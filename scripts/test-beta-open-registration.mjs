import assert from 'node:assert/strict';
import {randomBytes,scryptSync} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {copyFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Readable} from 'node:stream';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Real authentication middleware + SQLite, always below a newly-created temp
// root. No production runtime, model, account, invitation or database is used.
const runtime=isolatedNpcRuntime();
const keys=['ZHIYU_BETA_MODE','ZHIYU_INVITE_ONLY','ZHIYU_PUBLIC_ORIGIN','ZHIYU_PUBLIC_ORIGINS','ZHIYU_NPC_ID'];
const prior=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
const legacy='11111111-2222-4333-8444-555555555555',password='Synthetic-only-registration-password';
const checks=[];
const check=name=>{checks.push(name);console.log('PASS '+name);};
const cookieOf=response=>response.headers['set-cookie']?.split(';')[0]||'';
function mode({beta,invite,publicOrigin}={}){
  for(const [key,value]of [['ZHIYU_BETA_MODE',beta],['ZHIYU_INVITE_ONLY',invite],['ZHIYU_PUBLIC_ORIGIN',publicOrigin]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  delete process.env.ZHIYU_PUBLIC_ORIGINS;process.env.ZHIYU_NPC_ID=legacy;
}
try{
 const identity=await runtime.load('server/npc/beta-identity'),{authLocal}=await runtime.load('server/npc/auth-plugin');
 async function scenario(name,run){
  const root=join(runtime.root,name),emitter=new EventEmitter();
  const opening='npc-skills/skills/zhiyu-dialogue/npcs/molly';mkdirSync(join(root,opening),{recursive:true});copyFileSync(join(runtime.root,opening,'opening.json'),join(root,opening,'opening.json'));
  let handler;authLocal().configureServer({config:{root,server:{port:3198}},httpServer:emitter,middlewares:{use(fn){handler=fn;}}});
  const db=new DatabaseSync(join(root,'.npc-runtime/state.sqlite'));
  function request(method,url,body,{cookie='',host='localhost:3198',origin='http://localhost:3198',account,peer='192.0.2.1',extraHeaders={}}={}){
   return new Promise(resolve=>{const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);req.method=method;req.url=url;req.socket={remoteAddress:peer};req.headers={host,origin,cookie,'content-type':'application/json',...(account?{'x-zhiyu-account':account}:{}),...extraHeaders};const headers={};const res={statusCode:200,setHeader(k,v){headers[k.toLowerCase()]=v;},end(text){resolve({status:this.statusCode,body:JSON.parse(text||'{}'),headers});}};handler(req,res,()=>resolve({next:true,req}));});
  }
  const register=(username,extra={},options)=>request('POST','/api/auth/register',{username,password,confirmPassword:password,...extra},options);
  try{await run({db,request,register});}finally{db.close();emitter.emit('close');}
 }
 mode({beta:'1'});
 await scenario('default-open-beta',async({db,request,register})=>{
  const session=await request('GET','/api/auth/session');assert.equal(session.body.inviteOnly,false);assert.equal(session.body.adultConfirmationRequired,true);
  for(const adultConfirmed of [undefined,false,'true'])assert.equal((await register('OpenBetaA',{adultConfirmed})).status,403);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM zhiyu_accounts').get().n,0);
  check('BETA默认开放注册，但缺失、否定或伪字符串成年确认均被服务端拒绝');
  db.exec('CREATE TABLE molly_sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
  const retained=JSON.stringify({messages:[{id:'synthetic-legacy-only',part:{type:'text',text:'synthetic retained desktop history'}}]});db.prepare('INSERT INTO molly_sessions VALUES(?,?)').run(legacy+':molly-system-secretary',retained);
  const a=await register('OpenBetaA',{adultConfirmed:true});assert.equal(a.status,200);assert.equal(a.body.account.storageMode,'server');assert.equal(a.body.account.internal,false);assert.equal(a.body.claimedLegacy,false);
  const accountA=a.body.account.id,cookieA=cookieOf(a),rowA=db.prepare('SELECT * FROM zhiyu_accounts WHERE id=?').get(accountA);
  assert.equal(rowA.is_beta,1);assert.equal(rowA.is_internal,0);assert.notEqual(rowA.owner_id,legacy);assert.ok(db.prepare('SELECT 1 FROM zhiyu_beta_adult_consent WHERE account_id=?').get(accountA));
  assert.equal(a.body.firstUse,true);const openingA=db.prepare('SELECT data FROM molly_sessions WHERE id=?').get(rowA.owner_id+':molly-system-secretary').data;
  const freshOpening=JSON.parse(openingA).messages;
  assert.equal(freshOpening.length,9);assert.equal(freshOpening.filter(message=>message.part.type==='text').length,8);
  assert.deepEqual(freshOpening[2].part,{type:'team_card',version:1});assert.equal(freshOpening[0].part.text,'老大，我是你的专属私人秘书Molly。');
  assert.equal(db.prepare('SELECT data FROM molly_sessions WHERE id=?').get(legacy+':molly-system-secretary').data,retained);
  check('空库首个公开注册仍为外部server账号，成年声明留档且不能认领或改写旧桌面owner');
  assert.equal((await register('OpenBetaA',{adultConfirmed:true})).status,409);
  const b=await register('OpenBetaB',{adultConfirmed:true});assert.equal(b.status,200);assert.notEqual(a.body.account.id,b.body.account.id);
  const accountB=b.body.account.id,cookieB=cookieOf(b),key='profile:'+accountA,value=JSON.stringify({name:'synthetic open A only'});
  const write=await request('PUT','/api/account/state',{accountId:accountA,requestId:'11111111-1111-4111-8111-111111111111',changes:[{key,value,revision:0}]},{cookie:cookieA,account:accountA});assert.equal(write.status,200);
  assert.equal((await request('GET','/api/account/state',undefined,{cookie:cookieB,account:accountB})).body.entries[key],undefined);
  assert.equal((await request('GET','/api/account/state',undefined,{cookie:cookieB,account:accountA})).status,409);
  assert.equal((await request('POST','/api/npc/realtime-speech/settings',{apiKey:'synthetic-only'},{cookie:cookieA,account:accountA})).status,403);
  assert.equal((await request('GET','/api/npc/molly?mode=test',undefined,{cookie:cookieA})).status,403);
  const forwarded=await request('GET','/api/npc/molly',undefined,{cookie:cookieA+'; zhiyu_npc='+legacy});assert.equal(forwarded.next,true);assert.match(forwarded.req.headers.cookie,new RegExp('zhiyu_npc='+rowA.owner_id));
  check('开放账号保服务器资料隔离与普通产品路由限制，伪旧owner Cookie被替换');
  const existingLogin=await request('POST','/api/auth/login',{username:'OpenBetaA',password});assert.equal(existingLogin.status,200);assert.equal(existingLogin.body.firstUse,false);assert.equal(db.prepare('SELECT data FROM molly_sessions WHERE id=?').get(rowA.owner_id+':molly-system-secretary').data,openingA);
  process.env.ZHIYU_INVITE_ONLY='1';const closedSession=await request('GET','/api/auth/session',undefined,{cookie:cookieA});assert.equal(closedSession.body.authenticated,true);assert.equal(closedSession.body.inviteOnly,true);assert.equal(closedSession.body.account.id,accountA);assert.equal(closedSession.body.account.storageMode,'server');
  assert.equal((await register('ClosedBySwitch',{adultConfirmed:true})).status,403);assert.equal((await request('POST','/api/auth/login',{username:'OpenBetaA',password})).status,403);
  process.env.ZHIYU_INVITE_ONLY='0';const restored=await request('POST','/api/auth/login',{username:'OpenBetaA',password});assert.equal(restored.status,200);assert.equal(restored.body.account.id,accountA);
  assert.equal((await request('GET','/api/account/state',undefined,{cookie:cookieOf(restored),account:accountA})).body.entries[key].value,value);assert.equal(db.prepare('SELECT owner_id FROM zhiyu_accounts WHERE id=?').get(accountA).owner_id,rowA.owner_id);
  check('显式0/1往返仅切换入口，已有session、owner及资料不重建，关闭后密码登录恢复原账号');
  const [invite]=identity.generateBetaInvites(db,{count:1,note:'isolated-open-mode'});
  assert.equal((await request('POST','/api/auth/invite',{code:invite.code,adultConfirmed:false})).status,403);const invited=await request('POST','/api/auth/invite',{code:invite.code,adultConfirmed:true});assert.equal(invited.status,200);assert.equal(invited.body.firstUse,true);
  const invitedOwner=db.prepare('SELECT owner_id FROM zhiyu_accounts WHERE id=?').get(invited.body.account.id).owner_id;
  const inviteKey=invitedOwner+':molly-system-secretary',inviteOpening=db.prepare('SELECT data FROM molly_sessions WHERE id=?').get(inviteKey).data;
  assert.equal(JSON.parse(inviteOpening).messages.length,9);assert.deepEqual(JSON.parse(inviteOpening).messages[2].part,{type:'team_card',version:1});
  assert.equal((await request('POST','/api/auth/invite',{code:invite.code,adultConfirmed:true})).body.firstUse,false);
  assert.equal(db.prepare('SELECT data FROM molly_sessions WHERE id=?').get(inviteKey).data,inviteOpening,'ordinary invite relogin cannot replay new opening');
  db.prepare('DELETE FROM npc_experience_onboarding WHERE owner=?').run(invitedOwner);db.prepare('DELETE FROM npc_opening_accounts WHERE owner=?').run(invitedOwner);db.prepare('DELETE FROM npc_opening_states WHERE owner=?').run(invitedOwner);db.prepare('DELETE FROM molly_sessions WHERE id=?').run(inviteKey);
  assert.equal((await request('POST','/api/auth/invite',{code:invite.code,adultConfirmed:true})).body.firstUse,false);
  assert.equal(db.prepare('SELECT 1 FROM molly_sessions WHERE id=?').get(inviteKey),undefined,'old invite with cleared history and marker is not mistaken for a fresh account');
  const salt=randomBytes(16).toString('hex'),digest=scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex');db.prepare('UPDATE zhiyu_accounts SET password_salt=?,password_digest=? WHERE id=?').run(salt,digest,invited.body.account.id);
  identity.updateBetaInvite(db,invite.id,{disabled:true});assert.equal((await request('POST','/api/auth/invite',{code:invite.code,adultConfirmed:true})).status,401);assert.equal((await request('GET','/api/account/state',undefined,{cookie:cookieOf(invited),account:invited.body.account.id})).status,401);
  assert.equal((await request('POST','/api/auth/login',{username:invited.body.account.username,password})).status,401);assert.equal(identity.listBetaInvites(db).find(row=>row.id===invite.id).status,'disabled');
  check('开放模式仍保邀请码API、成年门禁及停用撤销，禁用码绑定账号也不能通过密码绕过');
 });
 mode({beta:'0',invite:'0',publicOrigin:'https://beta.example.test'});
 await scenario('trusted-public-without-beta-env',async({db,request,register})=>{
  const options={host:'beta.example.test',origin:'https://beta.example.test'};
  const session=await request('GET','/api/auth/session',undefined,options);assert.equal(session.body.inviteOnly,false);assert.equal(session.body.adultConfirmationRequired,true);
  assert.equal((await register('PublicOrigin',{adultConfirmed:true},{...options,origin:'https://evil.example.test'})).status,403);
  const result=await register('PublicOrigin',{adultConfirmed:true},options);assert.equal(result.status,200);assert.equal(result.body.account.storageMode,'server');assert.equal(result.body.account.internal,false);assert.equal(result.body.claimedLegacy,false);assert.match(result.headers['set-cookie'],/; Secure/);
  assert.notEqual(db.prepare('SELECT owner_id FROM zhiyu_accounts WHERE id=?').get(result.body.account.id).owner_id,legacy);
  assert.equal((await request('GET','/api/auth/session',undefined,{host:'untrusted.example.test',origin:'https://untrusted.example.test'})).status,403);
  check('BETA环境关闭的受信公网仍要求成年/server账号/禁旧owner且保Secure Cookie和Origin/Host检查');
 });
 mode();
 await scenario('legacy-local-desktop',async({db,request,register})=>{
  const session=await request('GET','/api/auth/session');assert.equal(session.body.inviteOnly,false);assert.equal(session.body.adultConfirmationRequired,false);
  const result=await register('DesktopOwner');assert.equal(result.status,200);assert.equal(result.body.claimedLegacy,true);assert.equal(result.body.account.storageMode,undefined);assert.equal(result.body.account.internal,true);
  const row=db.prepare('SELECT * FROM zhiyu_accounts WHERE id=?').get(result.body.account.id);assert.equal(row.owner_id,legacy);assert.equal(row.is_beta,0);assert.equal(row.is_internal,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM zhiyu_beta_adult_consent').get().n,0);
  assert.equal((await request('POST','/api/auth/login',{username:'DesktopOwner',password})).status,200);
  check('真正本机旧桌面注册、首账号legacy认领、internal/local存储与密码登录保持原逻辑');
 });
 mode({beta:'0',invite:'1'});
 await scenario('explicit-invite-without-beta-env',async({db,request,register})=>{
  const session=await request('GET','/api/auth/session');assert.equal(session.body.inviteOnly,true);assert.equal(session.body.adultConfirmationRequired,true);
  assert.equal((await register('BlockedSignup',{adultConfirmed:true})).status,403);const [invite]=identity.generateBetaInvites(db,{count:1});const result=await request('POST','/api/auth/invite',{code:invite.code,adultConfirmed:true});assert.equal(result.status,200);assert.equal(result.body.account.storageMode,'server');
  check('显式邀请开关可独立启用，邀请生成及原邀请码登录继续工作');
 });
 mode({beta:'1',invite:'0'});
 await scenario('bounded-public-registration-hash',async({db,request,register})=>{
  const first=await register('RateCohort',{adultConfirmed:true});assert.equal(first.status,200);
  for(let attempt=2;attempt<=100;attempt++)assert.equal((await register('RateCohort',{adultConfirmed:true})).status,409);
  assert.equal((await register('RateBlocked',{adultConfirmed:true})).status,429);assert.equal(db.prepare('SELECT COUNT(*) n FROM zhiyu_accounts').get().n,1);
  assert.equal((await request('POST','/api/auth/login',{username:'RateCohort',password})).status,200);
  const [invite]=identity.generateBetaInvites(db,{count:1});assert.equal((await request('POST','/api/auth/invite',{code:invite.code,adultConfirmed:true})).status,200);
  assert.equal((await register('DifferentPeer',{adultConfirmed:true},{peer:'192.0.2.2'})).status,200);
  assert.equal((await register('HeaderBypass',{adultConfirmed:true},{extraHeaders:{'x-forwarded-for':'192.0.2.3'}})).status,429);
  const nativeNow=Date.now;try{const later=nativeNow()+15*60000+1;Date.now=()=>later;assert.equal((await register('AfterWindow',{adultConfirmed:true})).status,200);}finally{Date.now=nativeNow;}
  check('server注册hash前按真实peer限100次/15分钟，不信XFF；不同peer/登录/邀请码独立且过期可重开');
 });
 const output='output/beta-open-registration-20261116';mkdirSync(output,{recursive:true});writeFileSync(join(output,'backend-verification.json'),JSON.stringify({passed:true,isolated:true,productionDatabase:false,modelCalls:false,checks},null,2));
 console.log('open registration authentication: PASS ('+checks.length+' groups; temporary SQLite only)');
}finally{
 for(const key of keys){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}
 runtime.cleanup();
}
