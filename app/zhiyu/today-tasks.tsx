'use client';
import {useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent} from 'react';
import {CalendarCheck, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CookingPot, Droplet, Dumbbell, House, Minus, NotebookPen, PersonStanding, ShoppingBag, Utensils} from 'lucide-react';
import type {GroupChat} from '../../lib/npc/group-chat';
import {useAccount} from './auth-gate';
import {useTaskCompletions} from './task-completion';
import {refreshTaskCompletions,setTaskCompleteAndSync} from './task-completion-sync';
import {isTaskItemSkipped, taskItemState, professionalTaskProgressForDate, professionalTasksForDate, professionalTaskCategory, professionalTaskCharacterName, shanghaiToday, shiftTaskDate, taskCalendarRange, taskDateLabel, taskItemsForDate, type TaskCategory, type TaskItem} from './task-items';
import {ProfessionalTaskCard, ProfessionalTaskDetailsDialog} from './professional-task';
import {refreshProfessionalTasks, useProfessionalTasks} from './professional-task-store';
import {professionalTaskProgress, type ProfessionalTask} from '../../lib/npc/professional-task';
import './today-tasks.css';
export {shanghaiToday, groupTasksForToday} from './task-items';
type Props = {presentation?:'dialog'|'page'; initialScope?:'today'|'all'; groups: GroupChat[]; onSelectGroup: (groupId: string) => void; onSelectCharacter?: (characterId: string) => void; onClose: () => void};
type Category = TaskCategory | 'all';
const categories = [
  {id:'all',label:'总体',icon:House}, {id:'cooking',label:'做饭',icon:CookingPot},
  {id:'fitness',label:'健身',icon:Dumbbell}, {id:'diet',label:'饮食',icon:Utensils},
  {id:'skin',label:'皮肤管理',icon:Droplet}, {id:'shopping',label:'采购',icon:ShoppingBag},
  {id:'recovery',label:'恢复',icon:PersonStanding}, {id:'review',label:'复盘',icon:NotebookPen},
] as const;
const percentage = (done:number,total:number) => total ? Math.round(done/total*100) : 0;
const monthDay = (date:string) => Number(date.slice(5,7))+'月'+Number(date.slice(8,10))+'日';
function TaskDatePicker({dates,markedDates,today,selected,onSelect,open,onOpen}: {
  dates:string[];markedDates:Set<string>;today:string;selected:string;onSelect:(date:string)=>void;open:boolean;onOpen:(open:boolean)=>void;
}) {
  const anchor=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),calendar=useRef<HTMLDivElement>(null),listId=useId();
  const [month,setMonth]=useState(()=>selected.slice(0,7));
  const available=useMemo(()=>new Set(dates),[dates]),first=dates[0],last=dates.at(-1)!;
  useLayoutEffect(()=>{if(open)calendar.current?.querySelector<HTMLButtonElement>('[aria-current="date"]')?.focus({preventScroll:true});},[open,month]);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!anchor.current?.contains(event.target as Node))onOpen(false);};
    document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
  },[open,onOpen]);
  const close=()=>{onOpen(false);trigger.current?.focus();};
  const changeMonth=(offset:number)=>{const value=new Date(`${month}-01T00:00:00Z`);value.setUTCMonth(value.getUTCMonth()+offset);setMonth(value.toISOString().slice(0,7));};
  const start=`${month}-01`,weekday=(new Date(`${start}T00:00:00Z`).getUTCDay()+6)%7;
  const lastDay=new Date(`${month}-01T00:00:00Z`);lastDay.setUTCMonth(lastDay.getUTCMonth()+1);lastDay.setUTCDate(0);const daysInMonth=lastDay.getUTCDate();
  const cells=Array.from({length:Math.ceil((weekday+daysInMonth)/7)*7},(_,index)=>index>=weekday&&index<weekday+daysInMonth?shiftTaskDate(start,index-weekday):null);
  function keys(event:KeyboardEvent<HTMLDialogElement>){
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
    const button=event.target as HTMLButtonElement,current=button.dataset.date;
    if(!current)return;
    const offsets:Record<string,number>={ArrowDown:7,ArrowUp:-7,ArrowLeft:-1,ArrowRight:1};
    const offset=offsets[event.key];if(offset===undefined)return;
    event.preventDefault();const next=shiftTaskDate(current,offset);if(!available.has(next))return;
    if(next.slice(0,7)!==month){setMonth(next.slice(0,7));requestAnimationFrame(()=>calendar.current?.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)?.focus());}
    else calendar.current?.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)?.focus();
  }
  return <div ref={anchor} className="zy-task-date-anchor">
    <button ref={trigger} type="button" className="zy-task-date-trigger" aria-label={'选择日期：'+taskDateLabel(selected,today)} aria-haspopup="dialog" aria-expanded={open} aria-controls={open?listId:undefined} onClick={()=>{if(!open)setMonth(selected.slice(0,7));onOpen(!open);}}><CalendarDays size={15} strokeWidth={1.7}/><span>{taskDateLabel(selected,today)}</span><ChevronDown size={13} strokeWidth={1.7}/></button>
    {open&&<dialog open id={listId} aria-label="任务日历" className="zy-task-date-popup" onKeyDown={keys}>
      <header className="zy-task-calendar-head"><button type="button" aria-label="上个月" disabled={month<=first.slice(0,7)} onClick={()=>changeMonth(-1)}><ChevronLeft size={15}/></button><strong>{Number(month.slice(0,4))}年{Number(month.slice(5,7))}月</strong><button type="button" aria-label="下个月" disabled={month>=last.slice(0,7)} onClick={()=>changeMonth(1)}><ChevronRight size={15}/></button></header>
      <div className="zy-task-calendar-weekdays" aria-hidden="true">{['一','二','三','四','五','六','日'].map(day=><span key={day}>{day}</span>)}</div>
      <div ref={calendar} className="zy-task-calendar-grid">{cells.map((date,index)=>date?<button key={date} type="button" data-date={date} className={(markedDates.has(date)?'has-task ':'')+(date===selected?'is-selected ':'')+(date===today?'is-today':'')} disabled={!available.has(date)} aria-current={date===selected?'date':undefined} aria-label={monthDay(date)+(markedDates.has(date)?'，有任务':'')+(date===today?'，今天':'')} onClick={()=>{onSelect(date);close();}}>{Number(date.slice(8,10))}{markedDates.has(date)&&<i aria-hidden="true"/>}</button>:<span key={'empty-'+index}/>)}</div>
      <footer className="zy-task-calendar-foot"><span><i/>有任务</span><button type="button" onClick={()=>{onSelect(today);close();}}>今天</button></footer>
    </dialog>}
  </div>;
}
export default function TodayTasks(props:Props){const {account}=useAccount();return <TaskDialog key={account.id} {...props} accountId={account.id}/>;}
function TaskDialog({groups,onSelectGroup,onSelectCharacter,onClose,accountId,initialScope='today',presentation='dialog'}:Props&{accountId:string}){
  const dialog=useRef<HTMLDialogElement>(null);const titleId=useId(),detailId=useId();
  const [now,setNow]=useState(()=>Date.now()),[selectedDate,setSelectedDate]=useState<string|null>(null);
  const [category,setCategory]=useState<Category>('all'),[dateOpen,setDateOpen]=useState(false);
  const scope=initialScope;
  const [expanded,setExpanded]=useState<Set<string>>(()=>new Set()),[saveError,setSaveError]=useState('');
  const completions=useTaskCompletions(accountId);
  const professionalTasks=useProfessionalTasks(accountId),[openTaskId,setOpenTaskId]=useState<string|null>(null);
  useEffect(()=>{
    let alive=true;
    const refresh=()=>void refreshProfessionalTasks(accountId).catch(reason=>{if(alive)setSaveError(reason instanceof Error?reason.message:'任务暂时无法同步。');});
    refresh();const timer=setInterval(refresh,2000);return()=>{alive=false;clearInterval(timer);};
  },[accountId]);
  useEffect(()=>{if(presentation!=='dialog')return;const node=dialog.current;if(!node?.open)node?.showModal();return()=>{node?.close();};},[presentation]);
  useEffect(()=>{const clock=setInterval(()=>setNow(Date.now()),60_000);return()=>clearInterval(clock);},[]);
  const today=shanghaiToday(now),{dates,markedDates}=useMemo(()=>taskCalendarRange(groups,professionalTasks,today),[groups,professionalTasks,today]);
  const date=selectedDate&&dates.includes(selectedDate)?selectedDate:today;
  const allGroupTasks=useMemo(()=>dates.flatMap(value=>taskItemsForDate(groups,value)),[groups,dates]);
  const tasks=useMemo(()=>scope==='all'?allGroupTasks:taskItemsForDate(groups,date),[scope,allGroupTasks,groups,date]);
  useEffect(()=>{let alive=true;void refreshTaskCompletions(accountId,allGroupTasks.map(task=>task.id)).catch(reason=>{if(alive)setSaveError(reason instanceof Error?reason.message:'完成状态暂时无法同步。');});return()=>{alive=false;};},[accountId,allGroupTasks]);
  const shown=tasks.filter(task=>category==='all'||task.category===category);
  const npcTasks=useMemo(()=>scope==='all'?[...professionalTasks].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)):professionalTasksForDate(professionalTasks,date,today),[scope,professionalTasks,date,today]);
  const shownNpc=npcTasks.filter(task=>category==='all'||professionalTaskCategory(task)===category);
  const groupState=(task:TaskItem)=>taskItemState(task,completions,today);
  const progressForView=(task:ProfessionalTask)=>scope==='all'?{...professionalTaskProgress(task),status:task.status}:professionalTaskProgressForDate(task,date);
  const countable=tasks.filter(task=>['pending','completed'].includes(groupState(task))),shownCountable=shown.filter(task=>['pending','completed'].includes(groupState(task)));
  const countNpc=(task:ProfessionalTask)=>{const view=progressForView(task);return view.total>0&&['active','completed'].includes(view.status);};
  const npcCountable=npcTasks.filter(countNpc),shownNpcCountable=shownNpc.filter(countNpc);
  const total=countable.length+npcCountable.length,shownTotal=shownCountable.length+shownNpcCountable.length;
  const complete=countable.filter(task=>completions[task.id]).length+npcCountable.filter(task=>progressForView(task).status==='completed').length;
  const shownComplete=shownCountable.filter(task=>completions[task.id]).length+shownNpcCountable.filter(task=>progressForView(task).status==='completed').length;
  const categoryName=categories.find(item=>item.id===category)!.label,label=category==='all'?'全部任务':categoryName+'任务';
  function completeTask(task:TaskItem){if(!task.canComplete||task.date<today||isTaskItemSkipped(task,completions,today))return;try{setSaveError('');void setTaskCompleteAndSync(accountId,task.id,!completions[task.id]).catch(error=>setSaveError(error instanceof Error?error.message:'完成状态暂时未同步，请重试。'));}catch(error){setSaveError(error instanceof Error?error.message:'完成状态未保存，请稍后重试。');}}
  function expandTask(id:string){setExpanded(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next;});}
  const content=<>
    <header className="zy-today-tasks-head"><h2 id={titleId}>任务</h2>{scope==='today'&&<TaskDatePicker dates={dates} markedDates={markedDates} today={today} selected={date} open={dateOpen} onOpen={setDateOpen} onSelect={value=>{setSelectedDate(value===today?null:value);setSaveError('');}}/>}</header>
    <div className="zy-task-summary" aria-label={(scope==='all'?'全部日期':monthDay(date))+'全部任务统计'}><div className="zy-task-stat"><span>总任务</span><strong>{total}</strong><small>{scope==='all'?'全部日期':monthDay(date)} · 全部任务</small></div><div className="zy-task-stat"><span>已完成</span><strong>{complete}</strong><small>完成度 <b>{percentage(complete,total)}%</b></small></div><div className="zy-task-stat"><span>待完成</span><strong>{total-complete}</strong><small>{scope==='all'?'全部剩余任务':'当日剩余任务'}</small></div></div>
    <nav className="zy-task-categories" aria-label="任务分类">{categories.map(({id,label:name,icon:Icon})=><button type="button" key={id} aria-pressed={category===id} className={category===id?'is-selected':''} onClick={()=>{setCategory(id);setSaveError('');}}><Icon size={25} strokeWidth={1.7}/><span>{name}</span></button>)}</nav>
    <section className="zy-task-card" aria-label={label}><div className="zy-task-card-head"><div className="zy-task-list-heading"><h3>{label}</h3><span className="zy-task-count"><i/>{shownComplete} / {shownTotal} 已完成</span></div><div className="zy-task-percent">{percentage(shownComplete,shownTotal)}<span>%</span></div><p>{scope==='all'?'全部日期':taskDateLabel(date,today)}的{category==='all'?'':categoryName}任务进度</p></div>
      {saveError&&<p role="alert" className="zy-task-save-error">{saveError}</p>}
      <div className="zy-task-list">{shownNpc.map(task=>{const progress=progressForView(task),done=progress.status==='completed',skipped=progress.status==='skipped',open=expanded.has(task.id),itemId=detailId+'-npc-'+task.id;return <article key={task.id} className={'zy-task-item zy-task-npc-item'+(skipped?' is-skipped':'')}><div className="zy-task-row">
        <button type="button" className={'zy-task-completion'+(done?' is-done':'')} aria-label={'查看任务步骤：'+task.title} onClick={()=>setOpenTaskId(task.id)}>{done?<Check size={13} strokeWidth={2.5}/>:skipped?<Minus size={13} strokeWidth={2}/>:null}</button>
        <div className={'zy-task-title'+(done?' is-done':'')}><span>{task.title}</span><small>{professionalTaskCharacterName(task)} · {progress.completed}/{progress.total} 步骤{progress.skipped>0?` · ${progress.skipped} 已跳过`:''}{progress.status==='paused'?' · 已暂停':progress.status==='cancelled'?' · 已结束':''}</small></div><span className="zy-task-time">{progress.percent}%</span>
        <button type="button" className={'zy-task-expand'+(open?' is-open':'')} aria-label={(open?'收起':'展开')+'：'+task.title} aria-expanded={open} aria-controls={open?itemId:undefined} onClick={()=>expandTask(task.id)}><ChevronDown size={15} strokeWidth={1.7}/></button>
      </div>{open&&<div id={itemId} className="zy-task-npc-details"><ProfessionalTaskCard accountId={accountId} taskId={task.id} onOpen={setOpenTaskId} showCharacter/>{onSelectCharacter&&<button type="button" className="zy-task-source" onClick={()=>onSelectCharacter(task.characterId)}>回到{professionalTaskCharacterName(task)}的聊天</button>}</div>}</article>;})}{shown.map((task,index)=>{const state=groupState(task),done=state==='completed',skipped=state==='skipped',open=expanded.has(task.id),itemId=detailId+'-'+index;return <article key={task.id} className={'zy-task-item'+(skipped?' is-skipped':'')}><div className="zy-task-row">
        <button type="button" className={'zy-task-completion'+(done?' is-done':'')} disabled={!task.canComplete||task.date<today||skipped} aria-label={(skipped?'已跳过':done?'撤销完成':'完成')+'：'+task.title+' · '+task.groupName} aria-pressed={done} title={skipped?'当日未完成，已跳过':!task.canComplete?task.statusLabel:undefined} onClick={()=>completeTask(task)}>{done?<Check size={13} strokeWidth={2.5}/>:skipped?<Minus size={13} strokeWidth={2}/>:null}</button>
        <div className={'zy-task-title'+(done?' is-done':'')}><span>{task.title}</span>{scope==='all'&&<small>{taskDateLabel(task.date,today)}</small>}{(skipped||!task.canComplete)&&<small>{skipped?'已跳过':task.statusLabel}</small>}</div>{task.time?<time className="zy-task-time">{task.time}</time>:<span className="zy-task-time">时间待定</span>}
        <button type="button" className={'zy-task-expand'+(open?' is-open':'')} aria-label={(open?'收起':'展开')+'：'+task.title+' · '+task.groupName} aria-expanded={open} aria-controls={open?itemId:undefined} onClick={()=>expandTask(task.id)}><ChevronDown size={15} strokeWidth={1.7}/></button>
      </div>{open&&<ul id={itemId} className="zy-task-details">{task.details.map((text,i)=><li key={i}>{text}</li>)}<li><button type="button" className="zy-task-source" onClick={()=>onSelectGroup(task.groupId)}>来自：{task.groupName}</button></li></ul>}</article>;})}
      {!shown.length&&!shownNpc.length&&<div className="zy-today-tasks-empty"><CalendarCheck size={30} strokeWidth={1.25}/><h3>{scope==='all'?'':taskDateLabel(date,today)}还没有{category==='all'?'':categoryName}任务</h3><p>已安排的任务会显示在这里。</p></div>}
      {(shown.some(task=>!task.canComplete||isTaskItemSkipped(task,completions,today))||shownNpc.some(task=>['paused','cancelled','skipped'].includes(progressForView(task).status)))&&<p className="zy-task-pending-note">已跳过、待确认、已暂停或已结束的安排不计入待完成任务。</p>}
      </div>
    </section>
  </>;
  return <>{presentation==='page'?<section className="zy-today-tasks zy-today-tasks-page" aria-labelledby={titleId}>{content}</section>:<dialog ref={dialog} className="zy-dialog zy-today-tasks" aria-labelledby={titleId} onCancel={event=>{event.preventDefault();if(dateOpen)setDateOpen(false);else onClose();}} onPointerDown={event=>{if(event.target!==event.currentTarget||event.button!==0)return;const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)onClose();}}>{content}</dialog>}{openTaskId&&<ProfessionalTaskDetailsDialog accountId={accountId} taskId={openTaskId} showCharacter onClose={()=>setOpenTaskId(null)} onReturnChat={onSelectCharacter?()=>{setOpenTaskId(null);const task=professionalTasks.find(item=>item.id===openTaskId);if(task)onSelectCharacter(task.characterId);}:undefined} onViewMessage={onSelectCharacter?()=>{const task=professionalTasks.find(item=>item.id===openTaskId);if(task)onSelectCharacter(task.characterId);}:undefined}/>}</>;
}
