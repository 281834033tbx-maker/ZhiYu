import { secretaryDelegationInputFromPrompt } from '../../lib/npc/secretary-delegation';
/** Liu-only clinical nutrition foundation; source scope is part of every retrieved record. */
export type LiuClinicalSource = {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly publisher: string;
  readonly publishedAt: string | null;
  readonly reviewedAt: string;
  readonly accessLevel: 'full_text' | 'official_summary' | 'catalog_only';
  readonly locator: string;
  readonly supports: string;
  readonly limitations: readonly string[];
};
export type LiuClinicalEntry = {
  readonly id: string;
  readonly title: string;
  readonly topics: readonly string[];
  readonly category: string;
  readonly summary: string;
  readonly rules: readonly string[];
  readonly conditions: readonly string[];
  readonly redFlags: readonly string[];
  readonly sourceIds: readonly string[];
  readonly evidenceBasis: 'guideline_summary' | 'assistant_synthesis';
  readonly limitations: readonly string[];
  /** Resolved from this exact source snapshot, never trusted from raw entry fields. */
  readonly sources: readonly LiuClinicalSource[];
};
export type LiuClinicalLibrary = {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly characterId: 'liu';
  readonly status: 'user_authorized_clinical_nutrition_foundation';
  readonly coverage: {
    readonly complete: false;
    readonly clinicallyValidated: false;
    readonly textbookFullTextImported: false;
    readonly entryCount: number;
    readonly sourceCount: number;
  };
  readonly coreRules: readonly string[];
  readonly sources: readonly LiuClinicalSource[];
  readonly entries: readonly LiuClinicalEntry[];
};
export class LiuClinicalKnowledgeError extends Error {
  constructor(message: string, readonly code: 'LIU_CLINICAL_KNOWLEDGE_INVALID' | 'LIU_CLINICAL_SELECTION_INVALID') {
    super(message); this.name = 'LiuClinicalKnowledgeError';
  }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const id = (value: unknown): value is string => text(value) && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const unique = (value: unknown): value is string[] => strings(value) && new Set(value).size === value.length;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const https = (value: unknown): value is string => {
  if (!text(value)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password; }
  catch { return false; }
};
function requireValid(condition: unknown, message: string): asserts condition {
  if (!condition) throw new LiuClinicalKnowledgeError(message, 'LIU_CLINICAL_KNOWLEDGE_INVALID');
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

export function parseLiuClinicalKnowledge(raw: string): LiuClinicalLibrary {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new LiuClinicalKnowledgeError('柳智敏临床营养基础库不是有效JSON', 'LIU_CLINICAL_KNOWLEDGE_INVALID'); }
  requireValid(object(value) && value.schemaVersion === 1 && text(value.version) && value.characterId === 'liu'
    && value.status === 'user_authorized_clinical_nutrition_foundation', '柳智敏营养库身份、版本或授权状态无效');
  const coverage = value.coverage;
  requireValid(object(coverage) && coverage.complete === false && coverage.clinicallyValidated === false
    && coverage.textbookFullTextImported === false && count(coverage.entryCount) && count(coverage.sourceCount),
  '柳智敏营养库不能误标为全量教材、完整学科或临床验证');
  requireValid(unique(value.coreRules) && value.coreRules.length > 0 && Array.isArray(value.sources) && value.sources.length > 0
    && Array.isArray(value.entries) && value.entries.length > 0, '柳智敏营养库缺少常驻规则、来源或条目');
  const sourceIds = new Set<string>();
  const sources: LiuClinicalSource[] = value.sources.map(source => {
    requireValid(object(source) && id(source.id) && !sourceIds.has(source.id) && text(source.title) && https(source.url)
      && text(source.publisher) && (source.publishedAt === null || text(source.publishedAt)) && text(source.reviewedAt)
      && ['full_text', 'official_summary', 'catalog_only'].includes(source.accessLevel as string)
      && text(source.locator) && text(source.supports) && strings(source.limitations) && source.limitations.length > 0,
    '柳智敏营养库来源重复、缺少定位/范围/限制或字段无效');
    sourceIds.add(source.id);
    return { id: source.id, title: source.title, url: source.url, publisher: source.publisher, publishedAt: source.publishedAt,
      reviewedAt: source.reviewedAt, accessLevel: source.accessLevel as LiuClinicalSource['accessLevel'], locator: source.locator,
      supports: source.supports, limitations: [...source.limitations] };
  });
  const sourceMap = new Map(sources.map(source => [source.id, source]));
  const entryIds = new Set<string>();
  const entries: LiuClinicalEntry[] = value.entries.map(entry => {
    requireValid(object(entry) && id(entry.id) && !entryIds.has(entry.id) && text(entry.title) && unique(entry.topics)
      && entry.topics.length > 0 && text(entry.category) && text(entry.summary) && strings(entry.rules) && entry.rules.length > 0
      && strings(entry.conditions) && entry.conditions.length > 0 && strings(entry.redFlags) && unique(entry.sourceIds)
      && entry.sourceIds.length > 0 && entry.sourceIds.every(sourceId => sourceMap.has(sourceId))
      && ['guideline_summary', 'assistant_synthesis'].includes(entry.evidenceBasis as string)
      && strings(entry.limitations) && entry.limitations.length > 0,
    '柳智敏营养条目重复、缺少适用条件/限制或引用不存在');
    entryIds.add(entry.id);
    const refs = entry.sourceIds.map(sourceId => sourceMap.get(sourceId)!);
    requireValid(refs.every(source => source.accessLevel !== 'catalog_only'), `柳智敏条目 ${entry.id} 不能用书目目录证明临床建议`);
    return { id: entry.id, title: entry.title, topics: [...entry.topics], category: entry.category, summary: entry.summary,
      rules: [...entry.rules], conditions: [...entry.conditions], redFlags: [...entry.redFlags], sourceIds: [...entry.sourceIds],
      evidenceBasis: entry.evidenceBasis as LiuClinicalEntry['evidenceBasis'], limitations: [...entry.limitations], sources: refs };
  });
  requireValid(entries.length === coverage.entryCount && sources.length === coverage.sourceCount, '柳智敏营养库统计与实际内容不一致');
  return freeze({ schemaVersion: 1, version: value.version, characterId: 'liu', status: 'user_authorized_clinical_nutrition_foundation',
    coverage: { complete: false, clinicallyValidated: false, textbookFullTextImported: false, entryCount: entries.length, sourceCount: sources.length },
    coreRules: [...value.coreRules], sources, entries });
}

export function selectLiuClinicalKnowledgeEntries(library: LiuClinicalLibrary, ids: unknown): readonly LiuClinicalEntry[] {
  if (ids === undefined) return Object.freeze([]);
  if (!Array.isArray(ids) || ids.length > 6 || new Set(ids).size !== ids.length
    || ids.some(value => typeof value !== 'string' || !library.entries.some(entry => entry.id === value))) {
    throw new LiuClinicalKnowledgeError('柳智敏临床营养检索结果无效', 'LIU_CLINICAL_SELECTION_INVALID');
  }
  return Object.freeze(ids.map(value => library.entries.find(entry => entry.id === value)!));
}

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
// Search aliases only: oral descriptions retrieve relevant precautions, never
// diagnose the cause or turn a cue into an individual treatment prescription.
function searchText(value: string): string {
  const input = normalize(value);
  const duration = '(?:[一二三四五六七八九十两\\d]+|多|几)天';
  const littleFood = '(?:没吃|未进食|没进食|没有进食|不吃|只喝水|几乎.{0,4}(?:没|未|不).{0,3}(?:吃|进食)|(?:每天|每日|一天)?只吃.{0,6}(?:口|一点|一些))';
  const lowIntake = new RegExp(duration + '.{0,20}' + littleFood + '|' + littleFood + '.{0,20}' + duration).test(input);
  const airway = /喘不过气|喘不上气|呼吸不了|不能呼吸|呼吸不上来|呼吸困难|喉咙.{0,4}(?:紧|肿)|嗓子.{0,4}(?:紧|肿)|嘴唇.{0,4}(?:肿|发紫)/.test(input);
  const aliases = [lowIntake ? '几天没吃 营养评估 再喂养' : '', airway ? '呼吸困难 食物过敏' : ''];
  // Single-character nutrients need nearby intake/supplement wording. Avoid
  // lexical collisions such as 铁路/铁锅、盐系、糖葫芦 or ordinary cartoon talk.
  if (!/盐系|盐城|盐湖/.test(input) && /(?:吃|摄入|加|放|少|减|控|限).{0,5}盐|盐.{0,8}(?:多少|几克|摄入|限量|合适)/.test(input)) aliases.push('食盐 减盐');
  if (!/钠灯/.test(input) && /钠.{0,8}(?:每天|多少|几克|摄入|限量|合适)|(?:摄入|补|控|限|低|高).{0,5}钠/.test(input)) aliases.push('钠摄入 减盐');
  if (!/铁路|高铁|地铁|铁锅|铁板|铁人|铁拳|铁塔|铁门|钢铁/.test(input) && /铁.{0,6}(?:怎么补|如何补|要补|需要补|多少|几克|几毫克|摄入|缺不缺)|(?:补|缺|摄入).{0,3}铁/.test(input)) aliases.push('补铁');
  if (!/糖葫芦|糖豆人|糖果屋|糖衣炮弹/.test(input) && /糖.{0,6}(?:摄入|多少|几克|每天|每日|限量|合适)|(?:摄入|控|减|戒|限).{0,3}糖/.test(input)) aliases.push('添加糖');
  return input + (aliases.some(Boolean) ? '\n' + aliases.filter(Boolean).join(' ') : '');
}
const nutritionTopic = /营养|饮食|吃|喝|餐|食|补剂|补充剂|蛋白|脂肪|碳水|热量|能量|维生素|矿物质|血糖|糖尿病|血压|血脂|肾|肝|胰腺|透析|痛风|尿酸|肿瘤|癌|贫血|吞咽|腹泻|便秘|呕吐|过敏|孕|哺乳|婴幼|儿童|老人|老年|骨质|减肥|减脂|增重|厌食|再喂养|脱水|乳糖|牛奶|奶粉|素食|diet|nutrition|protein|diabetes|kidney|refeeding/i;
const followupTopic = /^(?:(?:那|所以)?(?:我|这|这个|这种|这样)?(?:该|应该|要|还能)?(?:怎么办|怎么做|怎么安排|可以吗|需要吗|多少|为什么|继续)|好的|好呀|行)[？?。！!，,\s]*$/;
const subjectChange = /换个话题|不聊这个|先不说这个|不说吃的|不聊营养|说点别的|聊别的/;
const riskTerms = /再喂养|糖尿病|血糖|血钾|高钾|低钾|肾|透析|胰岛素|过敏|吞咽|误吸|脱水|急性|呕吐|厌食|进食障碍|肝硬化|心衰|孕|婴|儿童|儿科|refeeding|kidney|allergy/i;

/** A clinical question still needs core-rule review when no library entry covers it. */
export function isLiuClinicalQuestion(current: string, recent: readonly string[] = []): boolean {
  const changedSubject = subjectChange.test(current);
  const input = searchText(current.replace(subjectChange, ''));
  if (!input) return false;
  if (nutritionTopic.test(input)) return true;
  if (changedSubject) return false;
  if (!followupTopic.test(input)) return false;
  for (const previous of recent.slice(-8).reverse()) {
    const item = searchText(previous);
    if (!item || subjectChange.test(item)) return false;
    if (nutritionTopic.test(item)) return true;
    if (!followupTopic.test(item)) return false;
  }
  return false;
}
function containsTerm(input: string, topic: string): boolean {
  const term = normalize(topic);
  if (term.length < 2) {
    const contextual: Record<string, RegExp> = { 盐: /食盐|减盐/, 钠: /钠摄入/, 铁: /补铁|缺铁/, 糖: /添加糖|游离糖|糖摄入/, 汤: /喝汤|汤类/ };
    return contextual[term]?.test(input) || false;
  }
  if (/^[a-z0-9_-]+$/.test(term)) return new RegExp('(^|[^a-z0-9])' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])').test(input);
  return input.includes(term);
}
/** Context helps only an ongoing nutrition question; unrelated user turns end the topical window. */
export function matchLiuClinicalKnowledgeEntries(library: LiuClinicalLibrary, current: string, recent: readonly string[] = [], max = 6): readonly LiuClinicalEntry[] {
  if (typeof current !== 'string' || !Array.isArray(recent) || recent.some(item => typeof item !== 'string')
    || !Number.isSafeInteger(max) || max < 0 || max > 6) {
    throw new LiuClinicalKnowledgeError('柳智敏营养检索主题、上下文或数量无效', 'LIU_CLINICAL_SELECTION_INVALID');
  }
  const changedSubject = subjectChange.test(current);
  const input = searchText(current.replace(subjectChange, ''));
  if (!input) return Object.freeze([]);
  const history: string[] = [];
  for (const previous of (changedSubject ? [] : recent.slice(-8)).reverse()) {
    const item = searchText(previous);
    if (!item || subjectChange.test(item)) break;
    if (!nutritionTopic.test(item) && !followupTopic.test(item)) break;
    history.unshift(item);
  }
  // A short pronoun follow-up may inherit the focused nutrition topic. Pure
  // social chat must not activate an old disease merely because it is in history.
  const explicit = library.entries.some(entry => entry.topics.some(topic => containsTerm(input, topic)));
  if (!explicit && !nutritionTopic.test(input) && !(followupTopic.test(input) && history.some(item => nutritionTopic.test(item)))) return Object.freeze([]);
  const prior = history.join('\n');
  const rows = library.entries.map((entry, index) => {
    const direct = entry.topics.filter(topic => containsTerm(input, topic));
    const inherited = entry.topics.filter(topic => containsTerm(prior, topic));
    const risk = [...direct, ...inherited].some(topic => riskTerms.test(topic));
    return { entry, index, risk, urgent: direct.length > 0 && entry.category === 'urgent_safety', score: direct.reduce((sum, topic) => sum + Math.min(topic.length, 12) * 8, 0)
      + inherited.reduce((sum, topic) => sum + Math.min(topic.length, 12) * 2, 0) };
  }).filter(row => row.score > 0);
  // Match risk constraints before generic meal examples when several conditions
  // compete for the bounded prompt. Core safety rules remain resident as well.
  return Object.freeze(rows.sort((a, b) => Number(b.urgent) - Number(a.urgent) || Number(b.risk) - Number(a.risk) || b.score - a.score || a.index - b.index)
    .slice(0, max).map(row => row.entry));
}

function messageText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!object(value)) return '';
  if (typeof value.text === 'string') return value.text;
  if (object(value.part) && typeof value.part.text === 'string') return value.part.text;
  return '';
}
/** Only application-owned current/history JSON lines; never search global memory or other roles. */
export function liuClinicalInputFromPrompt(prompt: string): { current: string; recent: string[] } {
  const lines = prompt.split('\n');
  const currentLine = lines.find(line => /^【(?:本轮用户消息|本轮输入|当前收到的消息)/.test(line));
  const historyLine = lines.find(line => /^【(?:有效聊天历史|真实历史)】/.test(line));
  let current = ''; let recent: string[] = [];
  try { if (currentLine) current = messageText(JSON.parse(currentLine.slice(currentLine.indexOf('】') + 1))); }
  catch { /* Invalid/unstructured input is not a trusted retrieval query. */ }
  const delegated = secretaryDelegationInputFromPrompt(prompt);
  if (!current && delegated?.targetId === 'liu') current = `${delegated.text}\n${delegated.goal}`;
  try {
    if (historyLine) {
      const history: unknown = JSON.parse(historyLine.slice(historyLine.indexOf('】') + 1));
      if (Array.isArray(history)) recent = history.slice(-20).filter(item => object(item) && item.role === 'user'
        && item.chronologyUnknown !== true).map(messageText).filter(Boolean).slice(-8);
    }
  } catch { /* Never promote malformed history or system/NPC messages. */ }
  return { current, recent };
}

export const liuClinicalKnowledgeMarker = '【柳智敏本轮临床营养基础知识；来源范围、条件、风险与限制保留】';
export const liuClinicalKnowledgeRules = '本知识库只属于柳智敏，是临床营养基础版，不等于完整临床营养学、已导入教材全文、临床审校或医师资格。按当前真实用户条件使用条目，假设、引文、来源与旧聊天不自动成为健康史。sources的accessLevel、locator、supports、limitations限制可作出的结论；full_text只表示读到相关正文，不宣称通读整部指南，official_summary不能充作完整原文，catalog_only仅证书目信息。guideline_summary与assistant_synthesis分别是指南归纳与适配整理，不冒称教材原句、页码或现实个人原话。多病、年龄/妊娠、用药、营养不良、过敏与器官功能同时考虑，不能机械叠加互相冲突的单病饮食；关键条件缺失时短问或给条件分支。能量、蛋白、水、电解质、补剂和营养支持均需适用条件、单位及必要监测，不把一般参考变成个体处方，不建议自行停药调药或实施肠外/管饲治疗。明显急症、吞咽/误吸风险、严重低摄入或再喂养风险按常驻规则及条目及时升级处理，不能为短答省掉。后台来源用于追溯，平时按本人原口吻直接讲知识，必要时可如实解释已核书籍依据，不主动罗列后台标记、真人博主或个人视频。知识库不授予观察、检查、诊断、计时、发送、医学治疗或任何新工具能力。';
export function liuClinicalKnowledgeContext(entries: readonly LiuClinicalEntry[]): string {
  return '\n' + liuClinicalKnowledgeMarker + JSON.stringify(entries) + '\n' + liuClinicalKnowledgeRules;
}
