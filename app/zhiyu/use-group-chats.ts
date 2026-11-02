'use client';

import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {GroupChat, GroupCreateInput, GroupSendMedia} from '../../lib/npc/group-chat';

type Scope = {accountId: string; enabled: boolean};
type GroupState = {scope: Scope; groups: GroupChat[]; loading: boolean; error: string};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '群聊暂时无法加载，请稍后重试。';
}

async function groupRequest(accountId: string, body?: Record<string, unknown>, signal?: AbortSignal) {
  const response = await fetch('/api/npc/groups', {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: {
      'x-zhiyu-account': accountId,
      ...(body ? {'Content-Type': 'application/json'} : {}),
    },
    ...(body ? {body: JSON.stringify(body)} : {}),
    signal,
  });
  const payload = await response.json().catch(() => null) as {groups?: GroupChat[]; group?: GroupChat; error?: string} | null;
  if (!response.ok) throw new Error(payload?.error || '群聊暂时无法加载，请稍后重试。');
  if (!payload) throw new Error('群聊服务返回了无效结果，请重试。');
  return payload;
}

export function useGroupChats(accountId: string, enabled = true) {
  // Object identity also distinguishes A → B → A, rejecting the first A's late result.
  const scope = useMemo<Scope>(() => ({accountId, enabled}), [accountId, enabled]);
  const mutationQueues = useRef(new WeakMap<Scope, Map<string, Promise<GroupChat>>>());
  const activeScope = useRef<Scope | null>(null);
  const revision = useRef(0);
  const readSequence = useRef(0);
  const [state, setState] = useState<GroupState>({scope, groups: [], loading: !!accountId && enabled, error: ''});
  const current = useCallback(() => activeScope.current === scope && scope.enabled, [scope]);

  useLayoutEffect(() => {
    activeScope.current = scope;
    return () => {activeScope.current = null;};
  }, [scope]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!accountId || !enabled || !current()) return;
    const requestRevision = revision.current;
    const sequence = ++readSequence.current;
    try {
      const result = await groupRequest(accountId, undefined, signal);
      if (!Array.isArray(result.groups)) throw new Error('群聊列表返回了无效结果，请重试。');
      if (current() && !signal?.aborted && revision.current === requestRevision && readSequence.current === sequence) {
        setState({scope, groups: result.groups, loading: false, error: ''});
      }
    } catch (error) {
      if (current() && !signal?.aborted && readSequence.current === sequence) {
        setState(previous => ({scope, groups: previous.scope === scope ? previous.groups : [], loading: false, error: errorMessage(error)}));
      }
    } finally {
      if (current() && !signal?.aborted && readSequence.current === sequence) {
        setState(previous => previous.scope === scope ? {...previous, loading: false} : {scope, groups: [], loading: false, error: ''});
      }
    }
  }, [accountId, enabled, scope, current]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (accountId && enabled && !controller.signal.aborted) void refresh(controller.signal);
    });
    return () => {
      controller.abort();
    };
  }, [accountId, enabled, refresh]);

  const performMutation = useCallback(async (body: Record<string, unknown>) => {
    if (!accountId || !enabled || !current()) throw new Error('请先登录再创建或修改群聊。');
    try {
      const result = await groupRequest(accountId, body);
      if (!current()) throw new Error('账号已切换，请在当前账号重新操作。');
      if (!result.group) throw new Error('群聊服务返回了无效结果，请重试。');
      revision.current += 1;
      const group = result.group;
      setState(previous => ({
        scope,
        groups: [...(group.leftAt ? [] : [group]), ...(previous.scope === scope ? previous.groups : []).filter(item => item.id !== group.id)]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        loading: false,
        error: '',
      }));
      return group;
    } catch (error) {
      if (current()) setState(previous => ({scope, groups: previous.scope === scope ? previous.groups : [], loading: false, error: errorMessage(error)}));
      throw error;
    }
  }, [accountId, enabled, scope, current]);

  // The drawer and conversation menu can edit the same group independently.
  // Keep their requests in order so a late older snapshot cannot undo a newer edit.
  const mutate = useCallback((body: Record<string, unknown>) => {
    // Fast Refresh can retain the previous queue shape during this UI upgrade.
    const registry = mutationQueues.current || (mutationQueues.current = new WeakMap<Scope, Map<string, Promise<GroupChat>>>());
    let queues = registry.get(scope);
    if (!queues) {
      queues = new Map<string, Promise<GroupChat>>();
      registry.set(scope, queues);
    }
    const key = typeof body.groupId === 'string' ? body.groupId : `create:${String(body.requestId)}`;
    const previous = queues.get(key);
    const operation = (previous ? previous.catch(() => undefined) : Promise.resolve())
      .then(() => performMutation(body));
    queues.set(key, operation);
    void operation.finally(() => {
      if (queues.get(key) === operation) queues.delete(key);
    }).catch(() => {});
    return operation;
  }, [scope, performMutation]);

  const create = useCallback((input: GroupCreateInput) => mutate({action: 'create', ...input}), [mutate]);
  const rename = useCallback((groupId: string, name: string) => mutate({action: 'rename', groupId, name}), [mutate]);
  const settings = useCallback((groupId: string, patch: {purpose?: string; pinned?: boolean; announcement?: string; muted?: boolean}, requestId: string) => mutate({action: 'settings', groupId, ...patch, requestId}), [mutate]);
  const clear = useCallback((groupId: string, requestId: string) => mutate({action: 'clear', groupId, requestId}), [mutate]);
  const exit = useCallback((groupId: string, requestId: string) => mutate({action: 'exit', groupId, requestId}), [mutate]);
  const members = useCallback((groupId: string, addIds: string[], removeIds: string[], requestId: string) => mutate({action: 'members', groupId, addIds, removeIds, requestId}), [mutate]);
  const send = useCallback((groupId: string, text: string, mentionIds: string[], requestId: string, replyTo?: string, media?: GroupSendMedia) => mutate({action: 'send', groupId, text, mentionIds, requestId, ...(replyTo ? {replyTo} : {}), ...media}), [mutate]);
  const open = useCallback((groupId: string) => mutate({action: 'open', groupId}), [mutate]);
  const retry = useCallback((groupId: string) => mutate({action: 'retry', groupId}), [mutate]);
  const confirmPlan = useCallback((groupId: string, planId: string, requestId: string) => mutate({action: 'confirm-plan', groupId, planId, requestId}), [mutate]);
  const reminder = useCallback((groupId: string, reminderId: string, operation: 'confirm' | 'pause' | 'resume' | 'cancel', requestId: string) => mutate({action: 'reminder', groupId, reminderId, operation, requestId}), [mutate]);
  const visible = state.scope === scope && enabled && !!accountId;
  const hasPending = visible && state.groups.some(group => group.pending);
  const pollInterval = hasPending ? 2000 : visible && state.groups.length ? 5000 : 0;
  useEffect(() => {
    if (!accountId || !enabled) return;
    const controller = new AbortController();
    let refreshing = false;
    const poll = async () => {
      if (refreshing || controller.signal.aborted || document.visibilityState === 'hidden') return;
      refreshing = true;
      try {await refresh(controller.signal);} finally {refreshing = false;}
    };
    const onVisible = () => {if (document.visibilityState !== 'hidden') void poll();};
    const timer = pollInterval ? setInterval(() => void poll(), pollInterval) : null;
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('npc-groups-changed', onVisible);
    return () => {
      if (timer) clearInterval(timer);
      controller.abort();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('npc-groups-changed', onVisible);
    };
  }, [accountId, enabled, pollInterval, refresh]);
  return {
    groups: visible ? state.groups : [],
    loading: visible ? state.loading : !!accountId && enabled,
    error: visible ? state.error : '',
    refresh,
    create,
    rename,
    settings,
    clear,
    exit,
    members,
    send,
    open,
    retry,
    confirmPlan,
    reminder,
  };
}
