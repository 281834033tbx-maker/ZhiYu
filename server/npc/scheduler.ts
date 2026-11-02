import { scheduleDelivery } from '../../lib/npc/delivery';
import { partInput, imageInputs } from './media';
import type { NpcState } from '../../lib/npc/contracts';
import {
  ensureLife,
  dueKind,
  afterReply,
  activity,
  localDay,
  isTyping,
} from '../../lib/npc/life';
import { parseOutput, finishTurn } from '../../lib/npc/engine';
import { buildPrompt } from './prompt';
import { contactDecision, prepareContactTurn, completeContactTurn, assertContactPhoto } from '../../lib/npc/contact-life';

export type Runtime = {
  root: string;
  load: (id: string) => NpcState;
  save: (id: string, state: NpcState, revision: number) => void;
  generate: (root: string, prompt: string, options?: {images?:string[]; requestId?:string}) => Promise<unknown>;
  now?: () => number;
};
export async function runScheduledTurn(runtime: Runtime, id: string) {
  const clock = runtime.now || Date.now,
    start = clock(),
    state = runtime.load(id);
  const kind = dueKind(state, start, true);
  if (!kind) return false;
  const life = ensureLife(state, start),
    queued = [...life.queue],
    inputRevision = life.inputRevision || 0;
  const incoming =
    kind === 'queued'
      ? state.messages
          .filter((m) => queued.includes(m.turnId) && m.role === 'user')
          .map((m) => partInput(m.part))
          .join('\n')
      : '';
  const job = crypto.randomUUID(),
    branch = state.branch,
    rev = state.revision;
  const contactKind = kind === 'proactive' ? contactDecision(state, start).kind : null;
  if (contactKind) prepareContactTurn(state, start, contactKind);
  state.pending = { id: job, since: start };
  for (const m of state.messages)
    if (queued.includes(m.turnId) && m.role === 'user' && !m.readAt)
      m.readAt = new Date(start).toISOString();
  if (kind === 'proactive') {
    if (life.proactiveDay !== localDay(start)) {
      life.proactiveDay = localDay(start);
      life.proactiveAttempts = 0;
    }
    life.proactiveAttempts++;
  }
  runtime.save(id, state, rev);
  try {
    const result = parseOutput(
      await runtime.generate(
        runtime.root,
        buildPrompt(runtime.root, state, incoming, kind, contactKind),
        { requestId: job, images: imageInputs(runtime.root,id.split(':')[0],state.messages.slice(-80)) },
      ),
      incoming,
    );
    assertContactPhoto(state, contactKind, result.action, result.parts);
    const fresh = runtime.load(id),
      now = clock(),
      nextLife = ensureLife(fresh, now);
    if (fresh.branch !== branch || fresh.pending?.id !== job || fresh.paused)
      return false;
    if (
      isTyping(fresh, now) ||
      (nextLife.inputRevision || 0) !== inputRevision ||
      (kind === 'queued' && nextLife.queue.some((q) => !queued.includes(q))) ||
      activity(fresh, now) === 'sleeping' ||
      fresh.cooldownUntil > now ||
      (kind === 'proactive' &&
        (nextLife.lastUserAt > start ||
          nextLife.queue.length > 0 ||
          nextLife.quietUntil > now ||
          !nextLife.proactiveEnabled || contactDecision(fresh, now).kind !== contactKind))
    ) {
      fresh.pending = null;
      runtime.save(id, fresh, fresh.revision);
      return false;
    }
    const before = fresh.messages.length;
    if (kind === 'proactive') { result.memories = []; result.event = undefined; }
    finishTurn(fresh, job, incoming, result, now, false);
    scheduleDelivery(fresh.messages,before,start,Math.max(now,activity(fresh,now)==='working'?nextLife.nextWorkReplyAt:0));
    for (const m of fresh.messages.slice(before))
      m.origin = kind === 'proactive' ? 'proactive' : 'chat';
    if (kind === 'queued')
      nextLife.queue = nextLife.queue.filter((q) => !queued.includes(q));
    afterReply(fresh, now);
    completeContactTurn(fresh, now, contactKind, fresh.messages.slice(before), result.event, incoming);
    if (result.action === 'end_conversation') fresh.contactLife!.quietUntil = now + 2 * 3600000;
    nextLife.nextProactiveAt = fresh.contactLife!.nextAt;
    runtime.save(id, fresh, fresh.revision);
    return true;
  } catch {
    const fresh = runtime.load(id);
    if (fresh.branch === branch && fresh.pending?.id === job) {
      fresh.pending = null;
      const life = ensureLife(fresh, clock());
      life.retryAt = clock() + 120000;
      life.lastError = '暂时未能收到回复，稍后会自动重试。';
      runtime.save(id, fresh, fresh.revision);
    }
    // Details are deliberately not returned as character dialogue.
    return false;
  }
}
