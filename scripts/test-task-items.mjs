import assert from 'node:assert/strict';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Pure display adapter only: synthetic in-memory groups, no database/providers.
const runtime = isolatedNpcRuntime();
process.on('exit', () => runtime.cleanup());
const {professionalTasksForDate, shanghaiToday, validTaskDate, shiftTaskDate, taskDateOptions, taskScheduleOptions, nextTaskMonth, taskCalendarRange, professionalTaskCategory, professionalTaskCharacterName, taskDateLabel, groupTasksForToday, taskItemsForDate} =
  await runtime.load('lib/npc/task-items');

assert.equal(shanghaiToday(Date.parse('2026-10-07T15:59:59Z')), '2026-10-07');
assert.equal(shanghaiToday(Date.parse('2026-10-07T16:00:00Z')), '2026-10-08');
assert.equal(shanghaiToday(Date.parse('2026-12-31T16:00:00Z')), '2027-01-01');
assert.equal(validTaskDate('2024-02-29'), true);
for (const date of ['2026-02-29', '2026-02-30', '2026-10-32', '2026-1-01', '', null, 20261008]) {
  assert.equal(validTaskDate(date), false, `${date} must not be a valid calendar date`);
}
assert.equal(shiftTaskDate('2026-01-01', -1), '2025-12-31');
assert.equal(shiftTaskDate('2024-03-01', -1), '2024-02-29');
assert.equal(shiftTaskDate('2026-02-30', 1), '');
assert.equal(shiftTaskDate('2026-10-08', 0.5), '');
assert.equal(taskDateOptions('2026-10-01', '2026-09-08')[0], '2026-09-08');
assert.equal(taskDateOptions('2026-10-01', '2026-09-08').at(-1), '2026-11-01');
assert.equal(taskDateOptions('2026-10-01', '2026-09-08').length, 55);
assert.deepEqual(taskDateOptions('bad'), []);
assert.equal(taskDateOptions('2026-01-01')[0], '2026-01-01');
assert.equal(nextTaskMonth('2026-01-31'), '2026-02-28');
assert.equal(nextTaskMonth('2024-01-31'), '2024-02-29');
assert.equal(nextTaskMonth('2026-12-31'), '2027-01-31');
assert.equal(taskScheduleOptions('2026-12-28').length,31);
assert.equal(taskScheduleOptions('2026-12-28')[0],'2026-12-28');
assert.equal(taskScheduleOptions('2026-12-28').at(-1),'2027-01-27');
assert.equal(taskDateLabel('2026-10-08', '2026-10-08'), '今天');
assert.equal(taskDateLabel('2026-10-09', '2026-10-08'), '明天');
assert.equal(taskDateLabel('2026-10-01', '2026-10-08'), '10月1号');
assert.equal(taskDateLabel('bad', '2026-10-08'), '');

const date = '2026-10-08';
const baseReminder = {
  id: 'r-active', meal: 'breakfast', time: '08:00', timezone: 'Asia/Shanghai',
  startDate: '2026-10-01', endDate: '2026-10-09', status: 'active',
};
const group = {
  id: 'g-synthetic', name: '合成测试群', goal: '合成目标', sourceCharacterId: 'chen-nian',
  createdAt: `${date}T00:00:00Z`, updatedAt: `${date}T00:00:00Z`, createdBy: 'molly',
  chatEnabled: true, members: [], messages: [], namingSource: 'molly-model',
  plan: {id: 'p-synthetic', status: 'confirmed', createdAt: `${date}T00:00:00Z`, updatedAt: `${date}T00:00:00Z`,
    days: [{date, label: '合成安排标签', breakfast: '合成早餐菜单\n保留第二行内容', lunch: '合成午餐菜单', dinner: '合成晚餐菜单'}], shopping: []},
  reminders: [
    baseReminder,
    {...baseReminder, id: 'r-proposed', time: '07:30', status: 'proposed'},
    {...baseReminder, id: 'r-paused', time: '08:30', status: 'paused'},
    {...baseReminder, id: 'r-cancelled', time: '07:00', status: 'cancelled'},
    {...baseReminder, id: 'r-outside', startDate: '2026-10-09'},
    {...baseReminder, id: 'r-wrong-zone', timezone: 'UTC'},
    {...baseReminder, id: 'r-invalid-date', startDate: '2026-02-30'},
  ],
};
const before = JSON.stringify(group);
const entries = groupTasksForToday([group], date);
assert.deepEqual(entries[0].reminders.map(reminder => reminder.id), ['r-proposed', 'r-active', 'r-paused']);
assert.deepEqual(groupTasksForToday([group], '2026-02-30'), []);
assert.deepEqual(groupTasksForToday([{...group, leftAt: `${date}T01:00:00Z`}], date), []);
const tasks = taskItemsForDate([group], date);
assert.equal(tasks.length, 3, 'one plan plus three breakfast reminders stays three meal rows');
assert.deepEqual(tasks.map(task => task.title), ['早餐', '午餐', '晚餐']);
assert.ok(tasks.every(task => task.category === 'diet' && task.canComplete));
assert.ok(tasks.every(task => task.groupId === group.id && task.groupName === group.name && task.date === date));
assert.equal(tasks[0].time, '08:00', 'enabled reminder time takes priority over an earlier unconfirmed proposal');
assert.ok(tasks[0].statusLabel.includes('提醒已启用'));
assert.ok(tasks[0].details.join('\n').includes('07:30 · 待确认'), 'the earlier proposal remains visible with its real state');
assert.equal(tasks[1].time, undefined, 'an undated meal must not receive an invented time');
assert.ok(tasks[0].details.includes('合成早餐菜单\n保留第二行内容'), 'menu text survives unchanged');
for (const text of ['合成安排标签', '饮食计划已确认', '待确认', '已启用', '已暂停', '08:30', '2026-10-01至2026-10-09']) {
  assert.ok(tasks[0].details.join('\n').includes(text), `details retain ${text}`);
}
assert.ok(!tasks[0].details.join('\n').includes('已取消'));
assert.equal(JSON.stringify(group), before, 'mapping must not mutate source data');
assert.deepEqual(taskItemsForDate([group], 'bad'), []);
assert.deepEqual(taskItemsForDate([{...group, leftAt: `${date}T01:00:00Z`}], date), []);
assert.deepEqual(taskItemsForDate([group], '2026-10-09').map(task => task.title), ['早餐提醒'], 'reminders without a plan still appear');
assert.deepEqual(taskItemsForDate([group], '2026-10-10'), [], 'out-of-range reminders do not leak to another date');

const cloned = () => structuredClone(group);
let changed = cloned();
changed.name = '合成改名'; changed.updatedAt = '2099-01-01T00:00:00Z';
changed.messages.push({id: 'synthetic-new-message', text: '合成聊天活动'});
changed.reminders.reverse();
assert.deepEqual(taskItemsForDate([changed], date).map(task => task.id), tasks.map(task => task.id), 'rename/chat/reordering preserve completion identity');
changed = cloned();
changed.plan.status = 'draft';
const drafts = taskItemsForDate([changed], date);
assert.deepEqual(drafts.map(task => task.id), tasks.map(task => task.id), 'confirmation changes status rather than task identity');
assert.ok(drafts.every(task => !task.canComplete));
assert.ok(drafts[0].statusLabel.includes('计划待确认'));
assert.ok(drafts[0].details.includes('饮食计划待确认'));
changed = cloned();
changed.reminders[0].status = 'paused';
changed.reminders[0].lastOccurrence = date;
const paused = taskItemsForDate([changed], date);
assert.equal(paused[0].id, tasks[0].id, 'pause/delivery do not clear completion of the confirmed meal');
assert.equal(paused[0].canComplete, true, 'a paused reminder does not pause its confirmed meal plan');
changed = cloned(); changed.plan.days[0].breakfast = '合成修改后的早餐菜单';
assert.notEqual(taskItemsForDate([changed], date)[0].id, tasks[0].id, 'same-plan menu edit cannot inherit old completion');
assert.equal(taskItemsForDate([changed], date)[1].id, tasks[1].id, 'editing breakfast does not reset lunch');
changed = cloned(); changed.reminders[0].time = '08:15';
assert.notEqual(taskItemsForDate([changed], date)[0].id, tasks[0].id, 'reminder time edit changes task identity');
changed = cloned(); changed.plan.id = 'p-replacement';
assert.notEqual(taskItemsForDate([changed], date)[0].id, tasks[0].id, 'replacement plans are separate tasks');

const reminderOnly = {...group, plan: undefined, reminders: [baseReminder]};
const active = taskItemsForDate([reminderOnly], date)[0];
assert.equal(active.canComplete, true);
assert.equal(active.title, '早餐提醒');
assert.notEqual(taskItemsForDate([reminderOnly], '2026-10-09')[0].id, active.id, 'repeating reminders have separate daily completion');
for (const status of ['proposed', 'paused']) {
  const readOnly = taskItemsForDate([{...reminderOnly, reminders: [{...baseReminder, status}]}], date)[0];
  assert.equal(readOnly.canComplete, false);
  assert.equal(readOnly.id, active.id);
  assert.ok(readOnly.statusLabel.includes(status === 'paused' ? '已暂停' : '待确认'));
}
assert.deepEqual(taskItemsForDate([{...reminderOnly, reminders: [{...baseReminder, status: 'cancelled'}]}], date), []);
const missing = cloned(); missing.plan.days[0].breakfast = ' '; missing.reminders = [];
assert.deepEqual(taskItemsForDate([missing], date).map(task => task.title), ['午餐', '晚餐'], 'empty menu slots do not become invented tasks');
assert.equal(new Set([...tasks, ...taskItemsForDate([{...group, id: 'another-synthetic-group'}], date)].map(task => task.id)).size, 6);

const cooking={id:'cooking-1',characterId:'zhou-chef',title:'合成地三鲜',goalKey:'地三鲜',status:'active',createdAt:'2026-09-20T16:00:00Z',updatedAt:'2026-10-08T16:00:00Z',revision:2,sourceMessageId:'source',cardMessageId:'card',steps:[1,2,3].map(i=>({id:'s'+i,title:'步骤'+i,details:['操作内容'],hints:[]}))};
assert.equal(professionalTasksForDate([cooking],'2026-10-10','2026-10-10').length,0,'old unfinished work stays on its original day instead of carrying into today');
assert.equal(professionalTasksForDate([cooking],'2026-10-09','2026-10-10').length,0,'carryover is not invented on every historical day');
assert.equal(professionalTasksForDate([{...cooking,status:'paused'}],'2026-10-10','2026-10-10').length,0,'paused work also stops carrying into today after its assigned day');
const finished={...cooking,status:'completed',updatedAt:'2026-10-11T16:00:00Z',steps:cooking.steps.map((s,i)=>({...s,completedAt:i===2?'2026-10-09T16:01:00Z':'2026-10-09T15:59:00Z'}))};
assert.equal(professionalTasksForDate([finished],'2026-10-10','2026-10-10').length,1,'completion day follows Shanghai final-step time, not later hint refresh');
assert.equal(professionalTasksForDate([finished],'2026-10-09','2026-10-10').length,0);
assert.doesNotThrow(()=>professionalTasksForDate([{...finished,steps:finished.steps.map(step=>({...step,completedAt:'pending'}))}],'2026-10-10','2026-10-10'),'a transient or malformed snapshot cannot crash global task rendering');
assert.equal(professionalTasksForDate([{...cooking,status:'cancelled'}],'2026-10-09','2026-10-10').length,1,'cancelled records remain visible on their end day');
assert.deepEqual(professionalTasksForDate([cooking],'bad','2026-10-10'),[]);
assert.equal(cooking.steps.some(step=>step.completedAt),false,'display filtering never changes step progress');
console.log('PASS task items: Shanghai calendar and parent-task assigned/completion days without carryover; existing plan/reminder merging and stable completion IDs. Synthetic pure data only.');

const scheduled={...cooking,id:'fitness-1',characterId:'chen-nian',createdAt:'2026-09-08T00:00:00Z',steps:cooking.steps.map((step,index)=>({...step,scheduledDate:index===2?'2026-10-13':'2026-10-11'}))};
assert.equal(professionalTaskCategory(scheduled),'fitness');assert.equal(professionalTaskCharacterName(scheduled),'陈年');
assert.equal(professionalTaskCategory(cooking),'cooking');
const nutrition={...scheduled,id:'nutrition-1',characterId:'liu'};
assert.equal(professionalTaskCategory(nutrition),'diet');
assert.equal(professionalTaskCharacterName(nutrition),'柳智敏');
assert.equal(professionalTasksForDate([scheduled],'2026-10-13','2026-10-11').length,1,'future scheduled steps make their parent reachable on that date');
assert.equal(professionalTasksForDate([scheduled],'2026-10-12','2026-10-11').length,0,'explicit planning never carries onto an unscheduled date');
const calendar=taskCalendarRange([group],[scheduled],'2026-10-11');
assert.equal(calendar.dates[0],'2026-09-08');assert.ok(!calendar.markedDates.has('2026-09-08'),'creation starts the history range without inventing a task on a day with no assigned steps');assert.equal(calendar.dates.at(-1),'2026-11-11');
for(const day of ['2026-10-01','2026-10-08','2026-10-11','2026-10-13'])assert.ok(calendar.markedDates.has(day),`calendar marks real tasks on ${day}`);
assert.ok(!calendar.markedDates.has('2026-10-12'),'empty future dates stay unmarked');
assert.equal(JSON.stringify(scheduled.steps.map(step=>step.scheduledDate)),JSON.stringify(['2026-10-11','2026-10-11','2026-10-13']),'calendar never changes scheduled dates');
console.log('PASS task calendar: earliest actual history, natural-month clamp, future schedule inclusion, mixed-role categories and 0–30 day changes.');

const beforeMidnight=shanghaiToday(Date.parse('2026-10-11T15:59:59Z')),afterMidnight=shanghaiToday(Date.parse('2026-10-11T16:00:00Z'));
assert.equal(taskDateLabel('2026-10-12',beforeMidnight),'明天');assert.equal(taskDateLabel('2026-10-12',afterMidnight),'今天');
assert.equal(taskDateLabel('2026-10-11',afterMidnight),'10月11号');
assert.equal(taskScheduleOptions(afterMidnight).at(-1),'2026-11-11');
console.log('PASS cross-Shanghai-midnight schedule labels and changing 0–30-day window without altering stored dates.');
