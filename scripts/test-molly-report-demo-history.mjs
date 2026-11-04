import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Real prompt/domain/middleware code runs against a disposable project and DB.
// No browser, production data, payment channel or model request is used.
const runtime=isolatedNpcRuntime();
let db,server;
try {
  const {isReportDemoMessage,modelHistoryMessages,factualHistoryMessages}=await runtime.load('lib/npc/report-demo-history');
  const {privateHistoryMessages}=await runtime.load('server/npc/private-history');
  const {reportDemoContext}=await runtime.load('server/npc/report-demo-context');
  const now=Date.parse('2026-11-04T12:00:00+08:00'),at=new Date(now-1000).toISOString();
  const make=(id,role,text,extra={})=>({id,turnId:id,role,at,part:{type:'text',text},...extra});
  const actual=make('actual','user','我体重70公斤');
  const sample=make('sample','assistant','我体重166.2斤',{secretaryEvent:{id:'report-demo:quote:sample',kind:'weekly'}});
  const demoReply=make('sample-question','user','我腰围91厘米',{replyTo:sample.id});
  const daily={...sample,id:'daily',secretaryEvent:undefined,part:{type:'daily_brief',text:'演示简报',brief:{}}};
  const weekly={...sample,id:'weekly',secretaryEvent:undefined,part:{type:'weekly_report',text:'演示周报',report:{}}};
  const messages=[actual,sample,daily,weekly,demoReply],before=JSON.stringify(messages);
  assert.equal(isReportDemoMessage(sample),true);
  assert.equal(isReportDemoMessage(daily),true);
  assert.equal(isReportDemoMessage(weekly),true);
  assert.equal(isReportDemoMessage(actual),false);
  assert.equal(isReportDemoMessage({part:{type:'secretary_report'}}),false,'old genuine reports are not erased');
  assert.deepEqual(privateHistoryMessages({messages}),messages,'the public chat still displays demo cards');
  assert.deepEqual(modelHistoryMessages(messages).map(message=>message.id),['actual','sample-question']);
  assert.deepEqual(factualHistoryMessages(messages).map(message=>message.id),['actual']);
  assert.equal(JSON.stringify(messages),before,'filters never mutate original conversations');
  const quote=reportDemoContext(messages,now);
  assert.match(quote,/固定演示样例，不是用户真实记录/);
  assert.match(quote,/166\.2斤/,'an explicit question about a sample retains its exact labelled context');
  assert.equal(reportDemoContext([actual,sample],now),'','unquoted samples are absent from model context');
  assert.equal(reportDemoContext([actual,{...sample,deliverAt:now+10000},demoReply],now),'','undelivered samples cannot become quote context');
  console.log('PASS: visible samples remain visible; factual/model histories exclude them; explicit quotes are labelled as samples.');

  const cases=[
    ['lib/npc/engine','createState','server/npc/prompt','buildPrompt'],
    ['lib/npc/molly','createMolly','server/npc/molly-prompt','mollyPrompt'],
    ['lib/npc/yuan-xiaoman','createYuan','server/npc/yuan-prompt','yuanPrompt'],
    ['lib/npc/he-jiawei','createHe','server/npc/he-prompt','hePrompt'],
    ['lib/npc/chen-nian','createChen','server/npc/chen-prompt','chenPrompt'],
    ['lib/npc/liu','createLiu','server/npc/liu-prompt','liuPrompt'],
    ['lib/npc/zhou-chef','createChef','server/npc/zhou-chef-prompt','chefPrompt'],
  ];
  for(const [stateModule,creator,promptModule,builder] of cases) {
    const state=(await runtime.load(stateModule))[creator](stateModule.endsWith('engine')?'normal':undefined);
    state.messages=[actual,sample,daily,weekly];state.queue=[actual.turnId];
    const build=(await runtime.load(promptModule))[builder];
    assert.equal(typeof build,'function',builder);
    const prompt=build(runtime.root,state,actual.part.text);
    const history=prompt.split('\n').find(line=>/^【(?:本用户Molly聊天历史|有效聊天历史|真实历史)】/u.test(line));
    assert.ok(history,builder+' has a structured history');
    assert.match(history,/70公斤/);
    assert.doesNotMatch(history,/166\.2斤|daily_brief|weekly_report|report-demo:/,builder+' excludes sample data');
  }
  console.log('PASS: all seven character prompts omit sample data from their factual chat histories.');

  const {professionalTaskDelegationEvidence}=await runtime.load('lib/npc/professional-task-chat');
  const accepted=make('accepted','user','好',{at:new Date(now).toISOString()});
  const taskState={characterId:'chen-nian',messages:[actual,sample,accepted],queue:[accepted.turnId],professionalTasks:[]};
  assert.equal(professionalTaskDelegationEvidence(taskState,now).plans.length,0,'sample quote is not an accepted training plan');

  mkdirSync(join(runtime.root,'.npc-runtime'),{recursive:true});
  db=new DatabaseSync(join(runtime.root,'.npc-runtime/state.sqlite'));
  db.exec('CREATE TABLE molly_sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
  const owner=crypto.randomUUID(),other=crypto.randomUUID();
  const {createMolly}=await runtime.load('lib/npc/molly');
  const state=createMolly();state.messages=messages;
  db.prepare('INSERT INTO molly_sessions VALUES(?,?)').run(`${owner}:molly-system-secretary`,JSON.stringify(state));
  const {TaskMemoryStore}=await runtime.load('server/npc/group-task-memory');
  const memory=new TaskMemoryStore(db).collect(owner);
  assert.ok(memory.facts.some(fact=>fact.key==='weight'&&fact.value===70));
  assert.ok(!memory.facts.some(fact=>fact.key==='waist'||fact.value===83.1),'a response quoting a sample is not a real measurement');
  assert.equal(new TaskMemoryStore(db).collect(other).facts.length,0,'owner isolation is retained');
  console.log('PASS: real measurement extraction survives; sample projections/discussion cannot populate task memory or task plans.');

  for(const [stateModule,creator,applyName] of [
    ['lib/npc/engine','createState','finishTurn'],
    ['lib/npc/yuan-xiaoman','createYuan','applyYuan'],
    ['lib/npc/he-jiawei','createHe','applyHe'],
    ['lib/npc/chen-nian','createChen','applyChen'],
    ['lib/npc/liu','createLiu','applyLiu'],
    ['lib/npc/zhou-chef','createChef','applyChef'],
  ]) {
    const mod=await runtime.load(stateModule),person=mod[creator](stateModule.endsWith('engine')?'normal':undefined);
    const apply=source=>{
      const out={parts:[{type:'text',text:'这是展示的例子'}],action:'reply',event:null,task:{decision:'none'},memories:[{text:source.part.text,kind:'user_claim',evidence:source.part.text}]};
      person.queue=[source.turnId];
      if(applyName==='finishTurn')mod[applyName](person,source.turnId,source.part.text,out,now,false);
      else mod[applyName](person,out,source.turnId,now);
    };
    person.messages=[structuredClone(sample),structuredClone(demoReply)];
    apply(demoReply);assert.equal(person.memories.length,0,applyName+' rejects model-proposed memory from a sample discussion');
    person.messages.push(structuredClone(actual));
    apply(actual);assert.equal(person.memories.length,1,applyName+' preserves genuine user evidence');
  }
  console.log('PASS: all six ordinary character memory writers reject sample-derived proposals and still save genuine user claims.');

  const choice={...sample,id:'demo-choice',part:{type:'choice',text:'晚餐吃什么（2 选 1）',options:['食堂','外卖']}};
  state.messages=[choice];
  db.prepare('UPDATE molly_sessions SET data=? WHERE id=?').run(JSON.stringify(state),`${owner}:molly-system-secretary`);
  const {mollyLocal}=await runtime.load('server/npc/molly-plugin');
  let handler,modelCalls=0;server=new EventEmitter();
  mollyLocal({now:()=>now,available:()=>true,generate:async()=>{modelCalls++;throw Error('a demo choice must never call a real model');}})
    .configureServer({config:{root:runtime.root},httpServer:server,middlewares:{use(_path,fn){handler=fn;}}});
  const result=await new Promise(resolve=>{
    const req=Readable.from([Buffer.from(JSON.stringify({action:'send',turnId:crypto.randomUUID(),text:'食堂',choice:{messageId:choice.id,index:0},replyTo:choice.id}))]);
    req.method='POST';req.url='/';req.headers={host:'127.0.0.1:3101',origin:'http://127.0.0.1:3101',cookie:`zhiyu_npc=${owner}`};
    const res={statusCode:200,writableEnded:false,setHeader(){},end(value){this.writableEnded=true;resolve({status:this.statusCode,body:JSON.parse(value)});}};
    handler(req,res);
  });
  assert.equal(result.status,400);assert.match(result.body.error,/演示简报/);
  assert.equal(modelCalls,0);
  const saved=JSON.parse(db.prepare('SELECT data FROM molly_sessions WHERE id=?').get(`${owner}:molly-system-secretary`).data);
  assert.deepEqual(saved.queue,[]);assert.equal(saved.messages.length,1);
  assert.equal(saved.messages[0].part.selection,undefined,'rejected forged choice does not mutate the sample');
  console.log('PASS: forged ordinary Molly choice sends are rejected before selection, queue, model or task writes.');
} finally {
  server?.emit('close');db?.close();runtime.cleanup();
}
