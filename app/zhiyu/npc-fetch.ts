// Bootstrap the shared HttpOnly identity once before any NPC request can race it.
let identity: Promise<void> | undefined;
export async function npcFetch(url: string, init?: RequestInit) {
  identity ??= fetch('/api/npc/xia-xia?mode=normal', {cache:'no-store'}).then(response=>{
    if(!response.ok)throw new Error('NPC 会话初始化失败');
  }).catch(error=>{identity=undefined;throw error;});
  await identity;
  return fetch(url, init);
}
