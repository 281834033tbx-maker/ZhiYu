/** Chen-only coaching knowledge. Source facts and practical adaptations stay separate. */
export type ChenCoachAuthority = {
  readonly organization: string | null;
  readonly journal: string | null;
  readonly studyType: 'guideline' | 'systematic_review' | 'meta_analysis' | 'randomized_trial' | 'other';
  readonly doi: string | null;
  readonly pmid: string | null;
  readonly accessLevel: 'full_text' | 'full_text_sections' | 'abstract' | 'official_summary';
  readonly population: string;
  readonly sampleSize: number | null;
  readonly durationWeeks: number | null;
  readonly comparison: string;
  readonly findings: readonly string[];
};

export type ChenCoachSource = {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly attribution: 'independent' | 'author';
  readonly evidenceLevel: 'official_guidance' | 'research_review' | 'research_primary' | 'expert_consensus'
    | 'author_video_partial' | 'legacy_video_frame_reviewed' | 'author_description' | 'catalog_only';
  readonly publishedAt: string | null;
  readonly reviewedAt: string;
  /** Source position only; never a training duration, rest interval or dosage. */
  readonly evidenceTimes: readonly [number, number] | null;
  readonly researchFile: string;
  readonly supports: string;
  readonly limitations: readonly string[];
  /** Verified bibliography and actual study scope; not a guarantee of correctness. */
  readonly authority?: ChenCoachAuthority;
  readonly sourceType?: 'position_stand' | 'systematic_review' | 'narrative_review' | 'primary_trial' | 'clinical_guideline'
    | 'expert_consensus' | 'official_guidance';
};

export type ChenCoachMovement = {
  readonly id: string;
  readonly name: string;
  readonly suitability: string;
  readonly setup: string;
  readonly cues: readonly string[];
  readonly regression: string;
  readonly avoidWhen: string;
};

export type ChenCoachKnowledgeEntry = {
  readonly id: string;
  readonly title: string;
  readonly topics: readonly string[];
  readonly category: 'movement_pairs' | 'warmup' | 'split' | 'progression' | 'execution'
    | 'recovery' | 'supplement' | 'vitality' | 'source_detail';
  readonly summary: string;
  readonly rules: readonly string[];
  readonly conditions: readonly string[];
  readonly sourceIds: readonly string[];
  readonly evidenceBasis: 'independent_guidance' | 'assistant_adaptation' | 'author_partial' | 'legacy_partial';
  readonly limitations: readonly string[];
  /** Optional evidence-aware answer layers; old source libraries remain unchanged. */
  readonly plainAnswer?: string;
  readonly evidenceOnChallenge?: string;
  readonly conditionRequirements?: readonly string[];
  readonly claimEvidence?: readonly {
    readonly claim: string;
    readonly sourceIds: readonly string[];
    readonly relationship: 'direct' | 'supporting' | 'indirect';
    readonly limitations: readonly string[];
  }[];
  readonly adjudication?: {
    readonly question: string;
    readonly verdict: 'supported' | 'not_supported' | 'conditional' | 'insufficient_direct_evidence';
    readonly conclusion: string;
    readonly applicability: string;
  };
  /** A/B are candidates for one training slot, not two mandatory exercises. */
  readonly alternatives: readonly ChenCoachMovement[] | null;
  /** Resolved from this exact library snapshot; ignored if supplied in raw entries. */
  readonly sources: readonly ChenCoachSource[];
};

export type ChenCoachKnowledgeLibrary = {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly characterId: 'chen-nian';
  readonly status: 'user_authorized_coach_knowledge';
  readonly coverage: {
    readonly complete: false;
    readonly practiceTested: false;
    readonly mediaDownloads: 0;
    readonly entryCount: number;
    readonly sourceCount: number;
  };
  readonly coreRules: readonly string[];
  readonly sources: readonly ChenCoachSource[];
  readonly entries: readonly ChenCoachKnowledgeEntry[];
};

export class ChenCoachKnowledgeError extends Error {
  readonly code: 'CHEN_COACH_KNOWLEDGE_INVALID' | 'CHEN_COACH_SELECTION_INVALID';
  constructor(message: string, code: ChenCoachKnowledgeError['code']) {
    super(message); this.name = 'ChenCoachKnowledgeError'; this.code = code;
  }
}

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const id = (value: unknown): value is string => text(value) && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const uniqueStrings = (value: unknown): value is string[] => strings(value) && new Set(value).size === value.length;
const nullableText = (value: unknown): value is string | null => value === null || text(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const position = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const levels = ['official_guidance', 'research_review', 'research_primary', 'expert_consensus', 'author_video_partial', 'legacy_video_frame_reviewed', 'author_description', 'catalog_only'];
const categories = ['movement_pairs', 'warmup', 'split', 'progression', 'execution', 'recovery', 'supplement', 'vitality', 'source_detail'];
const bases = ['independent_guidance', 'assistant_adaptation', 'author_partial', 'legacy_partial'];
const studyTypes = ['guideline', 'systematic_review', 'meta_analysis', 'randomized_trial', 'other'];
const accessLevels = ['full_text', 'full_text_sections', 'abstract', 'official_summary'];
const verdicts = ['supported', 'not_supported', 'conditional', 'insufficient_direct_evidence'];
const sourceTypes = ['position_stand', 'systematic_review', 'narrative_review', 'primary_trial', 'clinical_guideline', 'expert_consensus', 'official_guidance'];
const httpsUrl = (value: unknown): value is string => {
  if (!text(value)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !!url.hostname; }
  catch { return false; }
};
const researchPath = (value: unknown): value is string => text(value) && value.startsWith('output/')
  && !value.includes('\\') && !value.split('/').some(part => part === '..' || part === '.' || !part);
function required(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ChenCoachKnowledgeError(message, 'CHEN_COACH_KNOWLEDGE_INVALID');
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Parse a single authorized snapshot; unknown fields cannot become runtime instructions. */
export function parseChenCoachKnowledge(raw: string): ChenCoachKnowledgeLibrary {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new ChenCoachKnowledgeError('陈年教练知识库不是有效 JSON', 'CHEN_COACH_KNOWLEDGE_INVALID'); }
  required(object(value) && value.schemaVersion === 1 && text(value.version) && value.characterId === 'chen-nian'
    && value.status === 'user_authorized_coach_knowledge', '陈年教练知识库身份、版本或授权状态无效');
  const coverage = value.coverage;
  required(object(coverage) && coverage.complete === false && coverage.practiceTested === false
    && coverage.mediaDownloads === 0 && count(coverage.entryCount) && count(coverage.sourceCount), '陈年教练知识不能误标为全量、实练或媒体下载');
  required(uniqueStrings(value.coreRules) && value.coreRules.length > 0, '陈年教练知识缺少常驻规则');
  required(Array.isArray(value.sources) && value.sources.length > 0 && Array.isArray(value.entries) && value.entries.length > 0,
    '陈年教练知识缺少条目或来源');
  const sourceIds = new Set<string>();
  const sources: ChenCoachSource[] = value.sources.map(source => {
    required(object(source) && id(source.id) && !sourceIds.has(source.id) && text(source.title) && httpsUrl(source.url)
      && ['independent', 'author'].includes(source.attribution as string) && levels.includes(source.evidenceLevel as string)
      && nullableText(source.publishedAt) && text(source.reviewedAt) && researchPath(source.researchFile)
      && text(source.supports) && strings(source.limitations), '陈年教练知识来源不完整、无效或重复');
    sourceIds.add(source.id);
    const times = source.evidenceTimes;
    required(times === null || (Array.isArray(times) && times.length === 2 && times.every(position) && times[0] <= times[1]),
      `陈年来源 ${source.id} 的原片时间无效`);
    const partial = ['author_video_partial', 'legacy_video_frame_reviewed'].includes(source.evidenceLevel as string);
    required(partial ? times !== null && source.attribution === 'author' : times === null,
      `陈年来源 ${source.id} 的时间只能用于已检查的局部原片`);
    required(source.attribution === 'independent'
      ? ['official_guidance', 'research_review', 'research_primary', 'expert_consensus'].includes(source.evidenceLevel as string)
      : ['author_video_partial', 'legacy_video_frame_reviewed', 'author_description', 'catalog_only'].includes(source.evidenceLevel as string),
    `陈年来源 ${source.id} 的作者/独立证据归因不一致`);
    let authority: ChenCoachAuthority | undefined;
    if (source.authority !== undefined) {
      const data = source.authority;
      required(source.attribution === 'independent' && object(data)
        && nullableText(data.organization) && nullableText(data.journal)
        && studyTypes.includes(data.studyType as string) && nullableText(data.doi)
        && (data.doi === null || (text(data.doi) && /^10\.\d{4,9}\/\S+$/i.test(data.doi)))
        && (data.pmid === null || (text(data.pmid) && /^\d+$/.test(data.pmid)))
        && accessLevels.includes(data.accessLevel as string) && text(data.population)
        && (data.sampleSize === null || (count(data.sampleSize) && data.sampleSize > 0))
        && (data.durationWeeks === null || (position(data.durationWeeks) && data.durationWeeks > 0))
        && text(data.comparison) && strings(data.findings) && data.findings.length > 0,
      `陈年来源 ${source.id} 的研究书目、实际阅读范围或数据无效`);
      authority = { organization: data.organization, journal: data.journal,
        studyType: data.studyType as ChenCoachAuthority['studyType'], doi: data.doi, pmid: data.pmid,
        accessLevel: data.accessLevel as ChenCoachAuthority['accessLevel'], population: data.population,
        sampleSize: data.sampleSize, durationWeeks: data.durationWeeks, comparison: data.comparison,
        findings: [...data.findings] };
    }
    if (source.sourceType !== undefined) {
      required(source.attribution === 'independent' && authority && sourceTypes.includes(source.sourceType as string),
        `陈年来源 ${source.id} 的来源类型缺少已核独立研究元数据`);
      required(source.sourceType !== 'primary_trial' || (source.evidenceLevel === 'research_primary'
        && ['randomized_trial', 'other'].includes(authority.studyType)),
        `陈年来源 ${source.id} 不能把综述或组织指南标为原始试验`);
      required(source.sourceType !== 'systematic_review' || (source.evidenceLevel === 'research_review'
        && ['systematic_review', 'meta_analysis'].includes(authority.studyType)),
        `陈年来源 ${source.id} 的综述类型不一致`);
      required(source.sourceType !== 'narrative_review' || (source.evidenceLevel === 'research_review'
        && authority.studyType === 'other'), `陈年来源 ${source.id} 的叙述综述不能冒充系统综述或原始试验`);
      required(!['position_stand', 'clinical_guideline', 'expert_consensus', 'official_guidance'].includes(source.sourceType as string)
        || (['official_guidance', 'expert_consensus'].includes(source.evidenceLevel as string)
          && ['guideline', 'other', 'systematic_review', 'meta_analysis'].includes(authority.studyType)),
      `陈年来源 ${source.id} 不能把原始试验标为组织立场、临床指南、共识或官方指导`);
    }
    return { id: source.id, title: source.title, url: source.url,
      attribution: source.attribution as ChenCoachSource['attribution'], evidenceLevel: source.evidenceLevel as ChenCoachSource['evidenceLevel'],
      publishedAt: source.publishedAt, reviewedAt: source.reviewedAt, evidenceTimes: times as [number, number] | null,
      researchFile: source.researchFile, supports: source.supports, limitations: [...source.limitations],
      ...(authority ? { authority } : {}),
      ...(source.sourceType !== undefined ? { sourceType: source.sourceType as ChenCoachSource['sourceType'] } : {}) };
  });
  const sourceMap = new Map(sources.map(source => [source.id, source]));
  const entryIds = new Set<string>();
  const entries: ChenCoachKnowledgeEntry[] = value.entries.map(entry => {
    required(object(entry) && id(entry.id) && !entryIds.has(entry.id) && text(entry.title)
      && uniqueStrings(entry.topics) && entry.topics.length > 0 && categories.includes(entry.category as string)
      && text(entry.summary) && strings(entry.rules) && entry.rules.length > 0 && strings(entry.conditions)
      && uniqueStrings(entry.sourceIds) && entry.sourceIds.length > 0 && entry.sourceIds.every(sourceId => sourceMap.has(sourceId))
      && bases.includes(entry.evidenceBasis as string) && strings(entry.limitations), '陈年教练知识条目无效、重复或来源缺失');
    const entryId = entry.id;
    entryIds.add(entryId);
    const refs = entry.sourceIds.map(sourceId => sourceMap.get(sourceId)!);
    const entrySourceIds = entry.sourceIds;
    required(refs.every(source => source.evidenceLevel !== 'catalog_only'), `陈年条目 ${entry.id} 不能从目录标题构造教学`);
    required(entry.evidenceBasis !== 'independent_guidance' || refs.every(source => source.attribution === 'independent'),
      `陈年条目 ${entry.id} 的独立结论不能混入作者归因`);
    required(entry.evidenceBasis !== 'author_partial' || refs.some(source => source.evidenceLevel === 'author_video_partial' || source.evidenceLevel === 'author_description'),
      `陈年条目 ${entry.id} 缺少作者局部证据`);
    required(entry.evidenceBasis !== 'legacy_partial' || refs.some(source => source.evidenceLevel === 'legacy_video_frame_reviewed'),
      `陈年条目 ${entry.id} 缺少旧抽样证据`);
    let adjudication: ChenCoachKnowledgeEntry['adjudication'];
    if (entry.adjudication !== undefined) {
      const data = entry.adjudication;
      required(object(data) && text(data.question) && verdicts.includes(data.verdict as string)
        && text(data.conclusion) && text(data.applicability)
        && refs.some(source => source.attribution === 'independent' && source.authority),
      `陈年条目 ${entry.id} 的争议判断缺少完整结论或已核研究依据`);
      adjudication = { question: data.question, verdict: data.verdict as NonNullable<ChenCoachKnowledgeEntry['adjudication']>['verdict'],
        conclusion: data.conclusion, applicability: data.applicability };
    }
    const answerFields = [entry.plainAnswer, entry.evidenceOnChallenge, entry.conditionRequirements, entry.claimEvidence];
    let answerLayers: Pick<ChenCoachKnowledgeEntry, 'plainAnswer' | 'evidenceOnChallenge' | 'conditionRequirements' | 'claimEvidence'> = {};
    if (answerFields.some(value => value !== undefined)) {
      required(text(entry.plainAnswer) && text(entry.evidenceOnChallenge) && strings(entry.conditionRequirements)
        && Array.isArray(entry.claimEvidence) && entry.claimEvidence.length > 0,
      `陈年条目 ${entry.id} 的日常回答、质疑依据、必要条件或论点映射不完整`);
      const claimEvidence = entry.claimEvidence.map(link => {
        required(object(link) && text(link.claim) && uniqueStrings(link.sourceIds) && link.sourceIds.length > 0
          && link.sourceIds.every(sourceId => entrySourceIds.includes(sourceId))
          && ['direct', 'supporting', 'indirect'].includes(link.relationship as string) && strings(link.limitations),
        `陈年条目 ${entryId} 的论点不能引用本条之外的来源或缺少关系限制`);
        return { claim: link.claim, sourceIds: [...link.sourceIds], relationship: link.relationship as 'direct' | 'supporting' | 'indirect',
          limitations: [...link.limitations] };
      });
      answerLayers = { plainAnswer: entry.plainAnswer, evidenceOnChallenge: entry.evidenceOnChallenge,
        conditionRequirements: [...entry.conditionRequirements], claimEvidence };
    }
    let alternatives: ChenCoachMovement[] | null = null;
    if (entry.category === 'movement_pairs') {
      required(entry.evidenceBasis === 'assistant_adaptation' && Array.isArray(entry.alternatives) && entry.alternatives.length === 2
        && entry.conditions.length > 0 && entry.limitations.length > 0, `陈年动作双候选 ${entry.id} 缺少适配/限制或被误归因`);
      const movementIds = new Set<string>();
      alternatives = entry.alternatives.map(movement => {
        required(object(movement) && id(movement.id) && !movementIds.has(movement.id) && text(movement.name)
          && text(movement.suitability) && text(movement.setup) && strings(movement.cues) && movement.cues.length > 0
          && text(movement.regression) && text(movement.avoidWhen), `陈年动作双候选 ${entryId} 不完整`);
        movementIds.add(movement.id);
        return { id: movement.id, name: movement.name, suitability: movement.suitability, setup: movement.setup,
          cues: [...movement.cues], regression: movement.regression, avoidWhen: movement.avoidWhen };
      });
    } else required(entry.alternatives === null, `陈年条目 ${entry.id} 的候选格式无效`);
    return { id: entry.id, title: entry.title, topics: [...entry.topics], category: entry.category as ChenCoachKnowledgeEntry['category'],
      summary: entry.summary, rules: [...entry.rules], conditions: [...entry.conditions], sourceIds: [...entry.sourceIds],
      evidenceBasis: entry.evidenceBasis as ChenCoachKnowledgeEntry['evidenceBasis'], limitations: [...entry.limitations],
      ...(adjudication ? { adjudication } : {}), ...answerLayers, alternatives, sources: refs };
  });
  required(entries.length === coverage.entryCount && sources.length === coverage.sourceCount, '陈年教练知识统计与实际条目不一致');
  return freeze({ schemaVersion: 1, version: value.version, characterId: 'chen-nian', status: 'user_authorized_coach_knowledge',
    coverage: { complete: false, practiceTested: false, mediaDownloads: 0, entryCount: entries.length, sourceCount: sources.length },
    coreRules: [...value.coreRules], sources, entries });
}

export function chenCoachKnowledgeCatalog(library: ChenCoachKnowledgeLibrary) {
  return library.entries.map(({ id, title, topics, category, evidenceBasis, adjudication }) => ({ id, title, topics, category, evidenceBasis,
    ...(adjudication ? { adjudication: { question: adjudication.question, verdict: adjudication.verdict } } : {}) }));
}

export function selectChenCoachKnowledgeEntries(library: ChenCoachKnowledgeLibrary, ids: unknown): readonly ChenCoachKnowledgeEntry[] {
  if (ids === undefined) return Object.freeze([]);
  if (!Array.isArray(ids) || ids.length > 5 || new Set(ids).size !== ids.length
    || ids.some(id => typeof id !== 'string' || !library.entries.some(entry => entry.id === id))) {
    throw new ChenCoachKnowledgeError('陈年教练知识检索结果无效', 'CHEN_COACH_SELECTION_INVALID');
  }
  return Object.freeze(ids.map(id => library.entries.find(entry => entry.id === id)!));
}

const normalizeTopic = (value: string) => value.normalize('NFKC').toLowerCase()
  .replace(/六\s*(?:到|至|[-~～—–])\s*八/g, '6-8')
  .replace(/十\s*(?:到|至|[-~～—–])\s*十二/g, '10-12')
  .replace(/(\d+)\s*(?:到|至|[-~～—–])\s*(\d+)/g, '$1-$2');
const genericEvidenceTopic = /^(?:(?:有|有什么|有何)?(?:科学|权威|研究)?(?:依据|证据|数据|文献|出处|研究|实验|科学|权威|论文|样本|训练|分组|对照组|周期|训练周期)(?:吗|么)?|绝对正确|质疑)$/u;
const genericQuestionFragment = /^(?:是什么|是啥|啥东西|是啥东西|什么意思|怎么做|怎么练|怎么办|有什么用|有啥用)$/u;
const studyDesignFollowup = /^(?:那|这个|这|你说的|刚才的)?(?:多少人(?:做的|参加的|参与的)?|(?:实验|研究)(?:有)?(?:几人|几个人|多少人)|分了几组|对照组(?:是)?什么|训练了多久(?:得出来的)?)[？?。！!\s]*$/u;

/** A source follow-up can reuse a nearby topic; ordinary new chat cannot. */
export function isChenCoachEvidenceQuestion(topic: string): boolean {
  return studyDesignFollowup.test(topic) || /依据|证据|出处|来源|凭什么|(?:怎么|如何)证明|有根据|有何根据|为什么.*(?:对|这么说|这样说|正确|相信|选择|推荐)|(?:真的|确定)[吗么]|(?:数据|研究|实验|论文|文献)\s*(?:支持|支撑|表明|证明|显示|发现|结论|结果|在哪|哪里|哪篇|哪项|呢|吗|么)|(?:有没有|有无|什么|哪些|哪项|哪篇|哪份|提供|给我|找|查|看).{0,12}(?:数据|研究|实验|论文|文献)/u.test(topic);
}

// Only an actual source request made from ordinary referring/question words can
// borrow the previous topic. A new subject such as phone data or a movie study
// must not inherit an older bench-press question simply because its noun is new.
const contextualEvidenceFollowup = /^(?:那|所以|但是|可是|不过|等下|等等|你|您|我|们|想问|请问|陈年|这|那|个|些|的|说法|结论|回答|刚才|上面|前面|到底|真的|确定|是否|是|不|对|正确|有|没|无|什么|哪些|哪项|哪篇|哪份|哪个|哪里|何种|多少|为什么|怎么|如何|凭|能|不能|给|提供|看|一下|拿|找|查|支持|支撑|证明|表明|显示|说明|查证|文献|研究|实验|论文|数据|科学|权威|原始|可靠|来源|出处|依据|证据|结果|人|做|参加|参与|分|了|几|组|对照组|训练|多久|得出来|按|吗|么|呢|啊|呀|\s|\p{P})+$/u;

export function isChenCoachContextualEvidenceFollowup(topic: string): boolean {
  return isChenCoachEvidenceQuestion(topic) && contextualEvidenceFollowup.test(topic);
}

function messageText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!object(value)) return '';
  if (typeof value.text === 'string') return value.text;
  return object(value.part) && typeof value.part.text === 'string' ? value.part.text : '';
}

/** Only this supplied private branch's application-owned JSON lines are read. */
export function chenCoachInputFromPrompt(prompt: string): { current: string; recent: string[] } {
  const lines = prompt.split('\n');
  const currentLine = lines.find(line => /^【(?:本轮用户消息|本轮输入|当前收到的消息)/u.test(line));
  const historyLine = lines.find(line => /^【(?:有效聊天历史|真实历史)】/u.test(line));
  let current = ''; let recent: string[] = [];
  try { if (currentLine) current = messageText(JSON.parse(currentLine.slice(currentLine.indexOf('】') + 1))); }
  catch { /* Malformed input is not a trusted retrieval query. */ }
  try {
    if (historyLine) {
      const history: unknown = JSON.parse(historyLine.slice(historyLine.indexOf('】') + 1));
      if (Array.isArray(history)) recent = history.slice(-20).filter(item => object(item) && item.role === 'user'
        && item.chronologyUnknown !== true).map(messageText).filter(Boolean).slice(-8);
    }
  } catch { /* No global history or NPC text is promoted into the retrieval query. */ }
  return { current, recent };
}

/** Deterministic topical retrieval, with bounded context only for source follow-ups. */
export function matchChenCoachKnowledgeEntries(library: ChenCoachKnowledgeLibrary, topic: string, max = 5,
  recent: readonly string[] = []): readonly ChenCoachKnowledgeEntry[] {
  if (typeof topic !== 'string' || !Number.isSafeInteger(max) || max < 0 || max > 5
    || !strings(recent)) {
    throw new ChenCoachKnowledgeError('陈年教练知识主题或数量无效', 'CHEN_COACH_SELECTION_INVALID');
  }
  return matchChenKnowledgeEntries(library, topic, max, recent);
}

/** Shared Chen-only matcher; independent foundation allows one extra bounded slot. */
export function matchChenKnowledgeEntries(library: ChenCoachKnowledgeLibrary, topic: string, max: number,
  recent: readonly string[] = [], prioritizeSpecificTopics = false): readonly ChenCoachKnowledgeEntry[] {
  if (typeof topic !== 'string' || !Number.isSafeInteger(max) || max < 0 || max > 6 || !strings(recent)) {
    throw new ChenCoachKnowledgeError('陈年教练知识主题或数量无效', 'CHEN_COACH_SELECTION_INVALID');
  }
  const evidenceQuestion = isChenCoachEvidenceQuestion(topic);
  const normalizedCurrent = normalizeTopic(topic);
  const topicalScore = (entry: ChenCoachKnowledgeEntry, input: string, includeGeneric = false) => {
    const terms = [...new Set(input.match(/[a-z][a-z0-9_-]+|\d+-\d+|[\u4e00-\u9fff]{2,}/g) || [])]
      // Only the specific-topic foundation mode excludes bare question wording
      // from reverse matching. An unknown noun + what-is must not match every
      // indexed topic ending in what-is. The legacy coach matcher is unchanged.
      .filter(term => !prioritizeSpecificTopics || !genericQuestionFragment.test(term));
    return entry.topics.reduce((sum, item) => {
      const term = normalizeTopic(item);
      if (!includeGeneric && genericEvidenceTopic.test(term)) return sum;
      return sum + (term.length >= 2 && (input.includes(term) || terms.some(word => word.length >= 2 && term.includes(word))) ? term.length : 0);
    }, 0);
  };
  // Stop at the latest substantive user turn, including an unrelated one. Do not
  // revive an older training topic after the conversation has moved elsewhere.
  const anchor = evidenceQuestion && contextualEvidenceFollowup.test(topic)
    && (studyDesignFollowup.test(topic) || !library.entries.some(entry => topicalScore(entry, normalizedCurrent) > 0))
    ? [...recent].slice(-8).reverse().find(item => normalizeTopic(item) !== normalizedCurrent
      && (!isChenCoachEvidenceQuestion(item) || !contextualEvidenceFollowup.test(item)
        || library.entries.some(entry => topicalScore(entry, normalizeTopic(item)) > 0))) : undefined;
  const input = normalizeTopic(topic + (anchor ? '\n' + anchor : ''));
  const scored = library.entries.map((entry, index) => ({ entry, index, score: topicalScore(entry, input, true),
    specificScore: prioritizeSpecificTopics ? topicalScore(entry, input) : 0 })).filter(row => row.score > 0);
  // Once a concrete foundation topic is found, generic citation-policy cards
  // add unrelated sample studies. The standing source rules already cover them.
  const matched = prioritizeSpecificTopics && scored.some(row => row.specificScore > 0)
    ? scored.filter(row => row.specificScore > 0) : scored;
  return Object.freeze(matched
    .sort((a, b) => b.specificScore - a.specificScore
      || (evidenceQuestion ? Number(!!b.entry.adjudication) - Number(!!a.entry.adjudication) : 0)
      || b.score - a.score || (a.entry.category === 'source_detail' ? 1 : 0) - (b.entry.category === 'source_detail' ? 1 : 0) || a.index - b.index)
    .slice(0, max).map(row => row.entry));
}

export const chenCoachKnowledgeMarker = '【陈年本轮教练知识；五项能力、适用条件及独立/作者证据保留】';
export const chenCoachKnowledgeRules = `本知识库只属于陈年。常驻规则用于动作执行、替代、排期、疲劳调整、训练补剂及日常精力；按本轮用户条件使用检索条目。source_detail是有限原片或旧帧记录，不是完整作者课程；原片位置不是训练时长、间歇或剂量。sources的attribution/evidenceLevel、supports和limitations决定能引用什么：目录不能作教学；author_description只能证明简介所说；局部与旧抽样不能升级成完整观看；独立资料不能冒充博主原话。assistant_adaptation和A/B只是有条件的执行候选，不是每人必须做两项或全人群最优。缺器械、疼痛、起落困难、最小负荷过重或固定轨迹不适配时退阶/换动作；两者都不适合允许暂不做该专项。离心、呼吸与肩胛运动依动作/目标保留必要短提示，不统一固定时长、全程沉肩或人人憋气。训练天数由用户决定，分化数与肌群频率/总量分开；疲劳不能仅靠补剂顶过，持续异常需另评估。补剂不是必需，剂量单位、全天总量、适用年龄/健康/用药条件不能丢。图示只解释动作，不代表已看到用户或具备实时纠姿能力。正常NPC教学保持本人既有口吻，直接讲掌握的知识，不主动提真人博主、个人视频出处、后台来源标记或研究档案；教材/书籍及核实主编信息按共享知识表达规则可以引用。用户明确核查具体原始出处时如实回答，不伪造或否认来源。知识保存不等于实练验证、医学资质、即时观察或工具授权。`;

export function chenCoachKnowledgeContext(entries: readonly ChenCoachKnowledgeEntry[]): string {
  return '\n' + chenCoachKnowledgeMarker + JSON.stringify(entries) + '\n' + chenCoachKnowledgeRules + '\n' + chenCoachEvidenceRules;
}

export const chenCoachEvidenceRules = '陈年回应科学依据质疑时，先正面给出本问题的结论，再按需要引用本轮已核研究或指南的题目、组织、年份、链接及实际数据；不把后台真人博主归因搬进普通教学。adjudication区分支持、不支持、有条件与直接证据不足，不能为显得肯定而抹掉适用范围，也不能把明确结论写成空泛看情况。authority仅保存已核书目、研究人群/比较和实际阅读范围：abstract与official_summary不冒充完整正文；样本、周数、结果、单位及限制不能编造或从另一研究移来。未发现统计差异不等于已证明完全相同，较重负荷的力量优势不能直接改写成6–8次必比10–12次增肌更快，研究结论不保证每个人绝对有效。正常聊天不每轮搬文献；缺少已核具体依据时如实说明，不虚构本库支持。';
