import config from './life-config.json';
import type { NpcState, LifeState } from './contracts';
import { ensureContact, contactDecision, contactUserActivity, contactSchedule } from './contact-life';
export { config as lifeConfig };
export function ensureLife(state: NpcState, now: number): LifeState {
  const life = (state.life ??= {
    queue: [],
    recentIncoming: [],
    wakeUntil: 0,
    nextWorkReplyAt: 0,
    lastUserAt:
      Date.parse(
        state.messages.filter((m) => m.role === 'user').at(-1)?.at || '',
      ) || 0,
    nextProactiveAt: now + config.proactiveMinMs,
    proactiveDay: '',
    proactiveAttempts: 0,
    proactiveEnabled: true,
    quietUntil: 0,
    retryAt: 0,
    lastError: '',
    wakeReason: '',
    proactivePolicyVersion: 2,
  });
  if (life.proactivePolicyVersion !== 2) {
    // Only discard the old 12-hour goodnight timer, preserving explicit busy requests.
    const userText = state.messages.filter(m=>m.role==='user').map(m=>'text' in m.part?m.part.text:'').reverse();
    const lastDirective = userText.find(text=>/我(?:去|要|先)?睡(?:了|觉)|晚安|我(?:现在|先|有点|在)?忙|先别打扰/.test(text));
    if (lastDirective && /我(?:去|要|先)?睡(?:了|觉)|晚安/.test(lastDirective) && !/忙|别打扰/.test(lastDirective)) {
      life.playerSleepingUntil=life.quietUntil;
      life.quietUntil=0;
    }
    life.proactivePolicyVersion=2;
  }
  if (!state.contactLife) {
    const c = ensureContact(state, now);
    c.enabled = life.proactiveEnabled;
    c.quietUntil = Math.max(c.quietUntil, life.quietUntil);
  }
  return life;
}
// Upgrade persisted minute-scale deadlines without clearing messages or relationship state.
export function shortenLegacyWorkWait(state: NpcState, now: number): boolean {
  const life = state.life;
  if (!life || life.nextWorkReplyAt <= now + config.workReplyMaxMs) return false;
  life.nextWorkReplyAt = now + config.workReplyMinMs;
  return true;
}
export function localHour(now: number) {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: config.timezone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now),
  );
}
export function localDay(now: number) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function activity(
  state: NpcState,
  now: number,
): 'sleeping' | 'working' | 'free' | 'woken' {
  const h = localHour(now);
  if ((state.contactLife?.npcSleepingUntil || 0) > now && (state.contactLife?.npcAwakeUntil || 0) <= now)
    return (state.life?.wakeUntil || 0) > now ? 'woken' : 'sleeping';
  if (h >= config.sleepStartHour && h < config.wakeHour)
    return (state.life?.wakeUntil || 0) > now || !contactSchedule(state, now).sleeping ? 'woken' : 'sleeping';
  // Xia is unemployed; legacy reply deadlines do not create a work shift.
  if (state.characterId !== 'xia-xia' && h >= config.workStartHour && h < config.workEndHour) return 'working';
  return 'free';
}
const delay = (min: number, max: number, rng: () => number) =>
  min + Math.floor(rng() * (max - min));
export function enqueue(
  state: NpcState,
  id: string,
  now: number,
  text: string,
  call?: 'voice' | 'video',
  rng = Math.random,
) {
  const life = ensureLife(state, now);
  if (life.queue.includes(id)) return;
  contactUserActivity(state, text, now);
  life.queue.push(id);
  life.lastUserAt = now;
  life.lastError = '';
  life.retryAt = 0;
  life.nextProactiveAt =
    nextProactive(state, now, rng);
  life.recentIncoming = life.recentIncoming.filter(
    (t) => now - t < config.burstWindowMs,
  );
  life.recentIncoming.push(now);
  if (
    activity(state, now) === 'sleeping' &&
    (call || life.recentIncoming.length >= config.burstCount)
  ) {
    life.wakeUntil = now + config.wakeForMs;
    life.wakeReason =
      call === 'video'
        ? '视频来电'
        : call === 'voice'
          ? '语音来电'
          : '连续消息提醒';
  }
  if (activity(state, now) === 'working' && !life.nextWorkReplyAt)
    life.nextWorkReplyAt =
      now + delay(config.workReplyMinMs, config.workReplyMaxMs, rng);
  if (/(?:别|不要|停止).*主动.*(?:找我|发消息|联系)|别再主动/.test(text))
    life.proactiveEnabled = false;
  if (/(?:可以|恢复|继续).*主动.*(?:找我|发消息|联系)/.test(text))
    life.proactiveEnabled = true;
  if (/我(?:去|要|先)?睡(?:了|觉)|晚安/.test(text))
    life.playerSleepingUntil = now + 12 * 3600000;
  else life.playerSleepingUntil = 0;
  if (/先别打扰|不要打扰|别打扰|免打扰/.test(text))
    life.quietUntil = now + 2 * 3600000;
}
export function dueKind(
  state: NpcState,
  now: number,
  prepare = false,
): 'queued' | 'proactive' | null {
  const life = ensureLife(state, now),
    current = activity(state, now);
  if (
    (!prepare && isTyping(state, now)) ||
    state.paused ||
    state.cooldownUntil > now ||
    (state.pending && now - state.pending.since < 180000) ||
    life.retryAt > now ||
    current === 'sleeping'
  )
    return null;
  if (life.queue.length)
    return !prepare && current === 'working' && life.nextWorkReplyAt > now
      ? null
      : 'queued';
  if (
    !life.proactiveEnabled ||
    life.quietUntil > now ||
    !life.lastUserAt ||
    now < (state.contactLife?.nextAt || life.nextProactiveAt)
  )
    return null;
  if (
    state.relationship === 'broken_up'
  )
    return null;
  state.contactLife!.enabled = life.proactiveEnabled;
  return contactDecision(state, now).kind ? 'proactive' : null;
}

export function isClose(state: NpcState) {
  return state.values.familiarity >= config.closeFamiliarity && state.values.affection >= config.closeAffection;
}
function nextProactive(state: NpcState, now: number, rng: () => number) {
  return now + (isClose(state)
    ? delay(config.proactiveMinMs, config.proactiveMaxMs, rng)
    : delay(config.formalProactiveMinMs, config.formalProactiveMaxMs, rng));
}
export function proactiveContext(state: NpcState, now: number) {
  const life = ensureLife(state, now);
  return { mode: isClose(state) ? 'personal' : state.mode === 'normal' ? 'history_review' : 'formal', playerSleeping: (life.playerSleepingUntil || 0) > now,
    mayCheckIn: isClose(state) && now-life.lastUserAt >= config.followUpAfterMs && (life.playerSleepingUntil || 0) <= now,
    dailyLimit: null };
}

export function afterReply(state: NpcState, now: number, rng = Math.random) {
  const life = ensureLife(state, now);
  life.nextWorkReplyAt =
    activity(state, now) === 'working'
      ? now + delay(config.workReplyMinMs, config.workReplyMaxMs, rng)
      : 0;
  life.nextProactiveAt =
    nextProactive(state, now, rng);
  life.retryAt = 0;
  life.lastError = '';
}

export function isTyping(state: NpcState, now: number) {
  return Object.values(state.life?.typingClients || {}).some(
    (c) => c.until > now,
  );
}
export function presence(
  state: NpcState,
  now: number,
  available = true,
): 'online' | 'offline' | 'busy' {
  if (!available || state.paused || activity(state, now) === 'sleeping')
    return 'offline';
  return activity(state, now) === 'working' || state.cooldownUntil > now
    ? 'busy'
    : 'online';
}
