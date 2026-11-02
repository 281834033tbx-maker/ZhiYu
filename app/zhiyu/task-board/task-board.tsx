'use client';

import {useCallback, useMemo, useRef, useState} from 'react';
import {CalendarDays, CalendarCheck, History, Plus, Search, ChevronDown, X} from 'lucide-react';
import PressableIconButton from '../pressable-icon-button';
import {useTaskBoard} from './use-task-board';
import {categoryGroups, categories, npcs, plans} from './config';
import {categoryOverview, futureOverview, historyOverview, isTaskFinished, shiftBoardDate, taskMatchesQuery} from './reducer';
import {TaskRow, ActiveTaskCard, ProgressPill, EndTaskConfirm, CategoryIcon, NpcAvatar, SegmentedControl, type TaskActions} from './task-components';
import HistoryView from './history-view';
import type {Task, TaskView} from './types';
import './task-board.css';

const monthDay = (date:string) => `${Number(date.slice(5,7))}月${Number(date.slice(8,10))}日`;
const weekday = (date:string) => new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',weekday:'short'}).format(new Date(date+'T12:00:00+08:00'));
const matchesCategory = (task:Task,category?:string) => !category || task.categoryId===category;

export default function TaskBoard({accountId,onOpenConversation}: {
  accountId:string;
  onOpenConversation:(npcId:string,task?:Task)=>void;
}) {
  const {model,dispatch,now,ready,storageError}=useTaskBoard(accountId);
  const [query,setQuery]=useState('');
  const [confirmId,setConfirmId]=useState<string|null>(null);
  const [confirmAnchor,setConfirmAnchor]=useState<HTMLElement|null>(null);
  const content=useRef<HTMLElement>(null);
  const [openFutureDays,setOpenFutureDays]=useState<Set<string>>(()=>new Set());
  const [historyMonth,setHistoryMonth]=useState<string>();
  const onHistoryMonthChange=useCallback((month:string)=>setHistoryMonth(month),[]);
  const {view,categoryFilter}=model.page;
  const todayTasks=useMemo(()=>model.tasks.filter(task=>task.date===model.today),[model.tasks,model.today]);
  const done=todayTasks.filter(isTaskFinished).length;
  const remaining=todayTasks.length-done;
  const active=todayTasks.find(task=>task.id===model.page.activeTaskId);
  const matches=(task:Task)=>matchesCategory(task,categoryFilter)&&taskMatchesQuery(task,query);
  const order=(a:Task,b:Task)=>Number(!!b.pinned)-Number(!!a.pinned)||a.order-b.order;
  const pending=todayTasks.filter(task=>!isTaskFinished(task)&&task.id!==active?.id&&matches(task)).sort(order);
  const completed=todayTasks.filter(task=>isTaskFinished(task)&&task.id!==active?.id&&matches(task)).sort((a,b)=>(b.completedAt||'').localeCompare(a.completedAt||''));
  const confirmTask=model.tasks.find(task=>task.id===confirmId)||null;
  const categoryFor=(task:Task)=>categories.find(category=>category.id===task.categoryId)||categories[0];
  const npcFor=(task:Task)=>npcs.find(npc=>npc.id===task.npcId)||npcs[0];
  function requestFinish(task:Task) {
    setConfirmAnchor(document.activeElement instanceof HTMLElement?document.activeElement:null);
    setConfirmId(task.id);
  }
  const actions:TaskActions={
    onToggleStatus(task){
      if(view==='future')return;
      if(view==='today'&&task.type==='steps'&&!isTaskFinished(task)){requestFinish(task);return;}
      dispatch({type:'toggle-status',taskId:task.id,now:Date.now()});
    },
    onStart(task){dispatch({type:'start',taskId:task.id,now:Date.now()});content.current?.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});},
    onFinish(task){if(task.type==='steps')requestFinish(task);else dispatch({type:task.type==='count'?'complete-count':'toggle-status',taskId:task.id,now:Date.now()});},
    onTalk(task){onOpenConversation(task.npcId,task);},
    onStepToggle(task,step){dispatch({type:'toggle-step',taskId:task.id,stepId:step.id,now:Date.now()});},
    onSetClick(task,step,index){dispatch({type:'set-step-set',taskId:task.id,stepId:step.id,index,now:Date.now()});},
    onTimerStart(task,step){dispatch({type:'start-timer',taskId:task.id,stepId:step.id,now:Date.now()});},
    onExpandTask(task){dispatch({type:'toggle-task',taskId:task.id});},
    onExpandStep(stepId){dispatch({type:'expand-step',stepId});},
    onPin(task){dispatch({type:'pin',taskId:task.id});},
  };
  const row=(task:Task,mode:'today'|'future')=><TaskRow key={task.id} task={task} category={categoryFor(task)} npc={npcFor(task)} mode={mode} expanded={model.page.expandedTaskIds.includes(task.id)} expandedStepId={model.page.expandedStepId} active={task.id===active?.id} now={now} rest={model.rest} timers={model.timers} today={model.today} actions={actions}/>;
  const futureDates=Array.from({length:model.page.futureRange},(_,index)=>shiftBoardDate(model.today,index+1));
  const futureTasks=model.tasks.filter(task=>task.date>model.today&&task.date<=futureDates.at(-1)!);
  const dailyByTitle=new Map<string,Task>();
  for(const task of futureTasks.filter(task=>task.repeat==='daily')) {
    const key=`${task.title}|${task.npcId}|${task.categoryId}`;
    if(!dailyByTitle.has(key))dailyByTitle.set(key,task);
  }
  const daily=[...dailyByTitle.values()].filter(matches);
  const futureCount=futureOverview(model);
  const historyDone=historyOverview(model,historyMonth);
  const countsFor=(categoryId:string)=>categoryOverview(model,categoryId,historyMonth);
  function selectView(next:TaskView){dispatch({type:'set-view',view:next});setQuery('');content.current?.scrollTo({top:0});}
  return <div className="zy-task-board" data-task-view={view} aria-label="任务工作台">
    <aside className="zy-directory zy-pet-directory zy-task-board-guide" aria-label="任务指引栏">
      <div className="zy-tb-guide-scroll">
        <h1 className="zy-tb-guide-title">任务</h1>
        <div className="zy-tb-search-line"><label className="zy-tb-search"><Search size={15}/><input aria-label="搜索任务" placeholder="搜索" value={query} onChange={event=>setQuery(event.target.value)}/>{query&&<button type="button" aria-label="清空任务搜索" onClick={()=>setQuery('')}><X size={13}/></button>}</label><PressableIconButton rotateOnClick type="button" aria-label="让 Molly 安排任务" onClick={()=>onOpenConversation('molly')}><Plus size={21}/></PressableIconButton></div>
        <nav className="zy-tb-views" aria-label="任务视图">{([{id:'today',name:'今天',icon:CalendarCheck,count:remaining},{id:'future',name:'未来',icon:CalendarDays,count:futureCount},{id:'history',name:'历史',icon:History,count:historyDone}] as const).map(({id,name,icon:Icon,count})=><button type="button" key={id} aria-pressed={view===id} className={view===id?'is-active':''} onClick={()=>selectView(id)}><span className={'zy-tb-view-icon is-'+id}><Icon size={15}/></span><span>{name}</span><strong>{count}</strong></button>)}</nav>
        <section className="zy-tb-plans" aria-labelledby="zy-tb-plans-title"><h2 id="zy-tb-plans-title">我的计划</h2>{plans.map(plan=><div className="zy-tb-plan" key={plan.id}><div><span>{plan.name}</span><small>{plan.progressText}</small></div><div className="zy-tb-plan-track"><i style={{width:`${plan.progress*100}%`,background:plan.color}}/></div></div>)}</section>
        <div className="zy-tb-category-groups">{[...categoryGroups].sort((a,b)=>a.order-b.order).map(group=><section key={group.id} aria-label={group.name}><h2>{group.name}</h2>{categories.filter(category=>category.groupId===group.id).map(category=><button type="button" key={category.id} aria-pressed={categoryFilter===category.id} className={categoryFilter===category.id?'is-active':''} onClick={()=>dispatch({type:'set-category',categoryId:categoryFilter===category.id?undefined:category.id})}><CategoryIcon category={category}/><span>{category.name}</span><small>{countsFor(category.id)||'—'}</small></button>)}</section>)}</div>
      </div>
      <div className="zy-tb-weekly-review"><NpcAvatar npc={npcs.find(npc=>npc.id==='molly')!} size={28}/><div><strong>本周复盘</strong><span>Molly · {model.page.weeklyReview.time}</span></div></div>
    </aside>
    <section ref={content} className="zy-task-board-content" aria-label={view==='today'?'今天的任务':view==='future'?'未来的任务':'任务历史'}>
      <div className="zy-tb-content-inner">
        {!ready&&<output className="zy-tb-loading">正在读取任务…</output>}
        {storageError&&<p className="zy-tb-storage-error" role="alert">{storageError}</p>}
        {view==='today'&&<>
          <header className="zy-tb-page-heading"><div><h1>今天</h1><p>{monthDay(model.today)} {weekday(model.today)}</p></div><ProgressPill current={done} total={todayTasks.length} color="var(--zy-task-accent)"/></header>
          {active&&matches(active)&&<section className="zy-tb-active-section" aria-label="进行中"><h2><i/>进行中</h2><ActiveTaskCard task={active} category={categoryFor(active)} npc={npcFor(active)} mode="today" expanded={model.page.activeExpanded} expandedStepId={model.page.expandedStepId} active now={now} rest={model.rest} timers={model.timers} today={model.today} actions={{...actions,onExpandTask(){dispatch({type:'toggle-active-expanded'});}}}/></section>}
          {!!pending.length&&<section className="zy-tb-task-section" aria-label="待完成"><header><h2>待完成</h2><span>按建议顺序</span></header>{pending.map(task=>row(task,'today'))}</section>}
          {!!completed.length&&<section className="zy-tb-task-section" aria-label="已完成"><header><h2>已完成</h2></header>{completed.map(task=>row(task,'today'))}</section>}
          {!pending.length&&!completed.length&&!(active&&matches(active))&&<div className="zy-tb-empty">没有匹配的任务</div>}
        </>}
        {view==='future'&&<>
          <header className="zy-tb-page-heading"><div><h1>未来</h1><p>{monthDay(futureDates[0])} – {monthDay(futureDates.at(-1)!)}</p></div><SegmentedControl label="未来日期范围" value={String(model.page.futureRange)} options={[{value:'7',label:'7 天'},{value:'30',label:'30 天'}]} onChange={value=>dispatch({type:'set-future-range',range:value==='30'?30:7})}/></header>
          {!!daily.length&&<section className="zy-tb-future-day" aria-label="每日任务"><header><h2>每日</h2><span>这 {model.page.futureRange} 天每天都做</span></header>{daily.map(task=>row(task,'future'))}</section>}
          {futureDates.map((date,index)=>{
            const tasks=futureTasks.filter(task=>task.date===date&&task.repeat!=='daily'&&matches(task)).sort(order);
            if(!tasks.length)return null;
            const expanded=index<2?!openFutureDays.has(date):openFutureDays.has(date);
            const title=index===0?'明天':weekday(date);
            return <section className="zy-tb-future-day" aria-label={monthDay(date)+'任务'} key={date}>
              <button type="button" className="zy-tb-day-toggle" aria-expanded={expanded} onClick={()=>setOpenFutureDays(previous=>{const next=new Set(previous);if(next.has(date))next.delete(date);else next.add(date);return next;})}><strong>{title}</strong><span>{monthDay(date)} · {tasks.length} 项</span><ChevronDown size={18} className={expanded?'is-open':''}/></button>
              <div className={'zy-tb-day-expansion'+(expanded?' is-open':'')} inert={!expanded} aria-hidden={!expanded}><div>{tasks.map(task=>row(task,'future'))}</div></div>
            </section>;
          })}
          {!daily.length&&!futureTasks.some(matches)&&<div className="zy-tb-empty">没有匹配的未来任务</div>}
        </>}
        {view==='history'&&<HistoryView model={model} dispatch={dispatch} now={now} query={query} actions={actions} scrollRef={content} onMonthChange={onHistoryMonthChange}/>}
      </div>
    </section>
    <EndTaskConfirm task={confirmTask} category={confirmTask?categoryFor(confirmTask):undefined} anchor={confirmAnchor} onCancel={()=>setConfirmId(null)} onConfirm={()=>{if(confirmTask)dispatch({type:'finish',taskId:confirmTask.id,now:Date.now()});setConfirmId(null);}}/>
  </div>;
}
