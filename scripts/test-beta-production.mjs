import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,mkdirSync,symlinkSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {request as httpRequest} from 'node:http';

// Production HTTP integration against a newly-created directory. Never point
// this test at the desktop database or at an existing deployment.
const folder=mkdtempSync(join(tmpdir(),'zhiyu-beta-production-test-'));
const founder='SyntheticFounder-'+randomUUID(),investor='SyntheticInvestor-'+randomUUID();
const env={...process.env};
for(const key of Object.keys(env))if(/API_KEY|TOKEN|SECRET|ZHIYU_ENV_FILE|ZHIYU_PUBLIC|NPC_|DEEPSEEK|DOUBAO|QWEN|DASHSCOPE|WEATHER/.test(key))delete env[key];
Object.assign(env,{ZHIYU_DATA_ROOT:folder,ZHIYU_BUILD_ROOT:resolve('dist'),HOST:'127.0.0.1',PORT:'0',NPC_TEXT_PROVIDER:'deepseek',DEEPSEEK_API_KEY:'',ZHIYU_ADMIN_FOUNDER_PASSWORD:founder,ZHIYU_ADMIN_INVESTOR_PASSWORD:investor});
for(const name of ['public','npc-skills','scripts'])symlinkSync(resolve(name),join(folder,name));
const child=spawn(process.execPath,['dist/beta/server.mjs'],{env,stdio:['ignore','pipe','pipe']});
let log='',origin='';const checks=[];
try{
  await new Promise((done,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Isolated production startup timed out')),30000);
    child.stdout.on('data',chunk=>{log+=chunk;const match=/http:\/\/127\.0\.0\.1:(\d+)/.exec(log);if(match){origin='http://127.0.0.1:'+match[1];clearTimeout(timeout);done();}});
    child.stderr.on('data',chunk=>{log+=chunk;});
    child.once('exit',()=>{clearTimeout(timeout);reject(Error('Isolated production server exited before ready'));});
  });
  async function request(path,{method='GET',body,cookie='',account,headers={}}={}){
    const response=await fetch(origin+path,{method,redirect:'manual',headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(account?{'X-Zhiyu-Account':account}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
    const text=await response.text();let data;try{data=JSON.parse(text);}catch{/* HTML or an empty response. */}
    return {status:response.status,data,text,cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};
  }
  assert.equal((await request('/')).status,302);
  for(const path of ['/mobile','/admin']){const r=await request(path);assert.equal(r.status,200);assert.ok(!r.text.includes('/@vite/client'));}
  assert.equal((await request('/healthz')).data.ok,true);checks.push('生产页面与资源入口，无Vite开发客户端');
  const dictionary=await request('/ime/rime-pinyin-simp/pinyin_simp.dict.yaml');
  assert.equal(dictionary.status,200);
  const hash=value=>createHash('sha256').update(value).digest('hex');
  assert.equal(hash(dictionary.text),hash(readFileSync('public/ime/rime-pinyin-simp/pinyin_simp.dict.yaml')));checks.push('完整离线拼音词库由生产静态服务原样提供');
  for(const path of ['/.env','/.npc-runtime/state.sqlite','/api/desktop/health','/api/npc/dialogue-health','/api/npc/dialogue-health/','/api/npc/dialogue-health/anything','/api/zhiyu-moments-health','/studio','/speech-settings','/npc/xia-xia/test'])assert.equal((await request(path)).status,404);
  assert.equal((await request('/api/npc/molly')).status,401);
  assert.equal((await request('/api/npc/audio/transcribe',{method:'POST',body:{audioId:randomUUID()+'.wav'}})).status,401);
  const badHost=await new Promise((done,reject)=>{const req=httpRequest(origin+'/api/auth/session',{headers:{Host:'untrusted.example'}},res=>{res.resume();done(res.statusCode);});req.on('error',reject);req.end();});
  assert.equal(badHost,403);checks.push('私有文件、维护页面、匿名API与未知Host被拒绝');
  const login=await request('/api/admin/login',{method:'POST',body:{role:'founder',password:founder}});assert.equal(login.status,200);
  const admin=login.cookie;
  const issue=await request('/api/admin/invites',{method:'POST',cookie:admin,body:{count:2,note:'synthetic-private-note'}});assert.equal(issue.status,200);
  const [a,b]=issue.data.invites;
  assert.equal((await request('/api/auth/invite',{method:'POST',body:{code:a.code,adultConfirmed:false}})).status,403);
  const accessA=await request('/api/auth/invite',{method:'POST',body:{code:a.code,adultConfirmed:true}});assert.equal(accessA.status,200);
  const accessB=await request('/api/auth/invite',{method:'POST',body:{code:b.code,adultConfirmed:true}});assert.equal(accessB.status,200);
  const accountA=accessA.data.account.id,accountB=accessB.data.account.id;
  assert.notEqual(accountA,accountB);checks.push('邀请码成人门禁与不同账号身份');
  assert.equal((await request('/api/npc/audio/transcribe',{method:'POST',cookie:accessA.cookie,account:accountA,body:{audioId:randomUUID()+'.wav'}})).status,404);
  assert.equal((await request('/api/npc/audio/transcribe',{cookie:accessA.cookie,account:accountA})).status,403);checks.push('生产语音转写路由需登录，仅POST且缺失语音不调用识别服务');
  const key='zhiyu-stitch-desktop-v2:'+accountA,value=JSON.stringify({selfProfile:{nickname:'isolated-a'},messages:{private:[{id:'fixture-message',text:'synthetic-only'}]}});
  const save=await request('/api/account/state',{method:'PUT',cookie:accessA.cookie,account:accountA,body:{accountId:accountA,requestId:randomUUID(),changes:[{key,value,revision:0}]}});assert.equal(save.status,200);
  const stateB=await request('/api/account/state',{cookie:accessB.cookie,account:accountB});assert.equal(stateB.data.entries[key],undefined);
  const renewed=await request('/api/auth/invite',{method:'POST',body:{code:a.code,adultConfirmed:true}});assert.equal(renewed.data.account.id,accountA);
  assert.equal((await request('/api/account/state',{cookie:renewed.cookie,account:accountA})).data.entries[key].value,value);
  assert.equal((await request('/api/account/state',{cookie:accessB.cookie,account:accountA})).status,409);checks.push('服务器资料隔离、无旧Cookie重登恢复、迟到旧账号拒绝');
  const started=await request('/api/beta/activity',{method:'POST',cookie:accessA.cookie,account:accountA,body:{action:'open',tabId:randomUUID(),seq:1,totalActiveMs:0,visible:true}});assert.equal(started.status,200);
  for(const path of ['/api/npc/molly?scenario=default','/api/npc/realtime-speech/settings']){
    const result=await request(path,{method:path.includes('settings')?'POST':'GET',cookie:accessA.cookie,account:accountA,...(path.includes('settings')?{body:{apiKey:'synthetic-test'}}:{})});assert.equal(result.status,403);
  }
  assert.equal((await request('/api/npc/secretary',{method:'POST',cookie:accessA.cookie,account:accountA,body:{action:'regenerate-report-demo',kind:'daily'}})).status,403);checks.push('内测用户不能调用全局设置或演示导入');
  const inv=await request('/api/admin/login',{method:'POST',body:{role:'investor',password:investor}});assert.equal(inv.status,200);
  const dashboard=await request('/api/admin/dashboard',{cookie:inv.cookie});assert.equal(dashboard.status,200);assert.ok(!dashboard.text.includes('synthetic-private-note'));assert.equal((await request('/api/admin/invites',{cookie:inv.cookie})).status,403);
  assert.equal((await request('/api/admin/export.csv?table=users',{cookie:inv.cookie})).text.includes('synthetic-private-note'),false);
  const flagged=await request('/api/admin/accounts/'+accountA+'/internal',{method:'POST',cookie:admin,body:{internal:true}});assert.equal(flagged.status,200);
  const after=await request('/api/admin/dashboard',{cookie:admin});assert.equal(after.data.users.some(user=>user.id===accountA),false);checks.push('投资人DTO/CSV过滤与内部账号排除');
  await request('/api/admin/invites/'+a.id,{method:'POST',cookie:admin,body:{disabled:true}});
  assert.equal((await request('/api/account/state',{cookie:renewed.cookie,account:accountA})).status,401);checks.push('邀请码停用立即撤销登录');
  mkdirSync('output/beta-release-20261115',{recursive:true});writeFileSync('output/beta-release-20261115/production-http-verification.json',JSON.stringify({passed:true,at:new Date().toISOString(),isolated:true,checks,realPhoneOrHardware:false},null,2));
  console.log('beta production HTTP: PASS ('+checks.length+' groups; isolated temporary directory only)');
}finally{
  child.kill('SIGTERM');await new Promise(done=>{if(child.exitCode!==null)return done();const timeout=setTimeout(()=>{child.kill('SIGKILL');done();},12000);child.once('exit',()=>{clearTimeout(timeout);done();});});
  rmSync(folder,{recursive:true,force:true});
}
