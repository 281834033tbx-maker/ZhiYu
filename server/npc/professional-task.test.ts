import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { cpSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ViteDevServer } from 'vite';
import { chefLocal } from './zhou-chef-plugin';
import type { generate } from './codex';
import { generate as generateChef } from './codex';
import { applyChef, createChef, parseChef } from '../../lib/npc/zhou-chef';
import { applyProfessionalTaskOperation, mutateProfessionalTaskStep, parseProfessionalTaskOperation, professionalTaskProgress, taskSourceAllowsCreation, type ProfessionalTask } from '../../lib/npc/professional-task';
import { chefPrompt } from './zhou-chef-prompt';

const reply = (text='接着做下一步，先把表面的水沥干。') => ({action:'reply',messages:[{type:'text',text}],event:null,memories:[],task:{decision:'none'}});
const proposal = (sourceMessageId='source', evidence='我要做地三鲜。', change:Record<string,unknown>={}) => ({decision:'create',basis:'execution_commitment',confidence:.95,scope:'current_user',polarity:'affirmed',readiness:'ready',sourceMessageId,evidence,title:'地三鲜',goalKey:'地三鲜',steps:[
  {title:'食材准备',details:['清洗、切配并沥干表面水分。']},
  {title:'土豆与茄子熟化',details:['熟化食材，检查完成状态。']},
  {title:'合炒与调味',details:['倒入拌匀的料汁，收至适当状态。']},
],...change});
const tick = () => new Promise(resolve=>setTimeout(resolve,10));
async function until(check:()=>boolean) {for(let i=0;i<300;i++){if(check())return;await tick();}assert.fail('异步测试未完成');}

void test('创建闸门核对真实来源、意图和目标；普通问答与假设不建任务，模型不能直接发卡',()=>{
  const positives:[string,string][]=[['我要做地三鲜。','execution_commitment'],['给我一个地三鲜任务，把步骤安排好。','explicit_request'],['今晚就做地三鲜，你帮我安排步骤。','execution_commitment'],['另外帮我安排现在做番茄炒蛋的步骤。','explicit_request']];
  for(const [text,basis] of positives)assert.equal(taskSourceAllowsCreation(text,basis as 'explicit_request'),true,text);
  for(const text of ['地三鲜怎么做？','给我看看地三鲜的完整做法。','最近挺想吃地三鲜的。','要是周末有空，我就做地三鲜。','我朋友说“我要做地三鲜”，你觉得他会做吗？','我要做地三鲜，但不要建任务，直接讲做法。','昨天我做了地三鲜。','分三步告诉我地三鲜怎么做，只讲解，不建立任务。']) {
    const tasks:ProfessionalTask[]=[];
    assert.throws(()=>applyProfessionalTaskOperation(tasks,parseProfessionalTaskOperation(proposal('source',text)),[{id:'source',text}],[]),text);
    assert.deepEqual(tasks,[]);
  }
  const op=parseProfessionalTaskOperation(proposal());
  assert.throws(()=>applyProfessionalTaskOperation([],op,[],[]),/本轮真实用户/);
  assert.throws(()=>applyProfessionalTaskOperation([],op,[{id:'source',text:'只是问做法'}],[]),/本轮真实用户/);
  assert.throws(()=>parseProfessionalTaskOperation(proposal('source','我要做地三鲜。',{confidence:.7})),/委托判断/);
  assert.throws(()=>parseChef({...reply(),messages:[{type:'professional_task',taskId:'invented'}]},'我要做地三鲜。'),/不支持/);
  assert.deepEqual(parseProfessionalTaskOperation(undefined),{decision:'none'});
});

void test('真实独立委托不被配料否定误杀，明确另开实例；重复任务和修订保留适用步骤ID',()=>{
  const source='不要糖，我现在做地三鲜。',tasks:ProfessionalTask[]=[];
  const created=applyProfessionalTaskOperation(tasks,parseProfessionalTaskOperation(proposal('source','我现在做地三鲜。')), [{id:'source',text:source}],[])!;
  assert.equal(tasks.length,1);assert.equal(created.created,true);
  const ids=created.task.steps.map(step=>step.id);
  mutateProfessionalTaskStep(created.task,ids[0],true,1);
  assert.equal(professionalTaskProgress(created.task).percent,33);
  const dup=applyProfessionalTaskOperation(tasks,parseProfessionalTaskOperation(proposal()),[{id:'source',text:'我要做地三鲜。'}],[])!;
  assert.equal(dup.created,false);assert.equal(tasks.length,1);assert.deepEqual(dup.task.steps.map(step=>step.id),ids);assert.ok(dup.task.steps[0].completedAt);
  const change='把青椒换成彩椒。';
  const edited=applyProfessionalTaskOperation(tasks,parseProfessionalTaskOperation(proposal('edit',change,{decision:'update',basis:'existing_task_change',taskId:created.task.id,steps:created.task.steps.map(step=>({id:step.id,title:step.title,details:['按照本轮修改的配料做。']}))})),[{id:'edit',text:change}],[])!;
  assert.deepEqual(edited.task.steps.map(step=>step.id),ids);assert.ok(edited.task.steps[0].completedAt);
  const deny='不要把地三鲜里的青椒换成彩椒。';
  assert.throws(()=>applyProfessionalTaskOperation(tasks,parseProfessionalTaskOperation(proposal('deny',deny,{decision:'update',basis:'existing_task_change',taskId:created.task.id})),[{id:'deny',text:deny}],[]),/否定了修改/);
  assert.throws(()=>applyProfessionalTaskOperation(tasks,parseProfessionalTaskOperation(proposal('edit',change,{decision:'update',basis:'existing_task_change',taskId:created.task.id,steps:created.task.steps.slice(1)})),[{id:'edit',text:change}],[]),/删除已经完成/);
  const again='地三鲜今天再做一次，另开一份任务。';
  applyProfessionalTaskOperation(tasks,parseProfessionalTaskOperation(proposal('again',again,{basis:'explicit_request',newInstance:true})),[{id:'again',text:again}],[]);
  assert.equal(tasks.length,2);assert.notEqual(tasks[0].id,tasks[1].id);assert.ok(tasks[0].steps[0].completedAt);
});

void test('方案改变先归档旧提示，改动作清当前步提示，改菜不继承同名旧食材准备进度',()=>{
  const tasks:ProfessionalTask[]=[];
  const task=applyProfessionalTaskOperation(tasks,parseProfessionalTaskOperation(proposal()),[{id:'source',text:'我要做地三鲜。'}],[])!.task;
  task.steps[1].hints.push({id:'old-hint',eventId:'old-event',stepId:task.steps[1].id,text:'旧做法提醒',at:new Date().toISOString(),messageIds:['old-message']});
  const source='把炸茄子改成少油煎。';
  applyProfessionalTaskOperation(tasks,parseProfessionalTaskOperation(proposal('edit',source,{decision:'update',basis:'existing_task_change',taskId:task.id,steps:task.steps.map((step,index)=>({id:step.id,title:step.title,details:index===1?['改为少油煎，按本轮方案检查状态。']:step.details}))})),[{id:'edit',text:source}],[]);
  assert.equal(task.steps[1].hints.length,0);assert.equal(task.previousPlans![0].steps[1].hints[0].text,'旧做法提醒');
  mutateProfessionalTaskStep(task,task.steps[0].id,true,task.revision);
  const oldId=task.steps[0].id,changeDish='地三鲜不做了，改做番茄炒蛋。';
  applyProfessionalTaskOperation(tasks,parseProfessionalTaskOperation(proposal('dish',changeDish,{decision:'update',basis:'existing_task_change',taskId:task.id,title:'番茄炒蛋',goalKey:'番茄炒蛋'})),[{id:'dish',text:changeDish}],[]);
  assert.equal(task.goalKey,'番茄炒蛋');assert.notEqual(task.steps[0].id,oldId);assert.equal(task.steps[0].completedAt,undefined);assert.ok(task.previousPlans!.at(-1)!.steps[0].completedAt);assert.equal(tasks.length,1);
});

void test('自然接受只连接最近真实具体执行提议；暂停、继续、取消不新建且不删进度',()=>{
  const tasks:ProfessionalTask[]=[];
  const plan={id:'plan',text:'做地三鲜吧，我带你一步步做。'};
  applyProfessionalTaskOperation(tasks,parseProfessionalTaskOperation(proposal('accept','行。',{basis:'accepted_plan',planMessageId:plan.id})),[{id:'accept',text:'行。'}],[plan]);
  assert.equal(tasks.length,1);
  assert.throws(()=>applyProfessionalTaskOperation([],parseProfessionalTaskOperation(proposal('accept','行。',{basis:'accepted_plan',planMessageId:'old'})),[{id:'accept',text:'行。'}],[{id:'old',text:plan.text},{id:'new1',text:'其他闲聊'},{id:'new2',text:'其他闲聊'},{id:'new3',text:'其他闲聊'}]),/实际执行方案/);
  assert.throws(()=>applyProfessionalTaskOperation([],parseProfessionalTaskOperation(proposal('accept','行。',{basis:'accepted_plan',planMessageId:'unrelated'})),[{id:'accept',text:'行。'}],[{id:'unrelated',text:'地三鲜这个名称很有意思。'}]),/实际执行方案/);
  const task=tasks[0];mutateProfessionalTaskStep(task,task.steps[0].id,true,task.revision);
  for(const text of ['不要取消地三鲜任务。','朋友说取消地三鲜任务。','朋友说，取消地三鲜任务。']){
    const control=parseProfessionalTaskOperation({decision:'cancel',basis:'existing_task_change',scope:'current_user',polarity:'affirmed',confidence:.95,taskId:task.id,sourceMessageId:'control',evidence:text});
    assert.throws(()=>applyProfessionalTaskOperation(tasks,control,[{id:'control',text}],[]),text);assert.equal(task.status,'active');
  }
  for(const [decision,text,status] of [['pause','今天先不做了。','paused'],['resume','继续刚才的地三鲜。','active'],['cancel','取消这份任务。','cancelled']] as const){
    const control=parseProfessionalTaskOperation({decision,basis:'existing_task_change',scope:'current_user',polarity:'affirmed',confidence:.95,taskId:task.id,sourceMessageId:'control',evidence:text});
    applyProfessionalTaskOperation(tasks,control,[{id:'control',text}],[]);assert.equal(task.status,status);assert.ok(task.steps[0].completedAt);assert.equal(tasks.length,1);
  }
});

void test('记录的44个语义案例对照来源闸门：正例可执行，反例即使模型错误create也被拦',()=>{
  const cases=JSON.parse(readFileSync(join(process.cwd(),'npc-skills/skills/zhiyu-professional-dialogue/references/interactive-task-intent-cases-20261010.json'),'utf8')).cases as {id:string;userText:string|null;context:{role:string;text:string}[];expectedDecision:string;expectedGoal?:string}[];
  for(const row of cases){
    if(!row.userText || !['create','none','clarify'].includes(row.expectedDecision))continue;
    const sources=[{id:'source',text:row.userText}];
    const lastUser=row.context.findLastIndex(message=>message.role==='user');
    const plans=row.context.slice(lastUser+1).filter(message=>message.role==='assistant').map((message,index)=>({id:`plan-${index}`,text:message.text}));
    if(row.expectedDecision==='create'){
      const accepted=plans.length&&taskSourceAllowsCreation(row.userText,'accepted_plan');
      const basis=accepted?'accepted_plan':taskSourceAllowsCreation(row.userText,'explicit_request')?'explicit_request':'execution_commitment';
      const tasks:ProfessionalTask[]=[];
      const goal=row.expectedGoal || '地三鲜';
      applyProfessionalTaskOperation(tasks,parseProfessionalTaskOperation(proposal('source',row.userText,{basis,title:goal,goalKey:goal,...(accepted?{planMessageId:plans.at(-1)!.id}:{})})),sources,plans);
      assert.equal(tasks.length,1,row.id);
    }else{
      for(const basis of ['explicit_request','execution_commitment','accepted_plan']){
        const tasks:ProfessionalTask[]=[];
        assert.throws(()=>applyProfessionalTaskOperation(tasks,parseProfessionalTaskOperation(proposal('source',row.id==='evidence_cannot_strip_negative_suffix'?'我要做地三鲜':row.userText!,{basis,...(plans.length?{planMessageId:plans.at(-1)!.id}:{})})),sources,plans),row.id+' '+basis);
        assert.equal(tasks.length,0,row.id);
      }
    }
  }
});

type Snapshot={messages:ReturnType<typeof createChef>['messages'];professionalTasks:ProfessionalTask[];pending:boolean;deliveryError:string;revision:number;error?:string;code?:string;relationshipValues:unknown};
async function fixture(root:string,runner:typeof generate,now:()=>number){
  cpSync(join(process.cwd(),'npc-skills'),join(root,'npc-skills'),{recursive:true});
  let handler:(req:IncomingMessage,res:ServerResponse)=>void=()=>{};
  const server=new EventEmitter();const plugin=chefLocal({available:()=>true,generate:runner,now});
  (plugin.configureServer as (server:ViteDevServer)=>void)({config:{root},httpServer:server,middlewares:{use:(_path:string,fn:typeof handler)=>{handler=fn;}}} as unknown as ViteDevServer);
  const request=(owner:string,method:string,body?:unknown)=>new Promise<{status:number;data:Snapshot}>(resolve=>{
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]) as IncomingMessage;req.method=method;req.url='/';req.headers={host:'127.0.0.1:3101',origin:'http://127.0.0.1:3101',cookie:owner?`zhiyu_npc=${owner}`:''};
    const res={statusCode:200,writableEnded:false,setHeader:()=>{},end(text:string){this.writableEnded=true;resolve({status:this.statusCode,data:JSON.parse(text)});}};
    handler(req,res as unknown as ServerResponse);
  });
  return{get:(owner:string)=>request(owner,'GET'),post:(owner:string,body:unknown)=>request(owner,'POST',body),close:()=>server.emit('close')};
}
const inputSource=(prompt:string)=>JSON.parse(/【本轮待回答[^】]+】([^\n]+)/.exec(prompt)![1]).at(-1).id as string;

void test('真实中间件账号隔离、任务保存、完成幂等/冲突、结构化提示与本机重开持久化',async()=>{
  const root=mkdtempSync(join(tmpdir(),'professional-task-api-'));let clock=Date.now(),calls=0;const prompts:string[]=[];
  const runner:typeof generate=async(_root,prompt)=>{calls++;prompts.push(prompt);return calls===1?{...reply('好，分三步做。'),task:proposal(inputSource(prompt))}:reply();};
  const owner=crypto.randomUUID(),other=crypto.randomUUID();let api=await fixture(root,runner,()=>clock);
  try{
    assert.equal((await api.get('')).status,401);
    await api.post(owner,{action:'send',text:'我要做地三鲜。',turnId:crypto.randomUUID()});await until(()=>calls===1);await tick();clock+=60_000;
    let snapshot=(await api.get(owner)).data;assert.equal(snapshot.professionalTasks.length,1);assert.equal(snapshot.messages.filter(message=>message.part.type==='professional_task').length,1);
    const task=snapshot.professionalTasks[0],beforeUsers=snapshot.messages.filter(message=>message.role==='user').length,values=snapshot.relationshipValues;
    const command={action:'task_step',taskId:task.id,stepId:task.steps[0].id,completed:true,eventId:crypto.randomUUID(),expectedRevision:task.revision};
    assert.equal((await api.post(other,command)).status,404);
    assert.equal((await api.post(owner,command)).status,200);assert.equal((await api.post(owner,command)).status,200);
    const conflict=await api.post(owner,{...command,eventId:crypto.randomUUID()});assert.equal(conflict.status,409);assert.equal(conflict.data.code,'TASK_REVISION_CONFLICT');assert.equal(conflict.data.professionalTasks[0].revision,2);
    assert.equal((await api.post(owner,{...command,completed:false})).status,409);
    await until(()=>calls===2);await tick();clock+=60_000;snapshot=(await api.get(owner)).data;
    assert.equal(snapshot.messages.filter(message=>message.role==='user').length,beforeUsers);assert.deepEqual(snapshot.relationshipValues,values);
    assert.equal(snapshot.professionalTasks[0].steps[1].hints.length,1);assert.ok(snapshot.messages.find(message=>message.professionalTaskHint?.stepId===task.steps[1].id));
    assert.match(prompts[1],/【本轮输入，仅为用户消息】""/);assert.match(prompts[1],/结构化步骤事件；不是用户发言/);
    assert.deepEqual((await api.get(other)).data.professionalTasks,[]);
    api.close();api=await fixture(root,runner,()=>clock);snapshot=(await api.get(owner)).data;
    assert.equal(snapshot.professionalTasks[0].id,task.id);assert.equal(snapshot.professionalTasks[0].steps[0].id,task.steps[0].id);assert.ok(snapshot.professionalTasks[0].steps[0].completedAt);assert.equal(snapshot.professionalTasks[0].steps[1].hints.length,1);assert.equal(calls,2);
  }finally{api.close();rmSync(root,{recursive:true,force:true});}
});

void test('撤销取消在途和延迟未送达旧提示；连续完成只保留最新进度提示，失败不撤销完成',async()=>{
  const root=mkdtempSync(join(tmpdir(),'professional-task-stale-'));let clock=Date.now(),calls=0;const releases:((value:unknown)=>void)[]=[];
  const runner:typeof generate=async(_root,prompt)=>{calls++;if(calls===1)return{...reply('分三步做。'),task:proposal(inputSource(prompt))};return new Promise(resolve=>releases.push(resolve));};
  const owner=crypto.randomUUID(),api=await fixture(root,runner,()=>clock);
  try{
    await api.post(owner,{action:'send',text:'我要做地三鲜。',turnId:crypto.randomUUID()});await until(()=>calls===1);await tick();clock+=60_000;
    let task=(await api.get(owner)).data.professionalTasks[0];
    const mutate=async(step:number,completed:boolean)=>{const response=await api.post(owner,{action:'task_step',taskId:task.id,stepId:task.steps[step].id,completed,eventId:crypto.randomUUID(),expectedRevision:task.revision});assert.equal(response.status,200);task=response.data.professionalTasks[0];return response;};
    await mutate(0,true);await until(()=>calls===2);await mutate(0,false);releases[0](reply('过时在途提醒'));await tick();
    assert.equal((await api.get(owner)).data.messages.some(message=>'text'in message.part&&message.part.text==='过时在途提醒'),false);
    await mutate(0,true);await until(()=>calls===3);releases[1](reply('过时延迟提醒'));await tick();await mutate(0,false);clock+=60_000;
    const undone=(await api.get(owner)).data;assert.equal(undone.messages.some(message=>'text'in message.part&&message.part.text==='过时延迟提醒'),false);assert.equal(undone.professionalTasks[0].steps[1].hints.length,0);
    await mutate(0,true);await until(()=>calls===4);await mutate(1,true);releases[2](reply('连续勾选前的旧提醒'));await tick();await api.post(owner,{action:'retry'});await until(()=>calls===5);releases[3](reply('最新第三步提醒'));await tick();clock+=60_000;
    const latest=(await api.get(owner)).data;assert.equal(latest.messages.some(message=>'text'in message.part&&message.part.text==='连续勾选前的旧提醒'),false);assert.ok(latest.messages.some(message=>'text'in message.part&&message.part.text==='最新第三步提醒'));assert.equal(professionalTaskProgress(latest.professionalTasks[0]).percent,67);
    const state=createChef();state.messages.push({id:'source',turnId:'input',role:'user',at:new Date(clock).toISOString(),part:{type:'text',text:'我要做地三鲜。'}});state.queue=['input'];
    applyChef(state,parseChef({...reply(),task:proposal()},'我要做地三鲜。'),'reply',clock);
    const prompt=chefPrompt(process.cwd(),state,'',clock,{id:'ui-event',taskId:state.professionalTasks[0].id,revision:2,kind:'step_completed',completedStepId:state.professionalTasks[0].steps[0].id,nextStepId:state.professionalTasks[0].steps[1].id,at:new Date(clock).toISOString()});
    assert.match(prompt,/不加私人关系分/);assert.match(prompt,/下一步已经开始/);
  }finally{api.close();rmSync(root,{recursive:true,force:true});}
});

void test('重开恢复持久完成事件；提示失败保留完成状态，停止自动重试并由retry恢复',async()=>{
  const root=mkdtempSync(join(tmpdir(),'professional-task-recovery-'));let clock=Date.now(),calls=0,fail=true;let release:(value:unknown)=>void=()=>{};
  const owner=crypto.randomUUID();
  const runner:typeof generate=async(_root,prompt)=>{calls++;if(calls===1)return{...reply('分三步做。'),task:proposal(inputSource(prompt))};if(calls===2)return new Promise(resolve=>{release=resolve;});if(fail)throw Error('synthetic offline');return reply('恢复后仅提示当前下一步。');};
  let api=await fixture(root,runner,()=>clock);
  try{
    await api.post(owner,{action:'send',text:'我要做地三鲜。',turnId:crypto.randomUUID()});await until(()=>calls===1);await tick();clock+=60_000;
    const task=(await api.get(owner)).data.professionalTasks[0];
    await api.post(owner,{action:'task_step',taskId:task.id,stepId:task.steps[0].id,completed:true,eventId:crypto.randomUUID(),expectedRevision:task.revision});await until(()=>calls===2);api.close();
    api=await fixture(root,runner,()=>clock);await until(()=>calls===3);await tick();release(reply('旧服务关闭后的草稿'));await tick();
    let snapshot=(await api.get(owner)).data;assert.ok(snapshot.professionalTasks[0].steps[0].completedAt);assert.match(snapshot.deliveryError,/暂时/);assert.equal(snapshot.messages.some(message=>'text'in message.part&&message.part.text==='旧服务关闭后的草稿'),false);
    await new Promise(resolve=>setTimeout(resolve,1100));assert.equal(calls,3,'failure must not repeatedly generate');
    fail=false;await api.post(owner,{action:'retry'});await until(()=>calls===4);await tick();clock+=60_000;snapshot=(await api.get(owner)).data;
    assert.equal(snapshot.deliveryError,'');assert.equal(snapshot.professionalTasks[0].steps[1].hints.length,1);assert.ok(snapshot.messages.find(message=>'text'in message.part&&message.part.text==='恢复后仅提示当前下一步。'));
  }finally{api.close();rmSync(root,{recursive:true,force:true});}
});

void test('结构化完成事件经真实generate检索/条件规划/生成/复核链，空用户输入保留并不写事实或关系',async()=>{
  const root=mkdtempSync(join(tmpdir(),'professional-task-pipeline-'));let clock=Date.now(),calls=0;const stages:string[]=[];
  const owner=crypto.randomUUID();
  const runner:typeof generate=async(runRoot,prompt,options)=>{
    calls++;
    if(calls===1)return{...reply('分三步做。'),task:proposal(inputSource(prompt))};
    return generateChef(runRoot,prompt,{...options,runRaw:async(_root,input)=>{
      if(input.startsWith('你是NPC聊天案例检索器')){
        stages.push('retrieval');assert.match(input,/【结构化步骤事件；不是用户发言】/);assert.match(input,/"nextStepId"/);assert.match(input,/"completedAt"/);assert.match(input,/【本轮输入，仅为用户消息】""/);
        return{ids:[],recipeIds:[],westernDessertRecipeIds:[],chefPlan:{taskMode:'step_guidance',knownFacts:[],conditions:[],answerMode:'direct',routeBasis:'真实持久完成事件定位尚未完成的下一步',qualityBasis:'沿本次保存方案提醒操作，未厨房验证',kitchenVerified:false}};
      }
      if(input.startsWith('你在智域扮演独立虚构成年人物赵一帆')){stages.push('generation');assert.match(input,/"nextStepId"/);assert.match(input,/土豆与茄子熟化/);return reply('接着处理土豆和茄子，下锅前沥干水。');}
      if(input.startsWith('你是NPC私聊成品编辑')){stages.push('review');assert.match(input,/"nextStepId"/);assert.match(input,/土豆与茄子熟化/);return{verdict:'keep',edits:[],remove:[],chefCheck:{verdict:'pass',issues:[]}};}
      throw Error('未预期的隔离生成阶段');
    }});
  };
  const api=await fixture(root,runner,()=>clock);
  try{
    await api.post(owner,{action:'send',text:'我要做地三鲜。',turnId:crypto.randomUUID()});await until(()=>calls===1);await tick();clock+=60_000;
    const before=(await api.get(owner)).data,task=before.professionalTasks[0];
    await api.post(owner,{action:'task_step',taskId:task.id,stepId:task.steps[0].id,completed:true,eventId:crypto.randomUUID(),expectedRevision:task.revision});await until(()=>stages.includes('review'));await tick();clock+=60_000;
    const after=(await api.get(owner)).data;assert.equal(after.deliveryError,'');assert.deepEqual(stages,['retrieval','generation','review']);assert.deepEqual(after.relationshipValues,before.relationshipValues);assert.equal(after.messages.filter(message=>message.role==='user').length,before.messages.filter(message=>message.role==='user').length);assert.equal(after.professionalTasks[0].steps[1].hints.length,1);
    const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(join(root,'.npc-runtime/state.sqlite'),{readOnly:true});
    try{const row=db.prepare('SELECT data FROM zhou_chef_sessions WHERE id=?').get(`${owner}:zhou-chef`) as {data:string};const stored=JSON.parse(row.data);assert.deepEqual(stored.memories,[]);assert.deepEqual(stored.proposals,[]);}finally{db.close();}
  }finally{api.close();rmSync(root,{recursive:true,force:true});}
});
