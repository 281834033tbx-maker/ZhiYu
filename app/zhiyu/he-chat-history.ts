import type { Message } from './data';
import { localCharacterChatKey } from './local-character-chat';
import { npcFetch } from './npc-fetch';

const completed = new Map<string, string>();
const pending = new Map<string, Promise<void>>();

function records(value: unknown): Message[] {
  if (!Array.isArray(value)) throw Error('何嘉伟的旧留言格式无法读取，原记录已保留');
  return value.filter((item): item is Message => !!item && typeof item === 'object'
    && typeof item.id === 'string' && typeof item.text === 'string' && item.mine === true);
}

/** Archive old local messages once per snapshot; never clear their original keys. */
export async function ensureHeChatHistory(accountId: string): Promise<void> {
  const local = localStorage.getItem(localCharacterChatKey(accountId, 'he-jiawei'));
  const archive = localStorage.getItem(`zhiyu-stitch-desktop-v2:${accountId}`);
  const backupKey = `zhiyu-he-pre-ai-history:v1:${accountId}`;
  const backup = localStorage.getItem(backupKey);
  let old: Message[];
  try {
    const saved = archive ? JSON.parse(archive) : null;
    const merged = new Map<string, Message>();
    for (const item of [...records(backup ? JSON.parse(backup) : []), ...records(saved?.messages?.['he-jiawei'] || []), ...records(local ? JSON.parse(local) : [])]) {
      const existing = merged.get(item.id);
      if (existing && existing.text !== item.text) throw Error('何嘉伟的旧留言存在重复ID冲突，原记录已保留');
      merged.set(item.id, { ...existing, ...item });
    }
    const ids = new Set(merged.keys());
    old = [...merged.values()].map(item => ({ id: item.id, text: item.text, mine: true, time: item.time || '',
      ...(item.at && Number.isFinite(Date.parse(item.at)) ? { at: item.at } : {}),
      ...(item.image ? { image: item.image } : {}), ...(item.audio ? { audio: item.audio } : {}),
      ...(item.audioDurationSeconds !== undefined ? { audioDurationSeconds: item.audioDurationSeconds } : {}),
      ...(item.file ? { file: item.file } : {}), ...(item.replyTo && ids.has(item.replyTo) ? { replyTo: item.replyTo } : {}) }));
  } catch (error) {
    throw error instanceof Error ? error : Error('何嘉伟的旧留言无法读取，原记录已保留');
  }
  // An optional second local copy must not block the migration when storage is full.
  // The source keys remain intact; the API persists all bytes before live previews replace the archive.
  if (!backup && old.length) { try { localStorage.setItem(backupKey, JSON.stringify(old)); } catch { /* Preserve existing source keys. */ } }
  // Only legacy records affect the signature. The App's live preview changes on every poll.
  const signature = JSON.stringify(old);
  if (completed.get(accountId) === signature) return;
  const running = pending.get(accountId);
  if (running) { await running; return ensureHeChatHistory(accountId); }
  const work = (async () => {
    if (old.length) {
      const auth = await fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' });
      const identity = await auth.json() as { account?: { id: string } };
      if (!auth.ok || identity.account?.id !== accountId) throw Error('账号已变化，请重新打开何嘉伟的聊天');
      // Imported IDs identify the original local records. Live API previews must never be re-imported.
      const response = await npcFetch('/api/npc/he-jiawei?mode=normal', { cache: 'no-store', headers: { 'X-Zhiyu-Account': accountId } });
      const session = await response.json() as { messages?: { id: string }[] };
      if (!response.ok || !Array.isArray(session.messages)) throw Error('何嘉伟的聊天服务暂时无法连接');
      const known = new Set<string>(session.messages.map((item: { id: string }) => item.id));
      const missing = old.filter(item => !known.has(item.id));
      for (let start = 0; start < missing.length;) {
        const batch: Message[] = [];
        let bytes = 100;
        while (start < missing.length && batch.length < 100) {
          const size = new TextEncoder().encode(JSON.stringify(missing[start])).length;
          if (batch.length && bytes + size > 10 * 1024 * 1024) break;
          batch.push(missing[start++]); bytes += size + 1;
        }
        const current = await fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' });
        const active = await current.json() as { account?: { id: string } };
        if (!current.ok || active.account?.id !== accountId) throw Error('账号已变化，请重新打开何嘉伟的聊天');
        const result = await npcFetch('/api/npc/he-jiawei?mode=normal', { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Zhiyu-Account': accountId }, body: JSON.stringify({ action: 'import_history', messages: batch }) });
        const data = await result.json() as { error?: string };
        if (!result.ok) throw Error(data.error || '旧留言迁移暂未完成，原记录已保留');
      }
    }
    completed.set(accountId, signature);
  })();
  pending.set(accountId, work);
  try { await work; } finally { pending.delete(accountId); }
}
