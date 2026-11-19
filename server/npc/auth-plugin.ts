import {initializeNewAccountOpening} from './experience-onboarding';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync,readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Plugin } from 'vite';
import {readTaskCalendar, TASK_CALENDAR_CHARACTERS} from './task-calendar-reader';
import {accountContentResetAt} from '../../lib/npc/content-reset';
import {betaInviteRequired,betaServerAccountRequired,claimBetaInvite,initBetaIdentity,isTrustedHost,isTrustedMutation,lookupBetaAccount,nextBetaUserNumber,normalizeTrustedNpcRequest,publicBetaAccount,secureRequestCookie,type BetaAccount} from './beta-identity';
import {initAccountState,serveAccountState,type AccountStateSaveHook} from './account-state';
import {guardBetaNpcAccess} from './beta-access-policy';

const COOKIE = 'zhiyu_auth';
const SESSION_AGE_SECONDS = 30 * 24 * 60 * 60;
const USERNAME = /^[A-Za-z][A-Za-z0-9._-]{5,31}$/;
const LEGACY_OWNER = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// A reverse proxy can share one peer address across the small test cohort.
// Bound expensive registration hashing without trusting forwarded IP headers.
const REGISTER_ATTEMPTS_PER_WINDOW=100;

type Account = BetaAccount;
type Credentials = { username?: unknown; password?: unknown; confirmPassword?: unknown; code?:unknown; adultConfirmed?:unknown };

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function cookieValue(req: IncomingMessage, name: string) {
  return req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function setSessionCookie(req:IncomingMessage,res: ServerResponse, token: string) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_AGE_SECONDS}${secureRequestCookie(req)?'; Secure':''}`);
}

function clearSessionCookie(req:IncomingMessage,res: ServerResponse) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureRequestCookie(req)?'; Secure':''}`);
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<Credentials> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('请发送 JSON 数据');
  let text = '';
  for await (const chunk of req) {
    text += chunk.toString();
    if (text.length > 4096) throw new Error('请求内容过长');
  }
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求内容无效');
  return value as Credentials;
}

function passwordDigest(password: string, salt: string) {
  return scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex');
}

function equalDigest(a: string, b: string) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function authLocal(options:{onStateSaved?:AccountStateSaveHook}={}): Plugin {
  return {
    name: 'zhiyu-local-auth',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      mkdirSync(join(root, '.npc-runtime'), { recursive: true });
      const db = new DatabaseSync(join(root, '.npc-runtime/state.sqlite'));
      db.exec(`PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS zhiyu_accounts (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL COLLATE NOCASE UNIQUE,
          password_salt TEXT NOT NULL,
          password_digest TEXT NOT NULL,
          owner_id TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS zhiyu_auth_sessions (
          token_digest TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES zhiyu_accounts(id),
          expires_at INTEGER NOT NULL
        );`);
      initBetaIdentity(db);initAccountState(db);
      db.exec('CREATE TABLE IF NOT EXISTS zhiyu_beta_adult_consent(account_id TEXT PRIMARY KEY,first_accepted_at INTEGER NOT NULL,last_accepted_at INTEGER NOT NULL)');
      const attempts = new Map<string, { count: number; until: number }>();
      const publicAccount=(account:Account)=>{
        let at:number|undefined;
        try{at=accountContentResetAt(JSON.parse(readFileSync(join(root,'.npc-runtime/content-reset.json'),'utf8')),account.id);}catch{/* Missing maintenance markers preserve the existing account flow. */}
        return {...publicBetaAccount(account),...(at===undefined?{}:{contentResetAt:at})};
      };
      const accountFor = (req:IncomingMessage):Account|null=>lookupBetaAccount(req,db);
      const issueSession = (req: IncomingMessage, res: ServerResponse, account: Account, claimedLegacy = false, firstUse = false) => {
        const token = randomBytes(32).toString('hex');
        db.prepare('INSERT INTO zhiyu_auth_sessions VALUES(?,?,?)').run(hash(token), account.id, Date.now() + SESSION_AGE_SECONDS * 1000);
        setSessionCookie(req,res, token);
        send(res, 200, { authenticated: true, account: publicAccount(account), claimedLegacy, firstUse });
      };

      // This middleware must be registered before every NPC plugin. The browser's
      // old zhiyu_npc cookie is ignored; the authenticated account owns the ID.
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '/').split('?')[0];
        if (!path.startsWith('/api/auth/') && !path.startsWith('/api/npc/') && !path.startsWith('/api/beta/') && path!=='/api/account/state') return next();
        if (!isTrustedHost(req)) return send(res,403,{error:'请求地址未获允许'});
        if (path==='/api/account/state') {
          const account=accountFor(req);if(!account)return send(res,401,{error:'请先登录智域'});
          if(req.method!=='GET'&&!isTrustedMutation(req))return send(res,403,{error:'请求来源无效'});
          void serveAccountState(req,res,db,account,options.onStateSaved);return;
        }
        if(path.startsWith('/api/beta/')){
          if(!accountFor(req))return send(res,401,{error:'请先登录智域'});
          if(req.method!=='GET'&&!isTrustedMutation(req))return send(res,403,{error:'请求来源无效'});
          return next();
        }

        if (path.startsWith('/api/npc/')) {
          const account = accountFor(req);
          if (!account) return send(res, 401, { error: '请先登录智域' });
          if(req.method!=='GET'&&req.method!=='HEAD'&&!isTrustedMutation(req))return send(res,403,{error:'请求来源无效'});
          return guardBetaNpcAccess(req,res,account,()=>{
          if(account.is_beta===1&&new URL(req.url||'/', 'http://localhost').searchParams.get('mode')==='test')return send(res,403,{error:'内测账号仅可使用正式聊天'});
          if (path === '/api/npc/task-calendar') {
            if (req.headers['x-zhiyu-account'] !== account.id) return send(res, 409, {error: '账号已变化，请重新打开任务日历'});
            if (req.method !== 'GET') return send(res, 405, {error: '任务日历仅支持查看'});
            const characterId = new URL(req.url!, 'http://localhost').searchParams.get('npc') || '';
            if (!TASK_CALENDAR_CHARACTERS.has(characterId)) return send(res, 400, {error: '请选择已有的人物'});
            try {return send(res, 200, {accountId: account.id, characterId, ...readTaskCalendar(db, account, characterId)});}
            catch {return send(res, 500, {error: '任务记录暂时无法读取，请稍后刷新'});}
          }
          const isGroupRequest = path === '/api/npc/groups' || path.startsWith('/api/npc/groups/');
          const isChefRequest = path === '/api/npc/zhou-chef' || path.startsWith('/api/npc/zhou-chef/');
          const isChenRequest = path === '/api/npc/chen-nian' || path.startsWith('/api/npc/chen-nian/');
          const isSecretaryRequest = path === '/api/npc/secretary' || path.startsWith('/api/npc/secretary/');
          const isLiuRequest = path === '/api/npc/liu' || path.startsWith('/api/npc/liu/');
          if ((path === '/api/npc/he-jiawei' || isChefRequest || isChenRequest || isGroupRequest || isSecretaryRequest || isLiuRequest) && req.headers['x-zhiyu-account'] !== account.id)
            return send(res, 409, { error: isGroupRequest ? '账号已变化，请重新打开群聊' : isChefRequest ? '账号已变化，请重新打开赵一帆的聊天' : isChenRequest ? '账号已变化，请重新打开陈年的聊天' : isLiuRequest ? '账号已变化，请重新打开柳智敏的聊天' : isSecretaryRequest ? '账号已变化，请重新打开任务提醒设置' : '账号已变化，请重新打开何嘉伟的聊天' });
          const otherCookies = (req.headers.cookie || '').split(';').map(v => v.trim())
            .filter(v => v && !v.startsWith('zhiyu_npc=')).join('; ');
          req.headers.cookie = `${otherCookies}${otherCookies ? '; ' : ''}zhiyu_npc=${account.owner_id}`;
          normalizeTrustedNpcRequest(req,server.config.server?.port||3100);
          return next();
          });
        }

        if (path === '/api/auth/session' && req.method === 'GET') {
          const account = accountFor(req);
          const registration={inviteOnly:betaInviteRequired(req),adultConfirmationRequired:betaServerAccountRequired(req)};
          return send(res, 200, account
            ? { authenticated: true, account: publicAccount(account), claimedLegacy: account.owner_id === process.env.ZHIYU_NPC_ID,...registration }
            : { authenticated: false,...registration });
        }
        if (req.method !== 'POST' || !isTrustedMutation(req)) return send(res, 403, { error: '请求来源无效' });
        if (path === '/api/auth/logout') {
          const token = cookieValue(req, COOKIE);
          if (token) db.prepare('DELETE FROM zhiyu_auth_sessions WHERE token_digest=?').run(hash(token));
          clearSessionCookie(req,res);
          return send(res, 200, { authenticated: false });
        }
        if (!['/api/auth/register','/api/auth/login','/api/auth/invite'].includes(path)) return send(res, 404, { error: '接口不存在' });
        if(path!=='/api/auth/invite'&&betaInviteRequired(req))return send(res,403,{error:'内测期间请使用邀请码进入'});

        void (async () => {
          let body: Credentials;
          try { body = await readBody(req); }
          catch { return send(res, 400, { error: '请求内容无效' }); }
          if(path==='/api/auth/invite'){
            if(body.adultConfirmed!==true)return send(res,403,{error:'请先确认你已满18岁'});
            const key=`invite:${req.socket.remoteAddress||'local'}`,limit=attempts.get(key);
            if(limit&&limit.until>Date.now()&&limit.count>=15)return send(res,429,{error:'尝试次数过多，请15分钟后重试'});
            const code=typeof body.code==='string'&&body.code.length<=128?body.code:'';
            const claimed=claimBetaInvite(db,code);
            if(!claimed){attempts.set(key,{count:(limit&&limit.until>Date.now()?limit.count:0)+1,until:Date.now()+15*60000});return send(res,401,{error:'邀请码无效或已停用'});}
            attempts.delete(key);const now=Date.now();
            db.prepare('INSERT INTO zhiyu_beta_adult_consent VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET last_accepted_at=excluded.last_accepted_at').run(claimed.account.id,now,now);
            const firstUse=claimed.firstUse&&initializeNewAccountOpening(db,root,claimed.account.owner_id,now,false);
            return issueSession(req,res,claimed.account,false,firstUse);
          }
          const username = typeof body.username === 'string' ? body.username.trim() : '';
          const password = typeof body.password === 'string' ? body.password : '';
          if (!USERNAME.test(username)) return send(res, 400, { error: '账号须以字母开头，包含 6-32 位字母、数字、点、下划线或短横线' });
          if (path === '/api/auth/register') {
            const serverAccount=betaServerAccountRequired(req);
            if(serverAccount&&body.adultConfirmed!==true)return send(res,403,{error:'请先确认你已满18岁'});
            if (password.length < 12 || Buffer.byteLength(password) > 512) return send(res, 400, { error: '密码至少 12 位，且不能过长' });
            if (password !== body.confirmPassword) return send(res, 400, { error: '两次输入的密码不一致' });
            if(serverAccount){
              const key=`register:${req.socket.remoteAddress||'local'}`,now=Date.now(),limit=attempts.get(key);
              if(limit&&limit.until>now&&limit.count>=REGISTER_ATTEMPTS_PER_WINDOW)return send(res,429,{error:'注册尝试次数过多，请15分钟后重试'});
              attempts.set(key,{count:(limit&&limit.until>now?limit.count:0)+1,until:limit&&limit.until>now?limit.until:now+15*60000});
            }
            const salt = randomBytes(16).toString('hex');
            const digest = passwordDigest(password, salt);
            try {
              db.exec('BEGIN IMMEDIATE');
              if (db.prepare('SELECT id FROM zhiyu_accounts WHERE username=?').get(username)) {
                db.exec('ROLLBACK');
                return send(res, 409, { error: '这个账号名已被使用' });
              }
              const isFirst = !(db.prepare('SELECT id FROM zhiyu_accounts LIMIT 1').get());
              const legacy = process.env.ZHIYU_NPC_ID;
              const claimedLegacy = !!(!serverAccount && isFirst && legacy && LEGACY_OWNER.test(legacy));
              const account: Account = { id: randomUUID(), username, owner_id: claimedLegacy ? legacy! : randomUUID(),created_at:Date.now(),display_number:nextBetaUserNumber(db),is_internal:serverAccount?0:1,is_beta:serverAccount?1:0 };
              db.prepare('INSERT INTO zhiyu_accounts(id,username,password_salt,password_digest,owner_id,created_at,display_number,is_internal,is_beta) VALUES(?,?,?,?,?,?,?,?,?)').run(account.id, username, salt, digest, account.owner_id, account.created_at,account.display_number,account.is_internal,account.is_beta);
              if(serverAccount)db.prepare('INSERT INTO zhiyu_beta_adult_consent VALUES(?,?,?)').run(account.id,account.created_at,account.created_at);
              const firstUse=initializeNewAccountOpening(db,root,account.owner_id,Date.now(),claimedLegacy);
              db.exec('COMMIT');
              return issueSession(req, res, account, claimedLegacy,firstUse);
            } catch {
              try { db.exec('ROLLBACK'); } catch { /* transaction already ended */ }
              return send(res, 500, { error: '注册未完成，请稍后重试' });
            }
          }

          const key = `${req.socket.remoteAddress || 'local'}:${username.toLowerCase()}`;
          const limit = attempts.get(key);
          if (limit && limit.until > Date.now() && limit.count >= 5) return send(res, 429, { error: '尝试次数过多，请稍后再试' });
          const row = db.prepare('SELECT * FROM zhiyu_accounts WHERE username=?').get(username) as (Account & { password_salt: string; password_digest: string }) | undefined;
          const candidate = passwordDigest(password, row?.password_salt || '00000000000000000000000000000000');
          const inviteDisabled=!!row&&!!db.prepare('SELECT 1 FROM zhiyu_beta_invites WHERE account_id=? AND disabled_at IS NOT NULL').get(row.id);
          if (!row || inviteDisabled || !equalDigest(candidate, row.password_digest)) {
            const prior = limit?.until && limit.until > Date.now() ? limit.count : 0;
            attempts.set(key, { count: prior + 1, until: Date.now() + 15 * 60 * 1000 });
            return send(res, 401, { error: '账号或密码不正确' });
          }
          attempts.delete(key);
          return issueSession(req, res, row,row.owner_id===process.env.ZHIYU_NPC_ID);
        })().catch(() => send(res, 500, { error: '登录服务暂时不可用' }));
      });
      server.httpServer?.once('close', () => db.close());
    },
  };
}
