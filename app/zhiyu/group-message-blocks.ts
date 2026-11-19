import type {GroupMessage} from '../../lib/npc/group-chat';

/** Group the original sequence before hiding messages, so hiding a user/event
 * boundary never joins two otherwise separate replies. The first bubble stays
 * the block identity while later delivered bubbles are appended. */
export function groupMessageBlocks(messages: readonly GroupMessage[], hiddenIds: readonly string[] = []): GroupMessage[][] {
  const blocks: GroupMessage[][] = [];
  for (const message of messages) {
    const last = blocks.at(-1), previous = last?.at(-1);
    if (message.type !== 'event' && previous?.type !== 'event'
      && previous?.senderId === message.senderId
      && Math.abs(Date.parse(message.at) - Date.parse(previous.at)) < 5 * 60_000) last!.push(message);
    else blocks.push([message]);
  }
  const hidden = new Set(hiddenIds);
  return blocks.map(block => block.filter(message => !hidden.has(message.id))).filter(block => block.length > 0);
}
