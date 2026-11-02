export function taskCalendarPlanName(character: {id: string; professionalTitle?: string; professionalProfile?: {title: string}}): string {
  if (character.id === 'chen-nian') return '健身计划';
  if (character.id === 'zhou-chef') return '烹饪计划';
  const title = character.professionalTitle || character.professionalProfile?.title || '';
  if (/营养|饮食/.test(title)) return '营养计划';
  if (/皮肤|护肤/.test(title)) return '护肤计划';
  if (/烹饪|厨师/.test(title)) return '烹饪计划';
  if (/健身|训练|运动/.test(title)) return '健身计划';
  return '专业计划';
}
