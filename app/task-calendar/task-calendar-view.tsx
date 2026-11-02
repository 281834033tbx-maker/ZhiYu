'use client';
/* eslint-disable next/no-img-element */
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- The custom month chooser uses a keyboard-operated listbox; dates are a named group. */

import {useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent} from 'react';
import {Apple, CalendarDays, ChefHat, Check, ChevronDown, Dumbbell, Ellipsis, Minus, X} from 'lucide-react';
import PressableIconButton from '../zhiyu/pressable-icon-button';
import {calendarDayLabels, calendarMonthCells, calendarMonthStats} from './task-calendar-summary';
import './task-calendar.css';

export type TaskCalendarStep = Readonly<{id: string; title: string; completed: boolean; skipped?: boolean; training?: Readonly<{target: string}>}>;
export type TaskCalendarTask = Readonly<{
  id: string;
  title: string;
  steps: readonly TaskCalendarStep[];
  completed: number;
  skipped?: number;
  total: number;
  percent: number;
  status?: string;
  timingKind?: 'training' | 'cooking';
  execution?: Readonly<{kind: 'training' | 'cooking'; status: 'running' | 'paused' | 'completed' | 'cancelled' | 'skipped'; elapsedMs: number}>;
}>;
export type TaskCalendarDay = Readonly<{
  tasks: readonly TaskCalendarTask[];
  completed: number;
  skipped?: number;
  total: number;
  percent: number;
}>;
export type TaskCalendarViewProps = {
  character: Readonly<{id: string; name: string; avatar?: string; planName?: string}>;
  months: readonly string[];
  days: ReadonlyMap<string, TaskCalendarDay>;
  today: string;
  loading?: boolean;
  error?: string;
  onRefresh?: () => void;
  nativeChrome?: boolean;
  onContentHeightChange?: (height: number) => void;
};

const weekdays = ['1', '2', '3', '4', '5', '6', '7'];
const monthLabel = (month: string) => `${Number(month.slice(5, 7))}月`;
const fullMonthLabel = (month: string) => `${Number(month.slice(0, 4))}年${monthLabel(month)}`;
const dateLabel = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
const validMonth = (month: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
const percentage = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const allSkipped = (value: {skipped?:number; total:number}) => value.total > 0 && value.skipped === value.total;
const allComplete = (value: {completed: number; total: number}) => value.total > 0 && value.completed === value.total;
function dayDurationSummary(day: TaskCalendarDay) {
  return (['training', 'cooking'] as const).flatMap(kind => {
    const tasks = day.tasks.filter(task => (task.execution?.kind || task.timingKind) === kind);
    if (!tasks.length) return [];
    const label = kind === 'training' ? '训练时长' : '做饭时长';
    // Running sessions expose state only; the clock remains entirely in the background.
    if (tasks.some(task => task.execution?.status === 'running')) return [`${label}：${kind === 'training' ? '训练中' : '做饭中'}`];
    const recorded = tasks.filter(task => task.execution);
    if (!recorded.length) return [`${label}：未记录`];
    const minutes = Math.floor(recorded.reduce((sum, task) => sum + Math.max(0, task.execution!.elapsedMs), 0) / 60_000);
    const state = recorded.some(task => task.execution?.status === 'skipped') ? '（已跳过）'
      : recorded.some(task => task.execution?.status === 'paused') ? '（已暂停）'
      : recorded.some(task => task.execution?.status === 'cancelled') ? '（已结束）' : '';
    return [`${label}：${Math.floor(minutes / 60)}小时${minutes % 60}分${state}`];
  }).join(' · ');
}
export default function TaskCalendarView({character, months, days, today, loading = false, error, onRefresh, nativeChrome = false, onContentHeightChange}: TaskCalendarViewProps) {
  const page = useRef<HTMLElement>(null), toolbar = useRef<HTMLElement>(null), content = useRef<HTMLDivElement>(null);
  const available = useMemo(() => [...new Set([...months, today.slice(0, 7)])].filter(validMonth).sort(), [months, today]);
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
  const month = available.includes(selectedMonth) ? selectedMonth : available.at(-1) || today.slice(0, 7);
  const [monthOpen, setMonthOpen] = useState(false);
  const [selection, setSelection] = useState<{date: string; anchor: HTMLButtonElement} | null>(null);
  const monthControl = useRef<HTMLDivElement>(null), monthTrigger = useRef<HTMLButtonElement>(null), monthList = useRef<HTMLDivElement>(null);
  const listId = useId();
  const cells = useMemo(() => calendarMonthCells(month), [month]);
  const datesWithTasks = cells.filter(cell => cell.inMonth && !!days.get(cell.date)?.tasks.length);
  const selectedDay = selection ? days.get(selection.date) : undefined;
  const years = [...new Set(available.map(value => value.slice(0, 4)))];
  const planName = character.planName || (character.id === 'chen-nian' ? '健身计划' : character.id === 'zhou-chef' ? '烹饪计划' : '专业计划');
  const PlanIcon = /健身/.test(planName) ? Dumbbell : /烹饪/.test(planName) ? ChefHat : /营养/.test(planName) ? Apple : CalendarDays;
  const stats = useMemo(() => calendarMonthStats(days, month, planName), [days, month, planName]);
  const largestCount = Math.max(1, ...stats.rows.map(row => row.total));

  useLayoutEffect(() => {
    const root = page.current, heading = toolbar.current, panels = content.current;
    if (!onContentHeightChange || !root || !heading || !panels) return;
    let frame = 0, active = true;
    const pixels = (value: string) => parseFloat(value) || 0;
    const outerHeight = (node: Element) => {
      const style = getComputedStyle(node);
      return node.getBoundingClientRect().height + pixels(style.marginTop) + pixels(style.marginBottom);
    };
    const measure = () => {
      frame = 0;
      if (!active) return;
      const rootStyle = getComputedStyle(root), panelStyle = getComputedStyle(panels);
      const children = [...panels.children];
      // The flex scroller fills the viewport. Measure its actual panels so an
      // already-tall window does not feed its empty space back into the result.
      const panelHeight = children.reduce((sum, child) => sum + outerHeight(child), 0)
        + Math.max(0, children.length - 1) * pixels(panelStyle.rowGap)
        + pixels(panelStyle.paddingTop) + pixels(panelStyle.paddingBottom)
        + pixels(panelStyle.borderTopWidth) + pixels(panelStyle.borderBottomWidth);
      onContentHeightChange(Math.ceil(outerHeight(heading) + panelHeight
        + pixels(rootStyle.paddingTop) + pixels(rootStyle.paddingBottom)
        + pixels(rootStyle.borderTopWidth) + pixels(rootStyle.borderBottomWidth)
        + pixels(rootStyle.rowGap)));
    };
    const schedule = () => {if (!frame && active) frame = window.requestAnimationFrame(measure);};
    const observer = new ResizeObserver(schedule);
    [root, heading, panels, ...panels.children].forEach(node => observer.observe(node));
    window.addEventListener('resize', schedule);
    window.addEventListener('focus', schedule);
    schedule();
    return () => {active = false; observer.disconnect(); window.removeEventListener('resize', schedule); window.removeEventListener('focus', schedule); window.cancelAnimationFrame(frame);};
  }, [onContentHeightChange]);

  useEffect(() => {
    if (!monthOpen) return;
    const outside = (event: PointerEvent) => {if (!monthControl.current?.contains(event.target as Node)) setMonthOpen(false);};
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [monthOpen]);
  useLayoutEffect(() => {
    if (monthOpen) monthList.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus({preventScroll: true});
  }, [monthOpen]);
  function selectMonth(value: string) {setSelectedMonth(value); setMonthOpen(false); monthTrigger.current?.focus({preventScroll: true});}
  function monthKeys(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {event.preventDefault(); setMonthOpen(false); monthTrigger.current?.focus(); return;}
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...(monthList.current?.querySelectorAll<HTMLButtonElement>('button') || [])];
    if (!buttons.length) return;
    event.preventDefault();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
    buttons[next]?.focus();
  }

  return <main ref={page} className={`zy-task-history${nativeChrome ? ' has-native-chrome' : ''}`} aria-label={`${character.name}的任务日历`}>
    {nativeChrome && <header className="zy-task-history-titlebar" aria-label={`${planName}窗口标题栏`}><PlanIcon size={14} strokeWidth={1.6} aria-hidden="true"/></header>}
    <header ref={toolbar} className="zy-task-history-toolbar">
          <h1>{planName}</h1>
          <div ref={monthControl} className="zy-task-history-month-control">
            <button ref={monthTrigger} type="button" className="zy-task-history-month-trigger" aria-label={`选择月份，当前${fullMonthLabel(month)}`} aria-haspopup="listbox" aria-expanded={monthOpen} aria-controls={monthOpen ? listId : undefined} onKeyDown={monthKeys} onClick={() => setMonthOpen(value => !value)}>{monthLabel(month)}<ChevronDown size={14} strokeWidth={1.7}/></button>
            {monthOpen && <div ref={monthList} id={listId} className="zy-task-history-month-list" role="listbox" tabIndex={-1} aria-label="选择月份" onKeyDown={monthKeys}>
              {years.map(year => <div className="zy-task-history-month-year" key={year}>
                {years.length > 1 && <span className="zy-task-history-month-year-label">{year}</span>}
                {available.filter(value => value.startsWith(`${year}-`)).map(value => <button type="button" role="option" key={value} aria-label={fullMonthLabel(value)} aria-selected={value === month} onClick={() => selectMonth(value)}>{monthLabel(value)}{value === month && <Check size={13} strokeWidth={1.7}/>}</button>)}
              </div>)}
            </div>}
          </div>
    </header>
    <div ref={content} className="zy-task-history-content">
      <section className="zy-task-history-month" aria-label={fullMonthLabel(month)} aria-busy={loading}>
        {error && <p role="alert" className="zy-task-history-error">{error}{onRefresh && <button type="button" disabled={loading} onClick={onRefresh}>重新读取</button>}</p>}
        <div className="zy-task-history-weekdays" aria-hidden="true">{weekdays.map(day => <span key={day}>{day}</span>)}</div>
        <div className="zy-task-history-grid" role="group" aria-label={`${fullMonthLabel(month)}日期`}>
          {cells.map(({date, inMonth}) => {
            const day = inMonth ? days.get(date) : undefined, hasTasks = !!day?.tasks.length, complete = !!day && allComplete(day), skipped = !!day && allSkipped(day);
            const labels = day ? calendarDayLabels(day, planName) : [];
            const topics = <span className="zy-task-history-date-label" aria-hidden="true">
              <span className="zy-task-history-date-topic">{labels[0]}</span>
              <span className="zy-task-history-date-join">{labels.length === 2 ? '+' : null}</span>
              <span className="zy-task-history-date-tail">{labels.length === 1 ? skipped ? <Minus size={13} strokeWidth={2}/> : complete ? <Check size={14} strokeWidth={2}/> : <X size={13} strokeWidth={2}/> : labels.length === 2 ? <span className="zy-task-history-date-topic">{labels[1]}</span> : labels.length > 2 ? <Ellipsis size={17} strokeWidth={2}/> : null}</span>
            </span>;
            const classes = `zy-task-history-date${!inMonth ? ' is-adjacent-month' : ''}${date === today && inMonth ? ' is-today' : ''}${selection?.date === date ? ' is-selected' : ''}${hasTasks ? skipped ? ' is-skipped' : complete ? ' is-complete' : ' is-incomplete' : ''}`;
            const number = <span className="zy-task-history-date-number">{Number(date.slice(8, 10))}</span>;
            return hasTasks ? <button type="button" key={date} data-date={date} className={classes} aria-current={date === today ? 'date' : undefined} aria-haspopup="dialog" title={labels.join('、')} aria-label={`${dateLabel(date)}，${labels.join('、')}，${day!.tasks.length}项任务，已完成${percentage(day!.percent)}%${day!.skipped ? `，已跳过${day!.skipped}步` : ''}${date === today ? '，今天' : ''}`} onClick={event => setSelection({date, anchor: event.currentTarget})}>{number}{topics}<i className="zy-task-history-status-dot" aria-hidden="true"/></button> : <span key={date} data-date={date} className={classes} aria-current={date === today && inMonth ? 'date' : undefined} aria-label={`${dateLabel(date)}，${inMonth ? '没有任务' : '相邻月份'}${date === today && inMonth ? '，今天' : ''}`}>{number}{topics}</span>;
          })}
        </div>
        <span className="zy-task-history-sr-only" role="status">{loading ? '正在读取任务记录…' : datesWithTasks.length ? `${datesWithTasks.length}天有任务` : '这个月还没有任务记录。'}</span>
      </section>
      <section className="zy-task-history-stats" aria-label={`${monthLabel(month)}任务分类统计`} aria-busy={loading}>
        <header className="zy-task-history-stats-heading"><h2>本月统计</h2><span>完成 / 记录</span></header>
        {error ? <p className="zy-task-history-stats-empty">记录暂时无法读取</p> : loading && !stats.total ? <p className="zy-task-history-stats-empty">正在读取记录…</p> : <>
          <ul className="zy-task-history-stats-list">{stats.rows.map(row => <li key={row.id} data-category={row.id} aria-label={`${row.label}，完成${row.count}次，共${row.total}次记录`}>
            <span className="zy-task-history-stats-label">{row.label}</span>
            <span className="zy-task-history-stats-track" aria-hidden="true"><span className="zy-task-history-stats-record" style={{width: `${row.total / largestCount * 100}%`}}/><span className="zy-task-history-stats-completed" style={{width: `${row.count / largestCount * 100}%`}}/></span>
            <span className="zy-task-history-stats-count"><strong>{row.count}</strong><span> / {row.total} 次</span></span>
          </li>)}</ul>
          {!stats.total && <p className="zy-task-history-stats-empty">这个月还没有任务记录</p>}
        </>}
      </section>
    </div>
    {selection && selectedDay && <TaskDayDetails key={`${character.id}:${selection.date}`} date={selection.date} day={selectedDay} anchor={selection.anchor} close={() => setSelection(null)}/>}
  </main>;
}

function TaskDayDetails({date, day, anchor, close}: {date: string; day: TaskCalendarDay; anchor: HTMLButtonElement; close: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId();
  const durationSummary = dayDurationSummary(day);
  const closeRequest = useRef<(() => void) | null>(null), latestClose = useRef(close);
  useLayoutEffect(() => {latestClose.current = close;});
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node || !anchor.isConnected) {latestClose.current(); return;}
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animation: Animation | null = null, closing = false, active = true;
    node.showModal();
    node.focus({preventScroll: true});
    // The native top layer keeps the scaled card clear of the calendar's clipping and scroll containers.
    function sourceTransform() {
      const source = anchor.getBoundingClientRect();
      const target = node!.getBoundingClientRect();
      return `translate(${source.left - target.left}px, ${source.top - target.top}px) scale(${source.width / Math.max(1, target.width)}, ${source.height / Math.max(1, target.height)})`;
    }
    const from = sourceTransform();
    node.style.transformOrigin = '0 0';
    if (!media.matches && typeof node.animate === 'function') {
      node.dataset.detailPhase = 'opening';
      animation = node.animate([{transform: from, opacity: .35}, {transform: 'translate(0px, 0px) scale(1, 1)', opacity: 1}], {duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both'});
      animation.onfinish = () => {animation?.cancel(); animation = null; if (active) node.dataset.detailPhase = 'open';};
    } else node.dataset.detailPhase = 'open';
    const dismiss = () => {
      if (!active || closing) return;
      closing = true;
      node.inert = true;
      node.setAttribute('aria-hidden', 'true');
      node.dataset.detailPhase = 'closing';
      if (media.matches || typeof node.animate !== 'function') {latestClose.current(); return;}
      if (animation) {
        // Interrupted opening retraces the exact rectangle it came from.
        animation.onfinish = () => {if (active) latestClose.current();};
        animation.playbackRate = -1.15;
        animation.play();
      } else {
        const to = sourceTransform();
        animation = node.animate([{transform: 'translate(0px, 0px) scale(1, 1)', opacity: 1}, {transform: to, opacity: .35}], {duration: 260, easing: 'cubic-bezier(.4,0,.8,.2)', fill: 'both'});
        animation.onfinish = () => {if (active) latestClose.current();};
      }
    };
    closeRequest.current = dismiss;
    const finishMotion = () => {
      if (animation) animation.finish();
    };
    const reducedMotion = () => {if (media.matches) finishMotion();};
    window.addEventListener('resize', finishMotion);
    media.addEventListener('change', reducedMotion);
    return () => {
      active = false;
      animation?.cancel();
      window.removeEventListener('resize', finishMotion);
      media.removeEventListener('change', reducedMotion);
      if (closeRequest.current === dismiss) closeRequest.current = null;
      node.close();
      if (anchor.isConnected) anchor.focus({preventScroll: true});
    };
  }, [anchor]);
  return <dialog ref={dialog} tabIndex={-1} className="zy-task-history-details" aria-labelledby={titleId} aria-describedby={durationSummary ? `${titleId}-summary` : undefined} onCancel={event => {event.preventDefault(); closeRequest.current?.();}} onPointerDown={event => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {event.preventDefault(); closeRequest.current?.();}
  }}>
    <header className="zy-task-history-details-heading"><div><h2 id={titleId}>{dateLabel(date)}</h2>{durationSummary && <p id={`${titleId}-summary`}>{durationSummary}</p>}</div><PressableIconButton type="button" aria-label="收起当日任务" title="收起当日任务" onClick={() => closeRequest.current?.()}><X size={18} strokeWidth={1.7}/></PressableIconButton></header>
    <div className="zy-task-history-details-scroll" aria-label="只读任务记录">
      {day.tasks.map(task => <section className="zy-task-history-task" key={task.id} aria-label={task.title}>
        <header><h3>{task.title}{['paused', 'cancelled', 'skipped'].includes(task.status || '') && <span className="zy-task-history-task-status">{task.status === 'skipped' ? '已跳过' : task.status === 'paused' ? '已暂停' : '已取消'}</span>}</h3><span className={`zy-task-history-task-count${allComplete(task) ? ' is-complete' : ''}`}><i aria-hidden="true"/>{task.completed} / {task.total} 完成{task.skipped ? ` · ${task.skipped} 已跳过` : ''}</span></header>
        <div className="zy-task-history-task-progress"><strong>{percentage(task.percent)}<span>%</span></strong></div>
        <ol className="zy-task-history-steps" aria-label={`${task.title}的只读步骤`}>{task.steps.map((step, index) => <li key={step.id} className={step.completed ? 'is-complete' : step.skipped ? 'is-skipped' : undefined} data-step-id={step.id} data-step-tone={index % 4}><span className="zy-task-history-step-circle" aria-hidden="true">{step.completed ? <Check size={13} strokeWidth={2.2}/>:step.skipped ? <Minus size={13} strokeWidth={2}/>:null}</span><span className="zy-task-history-step-title"><span className="zy-task-history-sr-only">{step.completed ? '已完成：' : step.skipped ? '已跳过：' : '未完成：'}</span>{step.title}{step.skipped&&<small className="zy-task-history-step-skipped">已跳过</small>}</span></li>)}</ol>
      </section>)}
    </div>
  </dialog>;
}
