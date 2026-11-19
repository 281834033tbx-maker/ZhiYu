import {createHash,randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {DatabaseSync} from 'node:sqlite';
import type {BetaAdminRole} from '../../lib/npc/beta-analytics';
import {secureRequestCookie} from './beta-identity';

const COOKIE='zhiyu_admin',AGE=8*3600;
type Secret={salt:string;digest:string};
type Secrets=Partial<Record<BetaAdminRole,Secret>>;
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
function equal(a:string,b:string){const left=Buffer.from(a,'hex'),right=Buffer.from(b,'hex');return left.length===right.length&&timingSafeEqual(left,right);}
export function betaCookie(req:IncomingMessage,name:string){return req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);}
export function readBetaAdminSecrets(root:string,env:NodeJS.ProcessEnv=process.env):Secrets {
  let stored:Secrets={};
  try{const parsed=JSON.parse(readFileSync(join(root,'.npc-runtime/beta-admin-secrets.json'),'utf8'));if(parsed?.version===1)stored=parsed.roles??{};}catch{/* No default password is ever created. */}
  const result:Secrets={};
  for(const role of ['founder','investor'] as const){
    const value=env[role==='founder'?'ZHIYU_ADMIN_FOUNDER_PASSWORD':'ZHIYU_ADMIN_INVESTOR_PASSWORD'];
    if(value&&value.length>=12&&Buffer.byteLength(value)<=512){const salt=digest('zhiyu-admin-env:'+role).slice(0,32);result[role]={salt,digest:scryptSync(value,Buffer.from(salt,'hex'),64).toString('hex')};}
    else{const secret=stored[role];if(secret&&/^[a-f0-9]{32}$/.test(secret.salt)&&/^[a-f0-9]{128}$/.test(secret.digest))result[role]=secret;}
  }
  // Distinct roles must not become equivalent credentials by a copy/paste mistake.
  if(env.ZHIYU_ADMIN_FOUNDER_PASSWORD&&env.ZHIYU_ADMIN_FOUNDER_PASSWORD===env.ZHIYU_ADMIN_INVESTOR_PASSWORD)delete result.investor;
  return result;
}
export function createBetaAdminAuth(db:DatabaseSync,root:string,options:{env?:NodeJS.ProcessEnv}={}) {
  db.exec(`CREATE TABLE IF NOT EXISTS zhiyu_beta_admin_sessions (token_digest TEXT PRIMARY KEY,role TEXT NOT NULL,credential_version TEXT NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS zhiyu_beta_admin_attempts (key TEXT PRIMARY KEY,count INTEGER NOT NULL,until_at INTEGER NOT NULL);`);
  const env=options.env??process.env;
  const secrets=()=>readBetaAdminSecrets(root,env);
  const version=(secret:Secret)=>digest(secret.salt+':'+secret.digest);
  const setCookie=(req:IncomingMessage,res:ServerResponse,token:string,age=AGE)=>res.setHeader('Set-Cookie',`${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secureRequestCookie(req)?'; Secure':''}`);
  return {
    configured(){const config=secrets();return {founder:!!config.founder,investor:!!config.investor};},
    sessionFor(req:IncomingMessage,now=Date.now()):BetaAdminRole|null {
      const token=betaCookie(req,COOKIE);if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
      const row=db.prepare('SELECT role,credential_version,expires_at FROM zhiyu_beta_admin_sessions WHERE token_digest=?').get(digest(token)) as {role:BetaAdminRole;credential_version:string;expires_at:number}|undefined;
      if(!row||row.expires_at<=now||(row.role!=='founder'&&row.role!=='investor'))return null;
      const secret=secrets()[row.role];return secret&&row.credential_version===version(secret)?row.role:null;
    },
    login(req:IncomingMessage,res:ServerResponse,input:{role?:unknown;password?:unknown},now=Date.now()) {
      const role=input.role;if(role!=='founder'&&role!=='investor')return {status:400,error:'请选择创始人或投资人账号'};
      const key=digest((req.socket.remoteAddress??'unknown')+':'+role),prior=db.prepare('SELECT count,until_at FROM zhiyu_beta_admin_attempts WHERE key=?').get(key) as {count:number;until_at:number}|undefined;
      if(prior&&prior.until_at>now&&prior.count>=5)return {status:429,error:'尝试次数过多，请 15 分钟后再试'};
      const password=typeof input.password==='string'&&Buffer.byteLength(input.password)<=512?input.password:'';
      const secret=secrets()[role];
      const candidate=scryptSync(password,Buffer.from(secret?.salt??'00000000000000000000000000000000','hex'),64).toString('hex');
      if(!secret||!equal(candidate,secret.digest)){
        db.prepare('INSERT INTO zhiyu_beta_admin_attempts VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,until_at=excluded.until_at').run(key,prior&&prior.until_at>now?prior.count+1:1,now+15*60000);
        return {status:401,error:secret?'账号或密码不正确':'该角色尚未配置后台密码'};
      }
      db.prepare('DELETE FROM zhiyu_beta_admin_attempts WHERE key=?').run(key);
      const token=randomBytes(32).toString('hex');
      db.prepare('DELETE FROM zhiyu_beta_admin_sessions WHERE expires_at<=?').run(now);
      db.prepare('INSERT INTO zhiyu_beta_admin_sessions VALUES(?,?,?,?)').run(digest(token),role,version(secret),now+AGE*1000);
      setCookie(req,res,token);return {status:200,role};
    },
    logout(req:IncomingMessage,res:ServerResponse){const token=betaCookie(req,COOKIE);if(token)db.prepare('DELETE FROM zhiyu_beta_admin_sessions WHERE token_digest=?').run(digest(token));setCookie(req,res,'',0);},
  };
}
