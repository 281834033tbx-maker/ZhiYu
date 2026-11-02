/** Public teaching references, with evidence strength preserved per observation. */
export type ChenFitnessEntry = {
  readonly id: string;
  readonly videoId: string;
  readonly title: string;
  readonly category: 'training' | 'nutrition';
  readonly topics: readonly string[];
  readonly source: {
    readonly url: string;
    readonly publishedAt: string | null;
    readonly researchFile: string | null;
    readonly reviewedMethod: string | null;
  };
  readonly evidenceStatus: 'title_only' | 'source_reviewed';
  readonly summary: string | null;
  readonly observations: readonly {
    readonly text: string;
    /** Source position in seconds, never training duration or a dosage. */
    readonly evidenceTimes: readonly [number, number] | null;
    readonly evidenceType: 'source_transcript' | 'video_frame' | 'platform_chapter_summary';
  }[];
  readonly missingParameters: readonly string[];
  /** Application cautions, separate from the author's source statements. */
  readonly safetyNotes: readonly string[];
  readonly verification: {
    readonly completeProtocol: false;
    readonly practiceTested: false;
    readonly safetyReviewed: boolean;
  };
};

export type ChenFitnessLibrary = {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly characterId: 'chen-nian';
  readonly status: 'user_authorized_source_reference';
  readonly author: { readonly name: '谭成义'; readonly handle: 'nishitiantan'; readonly profileUrl: string };
  readonly coverage: {
    readonly totalAccountPosts: number | null;
    readonly indexedPosts: number;
    readonly trainingEntries: number;
    readonly nutritionEntries: number;
    readonly excludedLifestylePosts: number;
    readonly complete: false;
  };
  readonly entries: readonly ChenFitnessEntry[];
};

export class ChenFitnessLibraryError extends Error {
  readonly code: 'CHEN_LIBRARY_INVALID' | 'CHEN_SELECTION_INVALID';
  constructor(message: string, code: ChenFitnessLibraryError['code']) {
    super(message); this.name = 'ChenFitnessLibraryError'; this.code = code;
  }
}

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const nullableText = (value: unknown): value is string | null => value === null || text(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const position = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const douyinUrl = (value: unknown): value is string => {
  if (!text(value)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && ['www.douyin.com', 'www.iesdouyin.com'].includes(url.hostname); }
  catch { return false; }
};
function required(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ChenFitnessLibraryError(message, 'CHEN_LIBRARY_INVALID');
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Reads one source snapshot; unknown extra fields never become runtime knowledge. */
export function parseChenFitnessLibrary(raw: string): ChenFitnessLibrary {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new ChenFitnessLibraryError('陈年训练营养来源库不是有效 JSON', 'CHEN_LIBRARY_INVALID'); }
  required(object(value) && value.schemaVersion === 1 && text(value.version) && value.characterId === 'chen-nian'
    && value.status === 'user_authorized_source_reference', '陈年来源库的版本、身份或授权状态无效');
  const author = value.author;
  required(object(author) && author.name === '谭成义' && author.handle === 'nishitiantan'
    && douyinUrl(author.profileUrl), '陈年来源库作者身份无效');
  const coverage = value.coverage;
  required(object(coverage) && (coverage.totalAccountPosts === null || count(coverage.totalAccountPosts))
    && count(coverage.indexedPosts) && count(coverage.trainingEntries) && count(coverage.nutritionEntries)
    && count(coverage.excludedLifestylePosts) && coverage.complete === false, '陈年来源库覆盖范围无效或被误标为全量');
  required(Array.isArray(value.entries) && value.entries.length > 0, '陈年来源库没有可追溯条目');
  const ids = new Set<string>();
  const entries: ChenFitnessEntry[] = value.entries.map(entry => {
    required(object(entry) && text(entry.videoId) && /^\d+$/.test(entry.videoId)
      && entry.id === 'tcy-' + entry.videoId && !ids.has(entry.id), '陈年来源库视频 ID 无效或重复');
    ids.add(entry.id);
    const id = entry.id;
    required(text(entry.title) && ['training', 'nutrition'].includes(entry.category as string)
      && strings(entry.topics) && new Set(entry.topics).size === entry.topics.length
      && ['title_only', 'source_reviewed'].includes(entry.evidenceStatus as string)
      && nullableText(entry.summary) && strings(entry.missingParameters) && strings(entry.safetyNotes), `陈年来源条目 ${entry.id} 的分类或证据状态无效`);
    const source = entry.source;
    required(object(source) && source.url === `https://www.douyin.com/video/${entry.videoId}`
      && nullableText(source.publishedAt) && nullableText(source.reviewedMethod)
      && (source.researchFile === null || (text(source.researchFile)
        && source.researchFile.startsWith('output/tan-chengyi-research-20261008/')
        && !source.researchFile.split('/').includes('..'))), `陈年来源条目 ${entry.id} 的出处无效`);
    const verification = entry.verification;
    required(object(verification) && verification.completeProtocol === false && verification.practiceTested === false
      && typeof verification.safetyReviewed === 'boolean', `陈年来源条目 ${entry.id} 不能升级为完整或实练验证方案`);
    required(Array.isArray(entry.observations), `陈年来源条目 ${entry.id} 的观察资料无效`);
    const observations = entry.observations.map(observation => {
      required(object(observation) && text(observation.text)
        && ['source_transcript', 'video_frame', 'platform_chapter_summary'].includes(observation.evidenceType as string), `陈年来源条目 ${id} 的观察媒介无效`);
      const times = observation.evidenceTimes;
      required(times === null || (Array.isArray(times) && times.length === 2 && times.every(position) && times[0] <= times[1]), `陈年来源条目 ${id} 的视频位置无效`);
      required(observation.evidenceType === 'platform_chapter_summary' || times !== null, `陈年来源条目 ${id} 的原片观察缺少时间证据`);
      return { text: observation.text, evidenceTimes: times as [number, number] | null,
        evidenceType: observation.evidenceType as ChenFitnessEntry['observations'][number]['evidenceType'] };
    });
    if (entry.evidenceStatus === 'title_only') {
      required(entry.summary === null && observations.length === 0 && entry.missingParameters.length > 0
        && verification.safetyReviewed === false, `陈年标题索引 ${entry.id} 不能带有教学结论或假称安全复核`);
    } else {
      required(observations.length > 0 && text(source.reviewedMethod) && text(source.researchFile), `陈年已读来源 ${entry.id} 缺少观察或研究记录`);
    }
    return { id: entry.id, videoId: entry.videoId, title: entry.title,
      category: entry.category as ChenFitnessEntry['category'], topics: [...entry.topics],
      source: { url: source.url, publishedAt: source.publishedAt, researchFile: source.researchFile, reviewedMethod: source.reviewedMethod },
      evidenceStatus: entry.evidenceStatus as ChenFitnessEntry['evidenceStatus'], summary: entry.summary,
      observations, missingParameters: [...entry.missingParameters], safetyNotes: [...entry.safetyNotes],
      verification: { completeProtocol: false, practiceTested: false, safetyReviewed: verification.safetyReviewed } };
  });
  required(entries.filter(entry => entry.category === 'training').length === coverage.trainingEntries
    && entries.filter(entry => entry.category === 'nutrition').length === coverage.nutritionEntries
    && coverage.indexedPosts >= entries.length + coverage.excludedLifestylePosts
    && (coverage.totalAccountPosts === null || coverage.totalAccountPosts >= coverage.indexedPosts), '陈年来源库条目数与覆盖统计不一致');
  return freeze({ schemaVersion: 1, version: value.version, characterId: 'chen-nian', status: 'user_authorized_source_reference',
    author: { name: '谭成义', handle: 'nishitiantan', profileUrl: author.profileUrl },
    coverage: { totalAccountPosts: coverage.totalAccountPosts, indexedPosts: coverage.indexedPosts,
      trainingEntries: coverage.trainingEntries, nutritionEntries: coverage.nutritionEntries,
      excludedLifestylePosts: coverage.excludedLifestylePosts, complete: false }, entries });
}

export function chenFitnessCatalog(library: ChenFitnessLibrary) {
  return library.entries.map(({ id, title, category, topics, evidenceStatus }) => ({ id, title, category, topics, evidenceStatus }));
}

/** Selection cannot invent knowledge records or select a different request's file. */
export function selectChenFitnessEntries(library: ChenFitnessLibrary, ids: unknown): readonly ChenFitnessEntry[] {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.length > 3 || new Set(ids).size !== ids.length
    || ids.some(id => typeof id !== 'string' || !library.entries.some(entry => entry.id === id))) {
    throw new ChenFitnessLibraryError('陈年来源检索结果无效，请重试', 'CHEN_SELECTION_INVALID');
  }
  return Object.freeze(ids.map(id => library.entries.find(entry => entry.id === id)!));
}

export const chenFitnessSourceRules = `这份库只是谭成义公开教学的有限来源参考。title_only条目只证明存在这个标题，不能从标题编动作、顺序、组数、次数、重量、间歇、时长、热量、营养比例或作者结论，也不能拼成他的完整训练法。source_reviewed仍需逐项看观察媒介；platform_chapter_summary只是平台摘要，可能压缩或误读，不能单独作为可执行动作、纠错、训练处方或营养剂量的依据。原片时间位置不是训练时长；作者示范及声称与普适有效性不同。summary不补足observations未说明的条件。missingParameters保持未知，缺关键条件先简短问或给有条件的范围；后台区分指定教学与一般研究或适配，正常NPC教学和任务不主动出现真人博主姓名或个人视频出处，教材/书籍与核实主编信息按共享知识表达规则处理，不编参数来自原片，不制造引用。safetyNotes是应用安全改写提示，不说成作者原话；安全复核状态以verification标记为准，来源均未经实练复现或完整体系验证，不声称权威最佳、全量看完或必定有效。只给适合当前经验、器械、目标、伤痛与进度的内容，不把生活索引导成专业知识，来源本身不授予工具能力；实际接口已接任务卡、用户点击式持久步骤计时和勾选后提示，不授予看图、观察动作、准确热量测量、到点主动送达或现实执行能力。技术适配与来源后台区分，但普通教学不暴露真人博主、个人视频出处或审核标记；有依据的教材/书籍及其主编信息可以按需引用。`;

export const chenFitnessReferenceMarker = '【陈年本轮训练营养来源参考；证据级别、原片观察及缺项逐条保留】';

export function chenFitnessReferenceContext(entries: readonly ChenFitnessEntry[]): string {
  return '\n' + chenFitnessReferenceMarker + JSON.stringify(entries)
    + '\n' + chenFitnessSourceRules;
}

/** Group dialogue has no retrieval model call; use only explicit topical overlap. */
export function matchChenFitnessEntries(library: ChenFitnessLibrary, topicText: string): readonly ChenFitnessEntry[] {
  const terms = [...new Set(topicText.toLowerCase().match(/[a-z][a-z0-9_-]+|[\u4e00-\u9fff]{2,}/g) || [])];
  const score = (entry: ChenFitnessEntry) => entry.topics.reduce((sum, topic) => {
    const term = topic.toLowerCase();
    return sum + (term.length >= 2 && terms.some(input => input.includes(term) || term.includes(input)) ? term.length : 0);
  }, 0);
  return Object.freeze(library.entries.map(entry => ({ entry, score: score(entry) })).filter(row => row.score > 0)
    .sort((a, b) => (a.entry.evidenceStatus === 'source_reviewed' ? -1 : 1)
      - (b.entry.evidenceStatus === 'source_reviewed' ? -1 : 1) || b.score - a.score).slice(0, 3).map(row => row.entry));
}
