import { secretaryDelegationInputFromPrompt } from '../../lib/npc/secretary-delegation';
/** Zhao Yifan's local cooking foundation. This module performs no I/O or network lookup. */
export type ChefFoundationSource = {
  readonly id: string; readonly title: string; readonly url: string;
  readonly readStatus: 'full_text' | 'partial_text' | 'catalog_only';
  readonly reviewedAt: string; readonly localEvidencePath: string; readonly supports: string | readonly string[];
  readonly limitations: readonly string[];
};
export type ChefFoundationEntry = {
  readonly id: string; readonly title: string; readonly topics: readonly string[];
  readonly category: 'ratio' | 'ingredient' | 'heat' | 'scaling' | 'troubleshooting' | 'recipe' | 'storage';
  readonly summary: string; readonly rules: readonly string[]; readonly conditions: readonly string[];
  readonly sourceIds: readonly string[];
  readonly evidenceBasis: 'source_summary' | 'cross_source_synthesis' | 'assistant_adaptation';
  readonly limitations: readonly string[];
  /** Always resolved from the same parsed source snapshot, never trusted from raw entries. */
  readonly sources: readonly ChefFoundationSource[];
};
export type ChefFoundationLibrary = {
  readonly schemaVersion: 1; readonly version: string; readonly characterId: 'zhou-chef';
  readonly status: 'user_authorized_cooking_foundation';
  readonly coverage: { readonly complete: false; readonly kitchenTested: false; readonly noviceReplicated: false;
    readonly entryCount: number; readonly sourceCount: number };
  readonly coreRules: readonly string[]; readonly sources: readonly ChefFoundationSource[];
  readonly entries: readonly ChefFoundationEntry[];
};
export class ChefFoundationKnowledgeError extends Error {
  constructor(message: string, readonly code: 'CHEF_FOUNDATION_KNOWLEDGE_INVALID' | 'CHEF_FOUNDATION_SELECTION_INVALID') {
    super(message); this.name = 'ChefFoundationKnowledgeError';
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
const evidencePath = (value: unknown): value is string => text(value)
  && value.startsWith('output/chef-local-foundation-20261017/') && !value.includes('\\') && !value.includes('\u0000')
  && value.split('/').every(part => !!part && part !== '.' && part !== '..') && /\.(?:md|txt|json|html)$/.test(value);
function requireValid(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ChefFoundationKnowledgeError(message, 'CHEF_FOUNDATION_KNOWLEDGE_INVALID');
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function parseChefFoundationKnowledge(raw: string): ChefFoundationLibrary {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new ChefFoundationKnowledgeError('赵一帆烹饪基础库不是有效JSON', 'CHEF_FOUNDATION_KNOWLEDGE_INVALID'); }
  requireValid(object(value) && value.schemaVersion === 1 && text(value.version) && value.characterId === 'zhou-chef'
    && value.status === 'user_authorized_cooking_foundation', '赵一帆烹饪基础库身份、版本或授权状态无效');
  const coverage = value.coverage;
  requireValid(object(coverage) && coverage.complete === false && coverage.kitchenTested === false
    && coverage.noviceReplicated === false && count(coverage.entryCount) && count(coverage.sourceCount),
  '赵一帆烹饪基础库不能误标为完整学科、厨房实做或新手验证');
  requireValid(unique(value.coreRules) && value.coreRules.length > 0 && Array.isArray(value.sources) && value.sources.length > 0
    && Array.isArray(value.entries) && value.entries.length > 0, '赵一帆烹饪基础库缺少常驻规则、来源或条目');
  const sourceIds = new Set<string>();
  const sources: ChefFoundationSource[] = value.sources.map(source => {
    requireValid(object(source) && id(source.id) && !sourceIds.has(source.id) && text(source.title) && https(source.url)
      && ['full_text', 'partial_text', 'catalog_only'].includes(source.readStatus as string)
      && text(source.reviewedAt) && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(source.reviewedAt)
      && evidencePath(source.localEvidencePath) && (text(source.supports) || (strings(source.supports) && source.supports.length > 0)) && strings(source.limitations) && source.limitations.length > 0,
    '赵一帆烹饪来源重复、缺少本地存证/范围/限制或字段无效');
    sourceIds.add(source.id);
    return { id: source.id, title: source.title, url: source.url, readStatus: source.readStatus as ChefFoundationSource['readStatus'],
      reviewedAt: source.reviewedAt, localEvidencePath: source.localEvidencePath, supports: typeof source.supports === 'string' ? source.supports : [...source.supports], limitations: [...source.limitations] };
  });
  const sourceMap = new Map(sources.map(source => [source.id, source]));
  const entryIds = new Set<string>();
  const entries: ChefFoundationEntry[] = value.entries.map(entry => {
    requireValid(object(entry) && id(entry.id) && !entryIds.has(entry.id) && text(entry.title) && unique(entry.topics)
      && entry.topics.length > 0 && ['ratio', 'ingredient', 'heat', 'scaling', 'troubleshooting', 'recipe', 'storage'].includes(entry.category as string)
      && text(entry.summary) && strings(entry.rules) && entry.rules.length > 0 && strings(entry.conditions) && entry.conditions.length > 0
      && unique(entry.sourceIds) && entry.sourceIds.length > 0 && entry.sourceIds.every(sourceId => sourceMap.has(sourceId))
      && ['source_summary', 'cross_source_synthesis', 'assistant_adaptation'].includes(entry.evidenceBasis as string)
      && strings(entry.limitations) && entry.limitations.length > 0,
    '赵一帆烹饪条目重复、缺少条件/限制、类别无效或引用不存在');
    entryIds.add(entry.id);
    const refs = entry.sourceIds.map(sourceId => sourceMap.get(sourceId)!);
    requireValid(refs.every(source => source.readStatus !== 'catalog_only'), `赵一帆条目 ${entry.id} 不能用书目目录支撑教学`);
    return { id: entry.id, title: entry.title, topics: [...entry.topics], category: entry.category as ChefFoundationEntry['category'],
      summary: entry.summary, rules: [...entry.rules], conditions: [...entry.conditions], sourceIds: [...entry.sourceIds],
      evidenceBasis: entry.evidenceBasis as ChefFoundationEntry['evidenceBasis'], limitations: [...entry.limitations], sources: refs };
  });
  requireValid(entries.length === coverage.entryCount && sources.length === coverage.sourceCount, '赵一帆烹饪基础库统计与实际内容不一致');
  return freeze({ schemaVersion: 1, version: value.version, characterId: 'zhou-chef', status: 'user_authorized_cooking_foundation',
    coverage: { complete: false, kitchenTested: false, noviceReplicated: false, entryCount: entries.length, sourceCount: sources.length },
    coreRules: [...value.coreRules], sources, entries });
}
export function selectChefFoundationKnowledgeEntries(library: ChefFoundationLibrary, ids: unknown): readonly ChefFoundationEntry[] {
  if (ids === undefined) return Object.freeze([]);
  if (!Array.isArray(ids) || ids.length > 6 || new Set(ids).size !== ids.length
    || ids.some(value => typeof value !== 'string' || !library.entries.some(entry => entry.id === value)))
    throw new ChefFoundationKnowledgeError('赵一帆烹饪基础检索结果无效', 'CHEF_FOUNDATION_SELECTION_INVALID');
  return Object.freeze(ids.map(value => library.entries.find(entry => entry.id === value)!));
}
const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
const weightAmount = /[0-9]+(?:\.[0-9]+)?\s*(?:千克|公斤|克|kg\b|g\b|斤|两)/i;
function ingredientAmountChange(input: string): boolean {
  return /(?:调料|配料|食材|肉|鱼|蛋|面粉|盐|糖|醋|酱油|生抽)/.test(input)
    && (/(?:翻|加|双|两|三|四|五|十|[0-9]+(?:\.[0-9]+)?)倍|乘\s*[0-9]|(?:调料|配料).{0,5}怎么算/.test(input)
      || (weightAmount.test(input) && /原来|原方|现在|改成|换成|从|增加|减少/.test(input)));
}
function searchText(value: string): string {
  const input = normalize(value); const aliases: string[] = [];
  if (/几勺|一勺|两勺|汤匙|茶匙|克数|多少克|称重|电子秤|量杯|(?:用|放|加).{0,4}多少|配比|比例/.test(input)) aliases.push('配比 用量 重量 称量');
  if (ingredientAmountChange(input) || /翻倍|加倍|双倍|四人份|多人份|份量|分量|放大|缩小|做多|做少/.test(input)) aliases.push('份量 缩放 放大 缩小');
  if (/塞满|装满|太挤|锅里挤|一大锅|分批|出水|出很多水|炒不干/.test(input)) aliases.push('分批 出水 锅容量');
  if (/冰冻|冻着|里面有冰|冻肉|冻鱼|冷冻|解冻/.test(input)) aliases.push('解冻 鲜冻');
  if (/粉水(?:比|比例)?/.test(input)) aliases.push('水淀粉 勾芡 比例');
  if (/夹生|还硬|不软|没熟|外焦里生/.test(input)) aliases.push('夹生 熟度 补救');
  if (/烧焦|糊底|焦苦|焦了|汤快干|快烧干|炖干/.test(input)) aliases.push('焦苦 收汁 补救');
  if (/水油分离|油水分离|酱分离|油浮|乳化/.test(input)) aliases.push('乳化 破乳');
  if (/大模具|小模具|模具|几寸|八寸|六寸|圆模|方模/.test(input)) aliases.push('模具 面积 缩放');
  return input + (aliases.length ? '\n' + aliases.join(' ') : '');
}
// Use compounds here: single 炒/面 can mean stocks, hype or a movie frame.
// Exact specific entry topics remain available independently of this cue list.
const cookingTopic = /汤匙|茶匙|量勺|粉水|水淀粉|淀粉|勾芡|调料|配料|肉丝|肉片|番茄|西红柿|烹饪|做菜|做饭|炒菜|炒肉|煎肉|炸物|蒸鱼|炖肉|煮饭|煮面|烤箱|烤肉|烤饼|收汁|食材|调味|腌制|牛肉|猪肉|鸡肉|鱼肉|鸡蛋|蛋液|蛋白|蛋黄|炒蛋|面粉|面团|面包|面条|意面|和面|揉面|加水|米饭|甜品|甜点|烘焙|蛋糕|泡芙|巧克力|酱汁|奶油|黄油|发酵|模具|配料|ingredient|recipe|bake|cook|sauce|bread|(?:炒|煎|炸|蒸|煮|炖|烤).{0,3}(?:熟|糊|焦|干|软|烂|嫩|硬|透)/i;
const cookingCue = (input: string) => cookingTopic.test(input) || ingredientAmountChange(input);
const followupTopic = /^(?:那|所以|这个|这种|这样|它|刚才|现在|换成|换了|改成|还|再|继续|怎么办|怎么调整|怎么救)/;
// These topics say what to do with the ongoing subject, not which food or
// technique the subject is. They must not crowd the specific prior subject out.
const genericTopics = new Set(['怎么办', '为什么', '怎么做', '可以吗', '需要吗', '继续', '多少',
  '补救', '救场', '翻车', '失败', '调整', '处理', '用量', '配比', '比例', '配方', '做法', '克数',
  '份量', '分量', '重量', '时间', '多久', '翻倍', '加倍', '双倍', '放大', '缩小', '减半', '一半',
  '两人份', '四人份', '小份', '换算', '计算', '替代', '规格', '厚度', '温度', '毫升', '称重']);
const genericIntent = /救|补救|救场|挽回|用量|多少|几克|几勺|毫升|比例|配比|配方|做法|调整|处理|继续|怎么办|怎么做|怎么算|多久|多长|要不要|可不可以|能不能|可以|为什么|换成|改成|加倍|翻倍|减半|乘\s*[0-9]/;
const continuationWords = /可不可以|能不能|有没有|要不要|会不会|是不是|还可以|还需要|还要|还能|这个|这种|这样|刚才|现在|所以|到底|具体|大概|一共|总共|应该|需要|多少|怎么|怎样|如何|为什么|什么|一下|一点|一些|一半|翻倍|加倍|双倍|减半|继续|补救|救场|救回来|挽回|调整|处理|做法|配方|用量|配比|比例|克数|份量|分量|重量|时间|多久|多长|几克|几勺|毫升|分钟|计算|换成|回来|好的|好呀|加|放|用|救|补|算|做|办|要|能|可|以|还|再|那|这|它|我|先|就|都|吗|呢|呀|啊|吧|了|的|点|得|不|有|没|量|行|原来|原方|原先|改成|改|换到|变成|从|到|也|乘|除|千克|公斤|克|kg\b|g\b|斤|两|[.×*÷/]|[0-9一二三四五六七八九十两半]+|[？?。！!，,、：:;；\s]/g;
function shortGenericContinuation(value: string): boolean {
  const input = normalize(value);
  return input.length <= 100 && (genericIntent.test(input) || (weightAmount.test(input) && /改|换|从/.test(input))
    || /^(?:好的|好呀|行)[。！!\s]*$/.test(input))
    && input.replace(continuationWords, '') === '';
}
const subjectChange = /换个话题|不聊这个|先不说这个|不说做饭|不聊做菜|说点别的|聊别的/;
function containsTerm(input: string, topic: string): boolean {
  const term = normalize(topic);
  if (term.length < 2) {
    const contextual: Record<string, RegExp> = { 塌: /塌(?:了|掉|陷|下|回|得|不)|塌$/, 湿: /太湿|很湿|湿芯|还湿/ };
    return contextual[term]?.test(input) || false;
  }
  if (/^[a-z0-9_-]+$/.test(term)) return new RegExp('(^|[^a-z0-9])' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])').test(input);
  return input.includes(term);
}
/** Bounded deterministic local lookup; a current match always outranks inherited context. */
export function matchChefFoundationKnowledgeEntries(library: ChefFoundationLibrary, current: string, recent: readonly string[] = [], max = 6): readonly ChefFoundationEntry[] {
  if (typeof current !== 'string' || !Array.isArray(recent) || recent.some(item => typeof item !== 'string')
    || !Number.isSafeInteger(max) || max < 0 || max > 6)
    throw new ChefFoundationKnowledgeError('赵一帆烹饪检索主题、上下文或数量无效', 'CHEF_FOUNDATION_SELECTION_INVALID');
  const changed = subjectChange.test(current); const plain = normalize(current.replace(subjectChange, ''));
  let input = searchText(plain);
  if (!input || !max) return Object.freeze([]);
  const specificMatch = (item: string) => library.entries.some(entry => entry.topics.some(topic => !genericTopics.has(normalize(topic)) && containsTerm(item, topic)));
  const explicit = specificMatch(input);
  // A natural short continuation can omit the dish, as in asking whether it
  // can be rescued or how much to add. Unconsumed nouns end that inheritance.
  const genericFollowup = shortGenericContinuation(plain);
  const newDish = /(?:换|改)做|(?:现在|接下来|这次).{0,5}(?:想做|要做|做)|想做/.test(current);
  const followup = !changed && !newDish && (genericFollowup
    || (followupTopic.test(plain) && (cookingCue(plain) || explicit)));
  if (!explicit && !cookingCue(plain) && !followup) return Object.freeze([]);
  const history: string[] = [];
  if (followup) for (const previous of recent.slice(-8).reverse()) {
    const item = normalize(previous); const expanded = searchText(item);
    if (!item || subjectChange.test(item) || (!cookingCue(item) && !specificMatch(expanded) && !shortGenericContinuation(item))) break;
    history.unshift(expanded);
  }
  const prior = history.join('\n');
  const hasPriorSubject = history.some(item => cookingCue(item) || specificMatch(item));
  if (!explicit && !cookingCue(plain) && !hasPriorSubject) return Object.freeze([]);
  if (genericFollowup && hasPriorSubject && weightAmount.test(plain) && /原来|原方|现在|改|换成|从|增加|减少|乘/.test(plain))
    input += '\n份量 缩放 放大 缩小';
  const inheritSubjectFirst = genericFollowup && !explicit && hasPriorSubject;
  const rows = library.entries.map((entry, index) => {
    const direct = entry.topics.filter(topic => containsTerm(input, topic));
    const inherited = entry.topics.filter(topic => containsTerm(prior, topic));
    const specificInherited = inherited.filter(topic => !genericTopics.has(normalize(topic)));
    const specificDirect = direct.filter(topic => !genericTopics.has(normalize(topic)));
    return { entry, index, priority: inheritSubjectFirst ? Number(specificInherited.length > 0) : Number(specificDirect.length > 0),
      score: direct.reduce((sum, topic) => sum + Math.min(topic.length, 12) * 8, 0)
        + inherited.reduce((sum, topic) => sum + Math.min(topic.length, 12) * (inheritSubjectFirst && !genericTopics.has(normalize(topic)) ? 8 : 2), 0) };
  }).filter(row => row.score > 0);
  return Object.freeze(rows.sort((a, b) => b.priority - a.priority || b.score - a.score || a.index - b.index).slice(0, max).map(row => row.entry));
}
function messageText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!object(value)) return '';
  if (typeof value.text === 'string') return value.text;
  if (object(value.part) && typeof value.part.text === 'string') return value.part.text;
  return '';
}
/** Read only application-owned current/history lines; no global memory or other roles. */
export function chefFoundationInputFromPrompt(prompt: string): { current: string; recent: string[] } {
  const lines = prompt.split('\n');
  const currentLine = lines.find(line => /^【(?:本轮用户消息|本轮输入|当前收到的消息)/.test(line));
  const historyLine = lines.find(line => /^【(?:有效聊天历史|真实历史)】/.test(line));
  let current = ''; let recent: string[] = [];
  try { if (currentLine) current = messageText(JSON.parse(currentLine.slice(currentLine.indexOf('】') + 1))); } catch { /* untrusted malformed input */ }
  const delegated = secretaryDelegationInputFromPrompt(prompt);
  if (!current && delegated?.targetId === 'zhou-chef') current = `${delegated.text}\n${delegated.goal}`;
  if (!current) {
    const line = lines.find(line => line.startsWith('【结构化步骤事件；不是用户发言】'));
    try {
      const event: unknown = line && JSON.parse(line.slice(line.indexOf('】') + 1));
      if (object(event) && object(event.task) && Array.isArray(event.task.steps)) {
        const step = event.task.steps.find(item => object(item) && item.id === event.nextStepId);
        current = [messageText(event.task.title), object(step) ? messageText(step.title) : ''].filter(Boolean).join(' ');
      }
    } catch { /* Step state is only a retrieval cue, never user fact evidence. */ }
  }
  try {
    if (historyLine) {
      const history: unknown = JSON.parse(historyLine.slice(historyLine.indexOf('】') + 1));
      if (Array.isArray(history)) recent = history.slice(-20).filter(item => object(item) && item.role === 'user'
        && item.chronologyUnknown !== true).map(messageText).filter(Boolean).slice(-8);
    }
  } catch { /* Never promote NPC claims or malformed history. */ }
  return { current, recent };
}
export const chefFoundationKnowledgeMarker = '【赵一帆本轮本地烹饪基础知识；配比、规格、条件调整、补救与来源限制】';
export const chefFoundationKnowledgeRules = '这份本地基础库只属于赵一帆，知识已随程序提供，回答不要求用户另找教程，也不在每次提问时联网找教程。按当前问题取用，保留sources的readStatus/supports/limitations与条目的conditions/evidenceBasis/limitations。full_text只表示读到该网页相关正文，partial_text只支持已读部分，catalog_only只证书目目录，不能支持教学；归纳、跨来源综合和助手适配不冒充原文、作者原话或原视频缺失参数。配比须有基准重量、单位、材料状态及适用做法；按重量缩放不等于烹调时间、锅容量、温度或模具高度等比例缩放。食材部位、厚度、鲜冻与解冻状态、表面水分、设备模式和当前进度按本题需要判断，不把假设/示例当用户事实，关键条件缺失短问或给短分支，不机械问锅型和人数。补救先辨状态和可救范围，不把焦苦、过熟或食品安全风险保证为可恢复；提供下一步操作和观察终点。现有视频缺项可用明确区分的本地基础资料补充，但不能说成原作者已提供或厨房已验证。后台可追溯来源，正常按本人原口吻直接讲，用户问依据时如实说明范围；不用内部库名和来源标签撑满台词。此库不是完整烹饪学科、厨房试做、新手复现或最好吃的保证，也不授予观察、计时启动、主动消息、系统通知、联网或其它新工具能力。';
export function chefFoundationKnowledgeContext(entries: readonly ChefFoundationEntry[]): string {
  return '\n' + chefFoundationKnowledgeMarker + JSON.stringify(entries) + '\n' + chefFoundationKnowledgeRules;
}
