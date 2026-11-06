'use client';
/* eslint-disable next/no-img-element -- Preserve local SVG avatars and task image assets. */

import {useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {Activity, Check, ChevronDown, ClipboardList, CookingPot, Droplet, Dumbbell, HeartPulse, Image as ImageIcon, Mic, Moon, PersonStanding, Pin, Play, ShoppingBag, Timer, Utensils, type LucideIcon} from 'lucide-react';
import PressableIconButton from '../pressable-icon-button';
import {useAnchoredPopupPresence} from '../anchored-popup-motion';
import type {Task, Step, Category, Npc, TaskTimer, TaskView} from './types';
import {trainingTitlePresentation} from '../../../lib/npc/training-task-presentation';
import './task-components.css';

export type TaskActions = {
  onToggleStatus:(task:Task)=>void;
  onStart:(task:Task)=>void;
  onFinish:(task:Task)=>void;
  onTalk:(task:Task)=>void;
  onStepToggle:(task:Task,step:Step)=>void;
  /** The set index is zero-based. */
  onSetClick:(task:Task,step:Step,index:number)=>void;
  onTimerStart:(task:Task,step:Step)=>void;
  onExpandTask:(task:Task)=>void;
  onExpandStep:(stepId:string)=>void;
  onPin?:(task:Task)=>void;
};
export type TaskComponentProps = {
  task:Task; category:Category; npc:Npc; mode:TaskView;
  expanded:boolean; expandedStepId?:string; active?:boolean; now:number;
  rest?:TaskTimer; timers?:Record<string,TaskTimer>; actions:TaskActions; today?:string;
};
const iconMap:Record<string,LucideIcon> = {
  Dumbbell, Activity, Utensils, CookingPot, ShoppingBag, Moon, Droplet,
  HeartPulse, PersonStanding, ClipboardList,
  dumbbell:Dumbbell, activity:Activity, utensils:Utensils, cooking:CookingPot,
  'cooking-pot':CookingPot, shopping:ShoppingBag, 'shopping-bag':ShoppingBag,
  moon:Moon, droplet:Droplet, recovery:HeartPulse, sleep:Moon,
};
const finished = (task:Task) => task.status==='done'||task.status==='ended';
const stepDone = (task:Task) => task.steps?.filter(step=>step.done).length||0;
const hasStepProgress = (task:Task) => task.steps?.some(step=>step.done||(step.sets?.done||0)>0)||false;
const styleColor = (color?:string):CSSProperties => ({'--tb-category-color':color||'var(--zy-task-accent,var(--zy-chat-control-accent))'} as CSSProperties);
const timeLeft = (endsAt:number|undefined,now:number) => endsAt?Math.max(0,Math.ceil((endsAt-now)/1000)):0;
const clock = (seconds:number) => `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
const restLabel = (seconds:number) => seconds>=60?`${Math.floor(seconds/60)}分${seconds%60?String(seconds%60)+'秒':''}`:`${seconds}秒`;
const durationLabel = (seconds:number) => seconds%60===0?`${seconds/60} 分钟`:restLabel(seconds);
const isTrainingTask=(task:Task)=>['fitness','recovery'].includes(task.categoryId);
const taskTitle=(task:Task)=>trainingTitlePresentation(task.title,isTrainingTask(task)).title;
const stepTitle=(task:Task,step:Step)=>trainingTitlePresentation(step.name,isTrainingTask(task)).title;
function TrainingTaskNotes({task}:{task:Task}) {
  if(!isTrainingTask(task))return null;
  const cues=[...trainingTitlePresentation(task.title).cues,...(task.tip?[task.tip]:[])];
  return cues.length?<p className="tb-single-note" aria-label="动作要点">{['动作要点',...new Set(cues)].join('\n')}</p>:null;
}

export function CategoryIcon({category,size=26}:{category:Category;size?:number}) {
  const Icon=iconMap[category.icon]||ClipboardList;
  return <span className="tb-category-icon" style={{...styleColor(category.color),width:size,height:size}} aria-hidden="true"><Icon size={size>30?21:15} strokeWidth={1.6}/></span>;
}
export function NpcAvatar({npc,muted=false,size=18}:{npc:Npc;muted?:boolean;size?:number}) {
  const initial=npc.initial||(npc.name==='Molly'?'M':npc.name.charAt(0));
  const image=!!npc.avatar&&/^(?:\/|https?:|data:image)/.test(npc.avatar);
  return <span className={'tb-npc-avatar'+(muted?' is-muted':'')} title={npc.name} aria-label={npc.name} style={{width:size,height:size,background:npc.background||'var(--zy-incoming)',color:npc.color||'var(--zy-ink)'}}>
    {image?<img src={npc.avatar} alt=""/>:initial}
  </span>;
}
export function ProgressPill({current,total,unit,color,label}:{current:number;total:number;unit?:string;color?:string;label?:string}) {
  const safeTotal=Math.max(0,total),ratio=safeTotal?Math.max(0,Math.min(1,current/safeTotal)):0;
  const complete=safeTotal>0&&current>=safeTotal;
  const text=unit?`${current} / ${total}${unit}`:`${current} / ${total} 完成`;
  const circumference=2*Math.PI*5.5;
  return <span className={'tb-progress-pill'+(complete?' is-complete':'')} style={styleColor(color)} aria-label={label?label+'：'+text:text}>
    <span className="tb-progress-symbol" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 14 14"><circle className="tb-progress-track" cx="7" cy="7" r="5.5"/><circle className="tb-progress-fill" cx="7" cy="7" r="5.5" strokeDasharray={circumference} strokeDashoffset={circumference*(1-ratio)}/></svg><i/></span><span>{text}</span>
  </span>;
}
export function SegmentedControl<T extends string|number>({options,value,onChange,label}:{options:{value:T;label:string}[];value:T;onChange:(value:T)=>void;label:string}) {
  return <fieldset className="tb-segmented"><legend className="tb-sr-only">{label}</legend>{options.map(option=><button type="button" key={option.value} aria-pressed={value===option.value} className={value===option.value?'is-selected':''} onClick={()=>onChange(option.value)}>{option.label}</button>)}</fieldset>;
}
function Disclosure({open,children,id}:{open:boolean;children:ReactNode;id?:string}) {
  return <div id={id} className={'tb-disclosure'+(open?' is-open':'')} aria-hidden={!open} inert={!open}><div className="tb-disclosure-clip">{children}</div></div>;
}
function Chevron({open,label,onClick,controls}:{open:boolean;label:string;onClick:()=>void;controls?:string}) {
  return <PressableIconButton className={'tb-expand-icon'+(open?' is-open':'')} aria-label={label} aria-expanded={open} aria-controls={controls} onClick={event=>{event.stopPropagation();onClick();}}><ChevronDown size={18}/></PressableIconButton>;
}
function CounterCircle({task,mode,onClick}:{task:Task;mode:TaskView;onClick:()=>void}) {
  const done=finished(task),disabled=mode==='future';
  const label=mode==='history'?(done?'补记为没做到：':'补记为已完成：'):done?'取消完成：':task.type==='count'?`记一次 ${task.count?.perTime||0}${task.count?.unit||''}：`:task.type==='steps'?'结束任务：':'完成：';
  return <button type="button" className={'tb-status-circle'+(done?' is-done':'')+(mode==='history'?' is-history':'')} disabled={disabled} aria-label={disabled?'未来任务，暂不可完成：'+taskTitle(task):label+taskTitle(task)} aria-pressed={done} onClick={event=>{event.stopPropagation();onClick();}}>{done&&<Check size={13} strokeWidth={2.5}/>}</button>;
}
function TaskContextMenu({task,point,onClose,onPin,trigger}:{task:Task;point:{x:number;y:number}|null;onClose:()=>void;onPin:()=>void;trigger:RefObject<HTMLButtonElement|null>}) {
  const menu=useRef<HTMLDivElement>(null);
  const [savedPoint,setSavedPoint]=useState(point);
  if(point&&(point.x!==savedPoint?.x||point.y!==savedPoint?.y))setSavedPoint(point);
  const present=useAnchoredPopupPresence(!!point,menu,()=>savedPoint);
  useEffect(()=>{if(!point)return;const pointer=(event:PointerEvent)=>{if(!menu.current?.contains(event.target as Node))onClose();};const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();trigger.current?.focus();}else if(event.key==='Tab')onClose();};document.addEventListener('pointerdown',pointer);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',pointer);document.removeEventListener('keydown',escape);};},[point,onClose,trigger]);
  useLayoutEffect(()=>{if(point)menu.current?.querySelector<HTMLButtonElement>('button')?.focus();},[point]);
  const position=savedPoint;
  if(!present||!position)return null;
  return createPortal(<div className="zy-chat-context tb-task-context" ref={menu} role="menu" aria-label="任务操作" aria-hidden={!point} inert={!point} style={{left:position.x,top:position.y}}><button type="button" role="menuitem" onClick={()=>{onPin();onClose();trigger.current?.focus();}}><Pin size={15}/>{task.pinned?'取消置顶':'置顶'}</button></div>,document.body);
}
export function TaskRow(props:TaskComponentProps) {
  const {task,category,npc,mode,expanded,actions}=props;
  const id=useId();
  const mainButton=useRef<HTMLButtonElement>(null);
  const [contextPoint,setContextPoint]=useState<{x:number;y:number}|null>(null);
  const done=finished(task),steps=task.steps?.length||0,doneSteps=stepDone(task),progress=hasStepProgress(task);
  const progressVisible=mode==='history'?progress:mode==='today'&&!done&&progress;
  const countVisible=mode==='today'&&!done&&!!task.count&&task.count.current>0;
  const badgeVisible=steps>0&&!progress&&(mode!=='today'||!done);
  const miss=mode==='history'&&!done;
  const closeContext=()=>setContextPoint(null);
  return <article className={'tb-task-item'+(done?' is-done':'')+(miss?' is-missed':'')+' tb-mode-'+mode} style={styleColor(category.color)} data-task-id={task.id}>
    <div className="tb-task-line">
      <CounterCircle task={task} mode={mode} onClick={()=>actions.onToggleStatus(task)}/>
      <button ref={mainButton} type="button" className="tb-task-main" aria-expanded={expanded} aria-controls={id} onClick={()=>actions.onExpandTask(task)}
        onContextMenu={event=>{if(mode!=='today'||!actions.onPin)return;event.preventDefault();const r=event.currentTarget.getBoundingClientRect();setContextPoint({x:Math.max(8,Math.min(event.clientX||r.left+30,window.innerWidth-180)),y:Math.max(8,Math.min(event.clientY||r.bottom,window.innerHeight-58))});}}>
        <span className="tb-task-copy">
        <span className="tb-task-name">{task.pinned&&mode==='today'&&<Pin className="tb-task-pin" size={14}/>}<span>{taskTitle(task)}</span>{badgeVisible&&<span className="tb-step-badge">{steps}</span>}</span>
        <span className="tb-task-meta"><NpcAvatar npc={npc} muted={done&&mode==='today'}/><span>{task.amount}{!isTrainingTask(task)&&task.amount&&task.tip?' · ':''}{!isTrainingTask(task)&&task.tip}</span></span>
        </span>
      <span className="tb-task-row-progress">
        {miss&&(task.missText||task.missReason)&&<span className="tb-missed-tag">{task.missText||'没做 · '+task.missReason}</span>}
        {progressVisible&&<ProgressPill current={doneSteps} total={steps} color={category.color}/>}
        {countVisible&&task.count&&<ProgressPill current={task.count.current} total={task.count.target} unit={task.count.unit} color={category.color}/>}
      </span>
      </button>
      <Chevron open={expanded} controls={id} label={(expanded?'收起：':'展开：')+taskTitle(task)} onClick={()=>actions.onExpandTask(task)}/>
    </div>
    <Disclosure open={expanded} id={id}><TaskExpand {...props}/></Disclosure>
    {actions.onPin&&<TaskContextMenu task={task} point={contextPoint} trigger={mainButton} onClose={closeContext} onPin={()=>actions.onPin?.(task)}/>}
  </article>;
}
function futureStartText(task:Task,now:number,today?:string) {
  const base=today||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const tomorrow=new Date(`${base}T12:00:00Z`);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
  return task.repeat==='daily'||task.date===tomorrow.toISOString().slice(0,10)?'明天才能开始':`${Number(task.date.slice(5,7))}月${Number(task.date.slice(8,10))}日才能开始`;
}
function TaskFooter({task,category,mode,active=false,actions,now,today}:TaskComponentProps) {
  const done=finished(task),verb=category.verb||'执行';
  return <footer className="tb-task-footer">
    <button type="button" className="tb-action tb-action-brand" onClick={()=>actions.onTalk(task)}><Mic size={16}/>与智友对话</button>
    <div className="tb-task-footer-right">
      {mode==='future'?<span className="tb-task-footnote">{futureStartText(task,now,today)}</span>:mode==='history'?null:done?<span className="tb-task-footnote">{task.status==='ended'?'已结束':'已完成'}</span>:task.type==='steps'?<>
        <button type="button" className="tb-action tb-action-white" onClick={()=>actions.onFinish(task)}><Check size={16}/>{verb}完成</button>
        {!active&&<button type="button" className="tb-action tb-action-dark" onClick={()=>actions.onStart(task)}><Play size={15}/>{task.status==='paused'||hasStepProgress(task)?'继续':'开始'}{verb}</button>}
      </>:task.type==='count'&&task.count?<>
        <button type="button" className="tb-action tb-action-white" onClick={()=>actions.onFinish(task)}>{task.count.unit==='ml'?'喝完了':'完成'}</button>
        <button type="button" className="tb-action tb-action-dark" onClick={()=>actions.onToggleStatus(task)}>记一次 {task.count.perTime}{task.count.unit}</button>
      </>:<button type="button" className="tb-action tb-action-white" onClick={()=>actions.onToggleStatus(task)}><Check size={16}/>完成</button>}
    </div>
  </footer>;
}
function StepDetails({step,task,mode,actions,now,timers}: {step:Step;task:Task;mode:TaskView;actions:TaskActions;now:number;timers?:Record<string,TaskTimer>}) {
  const timer=timers?.[`${task.id}:${step.id}`],remaining=timeLeft(timer?.endsAt,now);
  const titleCues=trainingTitlePresentation(step.name,isTrainingTask(task)).cues.filter(cue=>!step.detail.includes(cue));
  return <div className="tb-step-details"><div className="tb-step-detail-copy">
    {titleCues.length>0&&<p className="tb-single-note" aria-label="动作要点">{titleCues.join('\n')}</p>}
    {(step.sets||step.detail||step.actual)&&<div className="tb-set-line">{step.sets&&<span className="tb-set-buttons">{Array.from({length:step.sets.total},(_,index)=>{
      const done=index<step.sets!.done,current=index===step.sets!.done&&!step.done&&!finished(task);
      return <button type="button" key={index} className={'tb-set'+(done?' is-done':'')+(current?' is-current':'')} disabled={mode!=='today'||finished(task)} aria-label={`${stepTitle(task,step)}，第${index+1}组${done?'，已完成':''}`} aria-pressed={done} onClick={()=>actions.onSetClick(task,step,index)}>第{index+1}组{done&&<Check size={11}/>}</button>;
    })}</span>}<span className="tb-set-detail">{mode==='history'?(step.actual||step.detail):step.detail}</span></div>}
    {!!step.tips?.length&&<ul className="tb-step-tips">{step.tips.map((tip,index)=><li key={index}>{tip}</li>)}</ul>}
    {step.timerSeconds&&mode==='today'&&!finished(task)&&<button type="button" className="tb-action tb-action-white tb-step-timer" onClick={()=>actions.onTimerStart(task,step)}><Timer size={15}/>{remaining?`计时中 ${clock(remaining)}`:timer?'重新计时':`开始 ${durationLabel(step.timerSeconds)}计时`}</button>}
    {timer&&mode==='today'&&remaining===0&&<output className="tb-timer-finished">计时结束</output>}
  </div>{step.image?<img className="tb-step-image" src={step.image} alt={stepTitle(task,step)+'示意图'}/>:<span className="tb-step-image tb-step-image-placeholder" aria-hidden="true"><ImageIcon size={23}/></span>}</div>;
}
function StepRows(props:TaskComponentProps) {
  const {task,mode,expandedStepId,actions,now,rest,timers,active}=props;
  const steps=task.steps||[],currentIndex=task.status==='in_progress'?steps.findIndex(step=>!step.done&&!step.skipped):-1;
  const readonly=mode!=='today'||finished(task);
  const detailBase=useId();
  return <div className="tb-vertical-steps">{steps.map((step,index)=>{
    const current=active&&index===currentIndex,canExpand=mode!=='future'||isTrainingTask(task),open=canExpand&&expandedStepId===step.id;
    const remaining=rest?.taskId===task.id&&rest.stepId===step.id?timeLeft(rest.endsAt,now):0;
    const cookingTimer=timers?.[`${task.id}:${step.id}`],cookingRemaining=timeLeft(cookingTimer?.endsAt,now);
    const tag=remaining?`休息中 ${clock(remaining)}`:cookingRemaining?`计时中 ${clock(cookingRemaining)}`:isTrainingTask(task)?step.durationText||(step.restSeconds?'休息 '+restLabel(step.restSeconds):''):mode==='future'?step.detail:mode==='history'?(step.actual||step.detail):step.durationText||(step.restSeconds?'休息 '+restLabel(step.restSeconds):step.detail);
    const detailsId=detailBase+'-'+index;
    return <div key={step.id} className={'tb-step'+(step.done?' is-done':'')+(current?' is-current':'')}>
      <div className="tb-step-line">
        {mode==='future'?<span className="tb-step-number">{index+1}</span>:<button type="button" className={'tb-status-circle tb-step-circle'+(step.done?' is-done':'')} disabled={readonly} aria-label={(step.done?'取消步骤完成：':'完成步骤：')+stepTitle(task,step)} aria-pressed={step.done} onClick={()=>actions.onStepToggle(task,step)}>{step.done&&<Check size={13} strokeWidth={2.5}/>}</button>}
        {canExpand?<button type="button" className="tb-step-name tb-step-name-button" aria-expanded={open} aria-controls={detailsId} onClick={()=>actions.onExpandStep(step.id)}>{stepTitle(task,step)}</button>:<span className="tb-step-name">{stepTitle(task,step)}</span>}
        {tag&&<span className={'tb-step-tag'+(remaining||cookingRemaining?' is-counting':'')}>{tag}</span>}
        {canExpand&&<Chevron open={open} controls={detailsId} label={(open?'收起步骤：':'展开步骤：')+stepTitle(task,step)} onClick={()=>actions.onExpandStep(step.id)}/>}
      </div>
      {canExpand&&<Disclosure open={open} id={detailsId}><StepDetails step={step} task={task} mode={mode} actions={actions} now={now} timers={timers}/></Disclosure>}
    </div>;
  })}</div>;
}
export function TaskExpand(props:TaskComponentProps) {
  const {task}=props;
  const count=task.count,segments=count?Math.max(1,Math.min(128,Math.ceil(count.target/count.perTime))):0;
  return <div className="tb-task-expand" style={styleColor(props.category.color)}>
    <TrainingTaskNotes task={task}/>
    {task.type==='steps'?<StepRows {...props}/>:task.type==='count'&&count?<div className="tb-count-content"><ProgressPill current={count.current} total={count.target} unit={count.unit} color={props.category.color}/><div className="tb-count-segments" aria-label={`${count.current} / ${count.target}${count.unit}`} style={{gridTemplateColumns:`repeat(${segments},minmax(0,1fr))`}}>{Array.from({length:segments},(_,index)=><span key={index} className={count.current>=Math.min(count.target,(index+1)*count.perTime)?'is-filled':''}/>)}</div>{task.note&&<p className="tb-single-note">{task.note}</p>}</div>:<p className="tb-single-note">{task.note||[task.amount,task.tip].filter(Boolean).join('，')}</p>}
    <TaskFooter {...props}/>
  </div>;
}
export function ActiveTaskCard(props:TaskComponentProps) {
  const {task,category,npc,expanded,actions,now,rest}=props;
  const steps=task.steps||[],done=finished(task),current=task.status==='in_progress'?steps.findIndex(step=>!step.done&&!step.skipped):-1;
  const id=useId();
  return <section className={'tb-active-card'+(done?' is-ended':'')} style={styleColor(category.color)} aria-label={'进行中任务：'+taskTitle(task)} data-active-task-id={task.id}>
    <header className="tb-active-header"><CategoryIcon category={category} size={40}/><button type="button" className="tb-active-copy" aria-expanded={expanded} aria-controls={id} onClick={()=>actions.onExpandTask(task)}><strong>{taskTitle(task)}</strong><span className="tb-task-meta"><NpcAvatar npc={npc}/><span>{task.amount}{!isTrainingTask(task)&&task.tip?' · '+task.tip:''}</span></span></button><ProgressPill current={stepDone(task)} total={steps.length} color={category.color}/><Chevron open={expanded} controls={id} label={(expanded?'收起进行中任务：':'展开进行中任务：')+taskTitle(task)} onClick={()=>actions.onExpandTask(task)}/></header>
    <div id={id}><Disclosure open={expanded}><TrainingTaskNotes task={task}/><StepRows {...props} active/></Disclosure><Disclosure open={!expanded}><div className="tb-horizontal-steps" style={{gridTemplateColumns:`repeat(${Math.min(6,Math.max(1,steps.length))},minmax(0,1fr))`}}>{steps.map((step,index)=>{
      const isCurrent=index===current,remaining=rest?.taskId===task.id&&rest.stepId===step.id?timeLeft(rest.endsAt,now):0;
      const ratio=step.done?1:step.sets&&step.sets.total?Math.min(1,step.sets.done/step.sets.total):0;
      const detail=done&&!step.done?'没做':isCurrent&&step.sets?`第 ${Math.min(step.sets.total,step.sets.done+1)} 组${remaining?' · 休息 '+clock(remaining):''}`:isCurrent&&remaining?'休息 '+clock(remaining):isTrainingTask(task)?step.sets?`${step.sets.done} / ${step.sets.total} 组`:step.durationText||'':step.detail;
      return <div key={step.id} className={'tb-horizontal-step'+(step.done?' is-done':'')+(isCurrent?' is-current':'')+(done&&!step.done?' is-skipped':'')}><div className="tb-mini-track"><span style={{width:`${ratio*100}%`}}/></div><strong>{step.done&&<Check size={12}/>}<span>{stepTitle(task,step)}</span></strong><small>{detail}</small></div>;
    })}</div></Disclosure></div>
    <TaskFooter {...props} active/>
  </section>;
}
export function EndTaskConfirm({task,category,open=true,onConfirm,onCancel,anchor}:{task:Task|null;category?:Category;open?:boolean;onConfirm:(task:Task)=>void;onCancel:()=>void;anchor?:HTMLElement|null}) {
  const dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLElement|null>(null),latestAnchor=useRef(anchor);
  const [cached,setCached]=useState({task,category});
  if(task&&cached.task!==task)setCached({task,category});
  const titleId=useId(),descriptionId=useId();
  useLayoutEffect(()=>{latestAnchor.current=anchor;},[anchor]);
  const visible=!!task&&open;
  const present=useAnchoredPopupPresence(visible,dialog,()=>anchor||opener.current);
  useLayoutEffect(()=>{
    if(!present)return;
    const node=dialog.current;
    if(!node)return;
    opener.current=latestAnchor.current||(document.activeElement instanceof HTMLElement?document.activeElement:null);
    if(!node.open)node.showModal();
    return()=>{node.close();if(opener.current?.isConnected)opener.current.focus({preventScroll:true});};
  },[present]);
  const shown=cached.task;
  if(!present||!shown)return null;
  const total=shown.steps?.length||0,complete=stepDone(shown),unit=['fitness','recovery'].includes(cached.category?.id||'')?'动作':'步骤';
  const explanation=complete===total?`全部 ${total} 个${unit}都做完了。`:`还有 ${total-complete} 个${unit}没做，结束后按 ${complete} / ${total} 记录。`;
  return <dialog ref={dialog} className="zy-dialog tb-end-confirm" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event=>{event.preventDefault();onCancel();}} onPointerDown={event=>{if(event.target!==event.currentTarget||event.button!==0)return;const r=event.currentTarget.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)onCancel();}}><div className="tb-end-confirm-copy"><h2 id={titleId}>结束{shown.title}？</h2><p id={descriptionId}>{explanation}</p></div><div className="tb-end-confirm-actions"><button type="button" autoFocus onClick={onCancel}>否</button><button type="button" onClick={()=>onConfirm(shown)}>是</button></div></dialog>;
}
