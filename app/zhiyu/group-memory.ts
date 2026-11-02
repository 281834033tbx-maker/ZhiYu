import type {Message} from './data';
import {readLocalCharacterChat} from './local-character-chat';

// The current chef's local messages keep their original history and identity.
// Only dietary task candidates go to the owner-scoped fact extractor.
const candidate = /过敏|忌口|不能吃|不吃|体重|体脂|身高|公斤|\bkg\b|厘米|早餐|早饭|午饭|晚饭|外卖|自己做饭/iu;
const synchronized = new Map<string, string>();

export async function rememberLocalTaskMessage(accountId: string, message: Message): Promise<void> {
  if (!message.mine || !message.text.trim() || !candidate.test(message.text)) return;
  const key = `${accountId}:zhou-chef:${message.id}`;
  const signature = JSON.stringify([message.text, message.at || null]);
  if (synchronized.get(key) === signature) return;
  const response = await fetch('/api/npc/groups', {
    method: 'POST', credentials: 'same-origin',
    headers: {'Content-Type':'application/json', 'x-zhiyu-account':accountId},
    body: JSON.stringify({action:'remember',sourceCharacterId:'zhou-chef',messageId:message.id,
      text:message.text,...(message.at ? {at:message.at} : {})}),
  });
  const result = await response.json().catch(() => null) as {error?:string; ok?:boolean}|null;
  if (!response.ok || !result?.ok) throw new Error(result?.error || '饮食信息暂时未能同步，原留言已保留。');
  synchronized.set(key, signature);
}

export async function syncLocalGroupFacts(accountId: string, active: () => boolean): Promise<void> {
  // Archived zhao-yifan is a different historical character and is not merged.
  for (const message of readLocalCharacterChat(accountId, 'zhou-chef')) {
    if (!active()) throw new Error('账号已切换，请重新操作。');
    await rememberLocalTaskMessage(accountId, message);
  }
}
