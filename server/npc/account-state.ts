import type {IncomingMessage,ServerResponse} from 'node:http';
import type {DatabaseSync} from 'node:sqlite';
import type {BetaAccount} from './beta-identity';

export type AccountStateSaveHook=(db:DatabaseSync,change:{account:BetaAccount;key:string;before:string|null;after:string|null;changeId:string;at:number})=>void;
type Change={key:string;value:string|null;revision:number};
const MAX_VALUE=20*1024*1024,MAX_ACCOUNT=32*1024*1024;
export function initAccountState(db:DatabaseSync){db.exec(`CREATE TABLE IF NOT EXISTS zhiyu_account_state(account_id TEXT NOT NULL,key TEXT NOT NULL,value TEXT,revision INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(account_id,key));
 CREATE TABLE IF NOT EXISTS zhiyu_account_state_writes(account_id TEXT NOT NULL,request_id TEXT NOT NULL,response TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(account_id,request_id));`);}
function reply(res:ServerResponse,status:number,value:unknown){res.statusCode=status;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(value));}
function entriesFor(db:DatabaseSync,id:string,keys?:string[]){
 const entries:Record<string,{value:string|null;revision:number}>=Object.create(null);
 if(keys)for(const key of keys){const row=db.prepare('SELECT value,revision FROM zhiyu_account_state WHERE account_id=? AND key=?').get(id,key) as {value:string|null;revision:number}|undefined;entries[key]=row||{value:null,revision:0};}
 else for(const row of db.prepare('SELECT key,value,revision FROM zhiyu_account_state WHERE account_id=?').all(id) as {key:string;value:string|null;revision:number}[])entries[row.key]={value:row.value,revision:row.revision};
 return entries;
}
export async function serveAccountState(req:IncomingMessage,res:ServerResponse,db:DatabaseSync,account:BetaAccount,onSaved?:AccountStateSaveHook){
 if(req.headers['x-zhiyu-account']&&req.headers['x-zhiyu-account']!==account.id)return reply(res,409,{error:'账号已变化，请重新打开页面'});
 if(req.method==='GET')return reply(res,200,{accountId:account.id,entries:entriesFor(db,account.id)});
 if(!['PUT','POST'].includes(req.method||''))return reply(res,405,{error:'不支持的方法'});
 if(!req.headers['content-type']?.startsWith('application/json'))return reply(res,400,{error:'请发送JSON数据'});
 let text='',bytes=0;
 try{for await(const chunk of req){bytes+=Buffer.byteLength(chunk);if(bytes>MAX_ACCOUNT)return reply(res,413,{error:'保存内容过大，请减少图片大小'});text+=chunk.toString();}}catch{return reply(res,400,{error:'保存请求未完整收到'});}
 let body:{accountId?:unknown;requestId?:unknown;changes?:unknown};try{body=JSON.parse(text);}catch{return reply(res,400,{error:'保存内容格式无效'});}
 if(!body||body.accountId!==account.id)return reply(res,409,{error:'账号已变化，请重新打开页面'});
 if(typeof body.requestId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId)||!Array.isArray(body.changes)||!body.changes.length||body.changes.length>512)return reply(res,400,{error:'保存内容格式无效'});
 const keys=new Set<string>(),changes:Change[]=[];
 for(const value of body.changes){
  const item=value as Change;
  if(!item||typeof item.key!=='string'||!item.key||item.key.length>256||Array.from(item.key).some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127)||keys.has(item.key)||!Number.isSafeInteger(item.revision)||item.revision<0||(item.value!==null&&typeof item.value!=='string')||(typeof item.value==='string'&&Buffer.byteLength(item.value)>MAX_VALUE))return reply(res,400,{error:'保存内容格式无效'});
  if(/(?:^|[-_:])(?:auth|password|token|credential|invite-code)(?:$|[-_:])/i.test(item.key))return reply(res,400,{error:'此保存接口不能存放登录凭证'});
  keys.add(item.key);changes.push(item);
 }
 try{
  db.exec('BEGIN IMMEDIATE');
  const replay=db.prepare('SELECT response FROM zhiyu_account_state_writes WHERE account_id=? AND request_id=?').get(account.id,body.requestId) as {response:string}|undefined;
  if(replay){db.exec('COMMIT');return reply(res,200,JSON.parse(replay.response));}
  const current=entriesFor(db,account.id,[...keys]);
  if(changes.some(c=>current[c.key].revision!==c.revision)){db.exec('ROLLBACK');return reply(res,409,{accountId:account.id,error:'其他设备修改了资料',entries:current});}
  const totals=db.prepare('SELECT COALESCE(SUM(LENGTH(CAST(value AS BLOB))),0) bytes,COUNT(*) count FROM zhiyu_account_state WHERE account_id=?').get(account.id) as {bytes:number;count:number};
  const newBytes=totals.bytes+changes.reduce((sum,c)=>sum+Buffer.byteLength(c.value||'')-Buffer.byteLength(current[c.key].value||''),0);
  const newCount=totals.count+changes.filter(c=>current[c.key].revision===0).length;
  if(newBytes>MAX_ACCOUNT||newCount>2048){db.exec('ROLLBACK');return reply(res,413,{error:'此账号的资料空间已满，请联系管理员'});}
  const at=Date.now(),versions:Record<string,number>=Object.create(null);
  for(const change of changes){
   const revision=change.revision+1;versions[change.key]=revision;
   db.prepare('INSERT INTO zhiyu_account_state(account_id,key,value,revision,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(account_id,key) DO UPDATE SET value=excluded.value,revision=excluded.revision,updated_at=excluded.updated_at').run(account.id,change.key,change.value,revision,at);
   onSaved?.(db,{account,key:change.key,before:current[change.key].value,after:change.value,changeId:body.requestId+':'+change.key,at});
  }
  const response={ok:true,accountId:account.id,versions};
  db.prepare('INSERT INTO zhiyu_account_state_writes VALUES(?,?,?,?)').run(account.id,body.requestId,JSON.stringify(response),at);
  db.prepare('DELETE FROM zhiyu_account_state_writes WHERE account_id=? AND created_at<?').run(account.id,at-7*86400000);
  db.exec('COMMIT');return reply(res,200,response);
 }catch{try{db.exec('ROLLBACK');}catch{/* Already completed. */}return reply(res,500,{error:'资料尚未保存，请重试'});}
}
