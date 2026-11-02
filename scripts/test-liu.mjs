import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';
const runtime=isolatedNpcRuntime(),dir=runtime.root;let server;
try {
 const load=name=>runtime.load((name.endsWith('plugin')||name.endsWith('prompt')?'server/npc/':'lib/npc/')+name);
 const {createLiu,parseLiu,applyLiu,nextNutritionWeek}=await load('liu');const {liuPrompt}=await load('liu-prompt');
 const a=createLiu(),b=createLiu();assert.equal(a.characterId,'liu');assert.equal(a.relationship,'strangers');assert.ok(Object.values(a.values).every(v=>v===0));assert.equal(Object.keys(a.values).length,22);assert.deepEqual(a.messages,[]);assert.deepEqual(a.memories,[]);assert.notEqual(a.branch,b.branch);
 const raw={action:'reply',messages:[{type:'text',text:'早餐想吃什么？'}],event:null,memories:[]};
 assert.throws(()=>parseLiu({...raw,messages:[{type:'sticker',assetId:'cow'}]},'你好'));
 applyLiu(a,parseLiu(raw,'你好'),'test');assert.equal(b.messages.length,0);assert.ok(Object.values(a.values).every(v=>v===0));
 const prompt=liuPrompt(process.cwd(),b,'你好');assert.match(prompt,/28岁/);assert.match(prompt,/170厘米/);assert.match(prompt,/慢热/);
 const {liuLocal}=await load('liu-plugin');let handler,calls=0;
 server=createServer((req,res)=>handler(req,res));liuLocal({available:()=>true,generate:async(_root,prompt)=>{
  calls++;
  const line=prompt.split('\n').find(line=>line.startsWith('【程序核实的任务委托来源；秘书来源不是本会话用户发言】'));
  const evidence=line && JSON.parse(line.slice(line.indexOf('】')+1));
  const source=evidence?.sources?.find(source=>source.text==='帮我安排下周早餐任务');
  if(!source)return raw;
  return {action:'reply',messages:[{type:'text',text:'下周早餐放这张卡里。'}],event:null,memories:[],task:{decision:'create',basis:'explicit_request',confidence:.99,scope:'current_user',polarity:'affirmed',readiness:'ready',sourceMessageId:source.id,evidence:source.text,title:'下周早餐',goalKey:'下周早餐',steps:nextNutritionWeek().map((date,index)=>({title:`第${index+1}天早餐`,scheduledDate:date,instructions:['燕麦、鸡蛋、牛奶和一份水果。']}))}};
 }}).configureServer({config:{root:dir},middlewares:{use:(_,h)=>handler=h},httpServer:server});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const first=await fetch(origin),cookie=first.headers.get('set-cookie').split(';')[0];assert.deepEqual((await first.json()).messages,[]);
 const turnId=crypto.randomUUID(),send=()=>fetch(origin,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'send',text:'你好',turnId})});
 assert.equal((await send()).status,200);await send();let state;
 for(let i=0;i<35;i++){state=await(await fetch(origin,{headers:{Cookie:cookie}})).json();if(state.messages.length===2)break;await new Promise(r=>setTimeout(r,200));}
 assert.equal(calls,1);assert.equal(state.messages.length,2);assert.equal(state.values,undefined);assert.equal(state.debug,undefined);
 const post=body=>fetch(origin,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post({action:'send',text:'帮我安排下周早餐任务',turnId:crypto.randomUUID()})).status,200);
 for(let i=0;i<60;i++){state=await(await fetch(origin,{headers:{Cookie:cookie}})).json();if(state.professionalTasks?.length===1&&state.messages.some(message=>message.part.type==='professional_task'))break;await new Promise(r=>setTimeout(r,150));}
 assert.equal(calls,2);assert.equal(state.professionalTasks.length,1);assert.equal(state.professionalTasks[0].characterId,'liu');
 const task=state.professionalTasks[0];assert.equal(task.steps.length,7);assert.ok(task.steps.every(step=>step.scheduledDate&&!step.completedAt));
 const eventId=crypto.randomUUID(),click={action:'task_step',taskId:task.id,stepId:task.steps[0].id,completed:true,eventId,expectedRevision:task.revision};
 const completed=await post(click);assert.equal(completed.status,200);const updated=await completed.json();assert.ok(updated.professionalTasks[0].steps[0].completedAt);
 const replay=await post(click);assert.equal(replay.status,200);assert.equal((await replay.json()).professionalTasks[0].revision,updated.professionalTasks[0].revision);
 assert.equal(calls,2,'a meal tick is not an invented conversational user input');
 assert.equal((await(await fetch(origin)).json()).messages.length,0);
 assert.equal((await fetch(origin,{method:'POST',headers:{Origin:'https://example.com'},body:'{}'})).status,403);
 console.log('PASS: Liu zero values, scoped persona, independent memory, HTTP reply, 7-day nutrition card, saved checkmarks, mutation idempotence, persistence, user isolation, hidden values and origin guard');
}finally{if(server)await new Promise(r=>server.close(r));runtime.cleanup();}
