// Bootstrap the shared HttpOnly identity once before any NPC request can race it.
let identity: Promise<void> | undefined;
export function ensureNpcIdentity() {
  identity ??= fetch('/api/npc/xia-xia?mode=normal', {cache:'no-store'}).then(response=>{
    if(!response.ok)throw new Error('NPC 会话初始化失败');
  }).catch(error=>{identity=undefined;throw error;});
  return identity;
}
export async function npcFetch(url: string, init?: RequestInit) {
  await ensureNpcIdentity();
  return fetch(url, init);
}
