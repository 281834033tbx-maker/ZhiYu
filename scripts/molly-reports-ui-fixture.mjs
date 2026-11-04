import {createServer, request as proxyRequest} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Real report handlers on a disposable runtime. No authentication credentials,
// production NPC plugins, models, weather, payment or task services are loaded.
const assetPort=Number(process.env.ZHIYU_FIXTURE_ASSET_PORT||3104);
const fixturePort=Number(process.env.ZHIYU_REPORT_FIXTURE_PORT||0);
if(!Number.isInteger(assetPort)||assetPort<1024||assetPort>65535)throw Error('Invalid asset port');
if(fixturePort!==0&&(!Number.isInteger(fixturePort)||fixturePort<1024||fixturePort>65535))throw Error('Invalid fixture port');
const runtime=isolatedNpcRuntime();
const {secretaryLocal}=await runtime.load('server/npc/secretary-plugin');
const accounts={a:{id:'11111111-1111-4111-8111-111111111111',username:'简报演示 A'},b:{id:'22222222-2222-4222-8222-222222222222',username:'简报演示 B'}};
const bindings={'molly':['molly_sessions','molly-system-secretary'],'chen-nian':['chen_sessions','chen-nian'],'liu':['liu_sessions','liu'],'zhou-chef':['zhou_chef_sessions','zhou-chef'],'xia-xia':['sessions','xia-xia:normal'],'yuan-xiaoman':['yuan_sessions','yuan-xiaoman'],'he-jiawei':['he_sessions','he-jiawei']};
const counters={realApiReads:0,actualRealWrites:0,modelCalls:0,syntheticReportRequests:0,blockedNpcWrites:0,assetReads:0};
const handlers=[];let closing=false;
const proxies=new Set();
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const server=createServer((req,res)=>{
 void handle(req,res).catch(error=>{console.error(error);if(!res.headersSent)json(res,500,{error:'隔离演示未完成'});else res.end();});
});
secretaryLocal({automatic:false,now:()=>Date.parse('2026-11-04T08:00:00+08:00'),weather:{lookup:async()=>{throw Error('No fixture weather');},forecast:async()=>{throw Error('No fixture weather');},ipCity:async()=>{throw Error('No fixture location');}},teamAvailable:()=>false}).configureServer({config:{root:runtime.root},httpServer:server,middlewares:{use:(path,handler)=>handlers.push([path,handler])}});
const db=new DatabaseSync(join(runtime.root,'.npc-runtime/state.sqlite'));
function selected(req){return /(?:^|;\s*)report_demo_fixture=b(?:;|$)/u.test(req.headers.cookie||'')?'b':'a';}
function session(owner,character){
 const [table,key]=bindings[character];
 const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
 const row=exists?db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(`${owner}:${key}`):undefined;
 const state=row?JSON.parse(row.data):{messages:[],revision:0};
 return {messages:state.messages.filter(message=>!(state.privateHistoryHiddenIds||[]).includes(message.id)),pending:false,available:true,presence:'offline',debugAllowed:false,revision:state.revision,conversationId:key,deliveryError:''};
}
async function handle(req,res){
 const url=new URL(req.url||'/',`http://${req.headers.host}`),path=url.pathname,key=selected(req),account=accounts[key];
 if(path==='/fixture/report')return json(res,200,counters);
 if(path==='/fixture/edge-cases'){
  // Optional, explicit QA variant, never part of the fixed default sample.
  const row=db.prepare('SELECT data FROM molly_sessions WHERE id=?').get(`${account.id}:molly-system-secretary`);
  if(!row)return json(res,409,{error:'先打开 Molly 演示'});
  const state=JSON.parse(row.data),card=state.messages.findLast(message=>message.part.type==='daily_brief');
  if(!card)return json(res,409,{error:'先生成演示简报'});
  const brief=card.part.brief,pending=brief.pending.find(item=>item.id==='dinner-takeout');
  if(pending){pending.kind='choose';pending.text='晚餐方式（2 选 1）';pending.choices=[{text:'外卖',apply:pending.apply},{text:'食堂',apply:{kind:'add',item:{id:'dinner',time:'晚上',category:'meal_out',text:'晚餐：食堂',tag:'改期',ownerId:'liu'}}}];}
  if(!brief.schedule.some(item=>item.id==='qa-midnight'))brief.schedule.push({id:'qa-midnight',date:'2026-11-05',time:'06:00',category:'other',text:'看比赛',ownerId:'molly'});
  state.revision++;db.prepare('UPDATE molly_sessions SET data=? WHERE id=?').run(JSON.stringify(state),`${account.id}:molly-system-secretary`);
  res.writeHead(302,{'Location':'/?npc=molly','Cache-Control':'no-store'});return res.end();
 }
 if(path==='/fixture/account-a'||path==='/fixture/account-b'){
  const next=path.endsWith('b')?'b':'a';
  res.writeHead(302,{'Location':'/?npc=molly','Cache-Control':'no-store','Set-Cookie':[`report_demo_fixture=${next}; Path=/; HttpOnly; SameSite=Strict`,`zhiyu_npc=${accounts[next].id}; Path=/; HttpOnly; SameSite=Strict`]});return res.end();
 }
 if(/^\/api/iu.test(path)){
  if(path==='/api/auth/session'&&req.method==='GET'){
   res.setHeader('Set-Cookie',`zhiyu_npc=${account.id}; Path=/; HttpOnly; SameSite=Strict`);
   return json(res,200,{authenticated:true,account});
  }
  if(path==='/api/npc/secretary'){
   counters.syntheticReportRequests++;
   req.url=url.pathname.slice('/api/npc/secretary'.length)+'/'+url.search;
   return handlers.find(([prefix])=>prefix==='/api/npc/secretary')[1](req,res);
  }
  if(req.method!=='GET'){counters.blockedNpcWrites++;req.resume();return json(res,403,{error:'隔离演示不发送人物消息'});}
  if(path==='/api/npc/groups')return json(res,200,{groups:[]});
  if(path==='/api/npc/moments')return json(res,200,{items:[]});
  const character=path.slice('/api/npc/'.length);
  if(Object.hasOwn(bindings,character))return json(res,200,session(account.id,character));
  return json(res,404,{error:'隔离演示无此接口'});
 }
 if(req.method!=='GET'){req.resume();return json(res,405,{error:'界面资源只读'});}
 if(path==='/__open-in-editor'||path.startsWith('/@fs/'))return json(res,403,{error:'隔离演示禁止此资源'});
 counters.assetReads++;
 const proxy=proxyRequest({hostname:'127.0.0.1',port:assetPort,path:req.url,method:'GET',headers:{host:`127.0.0.1:${assetPort}`,accept:req.headers.accept||'*/*'}},upstream=>{
  const headers={...upstream.headers};delete headers['set-cookie'];
  res.writeHead(upstream.statusCode||502,headers);upstream.pipe(res);
 });
 proxies.add(proxy);proxy.on('close',()=>proxies.delete(proxy));proxy.on('error',()=>{if(!res.headersSent)json(res,502,{error:'隔离界面资源未就绪'});else res.end();});
 req.on('aborted',()=>proxy.destroy());proxy.end();
}
function stop(){
 if(closing)return;closing=true;
 for(const proxy of proxies)proxy.destroy();
 server.close(()=>{db.close();runtime.cleanup();});server.closeAllConnections();
}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
server.on('error',error=>{console.error(error);stop();process.exitCode=1;});
server.listen(fixturePort,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/?npc=molly`,isolated:true,...counters})));
