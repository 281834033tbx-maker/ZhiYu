'use client';
import {useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {Check, ChevronDown, ClipboardCheck, Minus, Pause, Play} from 'lucide-react';
import {nextProfessionalTaskStep, professionalTaskProgress, type ProfessionalTask, type ProfessionalTaskStep} from '../../lib/npc/professional-task';
import {professionalTaskStepContent, professionalTaskTimerView} from '../../lib/npc/professional-task-timer';
import {professionalTaskSessionView} from '../../lib/npc/professional-task-session';
import {completeProfessionalTaskSessionForAccount, startProfessionalTaskSession, setProfessionalTaskStatus, setProfessionalTaskStep, setProfessionalTaskStepDate, setProfessionalTaskTimer, useProfessionalTasks} from './professional-task-store';
import {professionalTaskCharacterName, shanghaiToday, taskDateLabel, taskScheduleOptions} from './task-items';
import {FitnessDemonstrationButton} from './fitness-demonstration';
import './professional-task.css';

const taskStatusLabel=(status:ProfessionalTask['status'])=>({active:'本次任务进度',paused:'任务已暂停',completed:'全部步骤已完成',cancelled:'任务已结束',skipped:'当日未完成，已跳过'}[status]);
type ExpansionState={open:string;automatic?:string;manual:boolean;listeners:Set<()=>void>};
const expansions=new Map<string,ExpansionState>();
function expansionState(key:string,initial?:string){
  let state=expansions.get(key);
  if(!state){state={open:initial||'',automatic:initial,manual:false,listeners:new Set()};expansions.set(key,state);}
  return state;
}
/** The chat preview and full dialog share one open step, scoped to this account and task. */
function useStepExpansion(accountId:string,task:ProfessionalTask){
  const key=JSON.stringify([accountId,task.id]),current=nextProfessionalTaskStep(task)?.id;
  const subscribe=useCallback((listener:()=>void)=>{const state=expansionState(key,current);state.listeners.add(listener);return()=>{state.listeners.delete(listener);};},[key,current]);
  const snapshot=useCallback(()=>expansionState(key,current).open,[key,current]);
  const expanded=useSyncExternalStore(subscribe,snapshot,()=>'');
  useEffect(()=>{
    const state=expansionState(key,current);
    if(current!==state.automatic){state.automatic=current;if(!state.manual){state.open=current||'';state.listeners.forEach(listener=>listener());}}
    if(state.open&&!task.steps.some(step=>step.id===state.open)){state.open='';state.manual=false;state.listeners.forEach(listener=>listener());}
  },[key,current,task.steps]);
  const toggle=(id:string)=>{const state=expansionState(key,current);state.manual=true;state.open=state.open===id?'':id;state.listeners.forEach(listener=>listener());};
  return {expanded,toggle};
}
function useTimerClock(steps:ProfessionalTaskStep[]){
  const [now,setNow]=useState(()=>Date.now());
  const running=steps.some(step=>professionalTaskTimerView(step,now).status==='running'),hasSchedule=steps.some(step=>!!step.scheduledDate);
  useEffect(()=>{if(!running&&!hasSchedule)return;const timer=window.setInterval(()=>setNow(Date.now()),running?500:30_000);return()=>window.clearInterval(timer);},[running,hasSchedule]);
  return now;
}
function countdown(seconds:number){const rounded=Math.max(0,Math.ceil(seconds));return `${Math.floor(rounded/60).toString().padStart(2,'0')}:${(rounded%60).toString().padStart(2,'0')}`;}
function durationLabel(seconds:number){const minutes=Math.floor(seconds/60),rest=seconds%60;return minutes===0?`${rest}秒`:rest?`${minutes}分${rest}秒`:`${minutes}分钟`;}
function TimerRing({progress,paused=false}:{progress:number;paused?:boolean}){
  const amount=Math.max(0,Math.min(1,Number.isFinite(progress)?progress:0));
  return <svg className={'zy-professional-task-timer-ring'+(paused?' is-paused':'')} viewBox="0 0 20 20" aria-hidden="true"><circle className="zy-professional-task-timer-track" cx="10" cy="10" r="8"/><circle className="zy-professional-task-timer-fill" cx="10" cy="10" r="8" pathLength="1" strokeDasharray={`${amount} 1`} transform="rotate(-90 10 10)"/></svg>;
}
/** Legacy tasks keep their contents; classification affects only their surface. */
function stepCategory(step:ProfessionalTaskStep){
  if(step.category)return step.category;
  if(/准备|备料|切配|切好|调好|调汁|热身|激活|检查/.test(step.title))return 'preparation';
  if(/装盘|收尾|拉伸|记录|整理|结束|清理/.test(step.title))return 'finishing';
  if(/配菜|料汁|辅助|补充/.test(step.title))return 'accessory';
  return 'main';
}
function TaskStepContent({step}:{step:ProfessionalTaskStep}){
  const {instructions,notes,completionCondition}=professionalTaskStepContent(step),training=step.training;
  return <>{training&&<><section className="zy-professional-task-content is-target"><h4>练哪里</h4><p>{training.target}</p></section>
    <section className="zy-professional-task-content is-training"><h4>组数与次数</h4><p>{training.sets}组 · {training.reps}{training.restSeconds?` · 组间休息${training.restSeconds>=60?`${Math.round(training.restSeconds/60*10)/10}分钟`:`${training.restSeconds}秒`}`:''}</p>{training.effort&&<p>{training.effort}</p>}</section></>}
    {(instructions.length>0||training?.recommendation)&&<section className="zy-professional-task-content"><h4>{training?'介绍':'操作'}</h4>{training?.recommendation&&<p className="zy-professional-task-recommendation">{training.recommendation}</p>}{instructions.map((text,index)=><p key={index}>{text}</p>)}</section>}
    {notes.length>0&&<section className="zy-professional-task-content is-note"><h4>注意事项</h4>{notes.map((text,index)=><p key={index}>{text}</p>)}</section>}
    {completionCondition&&<section className="zy-professional-task-content is-condition"><h4>完成状态</h4><p>{completionCondition}</p></section>}</>;
}
function StepDateCapsule({step,today,pending,disabled,onSchedule}:{step:ProfessionalTaskStep;today:string;pending:boolean;disabled:boolean;onSchedule:(date:string)=>void}){
  if(!step.scheduledDate)return null;
  const dates=taskScheduleOptions(today),historical=!dates.includes(step.scheduledDate);
  return <label className="zy-professional-task-date-capsule" data-long-date={taskDateLabel(step.scheduledDate,today).length>2}><select aria-label={'调整日期：'+step.title} value={step.scheduledDate} disabled={disabled||pending} onChange={event=>onSchedule(event.currentTarget.value)}>
    {historical&&<option value={step.scheduledDate} disabled>{taskDateLabel(step.scheduledDate,today)}</option>}
    {dates.map(date=><option key={date} value={date}>{taskDateLabel(date,today)}</option>)}
  </select><ChevronDown size={11} aria-hidden="true"/></label>;
}
function TaskSteps({task,steps,expanded,onExpand,onComplete,onTimer,onSchedule,pending,now,showHints=true}:{task:ProfessionalTask;steps:ProfessionalTaskStep[];expanded:string;onExpand:(id:string)=>void;onComplete:(step:ProfessionalTaskStep)=>void;onTimer:(step:ProfessionalTaskStep,action:'start'|'pause'|'resume')=>void;onSchedule:(step:ProfessionalTaskStep,date:string)=>void;pending:Set<string>;now:number;showHints?:boolean}){
  const prefix=useId(),next=nextProfessionalTaskStep(task)?.id,today=shanghaiToday(now);
  return <ol className="zy-professional-task-steps">{steps.map(step=>{
    const done=!!step.completedAt,skipped=!!step.skippedAt,open=expanded===step.id,detailId=prefix+'-'+step.id,latest=step.hints.at(-1);
    const timer=professionalTaskTimerView(step,now),timing=!done&&!skipped&&task.status!=='cancelled'&&task.status!=='skipped'&&(timer.status==='running'||timer.status==='paused'),rest=timer.kind==='rest';
    const ready=timer.status==='idle'||(timer.status==='elapsed'&&timer.canRestart),duration=rest?step.training?.restSeconds||0:step.durationSeconds||0;
    const cycle=rest?`，第${Math.min(timer.maxCycles||1,(timer.completedCycles||0)+1)}/${timer.maxCycles}次组间休息`:'';
    const timerLabel=ready?(rest?'休息 ':'')+durationLabel(duration):timer.status==='elapsed'?(rest?'休息完成':'计时结束'):countdown(timer.remainingSeconds);
    const blocked=task.status==='cancelled'||task.status==='skipped'||task.status==='paused'||skipped||done||pending.has('status')||pending.has('timer:'+step.id),current=next===step.id&&task.status==='active';
    return <li key={step.id} className={'zy-professional-task-step'+(current?' is-current':'')+(done?' is-done':'')+(skipped?' is-skipped':'')+(timing?' is-timing':'')} data-step-id={step.id} data-step-category={stepCategory(step)}>
      <div className="zy-professional-task-row">
        <button type="button" className={'zy-professional-task-check'+(done?' is-done':'')} aria-label={(skipped?'已跳过':done?'撤销完成':'完成')+'：'+step.title} aria-pressed={done} disabled={skipped||task.status==='skipped'||task.status==='cancelled'||(!done&&task.status==='paused')||pending.has('status')||pending.has('step:'+step.id)} onClick={()=>onComplete(step)}><span>{done?<Check size={10} strokeWidth={2.5}/>:skipped?<Minus size={10} strokeWidth={2}/>:null}</span></button>
        <button type="button" className="zy-professional-task-expand" title={step.title} aria-label={step.title} aria-expanded={open} aria-controls={detailId} onClick={()=>onExpand(step.id)}><span className={'zy-professional-task-step-title'+(done?' is-done':'')}>{step.title}</span>{skipped&&<span className="zy-professional-task-skipped-label">已跳过</span>}</button>
        {(step.scheduledDate||timer.showTimer)&&<div className="zy-professional-task-step-labels"><StepDateCapsule step={step} today={today} disabled={skipped||done||task.status==='skipped'||task.status==='cancelled'||task.status==='completed'} pending={pending.has('date:'+step.id)||pending.has('status')} onSchedule={date=>onSchedule(step,date)}/>
        {timer.showTimer&&!skipped&&<div className={'zy-professional-task-timer-controls'+(timing?' is-countdown':'')} data-timer-kind={rest?'rest':'duration'} title={rest?`组间休息已完成 ${timer.completedCycles||0}/${timer.maxCycles} 次`:undefined}>
          <button type="button" className={'zy-professional-task-time'+(timing?' is-countdown':'')} disabled={blocked||!ready} aria-label={ready?(rest?'开始组间休息：':'开始计时：')+step.title+'，'+durationLabel(duration)+cycle:timer.status==='elapsed'?step.title+(rest?'组间休息已完成':'计时结束'):step.title+cycle+'剩余 '+countdown(timer.remainingSeconds)} onClick={()=>onTimer(step,'start')}>{timing&&<TimerRing progress={timer.progress} paused={timer.status==='paused'}/>}<span>{timerLabel}</span></button>
          {timing&&<button type="button" className="zy-professional-task-timer-action" disabled={blocked} aria-label={(timer.status==='running'?'暂停计时':'继续计时')+'：'+step.title} onClick={()=>onTimer(step,timer.status==='running'?'pause':'resume')}>{timer.status==='running'?<Pause size={10} strokeWidth={2}/>:<Play size={10} strokeWidth={2}/>}</button>}
        </div>}</div>}
        {task.characterId==='chen-nian'&&<FitnessDemonstrationButton step={step}/>}
        <button type="button" className={'zy-professional-task-chevron-button'+(open?' is-open':'')} aria-label={(open?'收起':'展开')+'：'+step.title} aria-expanded={open} aria-controls={detailId} onClick={()=>onExpand(step.id)}><ChevronDown className="zy-professional-task-chevron" size={14} strokeWidth={1.7}/></button>
      </div>
      {open&&<div id={detailId} className="zy-professional-task-details"><TaskStepContent step={step}/>{showHints&&latest&&<div className="zy-professional-task-guidance"><span>{professionalTaskCharacterName(task)}的提示</span><p>{latest.text}</p></div>}</div>}
    </li>;
  })}</ol>;
}
function TaskProgress({task}:{task:ProfessionalTask}){const {percent}=professionalTaskProgress(task);return <div className="zy-professional-task-percent">{percent}<span>%</span></div>;}
function TaskCount({task}:{task:ProfessionalTask}){const {completed,total,skipped}=professionalTaskProgress(task);return <span className={'zy-professional-task-count'+(total>0&&completed===total?' is-complete':'')}><span aria-hidden="true"/>{completed} / {total} 完成{skipped>0&&` · ${skipped} 已跳过`}</span>;}
function useTaskActions(accountId:string,task:ProfessionalTask){
  const [error,setError]=useState(''),[pending,setPending]=useState<Set<string>>(()=>new Set()),working=useRef(new Set<string>());
  async function perform(key:string,operation:()=>Promise<void>,fallback:string){
    if(working.current.has(key)||working.current.has('status'))return false;
    working.current.add(key);setPending(new Set(working.current));setError('');
    try{await operation();return true;}catch(reason){setError(reason instanceof Error?reason.message:fallback);return false;}
    finally{working.current.delete(key);setPending(new Set(working.current));}
  }
  const complete=(step:ProfessionalTaskStep)=>perform('step:'+step.id,()=>setProfessionalTaskStep(accountId,task.id,step.id,!step.completedAt),'完成状态未保存，请稍后重试。');
  const status=(value:ProfessionalTask['status'])=>perform('status',()=>setProfessionalTaskStatus(accountId,task.id,value),'任务状态未保存，请稍后重试。');
  const timer=(step:ProfessionalTaskStep,action:'start'|'pause'|'resume')=>perform('timer:'+step.id,()=>setProfessionalTaskTimer(accountId,task.id,step.id,action),'计时状态未保存，请稍后重试。');
  const schedule=(step:ProfessionalTaskStep,date:string)=>perform('date:'+step.id,()=>setProfessionalTaskStepDate(accountId,task.id,step.id,date),'日期未保存，请稍后重试。');
  const startSession=()=>perform('session',()=>startProfessionalTaskSession(accountId,task.id),'开始状态未保存，请稍后重试。');
  const completeSession=(sessionId:string)=>perform('session-complete',()=>completeProfessionalTaskSessionForAccount(accountId,task.id,sessionId),'完成状态未保存，请稍后重试。');
  return {error,pending,complete,status,timer,schedule,startSession,completeSession};
}
type SessionConfirmation={sessionId:string;anchor:HTMLButtonElement};
function TaskSessionStart({task,pending,onStart,onFinish,now}:{task:ProfessionalTask;pending:Set<string>;onStart:()=>void;onFinish:(confirmation:SessionConfirmation)=>void;now:number}){
  const view=professionalTaskSessionView(task,now);
  if(!view)return null;
  const noun=view.kind==='training'?'训练':'做饭';
  const label=pending.has('session')?'保存中…':task.status==='skipped'?'已跳过':task.status==='cancelled'?'任务已结束':task.status==='completed'?`${noun}完成`
    :view.status==='running'?`${noun}中`:view.reason?.startsWith('尚未到')?view.reason:view.status==='completed'&&!view.canStart?`${noun}完成`
    :view.status==='skipped'?'已跳过':view.status==='cancelled'?'任务已结束':view.status==='paused'&&task.status==='active'?`继续${noun}`:view.startLabel;
  const canFinish=view.kind==='cooking'&&view.session?.status==='running'&&task.status==='active';
  return <button type="button" className="zy-professional-task-session-start" disabled={(!view.canStart&&!canFinish)||pending.has('session')||pending.has('session-complete')||pending.has('status')} title={canFinish?'完成本次做饭的所有任务':view.reason} onClick={event=>{if(canFinish)onFinish({sessionId:view.session!.id,anchor:event.currentTarget});else onStart();}}>{view.status==='running'?<span className="zy-professional-task-session-dot" aria-hidden="true"/>:<Play size={10} strokeWidth={2} aria-hidden="true"/>}{label}</button>;
}
/** A chat message refers to the task ID; its persisted state stays available outside the thread. */
export function ProfessionalTaskCard({accountId,taskId,onOpen,showCharacter=false}:{accountId:string;taskId:string;onOpen?:(taskId:string)=>void;showCharacter?:boolean}){
  const tasks=useProfessionalTasks(accountId),task=tasks.find(item=>item.id===taskId);
  if(!task)return <section className="zy-professional-task" aria-label="任务"><p className="zy-professional-task-status">任务正在同步…</p></section>;
  return <TaskCard key={task.id} accountId={accountId} task={task} onOpen={onOpen} showCharacter={showCharacter}/>;
}
function TaskCard({accountId,task,onOpen,showCharacter}:{accountId:string;task:ProfessionalTask;onOpen?:(taskId:string)=>void;showCharacter:boolean}){
  const {expanded,toggle}=useStepExpansion(accountId,task),{error,pending,complete,timer,schedule,startSession,completeSession}=useTaskActions(accountId,task),now=useTimerClock(task.steps);
  const [confirmComplete,setConfirmComplete]=useState<SessionConfirmation|null>(null);
  const [dialogOpen,setDialogOpen]=useState(false),steps=task.steps.slice(0,4);
  const open=()=>{if(onOpen)onOpen(task.id);else setDialogOpen(true);};
  return <><section className="zy-professional-task" aria-label={task.title+'任务'} data-task-id={task.id}>
    <header className="zy-professional-task-head"><div className="zy-professional-task-heading"><h3>{task.title}</h3><TaskCount task={task}/></div><TaskProgress task={task}/><p>{taskStatusLabel(task.status)}</p></header>
    {error&&!confirmComplete&&<p role="alert" className="zy-professional-task-error">{error}</p>}
    <TaskSteps task={task} steps={steps} expanded={expanded} onExpand={toggle} onComplete={step=>void complete(step)} onTimer={(step,action)=>void timer(step,action)} onSchedule={(step,date)=>void schedule(step,date)} pending={pending} now={now} showHints={false}/>
    {task.steps.length>4&&<div className="zy-professional-task-preview-more" aria-label="还有更多任务步骤"><span/><span/><span/></div>}
    <footer className="zy-professional-task-footer"><TaskSessionStart task={task} pending={pending} now={now} onStart={()=>void startSession()} onFinish={setConfirmComplete}/><button type="button" className="zy-professional-task-more" onClick={open}>查看全部任务</button></footer>
  </section>{dialogOpen&&<ProfessionalTaskDetailsDialog accountId={accountId} taskId={task.id} showCharacter={showCharacter} onClose={()=>setDialogOpen(false)}/>} {confirmComplete&&<CompleteSessionConfirmation confirmation={confirmComplete} pending={pending.has('session-complete')} error={error} onCancel={()=>setConfirmComplete(null)} onConfirm={()=>{void completeSession(confirmComplete.sessionId).then(saved=>{if(saved)setConfirmComplete(null);});}}/>}</>;
}
export function ProfessionalTaskDetailsDialog({accountId,taskId,onClose,onViewMessage,onReturnChat,showCharacter=false}:{accountId:string;taskId:string;onClose:()=>void;onViewMessage?:(messageId:string)=>void;onReturnChat?:()=>void;showCharacter?:boolean}){
  const task=useProfessionalTasks(accountId).find(item=>item.id===taskId);
  return task?<TaskDetailsDialog key={task.id} accountId={accountId} task={task} onClose={onClose} onViewMessage={onViewMessage} onReturnChat={onReturnChat} showCharacter={showCharacter}/>:null;
}
function EndTaskConfirmation({onCancel,onConfirm,pending,error,restoreFocus,title='是否结束当前任务？',pendingLabel='结束中…'}:{onCancel:()=>void;onConfirm:()=>void;pending:boolean;error:string;restoreFocus:()=>void;title?:string;pendingLabel?:string}){
  const dialog=useRef<HTMLDialogElement>(null),cancel=useRef<HTMLButtonElement>(null),titleId=useId();
  useLayoutEffect(()=>{const node=dialog.current;node?.showModal();cancel.current?.focus();return()=>{node?.close();restoreFocus();};},[restoreFocus]);
  return <dialog ref={dialog} className="zy-dialog zy-professional-task-confirm" aria-labelledby={titleId} onCancel={event=>{event.preventDefault();if(!pending)onCancel();}} onPointerDown={event=>{if(pending||event.target!==event.currentTarget||event.button!==0)return;const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)onCancel();}}>
    <h3 id={titleId}>{title}</h3>{error&&<p role="alert">{error}</p>}
    <div><button ref={cancel} type="button" disabled={pending} onClick={onCancel}>取消</button><button type="button" className="zy-professional-task-confirm-end" disabled={pending} onClick={onConfirm}>{pending?pendingLabel:'确定'}</button></div>
  </dialog>;
}
function CompleteSessionConfirmation({confirmation,...props}:{confirmation:SessionConfirmation;onCancel:()=>void;onConfirm:()=>void;pending:boolean;error:string}){
  const restoreFocus=useCallback(()=>{if(confirmation.anchor.isConnected)confirmation.anchor.focus({preventScroll:true});},[confirmation.anchor]);
  return <EndTaskConfirmation {...props} restoreFocus={restoreFocus} title="是否确定完成所有任务？" pendingLabel="完成中…"/>;
}
function TaskDetailsDialog({accountId,task,onClose,onViewMessage,onReturnChat,showCharacter}:{accountId:string;task:ProfessionalTask;onClose:()=>void;onViewMessage?:(messageId:string)=>void;onReturnChat?:()=>void;showCharacter:boolean}){
  const dialog=useRef<HTMLDialogElement>(null),endButton=useRef<HTMLButtonElement>(null),returnButton=useRef<HTMLButtonElement>(null),titleId=useId();
  const restoreConfirmationFocus=useCallback(()=>{(endButton.current||returnButton.current)?.focus({preventScroll:true});},[]);
  const {expanded,toggle}=useStepExpansion(accountId,task),{error,pending,complete,status,timer,schedule,startSession,completeSession}=useTaskActions(accountId,task),now=useTimerClock(task.steps);
  const [confirmComplete,setConfirmComplete]=useState<SessionConfirmation|null>(null);
  const [confirmEnd,setConfirmEnd]=useState(false),allHints=useMemo(()=>task.steps.flatMap(step=>step.hints).sort((a,b)=>a.at.localeCompare(b.at)),[task.steps]);
  const [seenHint,setSeenHint]=useState(()=>allHints.at(-1)?.id),latest=allHints.at(-1),hasNew=latest&&latest.id!==seenHint;
  useLayoutEffect(()=>{const node=dialog.current,previous=document.activeElement;node?.showModal();return()=>{node?.close();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus({preventScroll:true});};},[]);
  const message=()=>{if(latest?.messageIds[0]&&onViewMessage)onViewMessage(latest.messageIds[0]);if(onReturnChat)onReturnChat();else onClose();};
  return <dialog ref={dialog} className="zy-dialog zy-professional-task-dialog" aria-labelledby={titleId} onCancel={event=>{event.preventDefault();if(!confirmEnd&&!confirmComplete)onClose();}} onPointerDown={event=>{if(confirmEnd||confirmComplete||event.target!==event.currentTarget||event.button!==0)return;const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)onClose();}}>
    <header className="zy-professional-task-dialog-head"><div><h2 id={titleId}>{task.title}</h2>{showCharacter&&<p>{professionalTaskCharacterName(task)}</p>}</div><TaskCount task={task}/></header>
    <div className="zy-professional-task-dialog-summary"><TaskProgress task={task}/><p>{taskStatusLabel(task.status)}{task.status==='paused'&&<button type="button" className="zy-professional-task-resume" disabled={pending.has('status')} onClick={()=>void status('active')}>继续任务</button>}</p></div>
    {error&&!confirmEnd&&!confirmComplete&&<p role="alert" className="zy-professional-task-error">{error}</p>}
    {hasNew&&<output className="zy-professional-task-dialog-notice">有新提示<button type="button" onClick={()=>{setSeenHint(latest.id);if(expanded!==latest.stepId)toggle(latest.stepId);}}>查看步骤</button><button type="button" onClick={message}>查看消息</button></output>}
    <div className="zy-professional-task-dialog-list"><TaskSteps task={task} steps={task.steps} expanded={expanded} onExpand={toggle} onComplete={step=>void complete(step)} onTimer={(step,action)=>void timer(step,action)} onSchedule={(step,date)=>void schedule(step,date)} pending={pending} now={now}/></div>
    <footer className="zy-professional-task-dialog-footer"><TaskSessionStart task={task} pending={pending} now={now} onStart={()=>void startSession()} onFinish={setConfirmComplete}/>{['active','paused'].includes(task.status)&&<button ref={endButton} type="button" className="zy-professional-task-end" disabled={pending.has('status')} onClick={()=>setConfirmEnd(true)}>结束任务</button>}<button ref={returnButton} type="button" className="zy-professional-task-return" onClick={onReturnChat||onClose}>返回聊天</button></footer>
    {confirmEnd&&<EndTaskConfirmation pending={pending.has('status')} error={error} restoreFocus={restoreConfirmationFocus} onCancel={()=>setConfirmEnd(false)} onConfirm={()=>{void status('cancelled').then(saved=>{if(saved)setConfirmEnd(false);});}}/>}
    {confirmComplete&&<CompleteSessionConfirmation confirmation={confirmComplete} pending={pending.has('session-complete')} error={error} onCancel={()=>setConfirmComplete(null)} onConfirm={()=>{void completeSession(confirmComplete.sessionId).then(saved=>{if(saved)setConfirmComplete(null);});}}/>}
  </dialog>;
}
export function ProfessionalTaskEntry({accountId,characterId='zhou-chef',companion=false,onOpen}:{accountId:string;characterId?:string;companion?:boolean;onOpen?:(taskId:string)=>void}){
  const tasks=useProfessionalTasks(accountId).filter(task=>task.characterId===characterId&&['active','paused'].includes(task.status)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),now=useTimerClock(tasks.flatMap(task=>task.steps));
  const timers=tasks.flatMap(task=>task.steps.map(step=>({task,step,timer:professionalTaskTimerView(step,now)}))).filter(item=>!item.step.completedAt&&!item.step.skippedAt&&item.timer.showTimer&&['running','paused'].includes(item.timer.status)).sort((a,b)=>(a.timer.status==='running'?0:1)-(b.timer.status==='running'?0:1)||a.timer.remainingSeconds-b.timer.remainingSeconds),activeTimer=timers[0];
  const [picker,setPicker]=useState(false),[taskId,setTaskId]=useState<string|null>(null),anchor=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),pickerId=useId();
  useLayoutEffect(()=>{
    const composer=anchor.current?.closest<HTMLElement>('.chat-composer-shell'),entry=composer?.querySelector<HTMLElement>('.chat-text-entry');
    if(!composer||!entry||!companion||!tasks.length)return;
    const previous=composer.style.getPropertyValue('--zy-pt-toolbar-width');
    const measure=()=>composer.style.setProperty('--zy-pt-toolbar-width',`${Math.max(0,entry.getBoundingClientRect().left-composer.getBoundingClientRect().left)}px`);
    measure();const observer=new ResizeObserver(measure);observer.observe(composer);observer.observe(entry);
    return()=>{observer.disconnect();if(previous)composer.style.setProperty('--zy-pt-toolbar-width',previous);else composer.style.removeProperty('--zy-pt-toolbar-width');};
  },[companion,tasks.length]);
  useEffect(()=>{
    if(!picker)return;
    anchor.current?.querySelector<HTMLButtonElement>('.zy-professional-task-picker button')?.focus();
    const outside=(event:PointerEvent)=>{if(!anchor.current?.contains(event.target as Node))setPicker(false);};
    document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
  },[picker]);
  if(!tasks.length)return taskId?<ProfessionalTaskDetailsDialog accountId={accountId} taskId={taskId} onClose={()=>setTaskId(null)}/>:null;
  const open=(id:string)=>{setPicker(false);if(onOpen)onOpen(id);else setTaskId(id);};
  const first=tasks[0],{completed,total}=professionalTaskProgress(first);
  return <><div ref={anchor} className={'zy-professional-task-entry'+(companion?' has-companion':'')+(activeTimer?' has-timer':'')}>
    <button ref={trigger} type="button" aria-label={activeTimer?'查看计时任务：'+activeTimer.task.title+'，'+activeTimer.step.title+'，剩余 '+countdown(activeTimer.timer.remainingSeconds)+(activeTimer.timer.status==='paused'?'，已暂停':''):tasks.length===1?'查看任务：'+first.title:'查看 '+tasks.length+' 项任务'} aria-expanded={!activeTimer&&tasks.length>1?picker:undefined} aria-controls={picker?pickerId:undefined} onKeyDown={event=>{if(event.key==='Escape'&&picker){event.preventDefault();event.stopPropagation();setPicker(false);}}} onClick={()=>activeTimer?open(activeTimer.task.id):tasks.length===1?open(first.id):setPicker(!picker)}>
      {activeTimer?<><TimerRing progress={activeTimer.timer.progress} paused={activeTimer.timer.status==='paused'}/><span className="zy-professional-task-entry-time">{countdown(activeTimer.timer.remainingSeconds)}</span>{activeTimer.timer.status==='paused'&&<Pause size={10} strokeWidth={2}/>} {timers.length>1&&<span className="zy-professional-task-entry-timer-count">+{timers.length-1}</span>}</>:<><ClipboardCheck size={20} strokeWidth={1.6}/><span className="zy-professional-task-entry-label">{tasks.length===1?first.title:'任务 '+tasks.length}</span>{tasks.length===1&&<span className="zy-professional-task-entry-progress">{completed}/{total}</span>}</>}
    </button>
    {picker&&!activeTimer&&<div id={pickerId} className="zy-professional-task-picker" aria-label="进行中的任务">{tasks.map(task=>{const progress=professionalTaskProgress(task);return <button key={task.id} type="button" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setPicker(false);trigger.current?.focus();}}} onClick={()=>open(task.id)}><span>{task.title}{task.status==='paused'?' · 已暂停':''}</span><span>{progress.completed}/{progress.total}</span></button>;})}</div>}
  </div>{taskId&&<ProfessionalTaskDetailsDialog accountId={accountId} taskId={taskId} onClose={()=>setTaskId(null)}/>}</>;
}
