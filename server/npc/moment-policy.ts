import {getCharacter} from '../../lib/npc/character-directory';
import {loadMollyDialogueSkill, readDialoguePersona} from './dialogue-skill';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chenAcsmFoundationFile, parseChenAcsmFoundation, matchChenAcsmFoundationEntries, selectChenAcsmFoundationEntries } from './chen-acsm-foundation';
import { parseChefFoundationKnowledge, matchChefFoundationKnowledgeEntries, selectChefFoundationKnowledgeEntries } from './chef-foundation-knowledge';
import { parseLiuClinicalKnowledge, matchLiuClinicalKnowledgeEntries, selectLiuClinicalKnowledgeEntries } from './liu-clinical-knowledge';

/** Stable production session suffixes, not display-name aliases or test sessions. */
export const momentActors = [
  { id: 'xia-xia', table: 'sessions', suffix: 'xia-xia:normal', name: getCharacter('xia-xia')!.name, profile: 'xia-xia', kind: 'companion' },
  { id: 'yuan-xiaoman', table: 'yuan_sessions', suffix: 'yuan-xiaoman', name: getCharacter('yuan-xiaoman')!.name, profile: 'yuan-xiaoman', kind: 'companion' },
  { id: 'liu', table: 'liu_sessions', suffix: 'liu', name: getCharacter('liu')!.name, profile: 'liu-zhimin', kind: 'professional' },
  { id: 'chen-nian', table: 'chen_sessions', suffix: 'chen-nian', name: getCharacter('chen-nian')!.name, profile: 'chen-nian', kind: 'professional' },
  { id: 'he-jiawei', table: 'he_sessions', suffix: 'he-jiawei', name: getCharacter('he-jiawei')!.name, profile: 'he-jiawei', kind: 'companion' },
  { id: 'zhou-chef', table: 'zhou_chef_sessions', suffix: 'zhou-chef', name: getCharacter('zhou-chef')!.name, profile: 'zhou-chef', kind: 'professional' },
  { id: 'molly', table: 'molly_sessions', suffix: 'molly-system-secretary', name: 'Molly', profile: 'molly-system-secretary', kind: 'functional' },
] as const;
export type MomentActor = typeof momentActors[number];
export type MomentActorId = MomentActor['id'];

export const momentFrequencyPolicy = Object.freeze({
  timezone: 'Asia/Shanghai', maxDaily: 2, minGapMs: 2 * 60 * 60 * 1000,
  maxImages: 9, roundupTypicalDays: [4, 5] as const,
  lifeCheckMinMs: 3 * 60 * 60 * 1000, lifeCheckMaxMs: 6 * 60 * 60 * 1000,
  // Retained as a caller compatibility field, not a calibrated personality score.
  minimumImportance: 0.65,
});

const personalHeading = /^(?:赵一帆|陈年|柳智敏|小满|何嘉伟|夏夏)：/;
const actorHeading: Partial<Record<MomentActorId, string>> = {
  'xia-xia': '夏夏：', 'yuan-xiaoman': '小满：', liu: '柳智敏：',
  'chen-nian': '陈年：', 'he-jiawei': '何嘉伟：', 'zhou-chef': '赵一帆：',
};
function publicStyleFor(source: string, actor: MomentActor): string {
  return source.split(/(?=^## )/m).filter(section => {
    const heading = /^## (.*)$/m.exec(section)?.[1] || '';
    return !personalHeading.test(heading) || heading.startsWith(actorHeading[actor.id] || '\0');
  }).join('');
}

/** Reads the project mirror on each call, so a trained Skill correction is live. */
export function loadMomentRules(root: string, characterId: string, section: 'post' | 'interaction' = 'post'): string {
  const actor = momentActors.find(value => value.id === characterId);
  if (!actor || !['post', 'interaction'].includes(section)) throw new Error('未知朋友圈人物或规则分支');
  const mirror = 'npc-skills/skills/zhiyu-moments';
  const read = (path: string) => readFileSync(join(root, path), 'utf8');
  const chunk = (path: string, content = read(path)) => `【规则来源 ${path}】\n${content}`;
  const skill = read(`${mirror}/SKILL.md`);
  const parts = [
    '【当前朋友圈规则优先级】现行镜像Skill及本人物公开风格覆盖旧档案中的每日四条、普通美食一律不发等旧朋友圈条款。每天最多2条、至少间隔2小时、最多9图；上限不是配额。没有聊天不降低生活分享判断。所有示范、demo日期、联动与台词只解释方向，不是已发生事实，不写入记忆。内部理由、私聊来源和估算依据不进入公开正文或观察者上下文。',
    `【本次独立人物】${JSON.stringify(actor)}`,
    chunk(`${mirror}/SKILL.md`, skill),
  ];
  if (actor.kind !== 'functional') {
    const path = `${mirror}/references/${actor.kind === 'professional' ? 'professional' : 'companion'}-posts.md`;
    parts.push(chunk(path, publicStyleFor(read(path), actor)));
  }
  parts.push(chunk(`${mirror}/references/life-simulation.md`), chunk(`${mirror}/references/contract.md`));
  if (skill.includes('references/runtime-integration.md')) parts.push(chunk(`${mirror}/references/runtime-integration.md`));
  if (section === 'interaction') parts.push(chunk(`${mirror}/references/interactions.md`));
  const persona=readDialoguePersona(root,actor.id==='molly'?'molly-system-secretary':actor.id);
  parts.push(`【统一对话包中的当前独立资料；只属于${actor.name}，示例不升级为事实】\n${JSON.stringify(persona.profile)}\n【本人表达风格；朋友圈正文仍按上方公开规则】\n${persona.style}`);
  if (actor.kind === 'functional') {
    parts.push(`【Molly统一对话Skill；仅本人秘书模式】\n${loadMollyDialogueSkill(root).rules}`,
      'Molly保持机器人与系统秘书身份；不生成肉身生活或私人朋友圈。可基于实际可见公开内容选择点赞或偶尔简短玩笑，不继承其他人物的经历、私聊或恋爱线。');
  }
  return parts.join('\n\n');
}

/** Bounded retrieval from the same three parsed libraries used by ordinary dialogue. */
export function momentProfessionalEvidence(root: string, characterId: string, topic: string): string {
  const path = 'npc-skills/knowledge/professional';
  const read = (name: string) => readFileSync(join(root, path, name), 'utf8');
  if (!['chen-nian', 'zhou-chef', 'liu'].includes(characterId) || !topic.trim())
    return JSON.stringify({ characterId, entries: [] });
  try {
    if (characterId === 'chen-nian') {
      const library = parseChenAcsmFoundation(read(chenAcsmFoundationFile));
      const matches = matchChenAcsmFoundationEntries(library, topic, [], 6);
      const entries = selectChenAcsmFoundationEntries(library, matches.map(entry => entry.id));
      return JSON.stringify({ characterId, version: library.version, coreRules: library.coreRules, entries });
    }
    if (characterId === 'zhou-chef') {
      const library = parseChefFoundationKnowledge(read('chef-foundation-knowledge-20261017.json'));
      const matches = matchChefFoundationKnowledgeEntries(library, topic, [], 6);
      const entries = selectChefFoundationKnowledgeEntries(library, matches.map(entry => entry.id));
      return JSON.stringify({ characterId, version: library.version, coreRules: library.coreRules, entries });
    }
    const library = parseLiuClinicalKnowledge(read('liu-clinical-knowledge-20261015.json'));
    const matches = matchLiuClinicalKnowledgeEntries(library, topic, [], 6);
    const entries = selectLiuClinicalKnowledgeEntries(library, matches.map(entry => entry.id));
    return JSON.stringify({ characterId, version: library.version, coreRules: library.coreRules, entries });
  } catch {
    return JSON.stringify({ characterId, entries: [], error: 'LOCAL_KNOWLEDGE_UNAVAILABLE', instruction: '本轮未取得有效本地专业依据；不凭模型记忆补写技巧或把缺口说成科学界没有证据。' });
  }
}

export type MomentFormat = 'text_only' | 'image_only' | 'text_image';
export type MomentCollaboration = {
  eventId: string; participants: readonly string[]; roles: Readonly<Record<string, string>>;
  occurredAt: string; location: string;
};
export type MomentCalorieEvidence = {
  id: string; items: readonly {
    ingredient: string; edibleGrams: number; state: 'raw' | 'cooked' | 'as_eaten';
    kcalPer100g: number; sourceRef: string;
  }[]; oilSauceIncluded: boolean; totalKcal: number;
};
export type NormalizeTrainedMomentContext = {
  characterId: string; mode?: 'candidate' | 'publish_ready' | 'publish'; now?: number;
  verifiedSourceIds: readonly string[]; requiredSourceId?: string;
  returnPhotoPermissions?: readonly { sourceId: string; allowed: boolean; deidentified: boolean }[];
  collaborationEvents?: readonly MomentCollaboration[];
  calorieEvidence?: readonly MomentCalorieEvidence[];
  /** Host-owned acceptance; a model's media_result/pass is never sufficient. */
  mediaVerifier?: (url: string) => boolean;
};
export type TrainedMomentImageTask = {
  assetKind: 'generated_photo' | 'edit_existing' | 'chat_screenshot';
  count: number; imageBriefs: string[]; event: string;
  withCharacter?: boolean; faceVisibility?: string;
};
export type TrainedMomentInternalContext = {
  npcType: 'professional' | 'companion'; topicKind: string; topic: string; eventSummary: string;
  shareReason: string; formatReason: string; imageCountReason: string; evidenceRefs: string[];
  professionalDetail?: string; returnPhotoSourceIds: string[]; calorieEvidenceId?: string;
  collaboration: MomentCollaboration | null;
  roundup: { coveredFrom: string; coveredTo: string; sourceEventIds: string[]; newContentReason: string } | null;
};
export type NormalizedTrainedMoment = {
  format: MomentFormat; text: string; images: string[]; imageTask: TrainedMomentImageTask | null;
  mediaResult: { accepted: true; verifiedBy: 'host' } | null;
  internalContext: TrainedMomentInternalContext;
};

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.every(nonempty);
const unique = (value: readonly string[]) => new Set(value).size === value.length;
const field = (value: ObjectValue, snake: string, camel: string) => value[snake] ?? value[camel];
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const timestamp = (value: unknown) => nonempty(value) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
const allowedSource = (refs: readonly string[], context: NormalizeTrainedMomentContext) => refs.length > 0
  && unique(refs) && refs.every(ref => context.verifiedSourceIds.includes(ref));

function collaborationFrom(value: unknown, context: NormalizeTrainedMomentContext): MomentCollaboration | null | false {
  if (value == null) return null;
  if (!object(value)) return false;
  const eventId = field(value, 'event_id', 'eventId');
  const event = context.collaborationEvents?.find(item => item.eventId === eventId);
  const occurredAt = field(value, 'occurred_at', 'occurredAt');
  const participants = value.participants, roles = value.roles;
  if (!event || !nonempty(event.eventId) || !context.verifiedSourceIds.includes(event.eventId)
    || !texts(participants) || participants.length < 2 || !unique(participants)
    || !participants.includes(context.characterId) || participants.some(id => !momentActors.some(actor => actor.id === id))
    || participants.length !== event.participants.length || participants.some(id => !event.participants.includes(id))
    || !object(roles) || participants.some(id => !nonempty(roles[id]) || roles[id] !== event.roles[id])
    || !timestamp(occurredAt) || occurredAt !== event.occurredAt || !nonempty(value.location) || value.location !== event.location
    || !finite(context.now) || Date.parse(occurredAt as string) > context.now) return false;
  return { eventId: event.eventId, participants: [...event.participants], roles: { ...event.roles }, occurredAt: event.occurredAt, location: event.location };
}

function calorieEvidenceValid(id: unknown, text: string, context: NormalizeTrainedMomentContext): boolean {
  const matches = [...text.matchAll(/(?:约\s*)?(\d+(?:\.\d+)?)\s*(?:kcal|千卡|大卡)/gi)];
  if (!matches.length && id == null) return true;
  const evidence = context.calorieEvidence?.find(item => item.id === id);
  if (!evidence || !evidence.oilSauceIncluded || !evidence.items.length || !finite(evidence.totalKcal) || evidence.totalKcal <= 0
    || evidence.items.some(item => !nonempty(item.ingredient) || !finite(item.edibleGrams) || item.edibleGrams <= 0
      || !['raw', 'cooked', 'as_eaten'].includes(item.state) || !finite(item.kcalPer100g) || item.kcalPer100g < 0
      || !nonempty(item.sourceRef) || !context.verifiedSourceIds.includes(item.sourceRef))) return false;
  const calculated = evidence.items.reduce((sum, item) => sum + item.edibleGrams * item.kcalPer100g / 100, 0);
  return Math.abs(calculated - evidence.totalKcal) <= Math.max(2, calculated * 0.02)
    && matches.every(match => match[0].startsWith('约') && Math.abs(Number(match[1]) - evidence.totalKcal) <= Math.max(5, evidence.totalKcal * 0.02));
}

/** Pure validation/normalization. Does not mint events, publish, generate media or touch a DB. */
export function normalizeTrainedMoment(raw: unknown, context: NormalizeTrainedMomentContext): NormalizedTrainedMoment | null {
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { return null; } }
  const actor = momentActors.find(item => item.id === context.characterId);
  if (!object(raw) || !actor || actor.kind === 'functional' || !texts(context.verifiedSourceIds)
    || (raw.decision !== undefined && raw.decision !== 'post')
    || (raw.npc_id !== undefined && raw.npc_id !== actor.id)
    || !['candidate', 'publish_ready', 'publish'].includes(context.mode ?? 'candidate')) return null;
  const post = object(raw.post) ? raw.post : raw;
  const inner = field(raw, 'internal_context', 'internalContext');
  const checks = object(raw.checks) ? raw.checks : {};
  if (!object(inner) || (raw.publicSafe !== true && checks.privacy !== 'pass')
    || [checks.privacy, checks.continuity, checks.policy].includes('block')) return null;
  const format = post.format === 'text' ? 'text_only' : post.format;
  const body = post.text;
  if (!['text_only', 'image_only', 'text_image'].includes(format as string) || typeof body !== 'string'
    || body.length > 300 || (format === 'image_only' ? body.trim() !== '' : !body.trim())) return null;
  const npcType = field(inner, 'npc_type', 'npcType') ?? actor.kind;
  const values = ['topic_kind', 'topic', 'event_summary', 'share_reason', 'format_reason', 'image_count_reason']
    .map((key, index) => field(inner, key, ['topicKind', 'topic', 'eventSummary', 'shareReason', 'formatReason', 'imageCountReason'][index]));
  const refs = field(inner, 'evidence_refs', 'evidenceRefs') ?? raw.evidence_refs;
  if (npcType !== actor.kind || values.some(value => !nonempty(value)) || !texts(refs) || !allowedSource(refs, context)
    || (context.requiredSourceId !== undefined && !refs.includes(context.requiredSourceId))) return null;
  const [topicKind, topic, eventSummary, shareReason, formatReason, imageCountReason] = values as string[];
  const images: string[] = [];
  let imageTask: TrainedMomentImageTask | null = null;
  const media = post.media ?? post.images ?? [];
  if (!Array.isArray(media)) return null;
  for (const item of media) {
    const url = typeof item === 'string' ? item : object(item) ? item.url ?? item.path : null;
    if (!nonempty(url) || url.length > 4096 || /^data:/i.test(url)) return null;
    images.push(url);
  }
  if (images.length > momentFrequencyPolicy.maxImages || !unique(images)) return null;
  const task = field(post, 'image_task', 'imageTask');
  if (format === 'text_only') {
    if (images.length || task != null) return null;
  } else {
    if (!object(task)) return null;
    const assetKind = field(task, 'asset_kind', 'assetKind'), briefs = field(task, 'image_briefs', 'imageBriefs');
    if (!['generated_photo', 'edit_existing', 'chat_screenshot'].includes(assetKind as string)
      || !Number.isInteger(task.count) || (task.count as number) < 1 || (task.count as number) > momentFrequencyPolicy.maxImages
      || !texts(briefs) || briefs.length !== task.count || !nonempty(task.event)
      || (images.length > 0 && images.length !== task.count)) return null;
    const withCharacter = field(task, 'with_character', 'withCharacter'), faceVisibility = field(task, 'face_visibility', 'faceVisibility');
    if ((withCharacter !== undefined && typeof withCharacter !== 'boolean') || (faceVisibility !== undefined && !nonempty(faceVisibility))) return null;
    imageTask = { assetKind: assetKind as TrainedMomentImageTask['assetKind'], count: task.count as number, imageBriefs: [...briefs], event: task.event,
      ...(typeof withCharacter === 'boolean' ? { withCharacter } : {}), ...(nonempty(faceVisibility) ? { faceVisibility } : {}) };
  }
  let mediaResult: NormalizedTrainedMoment['mediaResult'] = null;
  if (format !== 'text_only' && context.mode !== undefined && context.mode !== 'candidate') {
    if (!imageTask || images.length !== imageTask.count || !context.mediaVerifier) return null;
    try { if (!images.every(url => context.mediaVerifier!(url) === true)) return null; } catch { return null; }
    mediaResult = { accepted: true, verifiedBy: 'host' };
  }
  const returnIds = field(inner, 'return_photo_source_ids', 'returnPhotoSourceIds') ?? [];
  if (!texts(returnIds) || !unique(returnIds) || returnIds.some(id => !refs.includes(id)
    || !context.returnPhotoPermissions?.some(item => item.sourceId === id && item.allowed === true && item.deidentified === true))) return null;
  if (topicKind === 'learner_feedback' && format !== 'text_only' && returnIds.length === 0) return null;
  // Host-labelled return-photo sources cannot be disguised by changing a model topic name.
  if (format !== 'text_only' && refs.some(id => context.returnPhotoPermissions?.some(item => item.sourceId === id) && !returnIds.includes(id))) return null;
  const calorieId = field(inner, 'calorie_evidence_id', 'calorieEvidenceId');
  if (!calorieEvidenceValid(calorieId, body, context)) return null;
  const collaboration = collaborationFrom(inner.collaboration, context);
  if (collaboration === false || (topicKind === 'collaboration' && !collaboration)
    || (collaboration && !refs.includes(collaboration.eventId))) return null;
  let roundup: TrainedMomentInternalContext['roundup'] = null;
  if (inner.roundup != null) {
    if (!object(inner.roundup)) return null;
    const value = inner.roundup, from = field(value, 'covered_from', 'coveredFrom'), to = field(value, 'covered_to', 'coveredTo');
    const ids = field(value, 'source_event_ids', 'sourceEventIds'), reason = field(value, 'new_content_reason', 'newContentReason');
    if (!timestamp(from) || !timestamp(to) || Date.parse(from as string) > Date.parse(to as string)
      || !finite(context.now) || Date.parse(to as string) > context.now || !texts(ids) || !allowedSource(ids, context)
      || ids.some(id => !refs.includes(id)) || !nonempty(reason)) return null;
    roundup = { coveredFrom: from as string, coveredTo: to as string, sourceEventIds: [...ids], newContentReason: reason };
  }
  if (topicKind === 'roundup' && !roundup) return null;
  const professionalDetail = field(inner, 'professional_detail', 'professionalDetail');
  return {
    format: format as MomentFormat, text: format === 'image_only' ? '' : body.trim(), images, imageTask, mediaResult,
    internalContext: { npcType: actor.kind, topicKind, topic, eventSummary, shareReason, formatReason, imageCountReason, evidenceRefs: [...refs],
      ...(nonempty(professionalDetail) ? { professionalDetail } : {}), returnPhotoSourceIds: [...returnIds],
      ...(nonempty(calorieId) ? { calorieEvidenceId: calorieId } : {}), collaboration, roundup },
  };
}
