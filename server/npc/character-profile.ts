/** Select the current profile without replaying preserved identity history. */
export function currentCharacterProfile(text: string): string {
  const start = '<!-- current-character-profile:start -->';
  const end = '<!-- current-character-profile:end -->';
  if (!text.includes(start) && !text.includes(end)) return text;
  if (text.split(start).length !== 2 || text.split(end).length !== 2
    || text.indexOf(end) < text.indexOf(start)) throw new Error('NPC当前人物资料块无效');
  const profile = text.slice(text.indexOf(start) + start.length, text.indexOf(end)).trim();
  if (!profile) throw new Error('NPC当前人物资料块为空');
  return profile;
}
