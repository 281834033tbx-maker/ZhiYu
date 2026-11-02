import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { assets } from '../../lib/npc/contracts';
import type { GroupChat, GroupMessage, GroupMediaPart } from '../../lib/npc/group-chat';
import { partInput } from './media';

export function groupMessageInputText(message?: GroupMessage) {
  return !message ? '' : message.part ? partInput(message.part) : message.text || '';
}

/** Only current media or a real visible reply target is attached, never arbitrary history. */
export function groupMediaInputs(root:string, owner:string, group:GroupChat, incoming?:GroupMessage) {
  const messages:GroupMessage[]=[];
  if (incoming) messages.push(incoming);
  if (incoming?.replyTo) {
    const quoted=group.messages.find(message=>message.id===incoming.replyTo);
    if (quoted && quoted.id!==incoming.id) messages.push(quoted);
  }
  const images:string[]=[], imageMessageIds:string[]=[];
  for (const message of messages) {
    if (message.senderId!=='user') continue;
    const part:GroupMediaPart|undefined=message.part;
    let path:string|undefined;
    if (part?.type==='upload') {
      const match=/^\/api\/npc\/media\/([a-f0-9-]{36}\.(?:png|jpg|webp|gif))$/.exec(part.url);
      if (!match) throw new Error('群图片引用无效，请重新发送');
      path=join(root,'.npc-runtime/uploads',owner,match[1]);
    } else if (part?.type==='sticker') {
      const asset=assets[part.assetId];
      if (!asset || asset.kind!=='sticker' || !asset.url.startsWith('/') || asset.url.includes('..')) throw new Error('群表情引用无效');
      path=join(root,'public',asset.url);
    }
    if (!path) continue;
    if (!existsSync(path)) throw new Error('群图片文件不可用，请重新发送；本轮不会猜测图片内容');
    if (!images.includes(path)) {images.push(path);imageMessageIds.push(message.id);}
  }
  return {images,imageMessageIds};
}
