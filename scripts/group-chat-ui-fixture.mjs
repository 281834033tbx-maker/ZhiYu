import {createServer, request as proxyRequest} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Real App assets and real group plugin, disposable state and synthetic API data.
// This server never forwards API calls or non-GET requests to the user's App.
const runtime=isolatedNpcRuntime();
const {groupChatsLocal}=await runtime.load('server/npc/groups-plugin');
const owner='5cad493a-f102-44f3-8a27-931049f19a42';
const account={id:'ea23ce77-1003-4438-8507-34aad738552d',username:'群聊测试用户'};
const handlers=[];
const report={namingAttempts:0,blockedApiWrites:0,names:[],dialogueCalls:[],uiFixture:true,realModel:false};
let failNext=false, failNextDialogue=false, failNextSend=false;
mkdirSync(join(runtime.root,'.npc-runtime'),{recursive:true});
const seed=new DatabaseSync(join(runtime.root,'.npc-runtime/state.sqlite'));
seed.exec('CREATE TABLE chen_sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
seed.prepare('INSERT INTO chen_sessions VALUES(?,?)').run(`${owner}:chen-nian`,JSON.stringify({mode:'normal',messages:[{
  id:'synthetic-allergy-message',role:'user',at:'2026-10-07T02:00:00.000Z',
  part:{type:'text',text:'我对海鲜过敏，体重72公斤，体脂率22%。'},
}]}));
seed.close();
const session={messages:[],pending:null,available:true,presence:'online',debugAllowed:false,revision:0};
const privateSessions=new Map();
const fixtureMoments=[];
function json(res,status,data){res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data));}
const server=createServer((req,res)=>{
  const path=(req.url||'/').split('?')[0];
  if(path==='/fixture/report')return json(res,200,report);
  if(path==='/fixture/fail-next'){failNext=true;return json(res,200,{ok:true});}
  if(path==='/fixture/fail-next-dialogue'){failNextDialogue=true;return json(res,200,{ok:true});}
  if(path==='/fixture/fail-next-send'){failNextSend=true;return json(res,200,{ok:true});}
  if(path==='/fixture/private-incoming'){
    const npc=new URL(req.url,'http://localhost').searchParams.get('npc')||'chen-nian';
    if(!['molly','chen-nian','xia-xia','yuan-xiaoman','liu','he-jiawei'].includes(npc))return json(res,400,{error:'Unknown synthetic NPC'});
    const current=privateSessions.get(npc)||{...session,messages:[]};
    current.messages.push({id:randomUUID(),role:'assistant',at:new Date().toISOString(),part:{type:'text',text:'隔离测试：收到一条新消息'}});
    privateSessions.set(npc,current);
    return json(res,200,{ok:true,npc,count:current.messages.length});
  }
  if(path==='/fixture/moment-incoming'){
    fixtureMoments.push({id:randomUUID(),personId:'yuan-xiaoman',status:'published',text:'隔离测试：动态头像资料定位',createdAt:Date.now(),images:[]});
    return json(res,200,{ok:true,count:fixtureMoments.length});
  }
  if(path==='/api/auth/session')return json(res,200,{authenticated:true,account});
  if(path.startsWith('/api/npc/groups')){
    if(req.headers['x-zhiyu-account']!==account.id)return json(res,409,{error:'测试账号不匹配'});
    if(req.method==='POST' && failNextSend){failNextSend=false;req.resume();return json(res,503,{error:'隔离测试：消息发送暂时失败，请重试'});}
    req.headers.cookie=`zhiyu_npc=${owner}`;
    req.url=req.url.slice('/api/npc/groups'.length)||'/';
    return handlers[0](req,res);
  }
  if(path.startsWith('/api/')){
    const privateNpc=path.replace('/api/npc/','');
    if(req.method==='POST' && ['molly','chen-nian','xia-xia','yuan-xiaoman','liu','he-jiawei'].includes(privateNpc)){
      let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
        let input;try{input=JSON.parse(body);}catch{return json(res,400,{error:'Invalid synthetic input'});}
        if(input.action!=='clear'&&input.action!=='read')return json(res,403,{error:'Only synthetic clear/read are allowed'});
        const current=privateSessions.get(privateNpc)||{...session,messages:[]};
        if(input.action==='clear'){current.messages=[];current.revision++;current.pending=null;}
        privateSessions.set(privateNpc,current);return json(res,200,current);
      });return;
    }
    if(req.method!=='GET'){report.blockedApiWrites++;return json(res,403,{error:'隔离测试不允许私聊写入'});}
    return json(res,200,path==='/api/npc/moments'?{items:fixtureMoments}:privateSessions.get(path.replace('/api/npc/',''))||session);
  }
  if(req.method!=='GET')return json(res,405,{error:'Only GET assets may be proxied'});
  const proxy=proxyRequest({hostname:'127.0.0.1',port:3100,path:req.url,method:'GET',headers:{host:'127.0.0.1:3100',accept:req.headers.accept||'*/*'}}, upstream=>{
    res.writeHead(upstream.statusCode||502,upstream.headers);upstream.pipe(res);
  });
  proxy.on('error',()=>json(res,502,{error:'本机UI服务未就绪'}));proxy.end();
});
const planDraft={days:Array.from({length:7},(_,index)=>({
  date:`2026-10-${String(8+index).padStart(2,'0')}`,label:index===5?'自由餐日':'常规减脂餐',
  breakfast:'鸡蛋1个、燕麦40克、牛奶250毫升',lunch:'鸡胸肉150克、米饭150克、西兰花200克',dinner:'豆腐200克、杂粮饭100克、青菜200克',
})),shopping:[{name:'鸡蛋',required:'7个',available:'已有4个',toBuy:'3个'},{name:'鸡胸肉',required:'1050克',available:'待确认',toBuy:'库存确认后扣除'},{name:'西兰花',required:'1400克',available:'待确认',toBuy:'库存确认后扣除'}]};
async function fixtureDialogue(context){
  report.dialogueCalls.push({kind:context.kind,mentionIds:context.incoming?.mentionIds||[],facts:context.facts.facts});
  if(failNextDialogue){failNextDialogue=false;throw Error('synthetic dialogue failure');}
  if(context.kind==='opening')return {messages:[
    {senderId:'molly',text:'老大，要安排接下来一周的减脂饮食。\n你之前提供的体重、体脂和海鲜过敏信息，已经放进这次规划资料里。\n@陈年，你来定一周饮食，先把还缺的条件问清楚。\n@赵一帆，你负责做饭指导。\n买菜清单我来整理。',mentionIds:['chen-nian','zhou-chef']},
    {senderId:'chen-nian',text:'海鲜会避开。\n除了海鲜，还有其他过敏或忌口吗？\n这周三餐都自己做吗，平时每顿能留多久做饭？\n家里现有的食材、用餐时间，也一起告诉我。',mentionIds:['user']},
    {senderId:'zhou-chef',text:'@陈年，菜单定好后我来接。\n老大，哪顿饭做之前叫我就好。',mentionIds:['chen-nian','user']},
  ]};
  if(context.kind==='confirmation')return {messages:[{senderId:'molly',text:'好的，老大，你的这些要求我都记下来了。\n@陈年 @赵一帆，你们两个好好干。',mentionIds:['chen-nian','zhou-chef']}]};
  if(context.kind==='reminder')return {messages:[{senderId:'zhou-chef',text:'老大，准备做早餐了，现在方便吗？这个时间还合适吗？',mentionIds:['user']}]};
  const recipient=context.incoming?.mentionIds?.[0];
  if(recipient==='zhou-chef')return {messages:[{senderId:'zhou-chef',text:'可以，鸡胸肉先切成厚薄均匀的片。\n老大，实际准备开始时告诉我，我接着讲下一步。',mentionIds:['user']}]};
  if(recipient==='molly')return {messages:[{senderId:'molly',text:'老大，我在。需要调整哪一项，直接说。',mentionIds:['user']}]};
  return {messages:[
    {senderId:'chen-nian',text:'一周饮食表已经整理好了，海鲜全部避开。\n每天的三餐和份量在上方计划里，你先看看是否合适。',mentionIds:['user']},
    {senderId:'molly',text:'老大，采购清单也整理好了。\n鸡蛋已有4个，还需要买3个；其他食材等你确认库存，再扣除。\n早餐暂提议08:00提醒，日期是10月8日至14日，确认后才开启。',mentionIds:['user']},
  ],planDraft,reminderProposals:[{meal:'breakfast',time:'08:00',startDate:'2026-10-08',endDate:'2026-10-14'}]};
}
groupChatsLocal({dialogue:async(_root,context)=>{
  const output=await fixtureDialogue(context);
  const currentIds=new Set(context.group.members.map(member=>member.id));
  output.messages=output.messages.filter(message=>currentIds.has(message.senderId)).map(message=>({
    ...message,mentionIds:message.mentionIds.filter(id=>currentIds.has(id)),
    text:message.text.replace(/@(陈年|赵一帆)/g,(token,name)=>currentIds.has(name==='陈年'?'chen-nian':'zhou-chef')?token:''),
  }));
  if(!output.messages.length)output.messages=[{senderId:'molly',text:'老大，我在。需要调整哪一项，直接说。',mentionIds:['user']}];
  if(!currentIds.has('chen-nian'))delete output.planDraft;
  if(!currentIds.has('zhou-chef'))delete output.reminderProposals;
  return output;
},namer:async(_root,{goal})=>{
  report.namingAttempts++;
  if(failNext){failNext=false;throw Error('synthetic naming failure');}
  const title=goal.includes('小满')?'闲聊也算进步':'吃饱再进步';report.names.push(title);return title;
}}).configureServer({config:{root:runtime.root},httpServer:server,middlewares:{use(_path,handler){handlers.push(handler);}}});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}`,isolated:true,realModel:false})));
process.on('SIGTERM',()=>server.close(()=>{runtime.cleanup();process.exit(0);}));
process.on('SIGINT',()=>server.close(()=>{runtime.cleanup();process.exit(0);}));
