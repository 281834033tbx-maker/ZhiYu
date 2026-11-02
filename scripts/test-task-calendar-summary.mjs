import assert from 'node:assert/strict';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Only pure source modules and synthetic records are loaded. No API/account/model is used.
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(project, 'app/task-calendar/task-calendar-summary.ts'), 'utf8');
const javascript = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022}}).outputText;
const {calendarMonthCells, calendarDayLabels, calendarMonthStats} = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
const checks = [];
const check = (name, run) => {run(); checks.push(name);};
const step = (title = '动作', completed = true, target) => ({title, completed, ...(target ? {training: {target}} : {})});
const task = (id, title, steps = [step()], extras = {}) => ({id, title, steps, ...extras});
const day = (...tasks) => ({tasks});
const map = value => new Map(Object.entries(value));
const row = (summary, id) => summary.rows.find(item => item.id === id);
const freeze = value => {if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);} return value;};

check('Monday-first October includes Sept 28–30 and Nov 1 with exact in-month flags', () => {
  const cells = calendarMonthCells('2026-10');
  assert.equal(cells.length, 35);
  assert.deepEqual(cells.slice(0, 4), [{date: '2026-09-28', inMonth: false}, {date: '2026-09-29', inMonth: false}, {date: '2026-09-30', inMonth: false}, {date: '2026-10-01', inMonth: true}]);
  assert.deepEqual(cells.at(-1), {date: '2026-11-01', inMonth: false});
  assert.equal(cells.filter(cell => cell.inMonth).length, 31);
  assert.equal(new Date(`${cells[0].date}T00:00:00Z`).getUTCDay(), 1);
  assert.equal(new Date(`${cells.at(-1).date}T00:00:00Z`).getUTCDay(), 0);
});
check('Leap February and non-leap four-week February have natural row counts', () => {
  assert.equal(calendarMonthCells('2024-02').filter(cell => cell.inMonth).length, 29);
  assert.equal(calendarMonthCells('2021-02').length, 28);
  assert.equal(calendarMonthCells('2021-02').every(cell => cell.inMonth), true);
});
check('Year boundaries and six-week months use real UTC neighbors', () => {
  assert.equal(calendarMonthCells('2027-01')[0].date, '2026-12-28');
  assert.equal(calendarMonthCells('2026-12').at(-1).date, '2027-01-03');
  assert.equal(calendarMonthCells('2026-08').length, 42);
});
check('Malformed/invalid months return no misleading cells or statistics', () => {
  for (const month of ['2026-00', '2026-13', '26-10', '2026-2', '2026-10junk', '']) {
    assert.deepEqual(calendarMonthCells(month), []);
    assert.deepEqual(calendarMonthStats(new Map(), month, '健身计划'), {rows: [], completed: 0, total: 0});
  }
});
check('All months in a leap and normal year are continuous complete Monday–Sunday weeks', () => {
  for (const year of [2024, 2026]) for (let month = 1; month <= 12; month++) {
    const cells = calendarMonthCells(`${year}-${String(month).padStart(2, '0')}`);
    assert.equal(cells.length % 7, 0);
    for (let index = 1; index < cells.length; index++) assert.equal(Date.parse(`${cells[index].date}T00:00:00Z`) - Date.parse(`${cells[index - 1].date}T00:00:00Z`), 86_400_000);
  }
});
check('Training target overrides task/step title; upper/mid/lower chest remain one chest label', () => {
  const value = day(task('chest', '腿部训练', [step('肩部动作', true, '胸大肌（上胸侧重）'), step('动作2', true, '上胸'), step('动作3', true, '中胸'), step('动作4', true, '下胸侧重')]));
  assert.deepEqual(calendarDayLabels(value, '健身计划'), ['胸部']);
  const result = calendarMonthStats(map({'2026-10-01': value}), '2026-10', '健身计划');
  assert.deepEqual(row(result, 'chest'), {id: 'chest', label: '胸部', count: 1, total: 1});
  assert.equal(row(result, 'legs').total, 0);
  assert.equal(result.total, 1);
});
check('An unknown declared target does not fall back to a conflicting title or guessed action', () => {
  const value = day(task('ambiguous', '胸部训练', [step('卧推', true, '合成未知部位')]));
  assert.deepEqual(calendarDayLabels(value, '健身计划'), ['训练']);
  assert.equal(row(calendarMonthStats(map({'2026-10-01': value}), '2026-10', '健身计划'), 'other').total, 1);
  assert.deepEqual(calendarDayLabels(day(task('plain', '力量训练', [step('划船')])), '健身计划'), ['训练']);
});
check('Explicit body-part words can classify old steps/task titles without training metadata', () => {
  assert.deepEqual(calendarDayLabels(day(task('legacy', '胸部训练', [step('动作')])), '健身计划'), ['胸部']);
  assert.deepEqual(calendarDayLabels(day(task('mixed', '训练计划', [step('肩部训练'), step('腿部训练')])), '健身计划'), ['肩部', '腿部']);
});
check('Anatomical leg/arm names do not overlap and explicit shoulder/core variants stay recognizable', () => {
  assert.deepEqual(calendarDayLabels(day(task('legs', '训练', [step('动作', true, '股二头肌')])), '健身计划'), ['腿部']);
  assert.deepEqual(calendarDayLabels(day(task('arms', '训练', [step('动作', true, '肱二头肌')])), '健身计划'), ['手臂']);
  assert.deepEqual(calendarDayLabels(day(task('shoulders', '训练', [step('动作', true, '肩前束')])), '健身计划'), ['肩部']);
  assert.deepEqual(calendarDayLabels(day(task('core', '训练', [step('动作', true, '腹直肌')])), '健身计划'), ['核心']);
});
check('Mixed muscle record completes rows from their own relevant steps but overall once', () => {
  const value = day(task('mixed', '混合训练', [step('动作1', true, '胸部'), step('动作2', true, '上胸'), step('动作3', false, '肩部')]));
  const result = calendarMonthStats(map({'2026-10-01': value}), '2026-10', '健身计划');
  assert.deepEqual(row(result, 'chest'), {id: 'chest', label: '胸部', count: 1, total: 1});
  assert.deepEqual(row(result, 'shoulders'), {id: 'shoulders', label: '肩部', count: 0, total: 1});
  assert.equal(result.total, 1); assert.equal(result.completed, 0);
});
check('Two separate tasks on the same day count twice, while multiple actions count once', () => {
  const value = day(task('morning', '胸部训练', [step('动作1'), step('动作2'), step('动作3')]), task('evening', '胸部训练', [step('动作4', false)]));
  const result = calendarMonthStats(map({'2026-10-01': value}), '2026-10', '健身计划');
  assert.deepEqual(row(result, 'chest'), {id: 'chest', label: '胸部', count: 1, total: 2});
  assert.equal(result.total, 2); assert.equal(result.completed, 1);
});
check('Repeated identities on one day deduplicate; conflicting snapshots do not claim complete', () => {
  const value = day(task('same', '胸部训练'), task('same', '胸部训练'), task('same', '胸部训练', [step('动作', false)]));
  const result = calendarMonthStats(map({'2026-10-01': value}), '2026-10', '健身计划');
  assert.equal(result.total, 1); assert.equal(result.completed, 0);
  assert.deepEqual(row(result, 'chest'), {id: 'chest', label: '胸部', count: 0, total: 1});
});
check('Distinct session identities and dates count separately even for the same task', () => {
  const value = map({'2026-10-01': day(task('plan:session-a', '胸部训练'), task('plan:session-b', '胸部训练')), '2026-10-02': day(task('plan:session-a', '胸部训练'))});
  const result = calendarMonthStats(value, '2026-10', '健身计划');
  assert.equal(result.total, 3); assert.equal(row(result, 'chest').count, 3);
});
check('Cross-month/invalid dates never contaminate the selected month statistics', () => {
  const value = map({'2026-09-30': day(task('a', '胸部训练')), '2026-10-01': day(task('b', '胸部训练')), '2026-11-01': day(task('c', '胸部训练')), '2026-10-32': day(task('d', '胸部训练'))});
  assert.equal(calendarMonthStats(value, '2026-10', '健身计划').total, 1);
});
check('Cancelled task/session retain a history label but contribute no statistics; empty steps have neither', () => {
  const value = day(task('cancel-task', '胸部训练', [step()], {status: 'cancelled'}), task('cancel-session', '胸部训练', [step()], {execution: {status: 'cancelled'}}), task('empty', '胸部训练', []));
  assert.deepEqual(calendarDayLabels(value, '健身计划'), ['胸部']);
  assert.deepEqual(calendarDayLabels(day(task('empty', '胸部训练', [])), '健身计划'), []);
  assert.equal(calendarMonthStats(map({'2026-10-01': value}), '2026-10', '健身计划').total, 0);
});
check('Cooking labels are short recipe names rather than each cooking operation', () => {
  const value = day(task('dish-a', '做地三鲜', [step('切菜'), step('炒菜')]), task('dish-b', '番茄炒蛋做法'), task('long', '一顿超级复杂的完整晚餐计划'));
  assert.deepEqual(calendarDayLabels(value, '烹饪计划'), ['地三鲜', '番茄炒蛋', '一顿超级复…']);
});
check('Separated cooking category prefixes leave the actual recipe name visible', () => {
  const examples = [['中餐 · 地三鲜', '地三鲜'], ['中式:番茄炒蛋', '番茄炒蛋'], ['西餐：意大利面', '意大利面'], ['西式 - 惠灵顿牛排', '惠灵顿牛排'], ['甜点·巧克力蛋糕', '巧克力蛋糕'], ['甜品 : 蛋挞做法', '蛋挞'], ['做中餐 · 地三鲜', '地三鲜']];
  for (const [title, label] of examples) assert.deepEqual(calendarDayLabels(day(task('recipe', title)), '烹饪计划'), [label]);
});
check('Standalone or unseparated category words retain a label rather than deleting useful content', () => {
  for (const title of ['中餐', '中式', '西餐', '西式', '甜点', '甜品', '中式鸡汤', '西式鸡汤']) {
    assert.deepEqual(calendarDayLabels(day(task('recipe', title)), '烹饪计划'), [title]);
  }
  assert.deepEqual(calendarDayLabels(day(task('recipe', '中餐 · ')), '烹饪计划'), ['中餐 ·']);
});
check('Clear recipes classify Chinese/Western/dessert; ambiguous ingredients remain other', () => {
  const value = day(task('a', '地三鲜'), task('b', '蒜香橄榄油意面'), task('c', '巧克力蛋糕'), task('d', '煎鸡胸'), task('e', '清蒸鱼'));
  const result = calendarMonthStats(map({'2026-10-01': value}), '2026-10', '烹饪计划');
  assert.equal(row(result, 'chinese').total, 1); assert.equal(row(result, 'western').total, 1); assert.equal(row(result, 'dessert').total, 1);
  assert.equal(row(result, 'other').total, 2); assert.equal(result.total, 5);
});
check('Meal-plan labels and statistics use breakfast/lunch/dinner records with distinct completion', () => {
  const value = day(task('nutrition', '今日饮食', [step('早餐', true), step('午餐', false), step('晚餐', true)]));
  assert.deepEqual(calendarDayLabels(value, '营养计划'), ['早餐', '午餐', '晚餐']);
  const result = calendarMonthStats(map({'2026-10-01': value}), '2026-10', '营养计划');
  assert.equal(row(result, 'breakfast').count, 1); assert.equal(row(result, 'lunch').count, 0); assert.equal(row(result, 'dinner').count, 1);
  assert.equal(result.total, 1); assert.equal(result.completed, 0);
});
check('Empty months keep fixed category rows without fictitious activity or extra zero rows', () => {
  assert.equal(calendarMonthStats(new Map(), '2026-10', '健身计划').rows.length, 6);
  assert.equal(calendarMonthStats(new Map(), '2026-10', '烹饪计划').rows.length, 3);
  assert.equal(calendarMonthStats(new Map(), '2026-10', '营养计划').rows.length, 3);
  assert.equal(calendarMonthStats(new Map(), '2026-10', '健身计划').rows.every(item => item.count === 0 && item.total === 0), true);
  assert.deepEqual(calendarDayLabels(undefined, '健身计划'), []);
});
check('Skipped and partially completed history remain records without becoming completed activity', () => {
  const skipped=task('skipped', '肩部训练', [{...step('侧平举',false,'肩部'),skipped:true}], {status:'skipped',execution:{status:'skipped'}});
  const partial=task('partial','胸部训练',[step('卧推',true,'胸部'),{...step('夹胸',false,'胸部'),skipped:true}],{status:'skipped'});
  const value=day(skipped,partial),result=calendarMonthStats(map({'2026-10-17':value}),'2026-10','健身计划');
  assert.deepEqual(calendarDayLabels(value,'健身计划'),['肩部','胸部']);
  assert.equal(result.total,2,'saved skipped records remain in the record count');assert.equal(result.completed,0);
  assert.equal(row(result,'shoulders').total,1);assert.equal(row(result,'shoulders').count,0);assert.equal(row(result,'chest').count,0);
});
check('Deep-frozen source records remain unchanged by labels or summaries', () => {
  const value = freeze(day(task('immutable', '胸部训练', [step('动作', false, '上胸')]))), original = structuredClone(value);
  calendarDayLabels(value, '健身计划'); calendarMonthStats(map({'2026-10-01': value}), '2026-10', '健身计划');
  assert.deepEqual(value, original);
});

const runtime = isolatedNpcRuntime();
try {
  const {projectTaskCalendar} = await runtime.load('lib/npc/task-calendar');
  check('Current execution session preserves real training metadata through API projection with no source mutation', () => {
    const now = Date.parse('2026-10-12T04:00:00Z');
    const input = freeze({id: 'synthetic-plan', characterId: 'chen-nian', title: '胸部训练', goalKey: '合成', status: 'completed', revision: 1,
      createdAt: '2026-10-12T01:00:00Z', updatedAt: '2026-10-12T03:00:00Z', sourceMessageId: 'source', cardMessageId: 'card',
      steps: [{id: 'one', title: '上斜哑铃卧推', details: [], hints: [], training: {target: '上胸', sets: 3, reps: '8～12次'}, completedAt: '2026-10-12T03:00:00Z'}],
      executionSessions: [{id: 'run-a', kind: 'training', date: '2026-10-12', stepIds: ['one'], planVersion: 0, taskTitle: '胸部训练',
        steps: [{id: 'one', title: '上斜哑铃卧推', completedAt: '2026-10-12T03:00:00Z'}], status: 'completed', startedAt: '2026-10-12T02:00:00Z', updatedAt: '2026-10-12T03:00:00Z', elapsedMs: 3_600_000}]});
    const projected = projectTaskCalendar({tasks: [input], now});
    assert.equal(projected.days.length, 1); assert.equal(projected.days[0].entries.length, 1);
    const entry = projected.days[0].entries[0];
    assert.equal(entry.entryId, 'synthetic-plan:run-a'); assert.deepEqual(entry.steps[0].training, input.steps[0].training);
    assert.notEqual(entry.steps[0].training, input.steps[0].training); assert.equal(entry.execution.elapsedMs, 3_600_000);
    assert.equal(entry.steps[0].completed, true);
    const presentation = day(task(entry.entryId, entry.title, entry.steps));
    assert.deepEqual(calendarDayLabels(presentation, '健身计划'), ['胸部']);
    assert.equal(row(calendarMonthStats(map({'2026-10-12': presentation}), '2026-10', '健身计划'), 'chest').count, 1);
  });
} finally {runtime.cleanup();}
const outputArgument = process.argv.find(argument => argument.startsWith('--output='));
if (outputArgument) {const destination = resolve(outputArgument.slice('--output='.length)); mkdirSync(dirname(destination), {recursive: true}); writeFileSync(destination, JSON.stringify({passed: true, checks, officialWrites: 0, apiCalls: 0, modelCalls: 0, viteCaches: 0}, null, 2));}
console.log(`Passed ${checks.length} calendar summary boundary checks.`);
