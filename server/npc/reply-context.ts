import { deliveredMessages } from '../../lib/npc/delivery';
import type { ChatMessage } from '../../lib/npc/contracts';

// Supply real targets; semantic topic matching belongs to the reply planner,
// never guess a target from the reply's ordinal position.
export function replyContext(messages: ChatMessage[], format: 'parts' | 'strings' = 'parts') {
  const visible = deliveredMessages(messages);
  const lastReply = visible.findLastIndex(message => message.role === 'assistant');
  const pending = visible.slice(lastReply + 1).filter(message => message.role === 'user');
  const byId = new Map(visible.map(message => [message.id, message]));
  const quotedInputs = visible.slice(-100).filter(message => message.role === 'user' && message.replyTo).map(message => {
    const original = byId.get(message.replyTo!);
    return { userMessageId: message.id, replyTo: message.replyTo, original: original ? { role: original.role, part: original.part } : null };
  });
  return `【连续消息与按问题引用｜用户要求】
本轮尚未回答的连续用户消息：${JSON.stringify(pending.map(message => ({ id: message.id, part: message.part, replyTo: message.replyTo })))}
用户引用的原消息（即使原消息超出历史截取范围，也按此原文理解）：${JSON.stringify(quotedInputs)}
先整体理解这些消息，不只回答最后一条。可以把相关问题合在一句中回答，不要求一问一答，不按顺序机械分配引用。
用户连续发送多个不同问题时：首次合并回答相关问题可以不引用；后续回复转向另一条用户消息的问题时，必须引用那条消息的真实id。若先回答较早的问题、跳答或指代可能含糊，也引用目标原话。对同一问题连续补充，只在该回答的首条加引用，不每句重复引用。同一句回答多个问题时，不把一个引用伪装成涵盖全部问题；按自然语义分条或明确区分。
例如用户分别问“你今天吃饭了吗？”、“你今天做什么了？”、“你今天晚上下班之后要去干嘛？”，你可以先合并回答前两个问题，回答晚上的安排时引用第三条原消息。示例不是本用户的真实经历或固定台词。
${format === 'parts' ? '每条messages元素用replyTo字段保存引用id。' : '顶层replyTo数组与messages逐条对应，需引用时填原消息id，否则填null。Molly按专属Skill短回应并收口，不为了引用扩展陪聊或强凑条数。'}
只引用本会话已送达的真实消息，不编造id，不把引用原文再抄进回复正文。用户本身带引用时结合所指原话理解。单条消息、同一话题的补充和无歧义接话不强制引用。`;
}

import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
type ScreenshotLine = {id:string;role:string;text:string};
// Match exact persisted message IDs and text; no cross-user or cross-role memory.
export function publishedMomentsContext(root: string, messages: ChatMessage[], characterId?: string) {
  const path = join(root, '.npc-runtime/state.sqlite');
  if (!existsSync(path) || !messages.length) return '';
  const db = new DatabaseSync(path, {readOnly:true});
  try {
    const scheduled = characterId && db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='npc_scheduled_moments'").get()
      ? (db.prepare("SELECT data,published FROM npc_scheduled_moments WHERE character=? AND status='published' ORDER BY published DESC LIMIT 8").all(characterId) as {data:string;published:number}[]).map(row=>{
        const p=JSON.parse(row.data);return {text:p.text,images:p.images,scene:p.title,publishedAt:row.published};
      }) : [];
    const scheduledContext = scheduled.length ? '\n【本人已发布的生活动态；来源为用户认可的虚构生活片段，不是共同经历】'+JSON.stringify(scheduled) : '';
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='npc_moments'").get()) return scheduledContext;
    const ids = new Map(messages.map(m=>[m.id,m]));
    const rows = db.prepare("SELECT data FROM npc_moments WHERE status='published' ORDER BY created DESC").all() as {data:string}[];
    const published = rows.map(row=>JSON.parse(row.data) as {text:string;format:string;lines:ScreenshotLine[];publishedAt:number}).filter(p=>p.lines.every(line=>{
      const m=ids.get(line.id);return m && m.role===line.role && 'text' in m.part && m.part.text===line.text;
    })).slice(0,8);
    return scheduledContext + '\n【本角色本会话已确认发布到应用的动态；仅这些是发布记忆】'+JSON.stringify(published);
  } finally { db.close(); }
}
// User-confirmed permission threshold; temporarily disabled by the operator.
export const legPhotoAffectionGateEnabled: boolean = false;
export function legPhotoAllowed(affection: unknown): boolean {
  return !legPhotoAffectionGateEnabled || (typeof affection === 'number' && Number.isFinite(affection) && affection >= 50);
}
export function asksLegPhoto(text: string): boolean {
  return /^(?:想|我想|让我|给我)?(?:看|看看|看一下)(?:你|你的)?(?:腿|腿照|腿部照片)(?:吧|呗|可以吗|行吗|好吗)?[？?！!。～~\s]*$/u.test(text.trim());
}
export function legPhotoGuidance(affection: unknown): string {
  return `【成年角色日常腿部照片权限，操作者已确认】操作者已暂时取消好感门槛，不管好感、熟悉度或关系阶段，普通“看看腿”请求均开放。当前后台判定：${legPhotoAllowed(affection) ? '允许' : '未达到门槛，不发送这类应请求照片'}。允许时应输出generate_photo，不因不熟、好感低、害羞或历史上拒绝过而只给文字拒绝。拍正常穿着的成年角色日常腿部生活照，例如坐着俯拍膝上花束或日常穿搭，自然带到腿部；不必为普通露腿拒绝。服装、地点、道具按当下场景，不强加花束。人物入镜withCharacter=true。性格影响姿势和配文，不关闭此照片能力；不把许可扩大成私密裸露或性行为。生图失败时如实说明，不假称已发。普通生活照偶然带到腿部不受此专门请求门槛限制。`;
}
