import type {ManualTaskRecord,Plan,Step,Task,TaskBoardModel,TaskStatus,TaskTimer} from './types';
export type {ManualTaskRecord} from './types';

const npcIds=new Set(['chen-nian','liu','zhou-chef','molly','yuan-xiaoman','xia-xia','he-jiawei']);
const categoryIds=new Set(['fitness','recovery','nutrition','cooking','shopping','sleep','skin','chores','bills','family']);
const statuses=new Set<TaskStatus>(['todo','in_progress','paused','done','ended','missed']);
const forbidden=new Set(['__proto__','prototype','constructor']);
function fail(path:string,message:string):never{throw Error(`${path}：${message}`);}
const own=(value:Record<string,unknown>,key:string)=>Object.hasOwn(value,key);
export function isBoardDate(value:unknown):value is string {
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
}
export function boardShanghaiToday(now=Date.now()):string {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
/** Reject prototype keys before copying anything, including unknown nested fields. */
function safeJson(value:unknown,path='记录',depth=0,budget={nodes:0}):void {
  if(++budget.nodes>20000||depth>14)fail(path,'记录过大或嵌套过深');
  if(value===null||['string','boolean'].includes(typeof value))return;
  if(typeof value==='number'){if(!Number.isFinite(value))fail(path,'数值必须有限');return;}
  if(Array.isArray(value)){if(value.length>1000)fail(path,'条目过多');value.forEach((entry,index)=>safeJson(entry,`${path}[${index}]`,depth+1,budget));return;}
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail(path,'必须是普通 JSON 对象');
  for(const [key,entry] of Object.entries(value)){if(forbidden.has(key))fail(path,'包含不允许的键');safeJson(entry,`${path}.${key}`,depth+1,budget);}
}
function object(value:unknown,path:string):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))fail(path,'必须是对象');return value as Record<string,unknown>;}
function fields(value:Record<string,unknown>,allowed:string[],path:string){for(const key of Object.keys(value))if(!allowed.includes(key))fail(`${path}.${key}`,'不支持此字段');}
function hasControls(value:string):boolean{for(let index=0;index<value.length;index++){const code=value.charCodeAt(index);if(code===127||code<32&&![9,10,13].includes(code))return true;}return false;}
function text(value:unknown,path:string,max=2000,empty=false):string{if(typeof value!=='string'||value.length>max||(!empty&&!value.trim())||hasControls(value))fail(path,'文字为空、过长或包含控制字符');return value.trim();}
function id(value:unknown,path:string):string{const result=text(value,path,128);if(!/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(result))fail(path,'使用稳定的英文字母、数字、冒号、横线或下划线标识');return result;}
function number(value:unknown,path:string,min=0,max=Number.MAX_SAFE_INTEGER,integer=false):number{if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isSafeInteger(value)))fail(path,'数值超出允许范围');return value;}
function bool(value:unknown,path:string):boolean{if(typeof value!=='boolean')fail(path,'必须是 true 或 false');return value;}
function date(value:unknown,path:string):string{if(!isBoardDate(value))fail(path,'日期必须是真实的 YYYY-MM-DD');return value;}
function list(value:unknown,path:string,max=50):unknown[]{if(!Array.isArray(value)||value.length>max)fail(path,'必须是限量数组');return value;}
function optionalText(value:Record<string,unknown>,key:string,path:string,max=2000):Record<string,string>{return own(value,key)?{[key]:text(value[key],`${path}.${key}`,max,true)}:{};}
function readStep(input:unknown,path:string):Step {
  const value=object(input,path);fields(value,['id','name','detail','restSeconds','durationText','sets','tips','image','timerSeconds','done','skipped','actual'],path);
  const step:Step={id:id(value.id,`${path}.id`),name:text(value.name,`${path}.name`,160),detail:text(value.detail,`${path}.detail`,8000,true),done:bool(value.done,`${path}.done`),...optionalText(value,'durationText',path,200),...optionalText(value,'actual',path,2000)};
  if(own(value,'restSeconds'))step.restSeconds=number(value.restSeconds,`${path}.restSeconds`,0,1800,true);
  if(own(value,'timerSeconds'))step.timerSeconds=number(value.timerSeconds,`${path}.timerSeconds`,1,86400,true);
  if(own(value,'skipped'))step.skipped=bool(value.skipped,`${path}.skipped`);
  if(step.done&&step.skipped)fail(path,'不能同时完成和跳过');
  if(own(value,'tips'))step.tips=list(value.tips,`${path}.tips`,30).map((entry,index)=>text(entry,`${path}.tips[${index}]`,2000));
  if(own(value,'image')){const image=text(value.image,`${path}.image`,2048);if(!image.startsWith('/')||image.startsWith('//')||image.includes('..')||/[?#]/.test(image))fail(`${path}.image`,'仅支持程序内的本地图片路径');step.image=image;}
  if(own(value,'sets')){const sets=object(value.sets,`${path}.sets`);fields(sets,['total','done','weight'],`${path}.sets`);const total=number(sets.total,`${path}.sets.total`,1,30,true),done=number(sets.done,`${path}.sets.done`,0,total,true);if(step.done&&done!==total||!step.done&&done===total)fail(`${path}.sets`,'组数进度须与步骤完成状态一致');step.sets={total,done,...optionalText(sets,'weight',`${path}.sets`,160)};}
  return step;
}
function readTask(input:unknown,path:string):Task {
  const value=object(input,path);fields(value,['id','title','categoryId','npcId','type','amount','tip','date','repeat','order','pinned','status','steps','count','note','missReason','missText','completedAt','planId'],path);
  if(!categoryIds.has(String(value.categoryId)))fail(`${path}.categoryId`,'请选择现有十个分类');
  if(!npcIds.has(String(value.npcId)))fail(`${path}.npcId`,'请选择现有七位智友');
  if(!['single','steps','count'].includes(String(value.type)))fail(`${path}.type`,'必须是 single、steps 或 count');
  if(!statuses.has(value.status as TaskStatus))fail(`${path}.status`,'安排状态无效');
  const task:Task={id:id(value.id,`${path}.id`),title:text(value.title,`${path}.title`,160),categoryId:String(value.categoryId),npcId:String(value.npcId),type:value.type as Task['type'],amount:text(value.amount,`${path}.amount`,500,true),date:date(value.date,`${path}.date`),order:number(value.order,`${path}.order`,0,1000000,true),status:value.status as TaskStatus,
    ...optionalText(value,'tip',path),...optionalText(value,'note',path,8000),...optionalText(value,'missReason',path),...optionalText(value,'missText',path)};
  if(own(value,'repeat')){if(value.repeat!=='daily')fail(`${path}.repeat`,'目前仅支持 daily');task.repeat='daily';}
  if(own(value,'pinned'))task.pinned=bool(value.pinned,`${path}.pinned`);
  if(own(value,'planId'))task.planId=id(value.planId,`${path}.planId`);
  if(own(value,'completedAt')){const at=text(value.completedAt,`${path}.completedAt`,100);if(!Number.isFinite(Date.parse(at)))fail(`${path}.completedAt`,'完成时间格式无效');if(!['done','ended'].includes(task.status))fail(`${path}.completedAt`,'未完成安排不能带完成时间');task.completedAt=at;}
  if(task.type==='steps'){task.steps=list(value.steps,`${path}.steps`).map((entry,index)=>readStep(entry,`${path}.steps[${index}]`));if(!task.steps.length)fail(`${path}.steps`,'至少需要一个步骤');if(new Set(task.steps.map(step=>step.id)).size!==task.steps.length)fail(`${path}.steps`,'步骤 ID 不能重复');if(task.status==='done'&&task.steps.some(step=>!step.done))fail(`${path}.status`,'完成安排的所有步骤必须已完成');if(own(value,'count'))fail(path,'步骤安排不能同时设置计数');}
  else if(own(value,'steps'))fail(path,'仅步骤安排可设置 steps');
  if(task.type==='count'){const count=object(value.count,`${path}.count`);fields(count,['current','target','perTime','unit'],`${path}.count`);const target=number(count.target,`${path}.count.target`,Number.MIN_VALUE,1e9),current=number(count.current,`${path}.count.current`,0,target),perTime=number(count.perTime,`${path}.count.perTime`,Number.MIN_VALUE,target);if(!['ml','步','次'].includes(String(count.unit)))fail(`${path}.count.unit`,'计数单位必须是 ml、步或次');if(task.status==='done'&&current!==target)fail(`${path}.count`,'完成安排的计数必须达到目标');task.count={current,target,perTime,unit:count.unit as 'ml'|'步'|'次'};}
  else if(own(value,'count'))fail(path,'仅计数安排可设置 count');
  return task;
}
export function parseBoardPlan(input:unknown,path='计划'):Plan {
  safeJson(input,path);const value=object(input,path);fields(value,['id','name','color','progress','progressText'],path);
  const color=text(value.color,`${path}.color`,160);if(!/^(?:#[0-9a-fA-F]{3,8}|var\(--[a-zA-Z0-9_-]+(?:,\s*#[0-9a-fA-F]{3,8})?\))$/.test(color))fail(`${path}.color`,'颜色须为十六进制或现有 CSS 变量');
  return {id:id(value.id,`${path}.id`),name:text(value.name,`${path}.name`,160),color,progress:number(value.progress,`${path}.progress`,0,1),progressText:text(value.progressText,`${path}.progressText`,500,true)};
}
function recordIdFor(name:string):string{let hash=0x811c9dc5;for(let index=0;index<name.length;index++)hash=Math.imul(hash^name.charCodeAt(index),0x01000193);return `manual-${(hash>>>0).toString(36)}`;}
/** A closed JSON contract. Runtime timers and professional provenance cannot be imported. */
export function parseManualTaskRecord(input:unknown):ManualTaskRecord {
  if(typeof input==='string'){if(input.length>2_000_000)fail('记录','文件过大');try{input=JSON.parse(input);}catch{fail('记录','不是有效 JSON');}}
  safeJson(input);const value=object(input,'记录');fields(value,['version','name','recordId','selectedDate','tasks','plans'],'记录');if(value.version!==1)fail('记录.version','仅支持版本 1');
  const name=text(value.name,'记录.name',160),recordId=own(value,'recordId')?id(value.recordId,'记录.recordId'):recordIdFor(name);
  const tasks=list(value.tasks,'记录.tasks',500).map((task,index)=>readTask(task,`记录.tasks[${index}]`));
  const plans=list(value.plans,'记录.plans',100).map((plan,index)=>parseBoardPlan(plan,`记录.plans[${index}]`));
  if(new Set(tasks.map(task=>task.id)).size!==tasks.length)fail('记录.tasks','安排 ID 不能重复');
  if(new Set(plans.map(plan=>plan.id)).size!==plans.length)fail('记录.plans','计划 ID 不能重复');
  if(tasks.filter(task=>task.status==='in_progress').length>1)fail('记录.tasks','同一份记录最多一个进行中安排');
  return {version:1,name,recordId,selectedDate:date(value.selectedDate,'记录.selectedDate'),tasks,plans};
}
const remaining=(timer:TaskTimer,now:number)=>timer.pausedRemainingMs??Math.max(0,timer.endsAt-now);
/** Merge only explicit IDs, preserving unrelated records and valid in-flight timers. */
export function applyManualTaskRecord(model:TaskBoardModel,input:ManualTaskRecord,now=Date.now()):TaskBoardModel {
  const record=parseManualTaskRecord(input);if(!Number.isFinite(now))fail('记录','导入时间无效');const at=new Date(now).toISOString();
  const incomingIds=new Set(record.tasks.map(task=>task.id));
  for(const task of model.tasks)if(incomingIds.has(task.id)&&(!task.manualRecord||task.manualRecord.id!==record.recordId))fail('记录.tasks','安排 ID 与其他来源记录冲突，请保留原记录或更换 ID');
  const added=record.tasks.map(task=>({...task,manualRecord:{id:record.recordId,name:record.name,importedAt:at}}));
  const byId=new Map(added.map(task=>[task.id,task]));
  const tasks=[...model.tasks.map(task=>byId.get(task.id)||task),...added.filter(task=>!model.tasks.some(current=>current.id===task.id))];
  const planById=new Map(record.plans.map(plan=>[plan.id,plan]));const plans=[...(model.plans||[]).map(plan=>planById.get(plan.id)||plan),...record.plans.filter(plan=>!model.plans?.some(current=>current.id===plan.id))];
  const timers=Object.fromEntries(Object.entries(model.timers).filter(([,timer])=>{const next=byId.get(timer.taskId);if(!next)return true;const before=model.tasks.find(task=>task.id===timer.taskId)?.steps?.find(step=>step.id===timer.stepId),after=next.steps?.find(step=>step.id===timer.stepId);return !!after&&!after.done&&!['done','ended','missed'].includes(next.status)&&before?.timerSeconds===after.timerSeconds;}).map(([key,timer])=>[key,{...timer}]));
  const active=added.find(task=>task.status==='in_progress'&&task.date===record.selectedDate);
  const previousActive=tasks.find(task=>task.id===model.page.activeTaskId);
  // Importing a selected day changes the visible active card, never unrelated task progress.
  const activeTaskId=active?.id||(previousActive?.date===record.selectedDate&&previousActive.status==='in_progress'?previousActive.id:undefined);
  for(const timer of Object.values(timers))if(byId.get(timer.taskId)?.status==='paused'&&timer.pausedRemainingMs===undefined)timer.pausedRemainingMs=remaining(timer,now);
  let rest=model.rest&&(!incomingIds.has(model.rest.taskId)||tasks.find(task=>task.id===model.rest!.taskId)?.steps?.some(step=>step.id===model.rest!.stepId&&!step.done))?{...model.rest}:undefined;
  if(rest&&byId.get(rest.taskId)?.status==='paused')rest={...rest,pausedRemainingMs:remaining(rest,now)};
  const keepExpansion=!active&&activeTaskId===model.page.activeTaskId;
  return {...model,today:boardShanghaiToday(now),tasks,plans,timers,rest,page:{...model.page,view:'today',selectedDate:record.selectedDate,categoryFilter:undefined,activeTaskId,
    activeExpanded:active?true:keepExpansion?model.page.activeExpanded:false,
    expandedStepId:active?active.steps?.find(step=>!step.done&&!step.skipped)?.id:keepExpansion?model.page.expandedStepId:undefined}};
}
