import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

const runtime=isolatedNpcRuntime(),environment=['NPC_TEXT_PROVIDER','NPC_AUDIO_PROVIDER','NPC_CODEX_BIN'];
const previous=Object.fromEntries(environment.map(key=>[key,process.env[key]]));
let server,db;
try{
  process.env.NPC_TEXT_PROVIDER='codex';process.env.NPC_AUDIO_PROVIDER='local';
  const blocker=join(runtime.root,'no-real-model');writeFileSync(blocker,'#!/bin/sh\nexit 91\n',{mode:0o700});process.env.NPC_CODEX_BIN=blocker;
  const {mollyLocal}=await runtime.load('server/npc/molly-plugin');
  const {SecretaryStore}=await runtime.load('server/npc/secretary-service');
  const {generate,collectChefUserEvidence}=await runtime.load('server/npc/codex');
  const {SECRETARY_DELEGATION_INPUT_MARKER}=await runtime.load('lib/npc/secretary-delegation');
  mkdirSync(join(runtime.root,'.npc-runtime'),{recursive:true});db=new DatabaseSync(join(runtime.root,'.npc-runtime/state.sqlite'));
  const owner=crypto.randomUUID();let now=Date.now(),scenario='cook',groupCalls=0;
  const npcStages=[];
  const secretary=new SecretaryStore(db,runtime.root,{now:()=>now,
    groups:{create:async()=>{groupCalls++;return {id:'group-'+crypto.randomUUID()};},get:(_owner,id)=>({id})},
    receiverDeps:{available:()=>true,generate:async(root,prompt,options)=>{
      assert.ok(prompt.includes(SECRETARY_DELEGATION_INPUT_MARKER));
      const pool=collectChefUserEvidence(prompt);assert.ok(pool.some(row=>row.source==='secretary_delegation'&&row.text==='我今天要做西红柿鸡蛋'));
      return generate(root,prompt,{...options,runRaw:async(_root,input)=>{
        if(input.startsWith('你是NPC聊天案例检索器')){
          npcStages.push('retrieval');assert.ok(input.includes(SECRETARY_DELEGATION_INPUT_MARKER),'verified delegation must reach semantic source retrieval');
          return {ids:[],recipeIds:[],westernDessertRecipeIds:[],chefPlan:{taskMode:'full_recipe',knownFacts:[{name:'菜名',value:'西红柿鸡蛋',evidence:'西红柿鸡蛋'}],
            conditions:[{name:'菜名',state:'known',handling:'reuse',reason:'源需求已明确菜名'},{name:'人数',state:'unknown',handling:'ask',reason:'补问份量'}],
            answerMode:'clarify',routeBasis:'只问必要人数',qualityBasis:'只承接用户目标，不声称厨房验证',kitchenVerified:false}};
        }
        if(input.startsWith('你是NPC私聊成品编辑')){npcStages.push('review');return {verdict:'keep',edits:[],chefCheck:{verdict:'pass',issues:[]}};}
        if(input.startsWith('你是赵一帆最终成品技术复核器')){npcStages.push('final');return {chefCheck:{verdict:'pass',issues:[]}};}
        if(input.startsWith('你在智域扮演独立虚构成年人物赵一帆')){npcStages.push('generation');return {action:'reply',messages:[{type:'text',text:'做几个人的量？'}],event:null,memories:[],task:{decision:'none'}};}
        throw Error('Unexpected isolated NPC stage');
      }});
    }}});
  let handler;server=new EventEmitter();
  const saved=()=>JSON.parse(db.prepare('SELECT data FROM molly_sessions WHERE id=?').get(`${owner}:molly-system-secretary`).data);
  const mollyRunner=async(_root,prompt)=>{
    const state=saved(),source=state.messages.filter(message=>message.role==='user'&&state.queue.includes(message.turnId)).at(-1);
    const base={sourceMessageId:source.id,evidence:source.part.text,scope:'current_user',polarity:'affirmed',confidence:.99};
    if(scenario==='cook')return {intent:'operation',messages:['让赵一帆来'],address:null,query:null,
      actions:[{...base,type:'handoff',targetId:'zhou-chef',service:'cooking',request:'做西红柿鸡蛋',mode:'new'}]};
    if(scenario==='tasks'){assert.ok(prompt.includes('todayTasks'));return {intent:'operation',messages:['今天的任务在这里'],address:null,query:null,actions:[{...base,type:'tasks',taskScope:'today'}]};}
    return {intent:'operation',messages:['群建好了'],address:null,query:null,actions:[{...base,type:'create-group',memberIds:['chen-nian','liu'],goal:'安排训练与饮食'}]};
  };
  mollyLocal({available:()=>true,generate:mollyRunner,secretary,now:()=>now}).configureServer({config:{root:runtime.root},httpServer:server,middlewares:{use(_path,fn){handler=fn;}}});
  const send=(text,extra={})=>new Promise(resolve=>{
    const req=Readable.from([Buffer.from(JSON.stringify({action:'send',turnId:crypto.randomUUID(),text,...extra}))]);req.method='POST';req.url='/';req.headers={host:'127.0.0.1:3101',origin:'http://127.0.0.1:3101',cookie:`zhiyu_npc=${owner}`};
    const res={statusCode:200,writableEnded:false,setHeader(){},end(value){this.writableEnded=true;resolve({status:this.statusCode,body:JSON.parse(value)});}};handler(req,res);
  });
  const settled=async()=>{for(let i=0;i<200;i++){const state=saved();if(!state.pending&&!state.queue.length)return state;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Isolated Molly did not settle');};
  assert.equal((await send('我今天要做西红柿鸡蛋')).status,200);
  let state=await settled();assert.equal(state.messages.at(-1).part.text,'让赵一帆来');assert.equal(state.messages.at(-1).recommendations,undefined);
  assert.equal(db.prepare('SELECT status FROM npc_secretary_jobs').get().status,'queued');
  await secretary.drain(owner);
  assert.equal(db.prepare('SELECT status FROM npc_secretary_jobs').get().status,'delivered');
  const chef=JSON.parse(db.prepare('SELECT data FROM zhou_chef_sessions WHERE id=?').get(`${owner}:zhou-chef`).data);
  assert.equal(chef.messages.filter(message=>message.role==='user').length,0);
  assert.equal(chef.messages.at(-1).part.text,'做几个人的量？');assert.equal(chef.secretaryDelegations.length,1);
  assert.deepEqual(npcStages,['retrieval','generation','review']);
  await secretary.drain(owner);assert.equal(npcStages.length,3,'outbox retry cannot send another NPC response');
  console.log('PASS actual Molly handler → durable outbox → source-verified NPC → retrieval/generation/technical review; no fake user or contact card');

  scenario='tasks';now+=10000;assert.equal((await send('今天有什么任务')).status,200);state=await settled();assert.equal(state.messages.at(-1).taskLinks[0].scope,'today');
  scenario='group';now+=10000;assert.equal((await send('拉陈年和柳智敏建个群')).status,200);state=await settled();assert.equal(state.messages.at(-1).secretaryEvent.kind,'group');assert.ok(state.messages.at(-1).secretaryEvent.groupId.startsWith('group-'));assert.equal(groupCalls,1);
  console.log('PASS actual Molly task navigation and successful group receipt metadata');
  secretary.stop();server.emit('close');server=null;db.close();db=null;
}finally{
  server?.emit('close');db?.close();for(const key of environment){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}runtime.cleanup();
}
