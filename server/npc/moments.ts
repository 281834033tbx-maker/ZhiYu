import type { ChatMessage } from '../../lib/npc/contracts';

export type MomentDecision = { format: 'text' | 'screenshot' | 'screenshot_text'; text: string; reason: string; messageIds: string[] };
export type ScreenshotLine = { id: string; role: 'user' | 'assistant'; text: string; at: string };
// Conservative automatic filter in addition to semantic review and user confirmation.
const privateText = /不要.{0,8}(截图|发朋友圈|公开|分享)|别.{0,6}(截图|公开|发出去)|保密|身份证|银行卡|密码|验证码|住址|病历|诊断|银行账号|\b1[3-9]\d{9}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i;
export function selectMoment(raw: unknown, messages: ChatMessage[], latestUserId: string): (MomentDecision & { lines: ScreenshotLine[] }) | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (d.decision !== 'post' || d.publicSafe !== true || !['text', 'screenshot', 'screenshot_text'].includes(String(d.format))) return null;
  if (typeof d.text !== 'string' || d.text.length > 300 || typeof d.reason !== 'string' || d.reason.length > 200) return null;
  if (!Array.isArray(d.messageIds) || d.messageIds.length < 2 || d.messageIds.length > 6 || d.messageIds.some(id => typeof id !== 'string')) return null;
  const ids = d.messageIds as string[];
  const start = messages.findIndex(m => m.id === ids[0]);
  const selected = messages.slice(start, start + ids.length);
  if (start < 0 || selected.length !== ids.length || selected.some((m, i) => m.id !== ids[i])) return null;
  if (!ids.includes(latestUserId) || !selected.some(m => m.role === 'assistant')) return null;
  if (selected.some(m => !['text', 'emoji'].includes(m.part.type) || !('text' in m.part))) return null;
  const lines = selected.map(m => ({ id: m.id, role: m.role, text: 'text' in m.part ? m.part.text : '', at: m.at }));
  if (lines.some(m => !m.text.trim() || m.text.length > 600) || lines.reduce((n, m) => n + m.text.length, 0) > 1800) return null;
  if (privateText.test(messages.slice(-16).map(m => 'text' in m.part ? m.part.text : '').join('\n')) || privateText.test(d.text)) return null;
  if (d.format === 'screenshot' && d.text !== '') return null;
  if (d.format !== 'screenshot' && !d.text.trim()) return null;
  return { format: d.format as MomentDecision['format'], text: d.text, reason: d.reason, messageIds: ids, lines };
}
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[c]!));
function wrap(text: string) {
  const result: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '', width = 0;
    for (const { segment } of new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(paragraph)) {
      const advance = /^[\x20-\x7e]+$/.test(segment) ? 14 : 25;
      if (width + advance > 400 && line) { result.push(line); line = ''; width = 0; }
      line += segment; width += advance;
    }
    result.push(line);
  }
  return result;
}
// Deterministic server rendering: no model-generated text, external images or script.
export function renderChatScreenshot(name: string, lines: ScreenshotLine[]) {
  let y = 114;
  const content = lines.map(line => {
    const wrapped = wrap(line.text), height = wrapped.length * 36 + 30;
    const mine = line.role === 'assistant'; // NPC's own perspective.
    const x = mine ? 164 : 96, avatarX = mine ? 624 : 24;
    const label = mine ? name.slice(0, 1) : '友';
    const bubble = `<rect x="${avatarX}" y="${y}" width="48" height="48" rx="12" fill="${mine ? '#eed7cf' : '#dcdfe2'}"/><text x="${avatarX + 24}" y="${y + 32}" text-anchor="middle" font-size="23">${escape(label)}</text><rect x="${x}" y="${y}" width="436" height="${height}" rx="14" fill="${mine ? '#d7eccc' : '#fff'}"/><text x="${x + 18}" y="${y + 39}" font-size="24" xml:space="preserve">${wrapped.map((t, i) => `<tspan x="${x + 18}" dy="${i ? 36 : 0}">${escape(t)}</tspan>`).join('')}</text>`;
    y += height + 24;
    return bubble;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="696" height="${y + 20}" viewBox="0 0 696 ${y + 20}"><rect width="696" height="100%" fill="#f1f2f3"/><g fill="#292b2d" font-family="PingFang SC,Microsoft YaHei,sans-serif"><text x="348" y="46" text-anchor="middle" font-size="25">${escape(name)} · 对方</text><text x="348" y="77" text-anchor="middle" font-size="16" fill="#85898e">聊天片段</text>${content}</g></svg>`;
}
