import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Test only the disposable UI fixture's synthetic API. No asset proxy request,
// production API, database, credentials or model is opened by this test.
const project=join(dirname(fileURLToPath(import.meta.url)),'..');
const child=spawn(process.execPath,['scripts/professional-task-ui-fixture.mjs'],{cwd:project,stdio:['ignore','pipe','pipe']});
const address=await new Promise((resolve,reject)=>{
  let output='',errors='';
  child.stdout.on('data',data=>{output+=data;for(const line of output.split('\n'))if(line.trim()){
    try{const row=JSON.parse(line);if(row.url)resolve(row.url);if(row.error)reject(Error(row.error));}catch(error){if(error.name!=='SyntaxError')reject(error);}
  }});
  child.stderr.on('data',data=>{errors+=data;});
  child.once('exit',code=>reject(Error(`Fixture exited ${code}: ${errors||output}`)));
  child.once('error',reject);
});
const account='task-ui-fixture-account-a',taskId='professional-fixture-task-a';
const request=async(path,init)=>{
  const response=await fetch(`${address}${path}`,init);return {status:response.status,value:await response.json()};
};
const post=async(body)=>request('/api/npc/zhou-chef?mode=normal',{method:'POST',headers:{'Content-Type':'application/json','X-Zhiyu-Account':account},body:JSON.stringify({taskId,...body})});
try{
  const initial=await request('/api/npc/zhou-chef');assert.equal(initial.status,200);
  const task=initial.value.professionalTasks[0];
  assert.equal(task.steps.length,6);assert.equal(task.steps.filter(step=>step.completedAt).length,1);
  assert.deepEqual(task.steps.filter(step=>step.durationSeconds).map(step=>step.durationSeconds),[300,600]);
  assert.equal(task.steps[4].durationSeconds,undefined,'30-second garlic and 1-minute pepper actions do not receive timers');
  assert.ok(task.steps.every(step=>step.instructions?.length&&step.notes?.length&&step.completionCondition),'each step has separate action, note and completion sections');
  const start=await post({action:'task_timer',eventId:'fixture-test-start',stepId:task.steps[2].id,operation:'start',expectedRevision:task.revision});
  assert.equal(start.status,200);let current=start.value.professionalTasks[0];
  assert.equal(current.steps[2].timer.status,'running');assert.equal(current.steps[2].timer.remainingMs,300_000);
  assert.equal(current.steps[2].completedAt,undefined,'starting a timer never completes a step');
  const idempotent=await post({action:'task_timer',eventId:'fixture-test-start',stepId:task.steps[2].id,operation:'start',expectedRevision:1});
  assert.equal(idempotent.status,200);assert.equal(idempotent.value.professionalTasks[0].revision,current.revision,'duplicate timer event does not reset time or increment revision');
  await request('/fixture/control?delayMs=150');
  const begin=Date.now(),pending=post({action:'task_timer',eventId:'fixture-test-second',stepId:task.steps[3].id,operation:'start',expectedRevision:current.revision});
  const during=await request('/api/npc/zhou-chef');assert.equal(during.value.professionalTasks[0].steps[3].timer,undefined,'delayed save is not persisted before its acknowledgement');
  const second=await pending;assert.equal(second.status,200);assert.ok(Date.now()-begin>=130,'fixture controls create a real delayed save');current=second.value.professionalTasks[0];
  assert.equal(current.steps[2].timer.status,'running');assert.equal(current.steps[3].timer.status,'running','independent timers can run together');
  await request('/fixture/control?delayMs=0&failNext=503');
  const failed=await post({action:'task_timer',eventId:'fixture-test-failed',stepId:task.steps[2].id,operation:'pause',expectedRevision:current.revision});
  assert.equal(failed.status,503);const afterFailed=await request('/api/npc/zhou-chef');
  assert.equal(afterFailed.value.professionalTasks[0].steps[2].timer.status,'running','synthetic save failure leaves server state untouched');
  await request('/fixture/control?conflictNext=1');
  const conflict=await post({action:'task_timer',eventId:'fixture-test-conflict',stepId:task.steps[2].id,operation:'pause',expectedRevision:current.revision});
  assert.equal(conflict.status,409);current=conflict.value.professionalTasks[0];
  assert.equal(current.steps[2].timer.status,'running');assert.ok(current.revision>afterFailed.value.professionalTasks[0].revision,'conflict responds with the latest revision');
  const pause=await post({action:'task_timer',eventId:'fixture-test-pause',stepId:task.steps[2].id,operation:'pause',expectedRevision:current.revision});
  assert.equal(pause.status,200);current=pause.value.professionalTasks[0];assert.equal(current.steps[2].timer.status,'paused');
  const resume=await post({action:'task_timer',eventId:'fixture-test-resume',stepId:task.steps[2].id,operation:'resume',expectedRevision:current.revision});
  assert.equal(resume.status,200);current=resume.value.professionalTasks[0];assert.equal(current.steps[2].timer.status,'running');
  const end=await post({action:'task_status',eventId:'fixture-test-end',status:'cancelled',expectedRevision:current.revision});
  assert.equal(end.status,200);current=end.value.professionalTasks[0];assert.equal(current.status,'cancelled');
  assert.ok(current.steps.filter(step=>step.timer).every(step=>step.timer.status==='paused'),'ending freezes every running timer');
  const elapsed=await request('/fixture/timer-elapsed');assert.equal(elapsed.status,200);
  const elapsedStep=elapsed.value.professionalTasks[0].steps[2];
  assert.equal(elapsedStep.completedAt,undefined,'elapsed fixture control never completes the step');
  assert.equal(elapsedStep.timer.status,'running','elapsed preview retains the real persisted start time for the renderer to evaluate');
  assert.ok(Date.now()-Date.parse(elapsedStep.timer.startedAt)>=301_000,'elapsed preview starts the potato timer more than five minutes in the past');
  const taskPause=await request('/fixture/task-paused');assert.equal(taskPause.status,200);
  assert.equal(taskPause.value.professionalTasks[0].status,'paused');
  assert.equal(taskPause.value.professionalTasks[0].steps[2].timer.status,'elapsed','pausing freezes an already elapsed timer at zero');
  assert.equal(taskPause.value.professionalTasks[0].steps[2].completedAt,undefined);
  const chestInitial=await request('/api/npc/chen-nian');assert.equal(chestInitial.status,200);
  const chest=chestInitial.value.professionalTasks[0];assert.equal(chest.characterId,'chen-nian');assert.equal(chest.title,'胸部训练');
  assert.ok(chest.steps.every(step=>step.category&&step.scheduledDate));assert.equal(chest.steps[1].training.target,'上胸');
  const scheduled=new Date(`${chest.steps[1].scheduledDate}T00:00:00Z`);scheduled.setUTCDate(scheduled.getUTCDate()+7);
  const changeDate=await request('/api/npc/chen-nian?mode=normal',{method:'POST',headers:{'Content-Type':'application/json','X-Zhiyu-Account':account},body:JSON.stringify({action:'task_step_date',eventId:'fixture-chest-date',taskId:chest.id,stepId:chest.steps[1].id,scheduledDate:scheduled.toISOString().slice(0,10),expectedRevision:chest.revision})});
  assert.equal(changeDate.status,200);assert.equal(changeDate.value.professionalTasks[0].steps[1].scheduledDate,scheduled.toISOString().slice(0,10));
  const wrongRole=await post({action:'task_step_date',eventId:'fixture-chest-wrong-role',taskId:chest.id,stepId:chest.steps[1].id,scheduledDate:chest.steps[1].scheduledDate,expectedRevision:chest.revision});assert.equal(wrongRole.status,404,'role endpoints never mutate another role task');
  const foreign=await request('/api/npc/zhou-chef',{headers:{Cookie:'task_ui_fixture_account=b','X-Zhiyu-Account':'task-ui-fixture-account-b'}});
  assert.deepEqual(foreign.value.professionalTasks,[],'another synthetic account has no foreign tasks');
  const blocked=await request('/api/npc/zhou-chef',{method:'POST',headers:{'Content-Type':'application/json','X-Zhiyu-Account':account},body:JSON.stringify({action:'send',text:'must never reach a real model'})});
  assert.equal(blocked.status,403);
  const encoded=await request('/%61pi/unknown',{method:'POST',body:'blocked'});assert.equal(encoded.status,403,'encoded API writes stay inside the fixture');
  const report=(await request('/fixture/report')).value;
  assert.equal(report.actualRealWrites,0);assert.equal(report.modelCalls,0);assert.equal(report.realApiReads,0);assert.equal(report.assetReads,0);
  console.log('PASS isolated UI fixture: six structured steps, separate 5/10-minute timers, no short timers, start/pause/resume, simultaneous timers, idempotent events, delayed save, 503 rollback, 409 conflict, end freeze and account isolation; real API/model/database access 0.');
}finally{
  child.kill('SIGTERM');await new Promise(resolve=>{child.once('exit',resolve);if(child.exitCode!==null)resolve();});
}
