import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,symlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Real React task components and pure projections, synthetic snapshots only.
// The task store/media button are inert adapters: no HTTP, DB, model or account.
const runtime=isolatedNpcRuntime();
process.on('exit',()=>runtime.cleanup());
symlinkSync(resolve('node_modules'),join(runtime.root,'node_modules'),'dir');
const ui=join(runtime.root,'app/zhiyu');mkdirSync(ui,{recursive:true});
writeFileSync(join(ui,'professional-task-store.mjs'),['useProfessionalTasks','completeProfessionalTaskSessionForAccount','startProfessionalTaskSession','setProfessionalTaskStatus','setProfessionalTaskStep','setProfessionalTaskStepDate','setProfessionalTaskTimer'].map(name=>`export const ${name}=()=>[];`).join('\n'));
writeFileSync(join(ui,'fitness-demonstration.mjs'),'export const FitnessDemonstrationButton=()=>null;');
writeFileSync(join(ui,'task-items.mjs'),"export * from '../../lib/npc/task-items.mjs';");
const source=readFileSync('app/zhiyu/professional-task.tsx','utf8').replace("import './professional-task.css';",'').replace(/(from\s+['"])(\.[^'"]+)(['"])/g,'$1$2.mjs$3')+'\nexport {TaskCard,TaskDetailsDialog};\n';
writeFileSync(join(ui,'professional-task.mjs'),ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
const calendarUI=join(runtime.root,'app/task-calendar');mkdirSync(calendarUI,{recursive:true});
writeFileSync(join(ui,'pressable-icon-button.mjs'),"import React from 'react';export default function Button(props){return React.createElement('button',props);}");
for(const name of ['task-calendar-summary','task-calendar-view']){
  const text=readFileSync(`app/task-calendar/${name}.${name.endsWith('view')?'tsx':'ts'}`,'utf8').replace("import './task-calendar.css';",'').replace(/(from\s+['"])(\.[^'"]+)(['"])/g,'$1$2.mjs$3')+(name.endsWith('view')?'\nexport {TaskDayDetails};\n':'');
  writeFileSync(join(calendarUI,name+'.mjs'),ts.transpileModule(text,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
}
const {TaskDayDetails}=await import(pathToFileURL(join(calendarUI,'task-calendar-view.mjs')).href);
const {TaskCard,TaskDetailsDialog}=await import(pathToFileURL(join(ui,'professional-task.mjs')).href);
const {projectProfessionalTaskExpiry}=await runtime.load('lib/npc/professional-task-expiry');
const {professionalTaskProgress}=await runtime.load('lib/npc/professional-task');
const {projectTaskCalendar}=await runtime.load('lib/npc/task-calendar');
const {professionalTasksForDate,professionalTaskProgressForDate,taskItemsForDate,isTaskItemSkipped,taskItemState,taskCalendarRange}=await runtime.load('lib/npc/task-items');
const now=Date.parse('2026-10-18T04:00:00Z'),today='2026-10-18',yesterday='2026-10-17';
const originalNow=Date.now;Date.now=()=>now;
const output=resolve('output/task-auto-skip-20261018');mkdirSync(output,{recursive:true});
const checks=[];const check=(name,run)=>{run();checks.push(name);};
const at='2026-10-17T02:00:00Z';
const task=(id,steps)=>({id,characterId:'chen-nian',title:'肩部训练',goalKey:'肩部训练',status:'active',createdAt:at,updatedAt:at,revision:1,sourceMessageId:id+'-source',cardMessageId:id+'-card',steps});
const step=(id,date,done=false)=>({id,title:'肩部动作'+id,details:['保持动作稳定'],instructions:['控制速度'],hints:[],scheduledDate:date,training:{target:'肩部',sets:3,reps:'10次',restSeconds:60},...(done?{completedAt:at}:{})});
try{
  const past=task('past',[1,2,3,4,5].map(id=>step('p'+id,yesterday,id<=2))),before=JSON.stringify(past);
  const projected=projectProfessionalTaskExpiry(past,now);
  const card=renderToStaticMarkup(React.createElement(TaskCard,{accountId:'synthetic',task:projected,showCharacter:true}));
  const details=renderToStaticMarkup(React.createElement(TaskDetailsDialog,{accountId:'synthetic',task:projected,showCharacter:true,onClose(){}}));
  writeFileSync(join(output,'past-task-component.html'),details);
  check('Original card and full component show 2/5 completed plus 3 skipped, without fake completion',()=>{
    assert.equal(JSON.stringify(past),before);assert.equal(projected.status,'skipped');
    assert.deepEqual(professionalTaskProgress(projected),{completed:2,total:5,percent:40,skipped:3,pending:0});
    assert.match(card,/2 \/ 5 完成 · 3 已跳过/);assert.match(details,/当日未完成，已跳过/);assert.match(details,/40<span>%/);
  });
  check('Skipped history stays inspectable but all completion/date/session controls are disabled and timers hidden',()=>{
    const checkboxes=[...details.matchAll(/<button\b[^>]*class="zy-professional-task-check[^>]*>/g)].map(match=>match[0]);
    assert.equal(checkboxes.length,5);assert.ok(checkboxes.every(tag=>tag.includes('disabled=""')));
    const dates=[...details.matchAll(/<select\b[^>]*>/g)].map(match=>match[0]);assert.equal(dates.length,5);assert.ok(dates.every(tag=>tag.includes('disabled=""')));
    assert.equal((details.match(/class="zy-professional-task-skipped-label"/g)||[]).length,3);
    const timers=[...details.matchAll(/<button\b[^>]*class="zy-professional-task-time[^>]*>/g)].map(match=>match[0]);
    assert.equal(timers.length,2,'only original completed-step timer labels remain; skipped-step timers are hidden');assert.ok(timers.every(tag=>tag.includes('disabled=""')));
    assert.match(details,/<button[^>]*class="zy-professional-task-session-start"[^>]*disabled=""[^>]*>.*?已跳过<\/button>/);
    assert.equal(professionalTasksForDate([projected],today,today).length,0);assert.equal(professionalTasksForDate([projected],yesterday,today).length,1);
  });
  const weekly=task('weekly',[step('old',yesterday),step('current',today),step('future','2026-10-19')]);
  weekly.executionSessions=[{id:'started-yesterday',kind:'training',date:yesterday,stepIds:['old'],planVersion:0,taskTitle:weekly.title,steps:[{id:'old',title:'昨日动作'}],status:'running',startedAt:'2026-10-17T15:00:00Z',updatedAt:'2026-10-17T15:00:00Z',elapsedMs:0}];
  const weekView=projectProfessionalTaskExpiry(weekly,now),weekMarkup=renderToStaticMarkup(React.createElement(TaskDetailsDialog,{accountId:'synthetic',task:weekView,showCharacter:true,onClose(){}}));
  writeFileSync(join(output,'weekly-task-component.html'),weekMarkup);
  check('Yesterday skips within a weekly plan while today can start, tomorrow remains the original future task',()=>{
    assert.equal(weekView.status,'active');assert.equal(weekView.steps[0].skippedAt,'2026-10-17T16:00:00.000Z');assert.ok(!weekView.steps[1].skippedAt);assert.ok(!weekView.steps[2].skippedAt);
    const start=weekMarkup.match(/<button[^>]*class="zy-professional-task-session-start"[^>]*>/)?.[0];assert.ok(start&&!start.includes('disabled'));
    assert.match(weekMarkup,/开始训练<\/button>/);assert.equal(weekView.steps.length,3);
    const pastProgress=professionalTaskProgressForDate(weekView,yesterday),todayProgress=professionalTaskProgressForDate(weekView,today);
    assert.equal(pastProgress.status,'skipped');assert.equal(pastProgress.pending,0);assert.equal(todayProgress.status,'active');assert.equal(todayProgress.pending,1);
  });
  check('Read-only calendar retains skipped steps and real frozen duration without turning them into completion',()=>{
    const calendar=projectTaskCalendar({tasks:[weekView],now});
    const old=calendar.days.find(day=>day.date===yesterday);assert.equal(old.completed,0);assert.equal(old.skipped,1);assert.equal(old.total,1);assert.equal(old.percent,0);
    assert.equal(old.entries[0].status,'skipped');assert.equal(old.entries[0].steps[0].skipped,true);assert.equal(old.entries[0].execution.status,'skipped');assert.equal(old.entries[0].execution.elapsedMs,3_600_000);
    const day={...old,tasks:old.entries.map(entry=>({...entry,id:entry.entryId||entry.taskId}))};
    const historyMarkup=renderToStaticMarkup(React.createElement(TaskDayDetails,{date:yesterday,day,anchor:{isConnected:true},close(){}}));
    writeFileSync(join(output,'calendar-day-component.html'),historyMarkup);
    assert.match(historyMarkup,/已跳过/);assert.match(historyMarkup,/0 \/ 1 完成 · 1 已跳过/);assert.ok(!historyMarkup.includes('zy-task-history-task-count is-complete'));
    assert.match(historyMarkup,/训练时长：1小时0分（已跳过）/);

    assert.ok(!calendar.days.some(day=>day.date==='2026-10-19'));
  });
  check('Past group rows skip only actionable uncompleted work; completions and draft states remain distinct',()=>{
    const group={id:'g',name:'合成群',members:[],messages:[],plan:{id:'plan',status:'confirmed',days:[{date:yesterday,breakfast:'燕麦',lunch:'米饭',dinner:'鱼肉'}]},reminders:[]};
    const rows=taskItemsForDate([group],yesterday),completions={[rows[0].id]:true};
    assert.equal(taskItemState(rows[0],completions,today),'completed');assert.equal(isTaskItemSkipped(rows[0],completions,today),false);
    assert.equal(taskItemState(rows[1],completions,today),'skipped');assert.equal(taskItemState(rows[1],{},yesterday),'pending');
    const draft=taskItemsForDate([{...group,plan:{...group.plan,status:'draft'}}],yesterday)[0];assert.equal(taskItemState(draft,{},today),'inactive');
    assert.equal(taskItemsForDate([group],today).length,0,'no next-day plan is invented');
  });
  check('Delayed completion of generation uses the actual assigned request date rather than later createdAt',()=>{
    const delayed=task('delayed',[{...step('late',undefined),scheduledDate:undefined}]);delayed.assignedDate='2026-09-30';delayed.createdAt='2026-10-01T00:01:00Z';
    const view=projectProfessionalTaskExpiry(delayed,now);assert.equal(professionalTasksForDate([view],'2026-09-30',today).length,1);assert.equal(professionalTasksForDate([view],'2026-10-01',today).length,0);
    const range=taskCalendarRange([], [view],today);assert.equal(range.dates[0],'2026-09-30');assert.ok(range.markedDates.has('2026-09-30'));
    const calendar=projectTaskCalendar({tasks:[view],now});assert.ok(calendar.days.some(day=>day.date==='2026-09-30'));assert.equal(calendar.days.some(day=>day.date==='2026-10-01'),false);
  });
  writeFileSync(join(output,'display-verification.json'),JSON.stringify({syntheticOnly:true,passed:true,realAccountReads:0,databaseWrites:0,networkCalls:0,modelCalls:0,checks},null,2)+'\n');
  console.log(`PASS ${checks.length} task expiry display groups: real React task components and pure history projections; formal account/API/model writes 0.`);
}finally{Date.now=originalNow;}
