import {socialPrivatePrompt,resolveSocialExplanation,resolveSocialPrivateReturn,prepareSocialFollowup} from './social-continuity';
import type { ChatMessage } from './contracts';
import { RELATIONSHIP_UNLOCKS } from './relationship-values';

const HOUR = 3600000;
const DAY = 24 * HOUR;
export const contactPolicy = {
  version: 1, closeAt: 60, followUpMs: 90 * 60000,
  shareMinMs: 3 * HOUR, shareMaxMs: 5 * HOUR,
  eventCooldownMs: 7 * DAY, eventDailyChance: 0.16,
};
export type ContactKind = 'share' | 'evening' | 'followup' | 'conflict_followup';
type Scene = { id: string; topic: string; cue: string; major: boolean; step: number; createdAt: number };
export type ContactLife = {
  version: number; enabled: boolean; nextAt: number; quietUntil: number;
  busyUntil: number; sleepingUntil: number; conflict: boolean;
  requiredSocialReactionId?:string;
  npcAwakeUntil?: number; npcSleepingUntil?: number;
  waiting?: { at: number; followedUp: boolean; knownUnavailable: boolean };
  returning?: { gapMs: number; explained: boolean; conflict: boolean; followedUp: boolean };
  feelings: { mood: number; dissatisfaction: number; unease: number };
  audits: { at: number; reason: string; before: ContactLife['feelings']; after: ContactLife['feelings'] }[];
  sentAt: number[]; lastEvening: string; lastAttemptAt: number; lastError: string;
  eventCheckedDay: string; lastMajorAt: number; majorDue: boolean;
  scene?: Scene; episode?: Scene & { lastAt: number; spoken: string };
  journal: { at: number; topic: string; sceneId: string; text: string; major: boolean; step: number }[];
};
export type ContactHost = {
  characterId: string; messages: ChatMessage[]; values: Record<string, number | null>;
  relationship?: string; contactLife?: ContactLife;
};
export const contactDay = (now: number) => new Date(now + 8 * HOUR).toISOString().slice(0, 10);
export const contactHour = (now: number) => new Date(now + 8 * HOUR).getUTCHours();
const textOf = (m: ChatMessage) => 'text' in m.part ? m.part.text : 'caption' in m.part ? m.part.caption || '' : '';
const deliveredAt = (m: ChatMessage) => Math.max(Date.parse(m.at) || 0, m.deliverAt || 0);
export function contactClose(s: ContactHost) {
  return s.relationship === 'lovers' || ((s.values.affection || 0) >= contactPolicy.closeAt && (s.values.familiarity || 0) >= contactPolicy.closeAt);
}
const photographableTopics = new Set(['food', 'shopping', 'exercise', 'work', 'home', 'games', 'outing', 'pets', 'series', 'walk']);
export function contactPhotoRequired(s: ContactHost, kind: ContactKind | null) {
  const v = s.values, gate = RELATIONSHIP_UNLOCKS.dailyPhoto;
  const eligible = (v.familiarity || 0) >= gate.familiarity && (v.affection || 0) >= gate.affection && (v.trust || 0) >= gate.trust && (v.comfort || 0) >= gate.comfort;
  return eligible && (kind === 'share' || kind === 'evening') && !!s.contactLife?.scene && photographableTopics.has(s.contactLife.scene.topic);
}
export function assertContactPhoto(s: ContactHost, kind: ContactKind | null, action: unknown, parts: { type: string }[]) {
  if (action === 'reply' && contactPhotoRequired(s, kind) && !parts.some(part => part.type === 'generated_photo'))
    throw Error('可拍日常的主动分享缺少配图任务');
}
// Xia's hours are confirmed. Yuan/Liu hours are configurable implementation defaults.
export function contactSchedule(s: ContactHost, now: number) {
  const hour = contactHour(now);
  const lateYuan = s.characterId === 'yuan-xiaoman' && new Date(now + 8 * HOUR).getUTCDay() === 6;
  const [sleep, wake] = s.characterId === 'xia-xia' ? [3, 12] : s.characterId === 'yuan-xiaoman' ? [lateYuan ? 2 : 1, 9] : [0, 8];
  const sleeping = (s.contactLife?.npcAwakeUntil || 0) > now ? false : (s.contactLife?.npcSleepingUntil || 0) > now ? true : hour >= sleep && hour < wake;
  return { sleeping, sleepHour: sleep, wakeHour: wake,
    source: s.characterId === 'xia-xia' ? 'user_required' : 'assistant_proposed' };
}
export function ensureContact(s: ContactHost, now: number): ContactLife {
  if (s.contactLife?.version === contactPolicy.version) return s.contactLife;
  const c: ContactLife = s.contactLife = {
    version: contactPolicy.version, enabled: true, nextAt: now + HOUR,
    quietUntil: 0, busyUntil: 0, sleepingUntil: 0, conflict: false,
    feelings: { mood: 0, dissatisfaction: 0, unease: 0 }, audits: [],
    sentAt: [], lastEvening: '', lastAttemptAt: 0, lastError: '',
    eventCheckedDay: '', lastMajorAt: now, majorDue: false, journal: [],
  };
  // Migrate only operational boundaries, never replay historical emotional penalties.
  for (const m of s.messages.filter(m => m.role === 'user')) applyAvailability(c, textOf(m), Date.parse(m.at) || now);
  const last = s.messages.at(-1);
  if (last?.role === 'assistant' && now - deliveredAt(last) < DAY)
    c.waiting = { at: deliveredAt(last), followedUp: false, knownUnavailable: c.busyUntil > deliveredAt(last) || c.sleepingUntil > deliveredAt(last) };
  return c;
}
function duration(text: string, fallback: number) {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(小时|分钟|天)/);
  return match ? Math.min(7 * DAY, Number(match[1]) * (match[2] === '小时' ? HOUR : match[2] === '天' ? DAY : 60000)) : fallback;
}
function applyAvailability(c: ContactLife, text: string, now: number) {
  if (/(?:别|不要|停止).*主动.*(?:找我|发消息|联系)|别再主动/.test(text)) c.enabled = false;
  else if (/(?:可以|恢复|继续).*主动.*(?:找我|发消息|联系)/.test(text)) c.enabled = true;
  if (/(?:先别|别|不要)打扰|免打扰|让我静静|先别找我/.test(text)) c.quietUntil = now + duration(text, 2 * HOUR);
  if (/忙完了|开完会了|有空了|回来了|睡醒了/.test(text)) { c.busyUntil = 0; c.sleepingUntil = 0; }
  else if (/我.{0,12}(?:忙|开会|加班|上班|开车|出差)|连着开\d+小时/.test(text)) c.busyUntil = now + duration(text, 4 * HOUR);
  if (/我(?:去|要|先)?睡(?:了|觉)|晚安/.test(text)) c.sleepingUntil = now + 10 * HOUR;
}
function changeFeelings(c: ContactLife, now: number, reason: string, deltas: Partial<ContactLife['feelings']>) {
  const before = { ...c.feelings };
  for (const key of ['mood', 'dissatisfaction', 'unease'] as const) {
    c.feelings[key] = Math.max(key === 'mood' ? -10 : 0, Math.min(10, c.feelings[key] + (deltas[key] || 0)));
  }
  if (JSON.stringify(before) !== JSON.stringify(c.feelings)) c.audits = [...c.audits, { at: now, reason, before, after: { ...c.feelings } }].slice(-50);
}
export function contactUserActivity(s: ContactHost, text: string, now: number) {
  const c = ensureContact(s, now), wait = c.waiting;
  const explained = /刚才.{0,30}(?:在|去|忙|开会|洗澡|电话|睡|有事|开车|游戏)|刚.{0,12}(?:开完|忙完|洗完)|没(?:看|注意|来得及)|手机.{0,10}(?:没电|静音)|家里有事/.test(text);
  if(explained)resolveSocialExplanation(s,true,'explanation',now);
  else resolveSocialPrivateReturn(s,now);
  if (wait && now - wait.at >= contactPolicy.followUpMs && !wait.knownUnavailable) {
    c.returning = { gapMs: now - wait.at, explained, conflict: c.conflict, followedUp: wait.followedUp };
    if (explained) changeFeelings(c, now, '用户说明暂离原因，恢复短期情绪', { mood: 2, dissatisfaction: -2, unease: -2 });
  } else if (c.returning && !c.returning.explained && explained) {
    c.returning.explained = true;
    changeFeelings(c, now, '用户分条补充暂离原因，恢复短期情绪', { mood: 2, dissatisfaction: -2, unease: -2 });
  }
  c.waiting = undefined;
  c.scene = undefined;
  applyAvailability(c, text, now);
  c.nextAt = now + contactPolicy.shareMinMs;
}
export function contactDecision(s: ContactHost, now: number): { kind: ContactKind | null; reason: string } {
  const c = ensureContact(s, now);
  if (!c.enabled) return { kind: null, reason: 'disabled' };
  if (c.quietUntil > now) return { kind: null, reason: 'do_not_disturb' };
  if (contactSchedule(s, now).sleeping) return { kind: null, reason: 'npc_sleeping' };
  if (!s.messages.some(m => m.role === 'user')) return { kind: null, reason: 'no_conversation' };
  if (s.relationship === 'broken_up') return { kind: null, reason: 'relationship_closed' };
  if (s.messages.some(m => m.role === 'assistant' && deliveredAt(m) > now)) return { kind: null, reason: 'delivery_pending' };
  if (now < c.nextAt) return { kind: null, reason: 'cooldown' };
  const close = contactClose(s), waiting = c.waiting;
  if (close && waiting && !waiting.followedUp && !waiting.knownUnavailable && c.busyUntil <= now && c.sleepingUntil <= now && now - waiting.at >= contactPolicy.followUpMs && now - waiting.at <= 3 * HOUR)
    return { kind: c.conflict ? 'conflict_followup' : 'followup', reason: 'unanswered_90_minutes' };
  const hour = contactHour(now), day = contactDay(now);
  const eveningContact = c.lastEvening === day || s.messages.some(m => m.role === 'assistant' && deliveredAt(m) <= now && contactDay(deliveredAt(m)) === day && contactHour(deliveredAt(m)) >= 19);
  if (close && hour >= 19 && !eveningContact) return { kind: 'evening', reason: 'daily_evening_contact' };
  // Limit repeated unsolicited new topics during one unreturned gap; nightly contact still remains possible.
  const lastUser = s.messages.findLast(m => m.role === 'user');
  const unanswered = c.sentAt.filter(t => t > (lastUser ? Date.parse(lastUser.at) : 0) && t > now - DAY).length;
  if (unanswered >= 2 || (!close && waiting)) return { kind: null, reason: 'awaiting_user_after_followup' };
  return { kind: 'share', reason: c.busyUntil > now ? 'asynchronous_share_while_busy' : 'new_life_share' };
}
const everyday: Record<string, { topic: string; cue: string }[]> = {
  'yuan-xiaoman': [
    { topic: 'food', cue: '发现一种想尝试的美食，或亲手做一顿不复杂的饭；先按当前时间决定正在吃还是计划吃' },
    { topic: 'shopping', cue: '逛街试衣、逛小店或挑日用品的小发现；不每次都买、不编消费金额' },
    { topic: 'travel', cue: '想去的新地方、查旅行路线或整理曾经自己的旅行照片；没有行程铺垫先计划，不突然跨城市' },
    { topic: 'exercise', cue: '训练或散步时一个具体的小发现，避免天天报运动成果' },
    { topic: 'work', cue: '写言情小说的人物关系、情节构思、卡文或改稿小插曲，不编出版、销量或获奖成果' },
    { topic: 'friends', cue: '和朋友的小互动或约饭想法，未登场人物只称朋友，不借其他NPC私聊' },
    { topic: 'home', cue: '在家听歌、看电影、做饭或整理衣服的新细节，近期插花已聊过，不再主动绕回花' },
  ],
  'xia-xia': [
    { topic: 'food', cue: '吃饭或小吃的新发现' }, { topic: 'games', cue: '游戏里一个普通小插曲，不编用户参与' },
    { topic: 'outing', cue: '出门散步或短途出游的想法，保持地点连续' }, { topic: 'pets', cue: '路边看到的小动物，不擅自新添宠物' },
    { topic: 'series', cue: '聊熟悉动漫或二次元世界普通玩乐，不编查过实时消息或原作官方新剧情' },
    { topic: 'friends', cue: '和动漫朋友一起玩的轻松小插曲，名单未定就不补固定好友关系或共同重大事件，不设工作赶稿' },
  ],
  liu: [
    { topic: 'music', cue: '听歌的小发现，不补舞台排练或演艺通告' }, { topic: 'food', cue: '工作结束吃饭或简单下厨' },
    { topic: 'walk', cue: '散步或休息的小细节' }, { topic: 'work', cue: '整理营养资料、核对食品标签或复盘餐食搭配的轻量插曲，不编真实接诊或公开用户健康资料' },
    { topic: 'friends', cue: '和已知朋友的一次普通往来，不编共同诊疗或借其他NPC私聊' },
  ],
};
const bigEvents = [
  { topic: 'career_change', cue: '一个原定工作安排出现变动：先收到改期/合作调整消息，再了解原因与选择，最后处理后续；不直接改永久职业' },
  { topic: 'friend_conflict', cue: '和朋友因具体约定起分歧：先有不愉快，再决定沟通或暂时疏远，后续允许和好或渐行渐远，不突然编背叛巨款' },
  { topic: 'travel_plan', cue: '准备一次短途旅行：先有想法，再安排时间路线，最后才成行或延期；不瞬间抵达异地' },
  { topic: 'low_mood', cue: '自己的生活中遇到小挫折或疲惫，心情低落，之后通过休息或处理问题逐渐恢复；不把用户当唯一解决办法' },
];
export function prepareContactTurn(s: ContactHost, now: number, kind: ContactKind, rng = Math.random) {
  const c = ensureContact(s, now); c.lastAttemptAt = now;
  prepareSocialFollowup(s,kind,now);
  if (kind === 'followup' || kind === 'conflict_followup') return;
  if (c.scene) return;
  if (c.episode && now - c.episode.lastAt >= 12 * HOUR) {
    c.scene = { ...c.episode, step: c.episode.step + 1 }; return;
  }
  const day = contactDay(now);
  if (c.eventCheckedDay !== day) {
    c.eventCheckedDay = day;
    c.majorDue = !c.episode && now - c.lastMajorAt >= contactPolicy.eventCooldownMs && rng() < contactPolicy.eventDailyChance;
  }
  const recent = new Set(c.journal.slice(-3).map(row => row.topic));
  const lastTexts = s.messages.filter(m => m.role === 'assistant').slice(-8).map(textOf).join('\n');
  if (/吃|饭|外卖|咖啡/.test(lastTexts)) recent.add('food');
  if (/花|花瓶|玻璃壶/.test(lastTexts)) recent.add('home');
  if (/逛街|试衣/.test(lastTexts)) recent.add('shopping');
  const majorEvents = s.characterId === 'xia-xia' ? bigEvents.filter(event => event.topic !== 'career_change') : bigEvents;
  const pool = c.majorDue ? majorEvents : everyday[s.characterId] || everyday.liu;
  const available = pool.filter(row => !recent.has(row.topic));
  const options = available.length ? available : pool;
  const chosen = options[Math.min(options.length - 1, Math.floor(rng() * options.length))];
  c.scene = { ...chosen, id: crypto.randomUUID(), major: c.majorDue, step: 1, createdAt: now };
  c.majorDue = false;
}
export function completeContactTurn(s: ContactHost, now: number, kind: ContactKind | null, newMessages: ChatMessage[], event?: { kind: string; basis?: string; evidence?: string }, incoming = '') {
  const c = ensureContact(s, now);
  c.lastError = '';
  if (!kind && event?.basis !== 'hypothesis' && event?.evidence && incoming.includes(event.evidence)) {
    if (['harm', 'betrayal'].includes(event.kind) && /你|咱们|我们(?:俩|两个)/.test(event.evidence)) c.conflict = true;
    if (event.kind === 'repair') { c.conflict = false; changeFeelings(c, now, '解释或和好事件', { mood: 2, dissatisfaction: -2, unease: -2 }); }
  }
  const sent = newMessages.length > 0;
  if (!sent) { c.nextAt = now + HOUR; return; }
  const lastAt = Math.max(now, ...newMessages.map(deliveredAt));
  const newText = newMessages.map(textOf).join('\n');
  if (/我(?:还没睡|还在(?:剪|忙|工作)|今晚(?:熬夜|不睡))/.test(newText)) c.npcAwakeUntil = now + 2 * HOUR;
  else if (/我(?:先|要|准备)?睡了|我(?:先|要|准备)?去睡/.test(newText)) { c.npcSleepingUntil = now + 8 * HOUR; c.npcAwakeUntil = 0; }
  if (kind === 'followup' || kind === 'conflict_followup') {
    if (c.waiting) c.waiting.followedUp = true;
    if (kind === 'conflict_followup') changeFeelings(c, now, '争执后未回应，仅一次短期波动', { mood: -2, dissatisfaction: 2, unease: 1 });
  } else if (!kind || !c.waiting) {
    c.waiting = { at: lastAt, followedUp: false, knownUnavailable: c.busyUntil > now || c.sleepingUntil > now };
  }
  if (kind) {
    c.sentAt = [...c.sentAt.filter(t => t > now - 7 * DAY), now];
    if (contactHour(now) >= 19) c.lastEvening = contactDay(now);
    if (c.scene && kind !== 'followup' && kind !== 'conflict_followup') {
      const scene = c.scene;
      const spoken = newMessages.map(textOf).filter(Boolean).join('\n').slice(0, 1600);
      c.journal = [...c.journal, { at: now, topic: scene.topic, sceneId: scene.id, text: spoken, major: scene.major, step: scene.step }].slice(-40);
      if (scene.major) {
        c.lastMajorAt = now;
        c.episode = scene.step >= 3 ? undefined : { ...scene, lastAt: now, spoken };
        if (scene.step === 1) changeFeelings(c, now, 'NPC本人生活事件短期情绪', scene.topic === 'travel_plan' ? { mood: 1 } : { mood: -1 });
      }
      c.scene = undefined;
    }
  } else c.returning = undefined;
  const nextShare = contactClose(s) ? contactPolicy.shareMinMs + Math.random() * (contactPolicy.shareMaxMs - contactPolicy.shareMinMs) : 12 * HOUR;
  c.nextAt = lastAt + (contactClose(s) && !c.waiting?.followedUp && !c.waiting?.knownUnavailable ? contactPolicy.followUpMs : nextShare);
}
/** Read existing continuity without adding a proactive-contact strategy. */
export function contactStatePrompt(s: ContactHost, now: number) {
  const c = s.contactLife;
  if (!c) return '';
  return `${socialPrivatePrompt(s,now)}\n【持续生活状态，仅供当前回应】${JSON.stringify({schedule:contactSchedule(s,now),close:contactClose(s),busy:c.busyUntil>now,userSleeping:c.sleepingUntil>now,returning:c.returning,conflict:c.conflict,shortTermFeelings:c.feelings,waiting:c.waiting,sceneCandidate:c.scene,ongoingEpisode:c.episode,recentLife:c.journal.slice(-8)})}
这是已保存的本分支状态，不新增发送、计时或追问任务。已发出的recentLife与已发生的ongoingEpisode用于连续回应，不反复重播；sceneCandidate尚未发生，不编为现实经历。returning存在时结合本轮原话：已经解释则自然接上并修正误解，没解释也不默认盘问，依本人接续规则判断是否有具体必要。本状态只由现有后台处理一次，不照念状态或分数。
忙碌、睡眠、暂停与已表达边界继续有效；持续生活不要求本轮主动分享或延长闲聊，不制造用户参与、付款或现实见面的事实。`;
}

export function contactPrompt(s: ContactHost, now: number, kind: ContactKind | null = null) {
  const c = ensureContact(s, now);
  return `${socialPrivatePrompt(s,now)}\n【持续生活与主动联系状态】${JSON.stringify({ kind, schedule: contactSchedule(s, now), close: contactClose(s), busy: c.busyUntil > now, userSleeping: c.sleepingUntil > now, returning: c.returning, conflict: c.conflict, photoRequired: contactPhotoRequired(s, kind), shortTermFeelings: c.feelings, waiting: c.waiting, sceneCandidate: c.scene, ongoingEpisode: c.episode, recentLife: c.journal.slice(-8) })}
这是本分支的运行状态，优先于旧档案每周1–3次、21点截止及永不跟问的实现说明。候选场景还没发生，按已有历史和作息选择可成立的细节；已发出的recentLife才是本分支生活连续性。候选与已知行程或本轮新身份冲突时搁置，不覆盖已发生事情；旧模特拍摄、夏夏上班接单或已撤回现职的候选不能当当前生活继续，已发历史仅作旧阶段回顾。日常闲聊不要每次重播最近的花/蛋糕；用户主动问旧事则正常接上。
kind为share/evening时主动分享一件新鲜小事或当前想法，亲近的晚间交流可直接表达想念；followup时接上上条未获回应的消息，温和找一次，不指责忙碌；conflict_followup可表达真实委屈，不威胁或把沉默认定恶意。没有新内容或不适合发送可以silent，后台会稍后再评估。busy/userSleeping时只留生活分享，不追问不回，不要求立刻回复。
photoRequired为true时，只有确有适合拍摄的日常场景才回复，并必须提交一条与当前活动相符的generate_photo；没有可信画面时silent。达到数值门槛不代表必须分享照片。
returning存在时，结合本轮原话判断用户是否解释：解释了自然接上、修正误解；没有解释而刚才在等，可以顺势问一句，不盘问。此状态只处理一次。不照念状态或分数。
重大生活事件遵循第1步开端、第2步发展、第3步收尾；沿用同一件事，不另换朋友/工作/地点，不强制喜剧或悲剧结局。这些是虚构NPC本人生活，不创建用户参加、付款或现实约会的事实。`;
}
