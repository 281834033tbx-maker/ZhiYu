import assert from 'node:assert/strict';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

// Pure, fixed clocks and synthetic tasks. No formal API, storage, or model calls.
const runtime = isolatedNpcRuntime();
process.on('exit', () => runtime.cleanup());
const {
  PROFESSIONAL_TASK_SESSION_VERSION, professionalTaskSessionKind, professionalTaskSessionScope,
  professionalTaskSessionView, professionalTaskSessionElapsedMs, mutateProfessionalTaskSession,
  freezeProfessionalTaskSessions, reconcileProfessionalTaskSessions,
} = await runtime.load('lib/npc/professional-task-session');
const { applyProfessionalTaskOperation, mutateProfessionalTaskStep, mutateProfessionalTaskStepDate } = await runtime.load('lib/npc/professional-task');
const t0 = Date.parse('2026-10-12T02:00:00Z');
const iso = time => new Date(time).toISOString();
const step = (id, extra = {}) => ({id, title:`卧推 ${id}`, details:['按计划完成动作。'], hints:[], ...extra});
const task = (extra = {}) => ({id:'task',characterId:'chen-nian',title:'胸部训练',goalKey:'胸部训练',status:'active',
  createdAt:iso(t0),updatedAt:iso(t0),revision:1,sourceMessageId:'source',cardMessageId:'card',steps:[step('a'),step('b')],...extra});
const start = (value, now = t0) => mutateProfessionalTaskSession(value, 'start', value.revision, now);
const complete = (value, id, now) => mutateProfessionalTaskStep(value, id, true, value.revision, now);
const undo = (value, id, now) => mutateProfessionalTaskStep(value, id, false, value.revision, now);
const changeStatus = (value, decision, now) => {
  const text = decision === 'pause' ? '暂停这个任务。' : decision === 'cancel' ? '取消这个任务。' : '继续这个任务。';
  return applyProfessionalTaskOperation([value], {decision,taskId:value.id,sourceMessageId:'status',evidence:text,
    confidence:.99,scope:'current_user',polarity:'affirmed',basis:'existing_task_change'}, [{id:'status',text}], [], now, [], value.characterId);
};
const update = (value, title, steps, now) => {
  const text = `把当前任务改成${title}。`;
  return applyProfessionalTaskOperation([value], {decision:'update',basis:'existing_task_change',confidence:.99,
    scope:'current_user',polarity:'affirmed',readiness:'ready',sourceMessageId:'update',evidence:text,taskId:value.id,title,goalKey:title,
    steps:steps.map(({id,title,details,scheduledDate,training})=>({id,title,details,...(scheduledDate ? {scheduledDate} : {}),...(training ? {training} : {})}))},
    [{id:'update',text}], [], now, [], value.characterId);
};
let count = 0;
const check = (name, fn) => {fn(); count++; console.log(`✓ ${name}`);};

check('explicit training/cooking classification excludes old nutrition, skincare and errands', () => {
  assert.equal(PROFESSIONAL_TASK_SESSION_VERSION, 'task-session-v1');
  assert.equal(professionalTaskSessionKind(task()), 'training');
  assert.equal(professionalTaskSessionKind(task({title:'旧活动',goalKey:'旧活动',steps:[step('a',{title:'哑铃卧推'})]})), 'training');
  assert.equal(professionalTaskSessionKind(task({title:'旧活动',goalKey:'旧活动',steps:[step('a',{title:'动作',training:{target:'胸',sets:3,reps:'10'}})]})), 'training');
  for (const title of ['早餐营养任务','训练日饮食安排','护肤任务','购物任务','训练补剂']) {
    const value=task({title,goalKey:title,steps:[step('a',{title:'执行第一项',details:['等10分钟。'],durationSeconds:600})]});
    assert.equal(professionalTaskSessionKind(value), undefined);
    assert.equal(professionalTaskSessionView(value,t0), undefined);
    assert.throws(()=>start(value), {code:'TASK_SESSION_UNAVAILABLE'});
    assert.equal(value.executionSessions, undefined);
  }
  assert.equal(professionalTaskSessionKind(task({title:'番茄炒蛋',goalKey:'番茄炒蛋',characterId:'zhou-chef',steps:[step('a',{title:'炒鸡蛋',details:['下锅翻炒。']})]})), 'cooking');
  for (const title of ['采购食材清单','清洁厨房']) assert.equal(professionalTaskSessionKind(task({title,goalKey:title,characterId:'zhou-chef',steps:[step('a',{title:'清洗用品',details:['清洗购来的用品。'],durationSeconds:300})]})),undefined);
  assert.equal(professionalTaskSessionKind(task({title:'采购并做晚餐',goalKey:'做晚餐',characterId:'zhou-chef',steps:[step('a',{title:'备料',details:['清洗土豆。']})]})), 'cooking');
});

check('never-started tasks have no fabricated history, elapsed or running display', () => {
  const value=task(), before=JSON.stringify(value), view=professionalTaskSessionView(value,t0+60_000);
  assert.equal(view.status,'idle'); assert.equal(view.displayText,'未记录'); assert.equal(view.canStart,true);
  assert.equal(view.elapsedMs,undefined); assert.equal(value.executionSessions,undefined); assert.equal(JSON.stringify(value),before);
});

check('background/reload wall time and repeated start preserve the original anchor', () => {
  const value=task(); assert.equal(start(value),true);
  const initial=structuredClone(value.executionSessions[0]), revision=value.revision;
  assert.equal(start(value,t0+120_000),false); assert.equal(value.revision,revision);
  assert.deepEqual(value.executionSessions[0],initial);
  const restored=JSON.parse(JSON.stringify(value)), session=restored.executionSessions[0];
  assert.equal(professionalTaskSessionElapsedMs(session,t0+900_000),900_000);
  const view=professionalTaskSessionView(restored,t0+900_000);
  assert.equal(view.status,'running'); assert.equal(view.displayText,'训练中'); assert.equal(view.elapsedMs,undefined);
  assert.equal(session.elapsedMs,0); assert.equal(session.updatedAt,iso(t0));
});

check('pause freezes, task resume stays paused, explicit start resumes without resetting', () => {
  const value=task(); start(value); changeStatus(value,'pause',t0+300_000);
  const session=value.executionSessions[0], originalStart=session.startedAt, revision=value.revision;
  assert.equal(session.status,'paused'); assert.equal(session.elapsedMs,300_000);
  assert.equal(professionalTaskSessionElapsedMs(session,t0+600_000),300_000);
  assert.equal(professionalTaskSessionView(value,t0+600_000).canStart,false);
  assert.throws(()=>start(value,t0+600_000),{code:'TASK_SESSION_PAUSED'});
  assert.equal(value.revision,revision);
  changeStatus(value,'resume',t0+600_000); assert.equal(session.status,'paused');
  start(value,t0+900_000); assert.equal(session.status,'running'); assert.equal(session.startedAt,originalStart);
  assert.equal(session.date,'2026-10-12'); assert.equal(session.elapsedMs,300_000);
  complete(value,'a',t0+1_000_000); complete(value,'b',t0+1_200_000);
  assert.equal(session.status,'completed'); assert.equal(session.elapsedMs,600_000);
  assert.equal(session.finishedAt,iso(t0+1_200_000)); assert.equal(value.status,'completed');
});

check('last step completes once, undo pauses, restart retains elapsed and actual date', () => {
  const value=task(); start(value); complete(value,'a',t0+120_000);
  assert.equal(value.executionSessions[0].status,'running');
  const beforeRev=value.revision; complete(value,'b',t0+300_000);
  assert.equal(value.revision,beforeRev+1);
  const session=value.executionSessions[0]; assert.equal(session.elapsedMs,300_000);
  assert.equal(session.steps[1].completedAt,iso(t0+300_000));
  assert.equal(complete(value,'b',t0+900_000),false); assert.equal(session.elapsedMs,300_000);
  undo(value,'b',t0+1_000_000); assert.equal(value.status,'active'); assert.equal(session.status,'paused');
  assert.equal(session.steps[1].completedAt,undefined); assert.equal(session.finishedAt,undefined);
  assert.equal(professionalTaskSessionElapsedMs(session,t0+2_000_000),300_000);
  start(value,t0+2_000_000); assert.equal(value.executionSessions.length,1);
  complete(value,'b',t0+2_120_000); assert.equal(session.elapsedMs,420_000);
});

check('multi-date tasks finish separate groups and block a future group until due', () => {
  const value=task({steps:[step('a',{scheduledDate:'2026-10-12'}),step('b',{scheduledDate:'2026-10-12'}),step('c',{scheduledDate:'2026-10-13'})]});
  start(value); assert.deepEqual(value.executionSessions[0].stepIds,['a','b']);
  complete(value,'a',t0+60_000); complete(value,'b',t0+120_000);
  assert.equal(value.status,'active'); assert.equal(value.executionSessions[0].status,'completed');
  assert.equal(value.executionSessions[0].elapsedMs,120_000);
  const view=professionalTaskSessionView(value,t0+200_000);
  assert.equal(view.canStart,false); assert.equal(view.reason,'尚未到训练日');
  assert.throws(()=>start(value,t0+200_000),{code:'TASK_SESSION_NOT_DUE'});
  start(value,t0+86_400_000); complete(value,'c',t0+86_700_000);
  assert.equal(value.executionSessions.length,2); assert.deepEqual(value.executionSessions.map(s=>s.date),['2026-10-12','2026-10-13']);
  assert.deepEqual(value.executionSessions.map(s=>s.elapsedMs),[120_000,300_000]);
  assert.deepEqual(value.executionSessions[1].stepIds,['c']);
});

check('day-ended tasks cannot start late or complete across midnight; real started time freezes at the boundary', () => {
  const begin=Date.parse('2026-10-12T15:59:00Z'), value=task({steps:[step('a',{scheduledDate:'2026-10-12'})]});
  start(value,begin); assert.throws(()=>complete(value,'a',begin+120_000),{code:'TASK_SKIPPED'});
  const session=value.executionSessions[0];
  assert.equal(session.date,'2026-10-12'); assert.equal(session.elapsedMs,60_000);assert.equal(session.status,'skipped');
  assert.equal(session.finishedAt,'2026-10-12T16:00:00.000Z');assert.equal(value.steps[0].completedAt,undefined);
  const next=task({steps:[step('a',{scheduledDate:'2026-10-10'})]});
  assert.throws(()=>start(next,begin+120_000),{code:'TASK_SKIPPED'});assert.equal(next.executionSessions,undefined);
});

check('rescheduling does not move, reset or lose a running/paused session scope', () => {
  const value=task({steps:[step('a',{scheduledDate:'2026-10-12'}),step('b',{scheduledDate:'2026-10-12'}),step('c',{scheduledDate:'2026-10-13'})]});
  start(value); mutateProfessionalTaskStepDate(value,'b','2026-10-15',value.revision,t0+60_000);
  assert.deepEqual(professionalTaskSessionScope(value,t0+60_000).map(s=>s.id),['a','b']);
  mutateProfessionalTaskSession(value,'pause',value.revision,t0+120_000);
  start(value,t0+180_000); complete(value,'a',t0+240_000); complete(value,'b',t0+300_000);
  assert.equal(value.executionSessions[0].date,'2026-10-12'); assert.equal(value.executionSessions[0].elapsedMs,240_000);
  assert.equal(value.executionSessions[0].status,'completed'); assert.equal(value.steps[2].completedAt,undefined);
});

check('cancellation freezes running or paused sessions and never marks completion', () => {
  for (const paused of [false,true]) {
    const value=task(); start(value);
    if (paused) mutateProfessionalTaskSession(value,'pause',value.revision,t0+120_000);
    changeStatus(value,'cancel',t0+300_000);
    const session=value.executionSessions[0];
    assert.equal(session.status,'cancelled'); assert.equal(session.elapsedMs,paused ? 120_000 : 300_000);
    assert.equal(session.finishedAt,iso(t0+300_000)); assert.equal(value.steps.some(s=>s.completedAt),false);
    assert.throws(()=>start(value,t0+500_000),{code:'TASK_SESSION_ENDED'});
    assert.equal(reconcileProfessionalTaskSessions(value,t0+600_000),false);
  }
});

check('plan replacement cancels open sessions and preserves old title/step completion snapshots', () => {
  for (const paused of [false,true]) {
    const value=task(); start(value); complete(value,'a',t0+60_000);
    if (paused) mutateProfessionalTaskSession(value,'pause',value.revision,t0+120_000);
    const previousId=value.executionSessions[0].id;
    update(value,'背部训练',[{id:'a',title:'高位下拉',details:['训练背部。']},{id:'b',title:'坐姿划船',details:['训练背部。']}],t0+300_000);
    const previous=value.executionSessions[0];
    assert.equal(value.previousPlans.length,1); assert.equal(previous.status,'cancelled');
    assert.equal(previous.elapsedMs,paused ? 120_000 : 300_000); assert.equal(previous.taskTitle,'胸部训练');
    assert.equal(previous.steps[0].title,'卧推 a'); assert.equal(previous.steps[0].completedAt,iso(t0+60_000));
    assert.equal(professionalTaskSessionView(value,t0+500_000).status,'idle');
    start(value,t0+600_000); assert.equal(value.executionSessions.length,2);
    assert.notEqual(value.executionSessions[1].id,previousId); assert.equal(value.executionSessions[1].planVersion,1);
    assert.equal(value.executionSessions[1].taskTitle,'背部训练');
    complete(value,'b',t0+900_000); assert.equal(previous.status,'cancelled'); assert.equal(previous.steps[1].completedAt,undefined);
    assert.equal(value.executionSessions[1].status,'completed'); assert.equal(value.executionSessions[1].elapsedMs,300_000);
  }
});

check('completed historical plans retain elapsed and snapshots after replacement', () => {
  const value=task(); start(value); complete(value,'a',t0+60_000); complete(value,'b',t0+120_000);
  const previous=structuredClone(value.executionSessions[0]);
  update(value,'腿部训练',[{title:'深蹲',details:['完成深蹲训练。']}],t0+300_000);
  assert.deepEqual(value.executionSessions[0],previous); assert.equal(value.status,'active');
  start(value,t0+360_000); assert.equal(value.executionSessions.length,2);
});

check('stale revisions and invalid clocks leave task unchanged; freeze/reconcile do not increment revision', () => {
  const value=task(), initial=JSON.stringify(value);
  assert.throws(()=>mutateProfessionalTaskSession(value,'start',0,t0),{code:'TASK_REVISION_CONFLICT'});
  assert.throws(()=>start(value,NaN),{code:'TASK_SESSION_TIME_INVALID'});
  assert.throws(()=>mutateProfessionalTaskSession(value,'resume',value.revision,t0),{code:'TASK_SESSION_OPERATION_INVALID'});
  assert.equal(JSON.stringify(value),initial);
  start(value); const revision=value.revision;
  assert.equal(freezeProfessionalTaskSessions(value,'paused',t0+60_000),true); assert.equal(value.revision,revision);
  assert.equal(freezeProfessionalTaskSessions(value,'paused',t0+120_000),false); assert.equal(value.revision,revision);
  value.steps.forEach(s=>s.completedAt=iso(t0+180_000));
  assert.equal(reconcileProfessionalTaskSessions(value,t0+180_000),true); assert.equal(value.revision,revision);
  assert.equal(value.executionSessions[0].elapsedMs,60_000);
});

console.log(`professional task sessions: ${count} fixed-clock groups passed`);
