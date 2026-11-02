import assert from 'node:assert/strict';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

const runtime=isolatedNpcRuntime();
try {
  const expiry=await runtime.load('lib/npc/professional-task-expiry');
  const core=await runtime.load('lib/npc/professional-task');
  const sessions=await runtime.load('lib/npc/professional-task-session');
  const timers=await runtime.load('lib/npc/professional-task-timer');
  const noon=Date.parse('2026-10-18T04:00:00Z'),boundary=Date.parse('2026-10-18T16:00:00Z');
  const iso=value=>new Date(value).toISOString();
  const step=(id,extra={})=>({id,title:'侧平举 '+id,details:['按计划完成肩部训练。'],hints:[],...extra});
  const task=(extra={})=>({id:crypto.randomUUID(),characterId:'chen-nian',title:'肩部训练',goalKey:'肩部训练',status:'active',createdAt:iso(noon),updatedAt:iso(noon),revision:1,sourceMessageId:'source',cardMessageId:'card',steps:[step('a'),step('b')],...extra});
  let checks=0;
  const check=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
  check('Shanghai midnight expires never-started undated work without fake completion or execution',()=>{
    const value=task();assert.equal(expiry.reconcileProfessionalTaskExpiry(value,boundary-1),false);
    assert.equal(expiry.reconcileProfessionalTaskExpiry(value,boundary),true);
    assert.equal(value.status,'skipped');assert.equal(value.skippedAt,iso(boundary));assert.equal(value.skipReason,'day-ended');
    assert.ok(value.steps.every(row=>row.skippedAt===iso(boundary)&&!row.completedAt));assert.equal(value.executionSessions,undefined);
    assert.deepEqual(core.professionalTaskProgress(value),{completed:0,total:2,percent:0,skipped:2,pending:0});
    const saved=JSON.stringify(value);assert.equal(expiry.reconcileProfessionalTaskExpiry(value,boundary+10*86400000),false);assert.equal(JSON.stringify(value),saved);
    assert.equal(core.nextProfessionalTaskStep(value),undefined);
  });
  check('offline recovery freezes a started session and step timer at the original day boundary',()=>{
    const value=task({steps:[step('a',{durationSeconds:300}),step('b')]});
    sessions.mutateProfessionalTaskSession(value,'start',value.revision,boundary-60000);
    timers.mutateProfessionalTaskTimer(value,'a','start',value.revision,boundary-60000);
    const before=JSON.stringify(value),projection=expiry.projectProfessionalTaskExpiry(value,boundary+3*86400000);
    assert.equal(JSON.stringify(value),before,'pure projections cannot mutate source data');
    assert.equal(projection.executionSessions[0].status,'skipped');assert.equal(projection.executionSessions[0].elapsedMs,60000);
    assert.equal(projection.executionSessions[0].finishedAt,iso(boundary));assert.equal(projection.executionSessions[0].skipReason,'day-ended');
    assert.equal(projection.steps[0].timer.remainingMs,240000);assert.equal(projection.steps[0].timer.updatedAt,iso(boundary));
    assert.equal(sessions.professionalTaskSessionView(value,boundary+86400000).canStart,false);
  });
  check('a paused real session keeps only recorded running time when its day ends',()=>{
    const value=task();sessions.mutateProfessionalTaskSession(value,'start',value.revision,boundary-60000);
    sessions.mutateProfessionalTaskSession(value,'pause',value.revision,boundary-30000);
    expiry.reconcileProfessionalTaskExpiry(value,boundary+86400000);
    assert.equal(value.executionSessions[0].status,'skipped');assert.equal(value.executionSessions[0].elapsedMs,30000);
    assert.equal(value.executionSessions[0].finishedAt,iso(boundary));
  });
  check('multi-day work skips only past unfinished steps and advances to a new real session',()=>{
    const value=task({steps:[step('a',{scheduledDate:'2026-10-18'}),step('b',{scheduledDate:'2026-10-18'}),step('c',{scheduledDate:'2026-10-19'})]});
    sessions.mutateProfessionalTaskSession(value,'start',value.revision,boundary-60000);
    core.mutateProfessionalTaskStep(value,'a',true,value.revision,boundary-30000);
    expiry.reconcileProfessionalTaskExpiry(value,boundary+60000);
    assert.equal(value.status,'active');assert.ok(value.steps[0].completedAt);assert.ok(value.steps[1].skippedAt);assert.equal(value.steps[2].skippedAt,undefined);
    assert.equal(core.nextProfessionalTaskStep(value).id,'c');assert.deepEqual(sessions.professionalTaskSessionScope(value,boundary+60000).map(row=>row.id),['c']);
    assert.equal(sessions.professionalTaskSessionView(value,boundary+60000).status,'idle');
    sessions.mutateProfessionalTaskSession(value,'start',value.revision,boundary+60000);
    assert.equal(value.executionSessions.length,2);assert.equal(value.executionSessions[1].date,'2026-10-19');
    core.mutateProfessionalTaskStep(value,'c',true,value.revision,boundary+120000);
    assert.equal(value.status,'skipped');assert.deepEqual(core.professionalTaskProgress(value),{completed:2,total:3,percent:67,skipped:1,pending:0});
  });
  check('skipped history cannot be resumed, completed, retimed, rescheduled or model-updated',()=>{
    const value=task({steps:[step('a',{scheduledDate:'2026-10-18',durationSeconds:300})]});expiry.reconcileProfessionalTaskExpiry(value,boundary);
    for(const mutate of [()=>core.mutateProfessionalTaskStep(value,'a',true,value.revision,boundary),()=>core.mutateProfessionalTaskStepDate(value,'a','2026-10-20',value.revision,boundary),()=>timers.mutateProfessionalTaskTimer(value,'a','start',value.revision,boundary),()=>sessions.mutateProfessionalTaskSession(value,'start',value.revision,boundary)])assert.throws(mutate,{code:'TASK_SKIPPED'});
    const text='修改当前肩部训练任务。';
    assert.throws(()=>core.applyProfessionalTaskOperation([value],{decision:'update',basis:'existing_task_change',confidence:.99,scope:'current_user',polarity:'affirmed',readiness:'ready',sourceMessageId:'edit',evidence:text,taskId:value.id,title:value.title,goalKey:value.goalKey,steps:[{title:'新动作',details:['按计划训练。']}]},[{id:'edit',text}],[],boundary,[],'chen-nian'),{code:'TASK_SKIPPED'});
    assert.ok(!value.steps[0].completedAt);
  });
  check('future-only edits preserve skipped IDs/content and archived history; deleted/changed skips are rejected',()=>{
    const value=task({steps:[step('a',{scheduledDate:'2026-10-18'}),step('b',{scheduledDate:'2026-10-20'})]});expiry.reconcileProfessionalTaskExpiry(value,boundary);
    const text='修改当前肩部训练任务。',content=value.steps.map(({id,title,details,scheduledDate})=>({id,title,details,scheduledDate}));
    const update=steps=>({decision:'update',basis:'existing_task_change',confidence:.99,scope:'current_user',polarity:'affirmed',readiness:'ready',sourceMessageId:'edit',evidence:text,taskId:value.id,title:value.title,goalKey:value.goalKey,steps});
    assert.throws(()=>core.applyProfessionalTaskOperation([value],update(content.slice(1)),[{id:'edit',text}],[],boundary,[],'chen-nian'),{code:'TASK_SKIPPED'});
    assert.throws(()=>core.applyProfessionalTaskOperation([value],update(content.map((row,index)=>index?row:{...row,scheduledDate:'2026-10-19'})),[{id:'edit',text}],[],boundary,[],'chen-nian'),{code:'TASK_SKIPPED'});
    core.applyProfessionalTaskOperation([value],update([...content,{title:'新侧平举',details:['按计划完成未来训练。'],scheduledDate:'2026-10-21'}]),[{id:'edit',text}],[],boundary,[],'chen-nian');
    assert.equal(value.status,'active');assert.equal(value.steps[0].skippedAt,iso(boundary));assert.equal(value.previousPlans[0].steps[0].skippedAt,iso(boundary));assert.equal(value.steps.length,3);
  });
  const proposal=(sourceMessageId,evidence,extra={})=>({decision:'create',basis:'explicit_request',confidence:.99,scope:'current_user',polarity:'affirmed',readiness:'ready',sourceMessageId,evidence,title:'肩部训练',goalKey:'肩部训练',steps:[{title:'侧平举',details:['按计划完成肩部训练。']}],...extra});
  check('late model delivery anchors undated work to the verified request day, not its later save day',()=>{
    const text='给我一个肩部训练任务。',savedAt=boundary+60000,tasks=[];
    const result=core.applyProfessionalTaskOperation(tasks,proposal('late',text),[{id:'late',text,at:iso(boundary-60000)}],[],savedAt,[],'chen-nian');
    assert.equal(result.task.createdAt,iso(savedAt));assert.equal(result.task.assignedDate,'2026-10-18');assert.equal(result.task.status,'skipped');assert.equal(result.task.steps[0].skippedAt,iso(boundary));
    const fresh='重新创建一个肩部训练任务。';
    const next=core.applyProfessionalTaskOperation(tasks,proposal('fresh',fresh,{newInstance:true}),[{id:'fresh',text:fresh,at:iso(savedAt)}],[],savedAt,[],'chen-nian');
    assert.equal(next.created,true);assert.notEqual(next.task.id,result.task.id);assert.equal(next.task.status,'active');assert.equal(next.task.assignedDate,'2026-10-19');
    const legacy=core.applyProfessionalTaskOperation([],proposal('manual',text),[{id:'manual',text}],[],savedAt,[],'chen-nian').task;
    assert.equal(legacy.status,'active');assert.equal(legacy.assignedDate,'2026-10-19');
  });
  check('completed and explicitly cancelled records remain unchanged; future dates survive multiple offline days',()=>{
    for(const status of ['completed','cancelled']){
      const value=task({status,steps:[step('a',status==='completed'?{completedAt:iso(noon)}:{})]}),before=JSON.stringify(value);
      assert.equal(expiry.reconcileProfessionalTaskExpiry(value,boundary+100*86400000),false);assert.equal(JSON.stringify(value),before);
    }
    const value=task({steps:[step('a',{scheduledDate:'2026-10-18'}),step('b',{scheduledDate:'2026-10-21'}),step('c',{scheduledDate:'2026-10-25'})]});
    expiry.reconcileProfessionalTaskExpiry(value,Date.parse('2026-10-22T02:00:00Z'));
    assert.equal(value.status,'active');assert.equal(value.steps[0].skippedAt,iso(boundary));assert.equal(value.steps[1].skippedAt,'2026-10-21T16:00:00.000Z');assert.equal(value.steps[2].skippedAt,undefined);
  });
  check('an earlier real completion cannot be undone or rescheduled by an offline old window',()=>{
    const value=task({steps:[step('a',{scheduledDate:'2026-10-18',completedAt:iso(noon)}),step('b',{scheduledDate:'2026-10-20'})]});
    const before=JSON.stringify(value);
    assert.throws(()=>core.mutateProfessionalTaskStep(value,'a',false,value.revision,boundary+60000),{code:'TASK_DAY_CLOSED'});
    assert.throws(()=>core.mutateProfessionalTaskStepDate(value,'a','2026-10-20',value.revision,boundary+60000),{code:'TASK_DAY_CLOSED'});
    assert.equal(JSON.stringify(value),before);
  });
  check('a session whose unfinished step was rescheduled still freezes on its actual start-day boundary',()=>{
    const value=task({steps:[step('a',{scheduledDate:'2026-10-18',durationSeconds:300})]});
    sessions.mutateProfessionalTaskSession(value,'start',value.revision,boundary-60000);
    timers.mutateProfessionalTaskTimer(value,'a','start',value.revision,boundary-60000);
    core.mutateProfessionalTaskStepDate(value,'a','2026-10-20',value.revision,boundary-30000);
    expiry.reconcileProfessionalTaskExpiry(value,boundary+60000);
    assert.equal(value.status,'active');assert.equal(value.steps[0].skippedAt,undefined);
    assert.equal(value.executionSessions[0].status,'skipped');assert.equal(value.executionSessions[0].elapsedMs,60000);
    assert.equal(value.steps[0].timer.remainingMs,240000);assert.equal(value.executionSessions[0].finishedAt,iso(boundary));
  });
  check('current expiry never rewrites archived execution snapshots with reused step IDs',()=>{
    const previous={id:'previous',kind:'training',date:'2026-10-18',stepIds:['a'],planVersion:0,taskTitle:'旧训练',steps:[{id:'a',title:'旧动作'}],status:'cancelled',startedAt:iso(noon),updatedAt:iso(noon+60000),finishedAt:iso(noon+60000),elapsedMs:60000};
    const value=task({steps:[step('a')],previousPlans:[{at:iso(noon+60000),title:'旧训练',goalKey:'旧训练',steps:[step('a')]}],executionSessions:[structuredClone(previous)]});
    expiry.reconcileProfessionalTaskExpiry(value,boundary);
    assert.equal(value.status,'skipped');assert.deepEqual(value.executionSessions[0],previous);
  });
  console.log(`PASS professional task expiry: ${checks} isolated fixed-clock groups; no production data/API/model/Jev operations.`);
}finally{runtime.cleanup();}
