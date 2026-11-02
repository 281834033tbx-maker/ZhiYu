/** Read-only presentation helpers. Counts describe saved task records, not exercise sets. */
type SummaryStep = Readonly<{title: string; completed: boolean; skipped?: boolean; training?: Readonly<{target: string}>}>;
type SummaryTask = Readonly<{
  id: string; title: string; steps: readonly SummaryStep[]; status?: string;
  execution?: Readonly<{status: string}>;
}>;
type SummaryDay = Readonly<{tasks: readonly SummaryTask[]}>;
type Category = Readonly<{id: string; label: string}>;
export type CalendarMonthStatistic = {id: string; label: string; count: number; total: number};
export type CalendarMonthSummary = {rows: CalendarMonthStatistic[]; completed: number; total: number};

const dayMillis = 86_400_000;
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const datePattern = /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/;
const fitnessCategories = [
  {id: 'chest', label: '胸部', pattern: /胸部|胸肌|胸大肌|[上中下]胸|(?:^|[、，,/\s])胸(?:$|[、，,/\s])|\bchest\b|pectoral/i},
  {id: 'shoulders', label: '肩部', pattern: /肩部|肩膀|肩[前中后]束|三角肌|(?:^|[、，,/\s])肩(?:$|[、，,/\s])|\bshoulders?\b|deltoid/i},
  {id: 'back', label: '背部', pattern: /背部|背肌|背阔肌|[上中下]背|(?:^|[、，,/\s])背(?:$|[、，,/\s])|\bback\b|latissimus/i},
  {id: 'legs', label: '腿部', pattern: /腿部|腿肌|腿[前后]侧|股四|股二|腘绳肌|臀部|臀肌|臀大肌|小腿|(?:^|[、，,/\s])[腿臀](?:$|[、，,/\s])|\blegs?\b|lower body|glute|quadriceps|hamstrings?|calves/i},
  {id: 'arms', label: '手臂', pattern: /手臂|(?<!股)二头肌|三头肌|肱二头|肱三头|\barms?\b|biceps?|triceps?/i},
  {id: 'core', label: '核心', pattern: /核心|腹部|腹肌|腹直肌|腹[内外]斜肌|腹横肌|\bcore\b|\babs\b|abdominal/i},
  {id: 'cardio', label: '有氧', pattern: /有氧|跑步|快走|骑行|游泳|跳绳|cardio/i},
  {id: 'full-body', label: '全身', pattern: /全身|full[-\s]?body/i},
] as const;
const cookingCategories = [
  {id: 'chinese', label: '中餐', pattern: /中餐|中式|中华料理|地三鲜|(?:番茄|西红柿)炒(?:鸡)?蛋|宫保鸡丁|红烧肉|麻婆豆腐|回锅肉|鱼香肉丝|青椒肉丝|水煮肉片|饺子|包子/},
  {id: 'western', label: '西餐', pattern: /西餐|西式|意大利面|意面|披萨|比萨|汉堡|三明治|惠灵顿/},
  {id: 'dessert', label: '甜点', pattern: /甜点|甜品|蛋糕|饼干|布丁|慕斯|蛋挞|提拉米苏|冰淇淋/},
] as const;
const nutritionCategories = [
  {id: 'breakfast', label: '早餐', pattern: /早餐|早饭/},
  {id: 'lunch', label: '午餐', pattern: /午餐|午饭/},
  {id: 'dinner', label: '晚餐', pattern: /晚餐|晚饭/},
  {id: 'snack', label: '加餐', pattern: /加餐/},
  {id: 'water', label: '饮水', pattern: /饮水|喝水/},
] as const;
const otherCategory = {id: 'other', label: '其他'};
type PlanKind = 'fitness' | 'cooking' | 'nutrition' | 'other';
const planKind = (name: string): PlanKind => /健身|训练|运动/.test(name) ? 'fitness'
  : /烹饪|做饭|料理/.test(name) ? 'cooking' : /营养|饮食|餐食/.test(name) ? 'nutrition' : 'other';
const categoryOrder = (kind: PlanKind): readonly Category[] => kind === 'fitness' ? fitnessCategories
  : kind === 'cooking' ? cookingCategories : kind === 'nutrition' ? nutritionCategories : [];
const defaultCategories = (kind: PlanKind): readonly Category[] => kind === 'fitness' ? fitnessCategories.slice(0, 6)
  : kind === 'cooking' ? cookingCategories : kind === 'nutrition' ? nutritionCategories.slice(0, 3) : [];
const matching = (text: string, categories: readonly (Category & {pattern: RegExp})[]): Category[] => categories.filter(category => category.pattern.test(text));
const validDate = (value: string) => datePattern.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const active = (task: SummaryTask) => task.status !== 'cancelled' && task.execution?.status !== 'cancelled' && task.steps.length > 0;

/** Monday-first natural month, including actual neighboring dates to complete each week. */
export function calendarMonthCells(month: string): {date: string; inMonth: boolean}[] {
  if (!monthPattern.test(month) || !validDate(`${month}-01`)) return [];
  const first = new Date(`${month}-01T00:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7;
  const next = new Date(first); next.setUTCMonth(next.getUTCMonth() + 1);
  const count = Math.round((next.getTime() - first.getTime()) / dayMillis);
  return Array.from({length: Math.ceil((offset + count) / 7) * 7}, (_, index) => {
    const date = new Date(first.getTime() + (index - offset) * dayMillis).toISOString().slice(0, 10);
    return {date, inMonth: date.startsWith(`${month}-`)};
  });
}

function taskCategorySteps(task: SummaryTask, kind: PlanKind): Map<string, {category: Category; steps: SummaryStep[]}> {
  const groups = new Map<string, {category: Category; steps: SummaryStep[]}>();
  const titleCategories = kind === 'fitness' ? matching(task.title, fitnessCategories)
    : kind === 'cooking' ? matching(task.title, cookingCategories)
      : kind === 'nutrition' ? matching(task.title, nutritionCategories) : [];
  for (const step of task.steps) {
    const categories = kind === 'fitness'
      // A declared but unknown target remains other; an action name is never a guessed muscle target.
      ? step.training?.target.trim() ? matching(step.training.target, fitnessCategories)
        : matching(step.title, fitnessCategories).length ? matching(step.title, fitnessCategories) : titleCategories
      : kind === 'nutrition' ? matching(step.title, nutritionCategories).length
        ? matching(step.title, nutritionCategories) : titleCategories
        // Cooking steps are operations, not independent meals; classify the saved recipe title.
        : titleCategories;
    for (const category of categories.length ? categories : [otherCategory]) {
      const group = groups.get(category.id) || {category, steps: []};
      group.steps.push(step); groups.set(category.id, group);
    }
  }
  return groups;
}

function shortTitle(title: string): string {
  const cleaned = title.trim().replace(/^[【[].*?[】\]]\s*/, '')
    .replace(/^(?:开始|学习|一起|今日|今天|制作|烹饪|做饭|做|完成|准备)\s*[:：]?\s*/, '')
    .replace(/^(?:中餐|中式|西餐|西式|甜点|甜品)\s*[·:：-]\s*(?=\S)/, '')
    .replace(/(?:制作|做法|烹饪|训练|计划|任务|教程|步骤|练习)(?:计划|任务)?$/, '').trim();
  const characters = Array.from(cleaned || title.trim() || '任务');
  return characters.length > 5 ? `${characters.slice(0, 5).join('')}…` : characters.join('');
}

/** Short saved-topic labels, including cancelled history; empty records have no topic. */
export function calendarDayLabels(day: SummaryDay | undefined, planName: string): string[] {
  if (!day) return [];
  const kind = planKind(planName), labels = new Set<string>();
  for (const task of day.tasks.filter(task => task.steps.length > 0)) {
    if (kind === 'fitness' || kind === 'nutrition') {
      for (const {category} of taskCategorySteps(task, kind).values()) labels.add(category.id === 'other'
        ? kind === 'fitness' ? '训练' : shortTitle(task.title) : category.label);
    } else labels.add(shortTitle(task.title));
  }
  return [...labels];
}

/**
 * Each date × saved task/session identity is one record. A mixed training record may
 * contribute once to each body-part row, but once to the overall total. Duplicate
 * identities count once; conflicting snapshots require all relevant steps complete.
 */
export function calendarMonthStats(days: ReadonlyMap<string, SummaryDay>, month: string, planName: string): CalendarMonthSummary {
  const summary: CalendarMonthSummary = {rows: [], completed: 0, total: 0};
  if (!monthPattern.test(month)) return summary;
  const kind = planKind(planName), rows = new Map<string, CalendarMonthStatistic>();
  for (const category of defaultCategories(kind)) rows.set(category.id, {id: category.id, label: category.label, count: 0, total: 0});
  for (const [date, day] of days) {
    if (!validDate(date) || !date.startsWith(`${month}-`)) continue;
    const records = new Map<string, SummaryTask[]>();
    for (const task of day.tasks.filter(active)) {
      const versions = records.get(task.id) || []; versions.push(task); records.set(task.id, versions);
    }
    for (const versions of records.values()) {
      summary.total++;
      if (versions.every(task => task.steps.every(step => step.completed && !step.skipped))) summary.completed++;
      const recordCategories = new Map<string, {category: Category; complete: boolean}>();
      for (const task of versions) for (const [id, {category, steps}] of taskCategorySteps(task, kind)) {
        const previous = recordCategories.get(id);
        recordCategories.set(id, {category, complete: (previous?.complete ?? true) && steps.every(step => step.completed && !step.skipped)});
      }
      for (const [id, {category, complete}] of recordCategories) {
        const row = rows.get(id) || {id, label: category.label, count: 0, total: 0};
        row.total++; if (complete) row.count++; rows.set(id, row);
      }
    }
  }
  const order = [...categoryOrder(kind), otherCategory].map(category => category.id);
  summary.rows = [...rows.values()].sort((a, b) => b.total - a.total || order.indexOf(a.id) - order.indexOf(b.id));
  return summary;
}
