/** Shared private/group message timestamp; keep the existing private-chat format. */
export function formatMessageTime(at: string, now = new Date()): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  const today = now.toDateString() === date.toDateString();
  return (today ? '今天 ' : date.toLocaleDateString('zh-CN') + ' ')
    + date.toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'});
}
