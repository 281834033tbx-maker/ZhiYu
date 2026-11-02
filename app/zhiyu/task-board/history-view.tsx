'use client';

import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type RefObject} from 'react';
import {ChevronLeft, ChevronRight} from 'lucide-react';
import PressableIconButton from '../pressable-icon-button';
import {categories, npcs} from './config';
import {historyTaskBaseline} from './mock';
import {historyOverview, isTaskFinished, shiftBoardDate, taskMatchesQuery} from './reducer';
import {ProgressPill, SegmentedControl, TaskRow, type TaskActions} from './task-components';
import type {DemoOverview, Task, TaskBoardAction, TaskBoardModel} from './types';
import './history-view.css';

type Props = {
  model:TaskBoardModel;
  dispatch:Dispatch<TaskBoardAction>;
  now:number;
  query:string;
  actions:TaskActions;
  scrollRef?:RefObject<HTMLElement|null>;
  onMonthChange?:(month:string)=>void;
};
type DayState = 'complete'|'partial'|'empty';
const weekdays = ['周日','周一','周二','周三','周四','周五','周六'];
const filters = [{value:'all',label:'全部'},{value:'done',label:'已完成'},{value:'missed',label:'没做到'}] as const;
const monthName = (month:string) => Number(month.slice(5,7))+'月';
const monthDay = (date:string) => Number(date.slice(5,7))+'月'+Number(date.slice(8,10))+'日';
const weekday = (date:string) => weekdays[new Date(date+'T00:00:00Z').getUTCDay()];
function monthDates(month:string) {
  const [year,value]=month.split('-').map(Number);
  const count=new Date(Date.UTC(year,value,0)).getUTCDate();
  return Array.from({length:count},(_,index)=>month+'-'+String(index+1).padStart(2,'0'));
}
function moveMonth(month:string,offset:number) {
  const [year,value]=month.split('-').map(Number);
  const date=new Date(Date.UTC(year,value-1+offset,1));
  return date.toISOString().slice(0,7);
}
function longestRun(states:DayState[]) {
  let current=0,longest=0;
  for(const state of states){current=state==='complete'?current+1:0;longest=Math.max(longest,current);}
  return longest;
}
function seedCalendarState(date:string,overview?:DemoOverview):DayState {
  if(!overview||!date.startsWith(overview.calendar.month))return 'empty';
  const day=Number(date.slice(8,10));
  if(overview.calendar.complete.includes(day))return 'complete';
  return overview.calendar.partial.includes(day)?'partial':'empty';
}

/** Display the supplied source. Demo aggregates are used only when that source
 * explicitly supplies its demoOverview; real task records are never filled in. */
export default function HistoryView({model,dispatch,now,query,actions,scrollRef,onMonthChange}:Props) {
  const node=useRef<HTMLElement>(null),sentinel=useRef<HTMLDivElement>(null);
  const pendingScroll=useRef<string|null>(null),pendingFocus=useRef<string|null>(null);
  const overview=model.demoOverview,isDemo=!!overview,yesterday=shiftBoardDate(model.today,-1);
  const defaultMonth=overview?.calendar.month||yesterday.slice(0,7);
  const defaultDate=overview?overview.calendar.month+'-'+String(overview.calendar.selected).padStart(2,'0'):yesterday;
  const sourceKey=(isDemo?'demo:':'actual:')+defaultMonth+':'+defaultDate;
  const previousSource=useRef(sourceKey);
  const [month,setMonth]=useState(defaultMonth);
  const [selectedDate,setSelectedDate]=useState(defaultDate);
  const [focusDate,setFocusDate]=useState(selectedDate);
  useEffect(()=>{onMonthChange?.(month);},[month,onMonthChange]);
  useEffect(()=>{
    if(isDemo&&query.trim()&&model.historyLoadedDays<365)
      dispatch({type:'load-history',throughDate:shiftBoardDate(model.today,-365)});
  },[dispatch,isDemo,model.historyLoadedDays,model.today,query]);
  useEffect(()=>{
    if(previousSource.current===sourceKey)return;
    previousSource.current=sourceKey;
    pendingScroll.current=null;pendingFocus.current=null;
    setMonth(defaultMonth);setSelectedDate(defaultDate);setFocusDate(defaultDate);
  },[defaultDate,defaultMonth,sourceKey]);
  const dates=useMemo(()=>monthDates(month),[month]);
  const allHistory=useMemo(()=>model.tasks.filter(task=>task.date<model.today),[model.tasks,model.today]);
  const grouped=useMemo(()=>{
    const groups=new Map<string,Task[]>();
    for(const task of allHistory){const group=groups.get(task.date)||[];group.push(task);groups.set(task.date,group);}
    for(const group of groups.values())group.sort((a,b)=>a.order-b.order);
    return groups;
  },[allHistory]);
  const monthTasks=useMemo(()=>allHistory.filter(task=>task.date.startsWith(month)),[allHistory,month]);
  const stats=useMemo(()=>{
    const seeded=!!overview&&month===overview.calendar.month;
    let fitnessDelta=0;
    if(seeded)for(const task of monthTasks){
      const previous=historyTaskBaseline(task);
      const before=previous?Number(isTaskFinished(previous)):Number(isTaskFinished(task));
      const after=Number(isTaskFinished(task));
      if(task.categoryId==='fitness')fitnessDelta+=after-before;
    }
    const states=dates.map(date=>{
      const tasks=grouped.get(date)||[];
      const initial=seeded?seedCalendarState(date,overview):'empty';
      if(!tasks.length)return initial;
      const altered=seeded&&tasks.some(task=>{
        const previous=historyTaskBaseline(task);
        return previous&&isTaskFinished(previous)!==isTaskFinished(task);
      });
      if(seeded&&!altered)return initial;
      return tasks.every(isTaskFinished)?'complete' as const:'partial' as const;
    });
    const completed=historyOverview(model,month);
    // The source's 126 / 84% overview represents 150 monthly tasks, including
    // days that have not paged into the visible list yet.
    const sourceMonthlyTotal=seeded?Math.round(overview.historyDone*100/Math.max(overview.calendar.completionRate,1)):monthTasks.length;
    const rate=seeded
      ? Math.max(0,Math.min(100,Math.round(completed/Math.max(sourceMonthlyTotal,1)*100)))
      : Math.round(monthTasks.filter(isTaskFinished).length/Math.max(monthTasks.length,1)*100);
    const baselineStates=seeded?dates.map(date=>seedCalendarState(date,overview)):[];
    const streak=seeded
      ? Math.max(0,overview.calendar.longestStreak+longestRun(states)-longestRun(baselineStates))
      : longestRun(states);
    const trainings=seeded
      ? Math.max(0,overview.calendar.trainingCount+fitnessDelta)
      : monthTasks.filter(task=>task.categoryId==='fitness'&&isTaskFinished(task)).length;
    return {completed,rate,streak,trainings,states};
  },[dates,grouped,model,month,monthTasks,overview]);
  const visibleDays=useMemo(()=>{
    const result=[...grouped].map(([date,tasks])=>({
      date,tasks,
      visible:tasks.filter(task=>
        (!model.page.categoryFilter||task.categoryId===model.page.categoryFilter)
        && taskMatchesQuery(task,query)
        && (model.page.historyFilter==='all'||(model.page.historyFilter==='done'?isTaskFinished(task):!isTaskFinished(task)))),
    })).filter(day=>day.visible.length||day.date===selectedDate);
    if(!result.some(day=>day.date===selectedDate)&&selectedDate<model.today)
      result.push({date:selectedDate,tasks:[],visible:[]});
    return result.sort((a,b)=>b.date.localeCompare(a.date));
  },[grouped,model.page.categoryFilter,model.page.historyFilter,model.today,query,selectedDate]);
  const scrollParent=useCallback(()=>{
    return scrollRef?.current||node.current?.closest<HTMLElement>('.zy-task-board-content')||node.current?.parentElement||null;
  },[scrollRef]);
  function selectDate(date:string) {
    if(date>=model.today)return;
    setSelectedDate(date);setFocusDate(date);pendingScroll.current=date;
    if(isDemo)dispatch({type:'load-history',throughDate:date});
  }
  function changeMonth(offset:number) {
    const next=moveMonth(month,offset),last=monthDates(next).at(-1)!;
    const target=last<model.today?last:shiftBoardDate(model.today,-1);
    setMonth(next);setFocusDate(target);setSelectedDate(target);
    pendingScroll.current=target;
    if(isDemo)dispatch({type:'load-history',throughDate:target});
  }
  useLayoutEffect(()=>{
    const date=pendingScroll.current;
    if(!date||(isDemo&&date<shiftBoardDate(model.today,-model.historyLoadedDays)))return;
    const day=node.current?.querySelector<HTMLElement>('[data-history-date="'+date+'"]');
    const parent=scrollParent();
    if(!day||!parent)return;
    pendingScroll.current=null;
    const top=day.getBoundingClientRect().top-parent.getBoundingClientRect().top+parent.scrollTop-18;
    parent.scrollTo({top,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  });
  useLayoutEffect(()=>{
    if(!pendingFocus.current)return;
    const button=node.current?.querySelector<HTMLButtonElement>('[data-calendar-date="'+pendingFocus.current+'"]');
    if(button){button.focus({preventScroll:true});pendingFocus.current=null;}
  },[month]);
  useEffect(()=>{
    const target=sentinel.current,parent=scrollParent();
    if(!isDemo||!target||!parent||model.historyLoadedDays>=365||query.trim()||!visibleDays.some(day=>day.visible.length))return;
    const append=()=>dispatch({type:'load-history'});
    if(typeof IntersectionObserver==='undefined'){
      const onScroll=()=>{if(parent.scrollTop+parent.clientHeight>=parent.scrollHeight-180)append();};
      parent.addEventListener('scroll',onScroll,{passive:true});
      return()=>parent.removeEventListener('scroll',onScroll);
    }
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)&&parent.scrollTop>0)append();
    },{root:parent,rootMargin:'220px 0px',threshold:0});
    observer.observe(target);return()=>observer.disconnect();
  },[dispatch,isDemo,model.historyLoadedDays,query,scrollParent,visibleDays]);
  const oldestRecordedDate=[...grouped.keys()].sort()[0]||yesterday;
  const earliestDate=isDemo?shiftBoardDate(model.today,-364):oldestRecordedDate.slice(0,7)+'-01';
  function calendarKey(event:KeyboardEvent<HTMLElement>) {
    const target=event.target as HTMLElement,current=target.dataset.calendarDate;
    if(!current)return;
    const offsets:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
    let next=offsets[event.key]===undefined?'':shiftBoardDate(current,offsets[event.key]);
    if(event.key==='Home')next=shiftBoardDate(current,-((new Date(current+'T00:00:00Z').getUTCDay()+6)%7));
    if(event.key==='End')next=shiftBoardDate(current,6-((new Date(current+'T00:00:00Z').getUTCDay()+6)%7));
    if(!next)return;
    event.preventDefault();
    if(next>=model.today||next<earliestDate)return;
    setFocusDate(next);
    if(next.slice(0,7)!==month){pendingFocus.current=next;setMonth(next.slice(0,7));}
    else node.current?.querySelector<HTMLButtonElement>('[data-calendar-date="'+next+'"]')?.focus();
  }
  const leading=(new Date(month+'-01T00:00:00Z').getUTCDay()+6)%7;
  const minimumMonth=earliestDate.slice(0,7);
  return <section ref={node} className="zy-tb-history" aria-label="历史任务">
    <header className="zy-tb-history-heading">
      <div><h1>历史</h1><p>{monthName(month)}完成 {stats.completed} 项</p></div>
      <SegmentedControl label="历史任务筛选" value={model.page.historyFilter} options={[...filters]}
        onChange={value=>dispatch({type:'set-history-filter',filter:value as 'all'|'done'|'missed'})}/>
    </header>
    <section className="zy-tb-history-calendar-card" aria-label={monthName(month)+'任务日历与统计'}>
      <div className="zy-tb-history-calendar">
        <header>
          <PressableIconButton type="button" aria-label="上个月" disabled={month<=minimumMonth} onClick={()=>changeMonth(-1)}><ChevronLeft size={16}/></PressableIconButton>
          <strong>{Number(month.slice(0,4))} 年 {Number(month.slice(5,7))} 月</strong>
          <PressableIconButton type="button" aria-label="下个月" disabled={month>=model.today.slice(0,7)} onClick={()=>changeMonth(1)}><ChevronRight size={16}/></PressableIconButton>
        </header>
        <div className="zy-tb-history-weekdays" aria-hidden="true">{['一','二','三','四','五','六','日'].map(day=><span key={day}>{day}</span>)}</div>
        <div className="zy-tb-history-grid">
          {Array.from({length:leading},(_,index)=><span key={'blank-'+index}/>)}
          {dates.map((date,index)=>{
            const status=stats.states[index],selected=date===selectedDate;
            const stateLabel=status==='complete'?'全部完成':status==='partial'?'部分完成':'没有任务';
            return <button type="button" key={date} data-calendar-date={date}
              className={'is-'+status+(selected?' is-selected':'')}
              aria-label={monthDay(date)+'，'+stateLabel} aria-pressed={selected}
              disabled={date>=model.today||date<earliestDate}
              tabIndex={focusDate===date?0:-1}
              onKeyDown={calendarKey}
              onFocus={()=>setFocusDate(date)} onClick={()=>selectDate(date)}>{Number(date.slice(8,10))}</button>;
          })}
        </div>
      </div>
      <div className="zy-tb-history-overview">
        <dl><div><dt>{stats.rate}%</dt><dd>{monthName(month)}完成率</dd></div><div><dt>{stats.streak}<small> 天</small></dt><dd>最长连续全勤</dd></div><div><dt>{stats.trainings}</dt><dd>次训练</dd></div></dl>
        <div className="zy-tb-history-legend" aria-label="日历图例"><span><i className="is-complete"/>全部完成</span><span><i className="is-partial"/>部分</span><span><i className="is-empty"/>没有任务</span></div>
      </div>
    </section>
    <div className="zy-tb-history-days">
      {visibleDays.map(day=><section key={day.date} data-history-date={day.date} className="zy-tb-history-day" aria-label={monthDay(day.date)+'任务'}>
        <header><h2>{day.date===shiftBoardDate(model.today,-1)?'昨天':monthDay(day.date)}</h2><span>{weekday(day.date)}</span>{day.tasks.length>0&&<div className="zy-tb-history-day-progress"><ProgressPill current={day.tasks.filter(isTaskFinished).length} total={day.tasks.length} label={monthDay(day.date)+'完成进度'}/></div>}</header>
        {day.visible.map(task=><TaskRow key={task.id} task={task} category={categories.find(item=>item.id===task.categoryId)||categories[0]} npc={npcs.find(item=>item.id===task.npcId)||npcs[0]} mode="history"
          expanded={model.page.expandedTaskIds.includes(task.id)} expandedStepId={model.page.expandedStepId}
          now={now} rest={model.rest} timers={model.timers} actions={actions}/>)}
        {!day.visible.length&&<p className="zy-tb-history-empty">{day.tasks.length?'这一天没有符合筛选的任务。':'这一天没有任务。'}</p>}
      </section>)}
      {!visibleDays.some(day=>day.visible.length)&&<output className="zy-tb-history-search-empty">没有找到符合条件的历史任务。</output>}
    </div>
    <div ref={sentinel} className="zy-tb-history-sentinel" aria-hidden="true"/>
    <output className="zy-tb-history-status" aria-live="polite">{isDemo?'已读取最近 '+model.historyLoadedDays+' 天的历史记录':'已显示 '+allHistory.length+' 条历史任务'}</output>
  </section>;
}
