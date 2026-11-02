type Contact = { id: string; name: string; nickname?: string; realName?: string };

const aliases: Record<string, string[]> = {
  'zhou-chef': ['赵一帆', '赵一凡', '周师傅'],
  'chen-nian': ['陈年'],
  'yuan-xiaoman': ['小满', '袁小满', '许晓曼'],
  'xia-xia': ['夏夏', '唐佳怡'],
  'he-jiawei': ['何嘉伟'],
  liu: ['柳智敏'],
};

/** Conservative routing for explicit group work. Nutrition goes to Liu; training goes to Chen. General chat stays private. */
export function detectGroupRequest(text: string, sourceId: string, contacts: Contact[]) {
  const goal = text.trim();
  if (!goal) return null;
  if (/(?:别|不要|不用|不想|不需要|先别|暂时不).{0,8}(?:建|拉|组|创建|开).{0,6}群/u.test(goal)) return null;
  if (/(?:别|不要|不用|不想|不需要|不打算|暂时不).{0,12}(?:(?:营养|饮食)(?:规划|计划)|(?:减脂|减肥|增肌).{0,8}(?:规划|计划|菜单|餐))/u.test(goal)) return null;
  if (/^(?:请问|问一下|我想(?:了解|知道|问)|想(?:了解|知道|问)|我只是(?:问|想了解))/u.test(goal)) return null;
  if (/^(?:他说|她说|别人说|有人说|朋友说|例如|比如|假如|如果|举例|引用|讨论|测试)/u.test(goal)) return null;
  if (/(?:什么是|是什么意思|什么意思|有什么区别|有何区别|如何理解|怎么理解|怎么用|如何使用|是不是|有什么好处)/u.test(goal)) return null;
  const explicit = /(?:建|组建|拉|创建).{0,16}(?:群聊|群)|开(?:一?个|个)?群(?:聊)?/u.test(goal);
  if (!explicit && /(?:解释|介绍|了解|查看|打开|查询|搜索).{0,16}(?:营养|饮食|减脂|减肥|增肌|群)/u.test(goal)) return null;
  const requesting = /(?:帮我|给我|请|麻烦|我想|我要|我现在要|我们|咱们|一起)/u.test(goal)
    || /^(?:建|组建|拉|创建|开)(?:一?个|个)?(?:群聊|群)/u.test(goal);
  if (!requesting) return null;
  if (!/(?:帮我|给我|请|麻烦|我要|我想)/u.test(goal)
    && /(?:能不能|可以吗|会不会|支持吗|是什么|怎么用|如何)/u.test(goal)) return null;
  const trainingPlan = /(?:训练|健身|运动)(?:规划|计划|安排|课表)/u.test(goal);
  const explicitDiet = /(?:营养|饮食)(?:规划|计划)|(?:减脂|减肥|增肌).{0,12}(?:菜单|餐)/u.test(goal);
  const dietPlan = explicitDiet || (!trainingPlan && /(?:减脂|减肥|增肌).{0,12}(?:规划|计划|菜单|餐)/u.test(goal));
  const fitnessCooking = /(?:健身|减脂|增肌)/u.test(goal) && /(?:做饭|做餐|下厨)/u.test(goal);
  if (!explicit && /(?:什么是|是什么意思|怎么理解|如何理解|是不是|有什么好处)/u.test(goal)) return null;
  if (!explicit && !dietPlan && !fitnessCooking) return null;
  const mentioned = contacts.filter(contact => [contact.name, contact.nickname, contact.realName, ...(aliases[contact.id] || [])]
    .some(name => !!name && goal.includes(name))).map(contact => contact.id);
  const memberIds = [...new Set([
    'molly', ...(sourceId !== 'molly' ? [sourceId] : []), ...mentioned,
    ...(dietPlan || fitnessCooking ? ['liu', 'zhou-chef'] : []),
    ...(fitnessCooking || (trainingPlan && (explicit || dietPlan)) ? ['chen-nian'] : []),
  ])];
  return { goal, memberIds, ...(goal.length > 1000 ? {error:'组群需求请控制在 1000 字以内，原文字已保留在输入框。'} : {}) };
}
