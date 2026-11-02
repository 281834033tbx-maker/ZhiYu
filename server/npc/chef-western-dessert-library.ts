/**
 * The library is a reviewed source reference, never a kitchen-tested recipe.
 * Parse and freeze it once per request; selection never reads a second file.
 */
type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type WesternDessertRecipe = {
  readonly id: string;
  readonly videoId: string;
  readonly domain: 'western' | 'dessert';
  readonly reviewMethod: 'full-span_sampled_visual_review_with_subtitle_supplement';
  readonly episode: number;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly source: { readonly url: string; readonly researchFile: string; readonly researchHash: string; readonly mediaHash: string };
  readonly ingredients: readonly JsonValue[];
  readonly steps: readonly {
    readonly order: number;
    readonly action: string;
    readonly completion: string | null;
    readonly missing: string | readonly string[] | null;
    /** Locations in the source video, not a cooking timer. */
    readonly evidenceTimes: readonly [number, number];
    readonly evidenceSampleTimes: readonly number[];
    readonly recordType: 'source_observation';
    readonly runtimeUse: 'source_reference' | 'requires_safety_rewrite_before_instruction';
  }[];
  readonly missingConditions: readonly string[];
  readonly claims: readonly {
    readonly kind: 'author_statement_or_source_description';
    readonly stepOrder: number;
    readonly sourceField: 'action' | 'completion';
    readonly text: string;
    readonly qualification: string | readonly string[] | null;
    readonly truthVerified: false;
  }[];
  readonly researchInferences: readonly JsonValue[];
  readonly sourceTimings: readonly JsonValue[];
  readonly summary: string | null;
  readonly safetyNotes: readonly (string | {
    readonly stepOrders: readonly number[];
    readonly reason: string;
    readonly requiredRewrite: string;
    readonly basisSeconds: readonly number[];
  })[];
  readonly blockedSourceStepOrders: readonly number[];
  readonly verification: {
    readonly sourceReviewed: true;
    readonly kitchenTested: false;
    readonly noviceReplicated: false;
    readonly completeRecipe: false;
    readonly sourceHashMatches: true;
    readonly researchHashVerified: true;
  };
};

export type WesternDessertRecipeLibrary = {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly characterId: 'zhou-chef';
  readonly author: { readonly name: '主厨广坦'; readonly account: 'chefguangtan' };
  readonly status: 'user_authorized_source_reference';
  readonly dataSemantics: {
    readonly sourceReviewMethod: 'full-span_sampled_visual_review_with_subtitle_supplement';
    readonly continuousAudiovisualWatched: false;
    readonly evidenceTimes: 'video_position_seconds_not_cooking_duration';
    readonly sourceTimings: 'author_demonstration_duration_not_validated_universal_time';
    readonly steps: 'source_observation_not_ready_to_execute_recipe';
  };
  readonly coverage: { readonly cookingSamples: number };
  readonly recipes: readonly WesternDessertRecipe[];
};

export class WesternDessertRecipeLibraryError extends Error {
  readonly code: 'RECIPE_LIBRARY_INVALID' | 'RECIPE_SELECTION_INVALID';
  constructor(message: string, code: WesternDessertRecipeLibraryError['code']) {
    super(message);
    this.name = 'WesternDessertRecipeLibraryError';
    this.code = code;
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const missing = (value: unknown): boolean => value === null || text(value) || strings(value);
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const jsonValue = (value: unknown): boolean => value === null || typeof value === 'boolean' || typeof value === 'string'
  || (typeof value === 'number' && Number.isFinite(value))
  || (Array.isArray(value) && value.every(jsonValue))
  || (record(value) && Object.values(value).every(jsonValue));
const jsonArray = (value: unknown): value is JsonValue[] => Array.isArray(value) && value.every(jsonValue);
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function requireLibrary(condition: unknown, message: string): asserts condition {
  if (!condition) throw new WesternDessertRecipeLibraryError(message, 'RECIPE_LIBRARY_INVALID');
}

export function parseWesternDessertRecipeLibrary(raw: string): WesternDessertRecipeLibrary {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new WesternDessertRecipeLibraryError('主厨广坦西餐甜品菜谱来源库不是有效 JSON', 'RECIPE_LIBRARY_INVALID'); }
  requireLibrary(record(value), '主厨广坦西餐甜品菜谱来源库结构无效');
  requireLibrary(value.schemaVersion === 1 && text(value.version) && value.characterId === 'zhou-chef'
    && value.status === 'user_authorized_source_reference', '主厨广坦西餐甜品菜谱来源库的版本、人物或授权范围无效');
  requireLibrary(record(value.author) && value.author.name === '主厨广坦' && value.author.account === 'chefguangtan', '主厨广坦西餐甜品菜谱来源作者无效');
  const semantics = value.dataSemantics;
  requireLibrary(record(semantics)
    && semantics.sourceReviewMethod === 'full-span_sampled_visual_review_with_subtitle_supplement'
    && semantics.continuousAudiovisualWatched === false
    && semantics.evidenceTimes === 'video_position_seconds_not_cooking_duration'
    && semantics.sourceTimings === 'author_demonstration_duration_not_validated_universal_time'
    && semantics.steps === 'source_observation_not_ready_to_execute_recipe', '主厨广坦西餐甜品来源位置、示范时间或未验证步骤语义无效');
  requireLibrary(record(value.coverage) && Number.isInteger(value.coverage.cookingSamples)
    && (value.coverage.cookingSamples as number) > 0 && Array.isArray(value.recipes)
    && value.recipes.length === value.coverage.cookingSamples, '主厨广坦西餐甜品菜谱来源库实际条目数与覆盖统计不符');
  const ids = new Set<string>();
  const videoIds = new Set<string>();
  const researchFiles = new Set<string>();
  for (const recipe of value.recipes) {
    requireLibrary(record(recipe), '主厨广坦西餐甜品菜谱记录结构无效');
    requireLibrary(text(recipe.videoId) && /^\d+$/.test(recipe.videoId)
      && recipe.id === `gt-${recipe.videoId}` && !ids.has(recipe.id) && !videoIds.has(recipe.videoId), '主厨广坦西餐甜品菜谱 ID 或视频 ID 无效、重复');
    ids.add(recipe.id); videoIds.add(recipe.videoId);
    requireLibrary(['western', 'dessert'].includes(recipe.domain as string)
      && recipe.reviewMethod === 'full-span_sampled_visual_review_with_subtitle_supplement', `主厨广坦菜谱 ${recipe.id} 的领域或实际研究方法无效`);
    requireLibrary(Number.isInteger(recipe.episode) && (recipe.episode as number) > 0 && text(recipe.name)
      && strings(recipe.aliases) && new Set(recipe.aliases).size === recipe.aliases.length
      && (recipe.summary === null || text(recipe.summary)), `主厨广坦西餐甜品菜谱 ${recipe.id} 的名称或索引无效`);
    const source = recipe.source;
    requireLibrary(record(source)
      && source.url === `https://www.douyin.com/video/${recipe.videoId}`
      && source.researchFile === `output/guangtan-western-dessert-research-20261008/visual-study-${recipe.videoId}.json`
      && !researchFiles.has(source.researchFile)
      && text(source.researchHash) && /^[a-f0-9]{64}$/.test(source.researchHash)
      && text(source.mediaHash) && /^[a-f0-9]{64}$/.test(source.mediaHash), `主厨广坦西餐甜品菜谱 ${recipe.id} 的来源无效`);
    researchFiles.add(source.researchFile);
    requireLibrary(jsonArray(recipe.ingredients) && recipe.ingredients.length > 0
      && strings(recipe.missingConditions) && recipe.missingConditions.length > 0
      && jsonArray(recipe.researchInferences) && jsonArray(recipe.sourceTimings)
      && jsonArray(recipe.safetyNotes), `主厨广坦西餐甜品菜谱 ${recipe.id} 的原料、缺项或安全资料无效`);
    const verification = recipe.verification;
    requireLibrary(record(verification) && verification.sourceReviewed === true && verification.sourceHashMatches === true && verification.researchHashVerified === true
      && verification.kitchenTested === false && verification.noviceReplicated === false && verification.completeRecipe === false,
    `主厨广坦西餐甜品菜谱 ${recipe.id} 不能升级为完整或厨房已验证配方`);
    const steps = recipe.steps;
    requireLibrary(Array.isArray(steps) && steps.length > 0, `主厨广坦西餐甜品菜谱 ${recipe.id} 缺少来源步骤`);
    for (const note of recipe.safetyNotes) {
      requireLibrary(text(note) || (record(note) && Array.isArray(note.stepOrders) && note.stepOrders.length > 0
        && note.stepOrders.every(order => Number.isInteger(order) && order > 0 && order <= steps.length)
        && new Set(note.stepOrders).size === note.stepOrders.length
        && text(note.reason) && text(note.requiredRewrite)
        && Array.isArray(note.basisSeconds) && note.basisSeconds.length > 0 && note.basisSeconds.every(nonnegative)),
      `主厨广坦西餐甜品菜谱 ${recipe.id} 的安全说明或动作定位无效`);
    }
    for (const [index, step] of steps.entries()) {
      requireLibrary(record(step) && step.order === index + 1 && text(step.action)
        && (step.completion === null || text(step.completion)) && missing(step.missing)
        && step.recordType === 'source_observation'
        && ['source_reference', 'requires_safety_rewrite_before_instruction'].includes(step.runtimeUse as string), `主厨广坦西餐甜品菜谱 ${recipe.id} 的步骤顺序或来源标记无效`);
      requireLibrary(Array.isArray(step.evidenceTimes) && step.evidenceTimes.length === 2
        && step.evidenceTimes.every(nonnegative) && step.evidenceTimes[0] <= step.evidenceTimes[1]
        && Array.isArray(step.evidenceSampleTimes) && step.evidenceSampleTimes.length > 0
        && step.evidenceSampleTimes.every(nonnegative)
        && Math.min(...step.evidenceSampleTimes) === step.evidenceTimes[0]
        && Math.max(...step.evidenceSampleTimes) === step.evidenceTimes[1], `主厨广坦西餐甜品菜谱 ${recipe.id} 的视频位置证据无效`);
    }
    const blockedOrders = recipe.blockedSourceStepOrders;
    requireLibrary(Array.isArray(blockedOrders)
      && blockedOrders.every(order => Number.isInteger(order) && order > 0 && order <= steps.length)
      && new Set(blockedOrders).size === blockedOrders.length, `主厨广坦西餐甜品菜谱 ${recipe.id} 的安全拦截步骤无效`);
    const blocked = steps.filter(step => step.runtimeUse === 'requires_safety_rewrite_before_instruction').map(step => step.order);
    requireLibrary(blocked.length === blockedOrders.length
      && blocked.every(order => blockedOrders.includes(order)), `主厨广坦西餐甜品菜谱 ${recipe.id} 的安全拦截标记不一致`);
    for (const note of recipe.safetyNotes) {
      if (record(note)) requireLibrary((note.stepOrders as number[]).every(order => blockedOrders.includes(order)),
        `主厨广坦西餐甜品菜谱 ${recipe.id} 的安全说明动作遗漏改写标记`);
    }
    requireLibrary(!blocked.length || recipe.safetyNotes.length > 0, `主厨广坦西餐甜品菜谱 ${recipe.id} 的安全拦截缺少说明`);
    requireLibrary(Array.isArray(recipe.claims), `主厨广坦西餐甜品菜谱 ${recipe.id} 的来源声明无效`);
    for (const claim of recipe.claims) {
      requireLibrary(record(claim) && claim.kind === 'author_statement_or_source_description'
        && Number.isInteger(claim.stepOrder) && (claim.stepOrder as number) > 0 && (claim.stepOrder as number) <= steps.length
        && ['action', 'completion'].includes(claim.sourceField as string) && text(claim.text) && missing(claim.qualification)
        && claim.truthVerified === false, `主厨广坦西餐甜品菜谱 ${recipe.id} 的作者声明无效`);
      const step = steps[(claim.stepOrder as number) - 1];
      requireLibrary((step[claim.sourceField as 'action' | 'completion'] || '').includes(claim.text), `主厨广坦西餐甜品菜谱 ${recipe.id} 的作者声明不属于所标来源步骤`);
    }
  }
  return freeze(value as unknown as WesternDessertRecipeLibrary);
}

/** A compact source index; complete step records stay out of ordinary rules. */
export function westernDessertRecipeCatalog(library: WesternDessertRecipeLibrary): { id: string; name: string; domain: WesternDessertRecipe['domain']; aliases: readonly string[]; summary?: string }[] {
  return library.recipes.map(({ id, name, domain, aliases, summary }) => ({ id, name, domain, aliases, ...(summary ? { summary } : {}) }));
}

/** Only real IDs may select 0–3 records from this request's frozen snapshot. */
export function selectWesternDessertRecipes(library: WesternDessertRecipeLibrary, ids: unknown): readonly WesternDessertRecipe[] {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.length > 3 || ids.some(id => typeof id !== 'string'
    || !library.recipes.some(recipe => recipe.id === id)) || new Set(ids).size !== ids.length) {
    throw new WesternDessertRecipeLibraryError('主厨广坦西餐甜品菜谱来源检索结果无效，请重试', 'RECIPE_SELECTION_INVALID');
  }
  return Object.freeze(ids.map(id => library.recipes.find(recipe => recipe.id === id)!));
}

/** Keep the combined chef source context bounded, regardless of publisher. */
export function validateChefReferenceSelectionCount(primary: readonly unknown[], westernDessert: readonly unknown[]): void {
  if (primary.length + westernDessert.length > 3) {
    throw new WesternDessertRecipeLibraryError('厨师本轮两套来源参考合计最多选择 3 条，请重试', 'RECIPE_SELECTION_INVALID');
  }
}
