import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Execute the real pure projection. No account, database, API or model is opened.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = join(root, 'lib/npc/task-calendar.ts');
const outputArgument = process.argv.find(argument => argument.startsWith('--output='));
const runtime = isolatedNpcRuntime();
process.on('exit', () => runtime.cleanup());
const {projectTaskCalendar, taskCalendarMonthCells, isTaskCalendarDate} = await runtime.load('lib/npc/task-calendar');
const {mutateProfessionalTaskSession} = await runtime.load('lib/npc/professional-task-session');
const {mutateProfessionalTaskStep} = await runtime.load('lib/npc/professional-task');
const now = Date.parse('2026-10-12T04:00:00.000Z');
const checked = [];
const check = (name, run) => {run(); checked.push(name);};
const task = (id = 'task', changes = {}) => ({
  id, characterId: 'chen-nian', title: '合成训练', goalKey: '合成目标', status: 'active',
  createdAt: '2026-10-10T08:00:00.000Z', updatedAt: '2026-10-12T03:00:00.000Z', revision: 1,
  sourceMessageId: `${id}-source`, cardMessageId: `${id}-card`,
  steps: [1, 2, 3].map(index => ({id: `${id}-${index}`, title: `合成步骤${index}`, details: ['合成指导'], hints: []})),
  ...changes,
});
const entryOn = (projection, date) => projection.days.find(day => day.date === date)?.entries[0];
const deepFreeze = value => {if (value && typeof value === 'object') {Object.values(value).forEach(deepFreeze); Object.freeze(value);} return value;};

check('Single tasks stay on the creation day, with later completion dates retained and no daily duplicates', () => {
  const initial = task(); initial.steps[0].completedAt = '2026-10-11T16:30:00.000Z';
  const projection = projectTaskCalendar({tasks: [initial], now});
  assert.deepEqual(projection.days.map(day => day.date), ['2026-10-10']);
  const entry = entryOn(projection, '2026-10-10');
  assert.equal(entry.completed, 1); assert.equal(entry.total, 3); assert.equal(entry.percent, 33);
  assert.deepEqual(entry.completedDates, ['2026-10-12']);
  assert.equal(entry.steps[0].completed, true); assert.equal(entry.steps[0].title, '合成步骤1');
  assert.equal(projection.snapshotOnly, true);
});

check('Scheduled plans use per-day step totals rather than the whole multi-day task progress', () => {
  const plan = task();
  plan.steps[0].scheduledDate = '2026-10-10'; plan.steps[0].completedAt = '2026-10-12T01:00:00.000Z';
  plan.steps[1].scheduledDate = '2026-10-11'; plan.steps[2].scheduledDate = '2026-10-11';
  plan.steps[1].completedAt = '2026-10-11T02:00:00.000Z';
  const projection = projectTaskCalendar({tasks: [plan], now});
  assert.deepEqual(projection.days.map(day => [day.date, day.completed, day.total, day.percent]), [
    ['2026-10-10', 1, 1, 100], ['2026-10-11', 1, 2, 50],
  ]);
  assert.deepEqual(entryOn(projection, '2026-10-11').stepIds, ['task-2', 'task-3']);
  assert.equal(entryOn(projection, '2026-10-10').steps[0].completedAt, '2026-10-12T01:00:00.000Z');
});

check('Undo and postponement reflect the saved snapshot without inventing the former day state', () => {
  const plan = task(); plan.steps = [plan.steps[0]];
  plan.steps[0].scheduledDate = '2026-10-10'; plan.steps[0].completedAt = '2026-10-11T02:00:00.000Z';
  assert.equal(entryOn(projectTaskCalendar({tasks: [plan], now}), '2026-10-10').percent, 100);
  delete plan.steps[0].completedAt; plan.steps[0].scheduledDate = '2026-10-12'; plan.revision++;
  const projection = projectTaskCalendar({tasks: [plan], now});
  assert.equal(entryOn(projection, '2026-10-10'), undefined);
  assert.equal(entryOn(projection, '2026-10-12').percent, 0);
  assert.equal(entryOn(projection, '2026-10-12').steps[0].completed, false);
});

check('Future dates have no history rows; dates with no rows can remain disabled in the UI', () => {
  const plan = task(); plan.steps.forEach(step => {step.scheduledDate = '2026-10-13';});
  const future = task('future', {createdAt: '2026-11-01T00:00:00.000Z'});
  const projection = projectTaskCalendar({tasks: [plan, future], now, accountCreatedAt: '2026-09-21T08:00:00.000Z'});
  assert.deepEqual(projection.days, []);
  assert.deepEqual(projection.months, ['2026-09', '2026-10']);
  assert.equal(projection.days.some(day => day.date === '2026-10-09'), false);
});

check('NPC filtering changes visible entries while preserving the account software-use period', () => {
  const chef = task('chef', {characterId: 'zhou-chef', createdAt: '2026-09-30T08:00:00.000Z'});
  const fitness = task('fitness');
  const projection = projectTaskCalendar({tasks: [chef, fitness], now, characterId: 'chen-nian'});
  assert.deepEqual(projection.months, ['2026-09', '2026-10']);
  assert.deepEqual(projection.days.flatMap(day => day.entries.map(entry => entry.taskId)), ['fitness']);
  const other = projectTaskCalendar({tasks: [chef, fitness], now, characterId: 'zhou-chef'});
  assert.deepEqual(other.days.flatMap(day => day.entries.map(entry => entry.taskId)), ['chef']);
});

check('Account and reliable legacy usage records bound natural months across years, without January defaults', () => {
  const projection = projectTaskCalendar({tasks: [], now: Date.parse('2027-02-04T02:00:00Z'),
    accountCreatedAt: Date.parse('2026-12-01T08:00:00Z'), firstUsageAt: '2026-11-18T08:00:00Z'});
  assert.deepEqual(projection.months, ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.equal(projection.startSource, 'usage-record'); assert.equal(projection.firstDate, '2026-11-18');
  const registration = projectTaskCalendar({tasks: [], now, accountCreatedAt: Date.parse('2026-10-11T16:00:00Z')});
  assert.equal(registration.startSource, 'account-created'); assert.equal(registration.firstDate, '2026-10-12');
  assert.deepEqual(registration.months, ['2026-10']);
  const unknown = projectTaskCalendar({tasks: [], now, accountCreatedAt: '2026-02-30T00:00:00Z', firstUsageAt: '09:21'});
  assert.equal(unknown.startSource, 'unknown'); assert.equal(unknown.firstDate, '2026-10-12');
  assert.deepEqual(unknown.months, ['2026-10']);
});

check('Shanghai midnight, leap February and Monday-first cells do not depend on the host timezone', () => {
  const previous = task('previous', {createdAt: '2026-10-11T15:59:59Z', steps: [{id: 'a', title: '跨日步骤', details: [], hints: []}]});
  const next = task('next', {createdAt: '2026-10-11T16:00:00Z', steps: [{id: 'b', title: '跨日步骤', details: [], hints: []}]});
  assert.deepEqual(projectTaskCalendar({tasks: [previous, next], now}).days.map(day => day.date), ['2026-10-11', '2026-10-12']);
  const february = taskCalendarMonthCells('2028-02');
  assert.equal(february[0], null); assert.equal(february[1], '2028-02-01');
  assert.equal(february.filter(Boolean).length, 29); assert.ok(february.includes('2028-02-29'));
  assert.equal(february.length % 7, 0);
  assert.equal(isTaskCalendarDate('2026-02-29'), false); assert.equal(isTaskCalendarDate('2028-02-29'), true);
  assert.deepEqual(taskCalendarMonthCells('2026-13'), []);
});

check('Past paused work skips while ended and completed states remain distinct and aggregation weighs actual steps', () => {
  const ended = task('ended', {status: 'cancelled', steps: [{id: 'ended-1', title: '已结束的步骤', details: [], hints: []}]});
  const complete = task('complete', {status: 'completed', steps: [{id: 'complete-1', title: '完成步骤', details: [], hints: [], completedAt: '2026-10-10T09:00:00Z'}]});
  const paused = task('paused', {status: 'paused'}); paused.steps[0].completedAt = '2026-10-10T09:00:00Z';
  const projection = projectTaskCalendar({tasks: [ended, complete, paused], now});
  assert.equal(projection.days[0].total, 5); assert.equal(projection.days[0].completed, 2); assert.equal(projection.days[0].percent, 40);
  assert.deepEqual(projection.days[0].entries.map(entry => entry.status).sort(), ['cancelled', 'completed', 'skipped']);
  assert.equal(projection.days[0].skipped,2,'only the two unfinished paused steps skip; completed steps stay completed');
});

check('An incomplete 199 of 200 steps displays 99 percent; only actual full completion reaches 100', () => {
  const tasks = Array.from({length: 10}, (_, taskIndex) => task(`many-${taskIndex}`, {steps: Array.from({length: 20}, (_, stepIndex) => ({
    id: `${taskIndex}-${stepIndex}`, title: '合成步骤', details: [], hints: [],
    ...(taskIndex === 9 && stepIndex === 19 ? {} : {completedAt: '2026-10-10T09:00:00Z'}),
  }))}));
  const incomplete = projectTaskCalendar({tasks, now}).days[0];
  assert.equal(incomplete.completed, 199); assert.equal(incomplete.total, 200); assert.equal(incomplete.percent, 99);
  tasks[9].steps[19].completedAt = '2026-10-10T09:00:00Z';
  assert.equal(projectTaskCalendar({tasks, now}).days[0].percent, 100);
});

check('Invalid timestamps never fabricate completion or a software-use date', () => {
  const invalid = task(); invalid.steps[0].completedAt = '2026-02-30T08:00:00Z';
  invalid.steps[1].completedAt = '2026-10-13T08:00:00Z'; invalid.steps[2].scheduledDate = '2026-02-30';
  const projection = projectTaskCalendar({tasks: [invalid], now, firstUsageAt: '2026-10-01'});
  assert.equal(projection.startSource, 'task-record'); assert.equal(projection.firstDate, '2026-10-10');
  assert.equal(projection.days[0].completed, 0); assert.equal(projection.days[0].total, 3);
  assert.ok(projection.days[0].entries[0].steps.every(step => step.completed === false));
  assert.throws(() => projectTaskCalendar({tasks: [], now: NaN}), /时间无效/);
});

check('Projection is read-only and returned detail arrays cannot mutate original task state', () => {
  const input = task(); input.steps[0].instructions = ['合成指令']; input.steps[0].notes = ['合成注意'];
  input.steps[0].training = {target: '合成部位', sets: 3, reps: '10次'};
  input.previousPlans = [{at: '2026-10-11T00:00:00Z', title: '旧方案', goalKey: '旧目标', steps: [structuredClone(input.steps[0])]}];
  const before = JSON.stringify(input); deepFreeze(input);
  const projection = projectTaskCalendar({tasks: [input], now});
  assert.equal(JSON.stringify(input), before);
  assert.equal(projection.days[0].entries.length, 1, 'previousPlans is not fabricated as a daily task log');
  const returned = projection.days[0].entries[0].steps[0];
  returned.details.push('修改投影'); returned.instructions.push('修改投影'); returned.notes.push('修改投影'); returned.training.sets = 9;
  assert.equal(JSON.stringify(input), before);
});

check('A noon start and final completion at one produce one hour on the actual execution day', () => {
  const training = task(); training.title = '胸部训练';
  training.steps.forEach(step=>{step.scheduledDate='2026-10-12';});
  const start = Date.parse('2026-10-12T04:00:00Z'), end = start + 3_600_000;
  mutateProfessionalTaskSession(training, 'start', training.revision, start);
  for (const step of training.steps) mutateProfessionalTaskStep(training, step.id, true, training.revision, end);
  const projection = projectTaskCalendar({tasks: [training], now: end});
  assert.deepEqual(projection.days.map(day => day.date), ['2026-10-12']);
  const entry = entryOn(projection, '2026-10-12');
  assert.equal(entry.execution.elapsedMs, 3_600_000); assert.equal(entry.execution.status, 'completed');
  assert.equal(entry.total, 3); assert.equal(entry.percent, 100);
});

check('Separate weekly sessions keep separate dates and durations without duplicating the task total', () => {
  const training = task(); training.title = '三天胸部训练';
  training.steps.forEach((step, index) => {step.scheduledDate = `2026-10-${10 + index}`;});
  for (const [index, step] of training.steps.entries()) {
    const start = Date.parse(`2026-10-${10 + index}T04:00:00Z`);
    mutateProfessionalTaskSession(training, 'start', training.revision, start);
    mutateProfessionalTaskStep(training, step.id, true, training.revision, start + (index + 1) * 600_000);
  }
  const projection = projectTaskCalendar({tasks: [training], now: now + 3_600_000});
  assert.deepEqual(projection.days.map(day => [day.date, day.total, day.entries[0].execution.elapsedMs]), [
    ['2026-10-10', 1, 600_000], ['2026-10-11', 1, 1_200_000], ['2026-10-12', 1, 1_800_000],
  ]);
});

check('Nutrition and skincare do not gain durations; old completed training has no fabricated time', () => {
  const nutrition = task('food', {title: '吃营养餐', goalKey: '营养餐'});
  nutrition.steps[0].durationSeconds = 300;
  const skincare = task('skin', {title: '护肤流程', goalKey: '护肤'});
  const old = task('old', {title: '胸部训练', goalKey: '胸部训练', status: 'completed'});
  old.steps.forEach(step => {step.completedAt = old.createdAt;});
  const projection = projectTaskCalendar({tasks: [nutrition, skincare, old], now});
  const entries = projection.days.flatMap(day => day.entries);
  assert.equal(entries.find(entry => entry.taskId === 'food').timingKind, undefined);
  assert.equal(entries.find(entry => entry.taskId === 'skin').timingKind, undefined);
  assert.equal(entries.find(entry => entry.taskId === 'old').timingKind, 'training');
  assert.ok(entries.every(entry => !entry.execution));
});

if (outputArgument) {
  const outputPath = resolve(outputArgument.slice('--output='.length));
  mkdirSync(dirname(outputPath), {recursive: true});
  writeFileSync(outputPath, `${JSON.stringify({source: sourcePath, syntheticOnly: true, snapshotOnly: true,
    networkCalls: 0, databaseReads: 0, databaseWrites: 0, passed: true, checks: checked}, null, 2)}\n`);
}
console.log(`PASS task calendar history: ${checked.length} regression groups; real pure function, synthetic tasks only.`);
