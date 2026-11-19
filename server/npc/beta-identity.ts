import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import type {DatabaseSync} from 'node:sqlite';

export type BetaAccount={id:string;username:string;owner_id:string;created_at:number;display_number:string;is_internal:number;is_beta:number};
export type BetaInvite={id:string;codeHint:string;note:string;isInternal:boolean;status:'unused'|'used'|'disabled';accountId?:string;userNumber?:string;joinedAt?:number;createdAt:number};
const trustedRequest=Symbol.for('zhiyu.verified-public-request');
type RequestWithTrust=IncomingMessage&{[trustedRequest]?:{host:string;origin:string|undefined}};
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export function normalizeInviteCode(code:string){return code.toUpperCase().replace(/[\s-]/g,'');}
export function inviteCodeDigest(code:string){return digest(normalizeInviteCode(code));}
function publicOrigins(){
  const list=[process.env.ZHIYU_PUBLIC_ORIGIN||'',process.env.ZHIYU_PUBLIC_ORIGINS||''].join(',').split(',').map(v=>v.trim()).filter(Boolean);
  return list.flatMap(value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash?[u.origin]:[];}catch{return [];}});
}
function originalHeaders(req:IncomingMessage){const trusted=(req as RequestWithTrust)[trustedRequest];return trusted||{host:req.headers.host||'',origin:req.headers.origin};}
function hostURL(host:string){try{const u=new URL('http://'+host);return !u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash?u:null;}catch{return null;}}
const loopback=(host:string)=>['localhost','127.0.0.1','[::1]'].includes(host);
export function isTrustedHost(req:IncomingMessage){const {host}=originalHeaders(req),u=hostURL(host);return !!u&&(loopback(u.hostname)||publicOrigins().some(origin=>new URL(origin).host===u.host));}
export function isTrustedMutation(req:IncomingMessage){
  if(!isTrustedHost(req))return false;
  const {host,origin}=originalHeaders(req);if(!origin)return false;
  try{const u=new URL(origin);if(u.origin!==origin||u.host!==host)return false;return loopback(u.hostname)?['http:','https:'].includes(u.protocol):publicOrigins().includes(u.origin);}catch{return false;}
}
/** Only called after the outer auth boundary has validated the original host,
 * mutation Origin and account. Existing NPC middleware remains loopback-only. */
export function normalizeTrustedNpcRequest(req:IncomingMessage,port=3100){
  if(!isTrustedHost(req)||(req.method!=='GET'&&req.method!=='HEAD'&&!isTrustedMutation(req)))throw Error('请求来源无效');
  const record=req as RequestWithTrust;
  record[trustedRequest]??={host:req.headers.host||'',origin:req.headers.origin};
  req.headers.host=`localhost:${port}`;
  if(req.headers.origin)req.headers.origin=`http://localhost:${port}`;
}
export function secureRequestCookie(req:IncomingMessage){const u=hostURL(originalHeaders(req).host);return !!u&&!loopback(u.hostname);}
export function betaInviteRequired(_req?:IncomingMessage){
  return process.env.ZHIYU_INVITE_ONLY==='1';
}
/** Storage isolation and ordinary-user permissions are deployment boundaries,
 * independent from whether sign-in currently asks for an invitation. */
export function betaServerAccountRequired(req?:IncomingMessage){
  if(process.env.ZHIYU_BETA_MODE==='1')return true;
  if(betaInviteRequired(req))return true;
  if(!req)return false;
  const u=hostURL(originalHeaders(req).host);return !!u&&!loopback(u.hostname)&&isTrustedHost(req);
}
export function initBetaIdentity(db:DatabaseSync){
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS zhiyu_accounts(id TEXT PRIMARY KEY,username TEXT NOT NULL COLLATE NOCASE UNIQUE,password_salt TEXT NOT NULL,password_digest TEXT NOT NULL,owner_id TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS zhiyu_auth_sessions(token_digest TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES zhiyu_accounts(id),expires_at INTEGER NOT NULL);`);
  const columns=new Set((db.prepare('PRAGMA table_info(zhiyu_accounts)').all() as {name:string}[]).map(v=>v.name));
  if(!columns.has('is_internal')){db.exec('ALTER TABLE zhiyu_accounts ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0');db.exec('UPDATE zhiyu_accounts SET is_internal=1');}
  if(!columns.has('is_beta'))db.exec('ALTER TABLE zhiyu_accounts ADD COLUMN is_beta INTEGER NOT NULL DEFAULT 0');
  if(!columns.has('display_number'))db.exec('ALTER TABLE zhiyu_accounts ADD COLUMN display_number TEXT');
  for(const row of db.prepare('SELECT id FROM zhiyu_accounts WHERE display_number IS NULL ORDER BY created_at,id').all() as {id:string}[])
    db.prepare('UPDATE zhiyu_accounts SET display_number=? WHERE id=?').run(nextBetaUserNumber(db),row.id);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS zhiyu_user_number ON zhiyu_accounts(display_number);
    CREATE TABLE IF NOT EXISTS zhiyu_beta_invites(id TEXT PRIMARY KEY,code_digest TEXT NOT NULL UNIQUE,code_hint TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',disabled_at INTEGER,account_id TEXT UNIQUE REFERENCES zhiyu_accounts(id),used_at INTEGER,created_at INTEGER NOT NULL,is_internal INTEGER NOT NULL DEFAULT 0);`);
}
export function nextBetaUserNumber(db:DatabaseSync){const row=db.prepare("SELECT MAX(CAST(SUBSTR(display_number,2) AS INTEGER)) n FROM zhiyu_accounts").get() as {n:number|null};return `U${String((row.n||0)+1).padStart(6,'0')}`;}
export function lookupBetaAccount(req:IncomingMessage,db:DatabaseSync,now=Date.now()):BetaAccount|null{
  const token=req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('zhiyu_auth='))?.slice('zhiyu_auth='.length);
  if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
  const account=db.prepare(`SELECT a.id,a.username,a.owner_id,a.created_at,a.display_number,a.is_internal,a.is_beta FROM zhiyu_auth_sessions s JOIN zhiyu_accounts a ON a.id=s.account_id
    WHERE s.token_digest=? AND s.expires_at>? AND NOT EXISTS(SELECT 1 FROM zhiyu_beta_invites i WHERE i.account_id=a.id AND i.disabled_at IS NOT NULL)`).get(digest(token),now) as BetaAccount|undefined;
  return account||null;
}
export function publicBetaAccount(account:BetaAccount){return {id:account.id,username:account.username,userNumber:account.display_number,internal:account.is_internal===1,createdAt:account.created_at,...(account.is_beta===1?{storageMode:'server' as const}:{} )};}
export function generateBetaInvites(db:DatabaseSync,input:{count:number;note?:string;isInternal?:boolean},now=Date.now()){
  if(!Number.isInteger(input.count)||input.count<1||input.count>500)throw Error('一次可生成 1–500 个邀请码');
  const note=typeof input.note==='string'?input.note.trim():'';if(note.length>300)throw Error('备注最多300字');
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const created:Array<BetaInvite&{code:string}>=[];db.exec('BEGIN IMMEDIATE');
  try{for(let i=0;i<input.count;i++){
    const raw=Array.from(randomBytes(20),n=>alphabet[n%alphabet.length]).join('');
    const code='ZY-'+raw.match(/.{5}/g)!.join('-'),id=randomUUID(),codeHint=`ZY-${raw.slice(0,3)}…${raw.slice(-3)}`;
    db.prepare('INSERT INTO zhiyu_beta_invites(id,code_digest,code_hint,note,created_at,is_internal) VALUES(?,?,?,?,?,?)').run(id,inviteCodeDigest(code),codeHint,note,now,input.isInternal?1:0);
    created.push({id,code,codeHint,note,isInternal:!!input.isInternal,status:'unused',createdAt:now});
  }db.exec('COMMIT');return created;}catch(error){db.exec('ROLLBACK');throw error;}
}
export function listBetaInvites(db:DatabaseSync):BetaInvite[]{
  const rows=db.prepare(`SELECT i.*,a.display_number,a.created_at joined_at FROM zhiyu_beta_invites i LEFT JOIN zhiyu_accounts a ON a.id=i.account_id ORDER BY i.created_at DESC,i.id`).all() as Array<{id:string;code_hint:string;note:string;is_internal:number;disabled_at:number|null;account_id:string|null;used_at:number|null;created_at:number;display_number:string|null;joined_at:number|null}>;
  return rows.map(r=>({id:r.id,codeHint:r.code_hint,note:r.note,isInternal:r.is_internal===1,status:r.disabled_at!==null?'disabled':r.account_id?'used':'unused',...(r.account_id?{accountId:r.account_id,userNumber:r.display_number||undefined,joinedAt:r.joined_at||undefined}:{}),createdAt:r.created_at}));
}
export function setAccountInternal(db:DatabaseSync,accountId:string,internal:boolean){
  db.exec('SAVEPOINT beta_account_internal');try{
    const changed=!!db.prepare('UPDATE zhiyu_accounts SET is_internal=? WHERE id=?').run(internal?1:0,accountId).changes;
    if(changed)db.prepare('UPDATE zhiyu_beta_invites SET is_internal=? WHERE account_id=?').run(internal?1:0,accountId);
    db.exec('RELEASE SAVEPOINT beta_account_internal');return changed;
  }catch(reason){db.exec('ROLLBACK TO SAVEPOINT beta_account_internal');db.exec('RELEASE SAVEPOINT beta_account_internal');throw reason;}
}
export function updateBetaInvite(db:DatabaseSync,id:string,patch:{note?:string;disabled?:boolean;isInternal?:boolean},now=Date.now()){
  if(patch.note!==undefined&&(typeof patch.note!=='string'||patch.note.length>300))throw Error('备注最多300字');
  const invite=db.prepare('SELECT account_id FROM zhiyu_beta_invites WHERE id=?').get(id) as {account_id:string|null}|undefined;if(!invite)return false;
  db.exec('BEGIN IMMEDIATE');try{
    if(patch.note!==undefined)db.prepare('UPDATE zhiyu_beta_invites SET note=? WHERE id=?').run(patch.note.trim(),id);
    if(patch.disabled!==undefined){db.prepare('UPDATE zhiyu_beta_invites SET disabled_at=? WHERE id=?').run(patch.disabled?now:null,id);if(patch.disabled&&invite.account_id)db.prepare('DELETE FROM zhiyu_auth_sessions WHERE account_id=?').run(invite.account_id);}
    if(patch.isInternal!==undefined){db.prepare('UPDATE zhiyu_beta_invites SET is_internal=? WHERE id=?').run(patch.isInternal?1:0,id);if(invite.account_id)setAccountInternal(db,invite.account_id,patch.isInternal);}
    db.exec('COMMIT');return true;
  }catch(error){db.exec('ROLLBACK');throw error;}
}
export function claimBetaInvite(db:DatabaseSync,code:string,now=Date.now()):{account:BetaAccount;firstUse:boolean}|null{
  const normalized=normalizeInviteCode(code);if(!/^ZY[A-HJ-NP-Z2-9]{20}$/.test(normalized))return null;
  db.exec('BEGIN IMMEDIATE');try{
    const invite=db.prepare('SELECT id,account_id,is_internal FROM zhiyu_beta_invites WHERE code_digest=? AND disabled_at IS NULL').get(digest(normalized)) as {id:string;account_id:string|null;is_internal:number}|undefined;
    if(!invite){db.exec('ROLLBACK');return null;}
    if(invite.account_id){const account=db.prepare('SELECT * FROM zhiyu_accounts WHERE id=?').get(invite.account_id) as BetaAccount|undefined;db.exec('COMMIT');return account?{account,firstUse:false}:null;}
    const id=randomUUID(),owner=randomUUID(),number=nextBetaUserNumber(db);
    // Invitation accounts never have a usable password; the code is their sole login credential.
    db.prepare('INSERT INTO zhiyu_accounts(id,username,password_salt,password_digest,owner_id,created_at,display_number,is_internal,is_beta) VALUES(?,?,?,?,?,?,?,?,1)').run(id,'beta_'+number.toLowerCase(),randomBytes(16).toString('hex'),randomBytes(64).toString('hex'),owner,now,number,invite.is_internal);
    db.prepare('UPDATE zhiyu_beta_invites SET account_id=?,used_at=? WHERE id=? AND account_id IS NULL').run(id,now,invite.id);
    const account=db.prepare('SELECT * FROM zhiyu_accounts WHERE id=?').get(id) as BetaAccount;
    db.exec('COMMIT');return {account,firstUse:true};
  }catch(error){db.exec('ROLLBACK');throw error;}
}
