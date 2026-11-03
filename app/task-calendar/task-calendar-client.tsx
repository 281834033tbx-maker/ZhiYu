'use client';
import {reportUserFacingError} from '../../lib/user-facing-errors';

import {useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {useAccount} from '../zhiyu/auth-gate';
import {allPeople, molly} from '../zhiyu/data';
import {taskCalendarPlanName} from '../zhiyu/task-calendar-label';
import {fitTaskCalendarWindowToContent} from '../zhiyu/task-calendar-window';
import type {TaskCalendarProjection} from '../../lib/npc/task-calendar';
import TaskCalendarView, {type TaskCalendarDay} from './task-calendar-view';

type CalendarResponse = TaskCalendarProjection & {accountId: string; characterId: string; error?: string};
const dateInShanghai = () => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
const subscribeToLocation = (listener: () => void) => {
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
};

export default function TaskCalendarClient() {
  const {account} = useAccount();
  const search = useSyncExternalStore<string | null>(subscribeToLocation, () => window.location.search, () => null);
  const route = useMemo(() => {
    if (search === null) return null;
    const query = new URLSearchParams(search);
    return {npc: query.get('npc') || '', expectedAccount: query.get('account') || '', nativeChrome: query.get('chrome') === 'compact' && /Electron\//.test(navigator.userAgent)};
  }, [search]);
  const [projection, setProjection] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const character = route ? [molly, ...allPeople].find(person => person.id === route.npc) : undefined;
  const planName = character ? taskCalendarPlanName(character) : '专业计划';
  const scopeError = route && (!character || (route.expectedAccount && route.expectedAccount !== account.id))
    ? character ? '账号已变化，请从聊天重新打开任务日历。' : '请选择已有的人物打开任务日历。' : '';

  useEffect(() => {
    const previousTitle = document.title;
    document.title = planName;
    return () => {document.title = previousTitle;};
  }, [planName]);

  useEffect(() => {
    if (!route) return;
    if (!character || (route.expectedAccount && route.expectedAccount !== account.id)) {
      return;
    }
    let alive = true, pending = false, rejected = false;
    const controller = new AbortController();
    const rejectSession = () => {
      rejected = true;
      if (alive) {setProjection(null); setError('账号已变化或登录已失效，请重新登录后刷新，或从聊天重新打开日历。'); setLoading(false);}
    };
    const read = async () => {
      if (!alive || pending || rejected) return;
      pending = true; setLoading(true); setError('');
      try {
        const sessionResponse = await fetch('/api/auth/session', {credentials: 'same-origin', cache: 'no-store', signal: controller.signal});
        if (!sessionResponse.ok) throw new Error('登录状态暂时无法读取，请稍后刷新。');
        const session = await sessionResponse.json() as {authenticated?: boolean; account?: {id: string}};
        if (!session.authenticated || session.account?.id !== account.id) return rejectSession();
        const response = await fetch(`/api/npc/task-calendar?npc=${encodeURIComponent(character.id)}`, {
          credentials: 'same-origin', cache: 'no-store', headers: {'X-Zhiyu-Account': account.id}, signal: controller.signal,
        });
        if (response.status === 401 || response.status === 409) return rejectSession();
        const data = await response.json() as CalendarResponse;
        if (!response.ok) throw new Error(data.error || '任务记录暂时无法读取，请稍后刷新。');
        if (data.accountId !== account.id || data.characterId !== character.id) return rejectSession();
        if (alive) setProjection(data);
      } catch (failure) {
        if (alive && !controller.signal.aborted) {setProjection(null); setError(reportUserFacingError(failure,'load','读取任务记录'));}
      } finally {pending = false; if (alive) setLoading(false);}
    };
    void read();
    const onFocus = () => {if (rejected) setRefresh(value => value + 1); else void read();};
    const onVisibility = () => {if (!document.hidden) onFocus();};
    const timer = window.setInterval(() => {if (!document.hidden) void read();}, 15_000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {alive = false; controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisibility);};
  }, [account.id, route, character, refresh]);

  const visible = !scopeError && projection?.accountId === account.id && projection.characterId === route?.npc ? projection : null;
  const days = useMemo<ReadonlyMap<string, TaskCalendarDay>>(() => new Map((visible?.days || []).map(day => [day.date, {
    completed: day.completed, skipped: day.skipped, total: day.total, percent: day.percent,
    tasks: day.entries.map(entry => ({id: entry.entryId || entry.taskId, title: entry.title, status: entry.status, timingKind: entry.timingKind, execution: entry.execution, steps: entry.steps.map(step => ({id: step.id, title: step.title, completed: step.completed, ...(step.skipped ? {skipped:true} : {}), ...(step.training ? {training: {target: step.training.target}} : {})})), completed: entry.completed, skipped: entry.skipped, total: entry.total, percent: entry.percent})),
  }])), [visible]);
  const today = visible?.today || dateInShanghai();
  return <TaskCalendarView key={`${account.id}:${route?.npc || ''}`} character={character ? {...character, planName} : {id: '', name: '智域'}} months={visible?.months || [today.slice(0, 7)]} days={days} today={today} loading={!scopeError && loading} error={scopeError || error} nativeChrome={route?.nativeChrome} onContentHeightChange={fitTaskCalendarWindowToContent} onRefresh={() => setRefresh(value => value + 1)}/>;
}
