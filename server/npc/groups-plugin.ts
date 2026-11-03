import {scheduleGroupDelivery,deliveryView} from '../../lib/npc/delivery';
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { groupNpcCatalog, type GroupChat, type GroupCreateInput, type GroupMember, type GroupMessage } from '../../lib/npc/group-chat';
import { nameGroupWithMolly, validGroupName, type GroupNamer } from './group-naming';
import { generateGroupDialogue, parseGroupDialogue, groupOperationalSpeakers, groupParticipationPlan, validDate, validTime, type GroupDialogueContext, type GroupDialogueRunner, type GroupDialogueOutput } from './group-dialogue';
import type { GroupParticipationPlan } from './group-routing';
import { TaskMemoryStore } from './group-task-memory';
import { shanghaiDate, reminderOccurrence, reminderStillCurrent, explicitTimeMatches, explicitConfirmation, reminderSuppressed } from './group-reminders';
import { userPart } from './media';
import { groupMediaInputs } from './group-media';
import { observeGroupActivity,recordGroupSocialExpressions } from './social-continuity';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const GROUP_ID = /^group-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const directory = new Map<string, (typeof groupNpcCatalog)[number]>(groupNpcCatalog.map(person => [person.id, person]));
const MAX_BODY_BYTES = 384 * 1024;
type GroupRow = { data: string; input_hash: string };
type StoredGroup = GroupChat & { openingDone?: boolean; hiddenBefore?: number; generationEpoch?: number };
type GroupJob = { seq: number; owner: string; group_id: string; request_id: string; kind: 'opening' | 'message' | 'confirmation' | 'reminder'; status: string; data: string; error: string };
type JobInput = { messageId?: string; inputHash?: string; reminderId?: string; occurrence?: string; participationPlan?:GroupParticipationPlan };

export class GroupRequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function validAvatar(value: unknown): value is string {
  // Reject control characters in URL/data values.
  // oxlint-disable-next-line no-control-regex
  if (typeof value !== 'string' || value.length > 256 * 1024 || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  if (value.startsWith('/') && !value.startsWith('//') && value.length <= 2048) return true;
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(value)) return true;
  try { return value.length <= 2048 && new URL(value).protocol === 'https:'; } catch { return false; }
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GroupRequestError(400, '无效请求');
  return value as Record<string, unknown>;
}

function onlyFields(body: Record<string, unknown>, fields: string[]) {
  if (Object.keys(body).some(field => !fields.includes(field))) throw new GroupRequestError(400, '请求包含不支持的字段');
}

export function validateGroupCreate(value: unknown): GroupCreateInput {
  const body = objectBody(value);
  onlyFields(body, ['requestId', 'sourceCharacterId', 'goal', 'memberIds', 'consent', 'self']);
  if (typeof body.requestId !== 'string' || !UUID.test(body.requestId)) throw new GroupRequestError(400, '无效建群请求编号');
  if (typeof body.sourceCharacterId !== 'string' || !directory.has(body.sourceCharacterId)) throw new GroupRequestError(400, '建群来源人物不存在');
  if (body.consent !== undefined && typeof body.consent !== 'boolean') throw new GroupRequestError(400, '无效同意状态');
  if (body.sourceCharacterId !== 'molly' && body.consent !== true) throw new GroupRequestError(400, '请先同意由 Molly 建群');
  // Multiline goals allow line breaks, but reject other control characters.
  if (typeof body.goal !== 'string' || !body.goal.trim() || Array.from(body.goal.trim()).length > 1200
    // oxlint-disable-next-line no-control-regex
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body.goal)) throw new GroupRequestError(400, '请填写有效的群聊目标');
  if (!Array.isArray(body.memberIds) || body.memberIds.length > groupNpcCatalog.length
    || body.memberIds.some(id => typeof id !== 'string' || !directory.has(id))) throw new GroupRequestError(400, '群成员不存在');
  const self = objectBody(body.self);
  onlyFields(self, ['name', 'avatar']);
  if (!validGroupName(self.name, 40)) throw new GroupRequestError(400, '无效用户名字');
  if (self.avatar !== undefined && !validAvatar(self.avatar)) throw new GroupRequestError(400, '无效用户头像');
  return {
    requestId: body.requestId.toLowerCase(), sourceCharacterId: body.sourceCharacterId,
    goal: body.goal.trim(), memberIds: [...new Set(body.memberIds as string[])],
    ...(body.consent === undefined ? {} : { consent: body.consent }),
    self: { name: self.name, ...(self.avatar === undefined ? {} : { avatar: self.avatar as string }) },
  };
}

function memberIds(input: GroupCreateInput): string[] {
  return [...new Set(['user', ...(input.sourceCharacterId === 'molly' ? [] : [input.sourceCharacterId]), 'molly', ...input.memberIds])];
}

/** Group writes are independent of every private session and relationship. */
export class GroupChatStore {
  private pending = new Map<string, { hash: string; promise: Promise<GroupChat> }>();
  private active = new Set<string>();
  private closed = false;
  private taskMemory: TaskMemoryStore;
  constructor(
    private db: DatabaseSync,
    private root: string,
    private namer: GroupNamer = nameGroupWithMolly,
    private now: () => number = Date.now,
    private uuid: () => string = randomUUID,
    private dialogue: GroupDialogueRunner = generateGroupDialogue,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS npc_group_chats (
      owner TEXT NOT NULL, id TEXT NOT NULL, request_id TEXT NOT NULL, input_hash TEXT NOT NULL,
      data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(owner,id), UNIQUE(owner,request_id)
    ); CREATE INDEX IF NOT EXISTS npc_group_chats_owner_updated ON npc_group_chats(owner,updated_at);
    CREATE TABLE IF NOT EXISTS npc_group_jobs (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, group_id TEXT NOT NULL,
      request_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL,
      error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, UNIQUE(owner,group_id,request_id)
    );
    CREATE TABLE IF NOT EXISTS npc_group_mutations (
      owner TEXT NOT NULL, group_id TEXT NOT NULL, request_id TEXT NOT NULL,
      action TEXT NOT NULL, input_hash TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(owner,group_id,request_id)
    );`);
    // Interrupted generation has no committed output; recover exactly once.
    db.prepare("UPDATE npc_group_jobs SET status='queued' WHERE status='running'").run();
    this.taskMemory = new TaskMemoryStore(db);
  }

  private owner(owner: string) {
    if (!UUID.test(owner)) throw new GroupRequestError(401, '请先登录智域');
  }

  private expose(row: GroupRow): GroupChat {
    const { openingDone: _openingDone, hiddenBefore = 0, generationEpoch: _generationEpoch, ...group } = JSON.parse(row.data) as StoredGroup;
    return { ...group, createdBy: 'molly', chatEnabled: group.chatEnabled === true, messages: (group.messages || []).slice(hiddenBefore) };
  }

  private stored(owner: string, id: unknown): StoredGroup {
    this.owner(owner);
    if (typeof id !== 'string' || !GROUP_ID.test(id)) throw new GroupRequestError(400, '无效群聊');
    const row = this.db.prepare('SELECT data,input_hash FROM npc_group_chats WHERE owner=? AND id=?').get(owner, id) as GroupRow | undefined;
    if (!row) throw new GroupRequestError(404, '群聊不存在');
    return JSON.parse(row.data) as StoredGroup;
  }

  private save(owner: string, group: StoredGroup) {
    if (this.closed) return;
    group.updatedAt = new Date(this.now()).toISOString();
    this.db.prepare('UPDATE npc_group_chats SET data=?,updated_at=? WHERE owner=? AND id=?').run(JSON.stringify(group), group.updatedAt, owner, group.id);
  }

  private joined(group: StoredGroup) {
    if (group.leftAt) throw new GroupRequestError(410, '你已退出此群');
  }

  get(owner: string, id: unknown): GroupChat {
    const { openingDone: _openingDone, hiddenBefore = 0, generationEpoch: _generationEpoch, ...group } = this.stored(owner, id);
    const jobs = this.db.prepare("SELECT status,error,data,created_at FROM npc_group_jobs WHERE owner=? AND group_id=? AND status IN ('queued','running','failed') ORDER BY seq").all(owner, group.id) as { status: string; error: string;data:string;created_at:string }[];
    const now=this.now(),future=group.messages.slice(hiddenBefore).filter(message=>!message.deliveryCancelled&&(message.deliverAt||0)>now).sort((a,b)=>a.deliverAt!-b.deliverAt!),next=future[0];
    const preparing=!group.leftAt&&!!jobs[0]&&['queued','running'].includes(jobs[0].status);
    let speaker:string|undefined=next?.senderId;let typingAfter=next?.typingAt,typingUntil=next?.deliverAt;
    if(!next&&preparing){
      let input:JobInput={};try{input=JSON.parse(jobs[0].data);}catch{/* No invented actor from malformed metadata. */}
      const source=group.messages.find(message=>message.id===input.messageId);
      const candidate=input.participationPlan?.requiredReplyIds[0]||source?.mentionIds?.[0]||'molly';
      speaker=group.members.some(member=>member.id===candidate)?candidate:undefined;
      const since=Date.parse(jobs[0].created_at);typingAfter=Number.isFinite(since)?deliveryView([],{since},now).typingAfter:undefined;typingUntil=undefined;
    }
    return { ...group, messages: group.messages.slice(hiddenBefore).filter(message=>!message.deliveryCancelled&&(!message.deliverAt||message.deliverAt<=now)).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)),
      pending:!group.leftAt&&(preparing||future.length>0),typingName:speaker?group.members.find(member=>member.id===speaker)?.name:undefined,typingAfter,typingUntil,
      error: group.leftAt ? '' : jobs.find(job => job.status === 'failed')?.error || '' };

  }

  list(owner: string): GroupChat[] {
    this.owner(owner);
    return (this.db.prepare('SELECT id FROM npc_group_chats WHERE owner=? ORDER BY updated_at DESC,id DESC').all(owner) as { id: string }[])
      .map(row => this.get(owner, row.id)).filter(group => !group.leftAt);
  }

  create(owner: string, value: unknown): Promise<GroupChat> {
    this.owner(owner);
    const input = validateGroupCreate(value);
    const ids = memberIds(input);
    const hash = createHash('sha256').update(JSON.stringify({
      sourceCharacterId: input.sourceCharacterId, goal: input.goal, ids, self: input.self,
    })).digest('hex');
    const previous = this.db.prepare('SELECT data,input_hash FROM npc_group_chats WHERE owner=? AND request_id=?').get(owner, input.requestId) as GroupRow | undefined;
    if (previous) {
      if (previous.input_hash !== hash) throw new GroupRequestError(409, '这个建群请求编号已用于其他需求');
      const group = this.get(owner, this.expose(previous).id);
      if (group.leftAt) throw new GroupRequestError(410, '你已退出此群');
      return Promise.resolve(group);
    }
    const key = `${owner}:${input.requestId}`;
    const pending = this.pending.get(key);
    if (pending) {
      if (pending.hash !== hash) throw new GroupRequestError(409, '这个建群请求正在处理其他需求');
      return pending.promise;
    }
    const promise = this.build(owner, input, ids, hash).finally(() => { this.pending.delete(key); });
    this.pending.set(key, { hash, promise });
    return promise;
  }

  private async build(owner: string, input: GroupCreateInput, ids: string[], hash: string): Promise<GroupChat> {
    const names = ids.map(id => id === 'user' ? input.self.name : directory.get(id)!.name);
    let name: string;
    try {
      name = await this.namer(this.root, { goal: input.goal, memberNames: names });
      if (!validGroupName(name, 24)) throw new Error('Invalid title');
    } catch {
      // Do not claim a canned title was chosen by Molly when model naming failed.
      throw new GroupRequestError(503, 'Molly 暂时没能起好群名，请稍后重试。');
    }
    if (this.closed) throw new GroupRequestError(503, '群聊服务已关闭，请重新打开后重试。');
    const at = new Date(this.now()).toISOString();
    const members: GroupMember[] = ids.map((id, order) => ({
      id, ...(id === 'user' ? input.self : { name: directory.get(id)!.name, avatar: directory.get(id)!.avatar }),
      role: id === 'user' ? 'user' : id === 'molly' ? 'admin' : 'npc', joinedAt: at, order,
    }));
    const group: GroupChat = {
      id: `group-${this.uuid()}`, name, goal: input.goal, sourceCharacterId: input.sourceCharacterId,
      createdAt: at, updatedAt: at, createdBy: 'molly', chatEnabled: true, members,
      messages: [], namingSource: 'molly-model',
      purpose: '聊天群', pinned: false,
      muted: false,
    };
    if (!GROUP_ID.test(group.id)) throw new Error('Invalid generated group ID');
    // Handle another service instance completing an identical request while naming.
    this.db.prepare('INSERT OR IGNORE INTO npc_group_chats VALUES(?,?,?,?,?,?,?)').run(owner, group.id, input.requestId, hash, JSON.stringify(group), at, at);
    const saved = this.db.prepare('SELECT data,input_hash FROM npc_group_chats WHERE owner=? AND request_id=?').get(owner, input.requestId) as GroupRow | undefined;
    if (!saved || saved.input_hash !== hash) throw new GroupRequestError(409, '这个建群请求编号已用于其他需求');
    this.taskMemory.record(owner, group.id, `goal:${input.requestId}`, input.goal, at);
    return this.open(owner, this.expose(saved).id);
  }

  rename(owner: string, groupId: unknown, name: unknown): GroupChat {
    this.owner(owner);
    if (typeof groupId !== 'string' || !GROUP_ID.test(groupId) || !validGroupName(name)) throw new GroupRequestError(400, '无效群名');
    const group = this.stored(owner, groupId);
    this.joined(group);
    group.name = name;
    group.updatedAt = new Date(this.now()).toISOString();
    this.save(owner, group);
    return this.get(owner, groupId);
  }

  private mutate(owner: string, group: StoredGroup, requestId: unknown, action: string, input: unknown, apply: () => void): GroupChat {
    if (typeof requestId !== 'string' || !UUID.test(requestId)) throw new GroupRequestError(400, '无效群设置请求编号');
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const previous = this.db.prepare('SELECT action,input_hash FROM npc_group_mutations WHERE owner=? AND group_id=? AND request_id=?')
      .get(owner, group.id, requestId) as { action: string; input_hash: string } | undefined;
    if (previous) {
      if (previous.action !== action || previous.input_hash !== hash) throw new GroupRequestError(409, '这个请求编号已用于其他群设置');
      return this.get(owner, group.id);
    }
    if (this.db.prepare('SELECT seq FROM npc_group_jobs WHERE owner=? AND group_id=? AND request_id=?').get(owner, group.id, requestId))
      throw new GroupRequestError(409, '这个请求编号已用于其他群操作');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      apply();
      this.save(owner, group);
      this.db.prepare('INSERT INTO npc_group_mutations VALUES(?,?,?,?,?,?)').run(owner, group.id, requestId, action, hash, new Date(this.now()).toISOString());
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.get(owner, group.id);
  }

  settings(owner: string, value: Record<string, unknown>): GroupChat {
    onlyFields(value, ['groupId', 'purpose', 'pinned', 'announcement', 'muted', 'requestId']);
    const group = this.stored(owner, value.groupId);
    this.joined(group);
    const hasPurpose = Object.hasOwn(value, 'purpose'), hasPinned = Object.hasOwn(value, 'pinned');
    const hasAnnouncement = Object.hasOwn(value, 'announcement'), hasMuted = Object.hasOwn(value, 'muted');
    if (!hasPurpose && !hasPinned && !hasAnnouncement && !hasMuted) throw new GroupRequestError(400, '请选择要修改的群设置');
    if (hasPurpose && (typeof value.purpose !== 'string' || (value.purpose.trim() && !validGroupName(value.purpose.trim(), 120))))
      throw new GroupRequestError(400, '群备注请使用不超过120字的文字');
    if (hasPinned && typeof value.pinned !== 'boolean') throw new GroupRequestError(400, '无效置顶设置');
    if (hasMuted && typeof value.muted !== 'boolean') throw new GroupRequestError(400, '无效免打扰设置');
    if (hasAnnouncement && (typeof value.announcement !== 'string' || Array.from(value.announcement.trim()).length > 2000
      // Allow ordinary multiline announcements, rejecting other controls.
      // oxlint-disable-next-line no-control-regex
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.announcement))) throw new GroupRequestError(400, '群公告请使用不超过2000字的文字');
    const purpose = typeof value.purpose === 'string' ? value.purpose.trim() : undefined;
    const announcement = typeof value.announcement === 'string' ? value.announcement.trim() : undefined;
    return this.mutate(owner, group, value.requestId, 'settings', { ...(hasPurpose ? { purpose } : {}), ...(hasPinned ? { pinned: value.pinned } : {}),
      ...(hasAnnouncement ? { announcement } : {}), ...(hasMuted ? { muted: value.muted } : {}) }, () => {
      if (hasPurpose) { if (purpose) group.purpose = purpose; else delete group.purpose; }
      if (hasPinned) group.pinned = value.pinned as boolean;
      if (hasAnnouncement) { if (announcement) group.announcement = announcement; else delete group.announcement; }
      if (hasMuted) group.muted = value.muted as boolean;
    });
  }

  members(owner: string, value: Record<string, unknown>): GroupChat {
    onlyFields(value, ['groupId', 'addIds', 'removeIds', 'requestId']);
    const group = this.stored(owner, value.groupId);
    this.joined(group);
    const allowedNpc = (id: unknown) => typeof id === 'string' && id !== 'molly' && directory.has(id);
    if (!Array.isArray(value.addIds) || !Array.isArray(value.removeIds)
      || value.addIds.length > groupNpcCatalog.length || value.removeIds.length > groupNpcCatalog.length
      || !value.addIds.every(allowedNpc) || !value.removeIds.every(allowedNpc)) throw new GroupRequestError(400, '只能添加或移除目录中的普通 NPC；用户和 Molly 必须留在群里');
    const addIds = [...new Set(value.addIds as string[])], removeIds = [...new Set(value.removeIds as string[])];
    if (addIds.some(id => removeIds.includes(id))) throw new GroupRequestError(400, '同一成员不能同时添加和移除');
    return this.mutate(owner, group, value.requestId, 'members', { addIds, removeIds }, () => {
      const removed = group.members.filter(member => removeIds.includes(member.id));
      if (removed.length) {
        for(const message of group.messages)if((message.deliverAt||0)>this.now()&&removed.some(member=>member.id===message.senderId))message.deliveryCancelled=true;
        group.formerMembers = [...(group.formerMembers || []), ...removed];
        group.members = group.members.filter(member => !removeIds.includes(member.id));
        if (removed.some(member => member.id === 'zhou-chef')) {
          for (const reminder of group.reminders || []) if (reminder.status === 'active') reminder.status = 'paused';
        }
      }
      let order = Math.max(-1, ...group.members.map(member => member.order), ...(group.formerMembers || []).map(member => member.order));
      const at = new Date(this.now()).toISOString();
      for (const id of addIds) {
        if (group.members.some(member => member.id === id)) continue;
        const person = directory.get(id)!;
        group.members.push({ id, name: person.name, avatar: person.avatar, role: 'npc', joinedAt: at, order: ++order });
      }
    });
  }

  private enqueue(owner: string, groupId: string, requestId: string, kind: GroupJob['kind'], input: JobInput) {
    this.db.prepare("INSERT OR IGNORE INTO npc_group_jobs(owner,group_id,request_id,kind,status,data,created_at) VALUES(?,?,?,?,'queued',?,?)")
      .run(owner, groupId, requestId, kind, JSON.stringify(input), new Date(this.now()).toISOString());
  }

  open(owner: string, id: unknown): GroupChat {
    const group = this.stored(owner, id);
    this.joined(group);
    if (!group.chatEnabled) { group.chatEnabled = true; this.save(owner, group); }
    if (!group.openingDone) this.enqueue(owner, group.id, 'opening', 'opening', {});
    return this.get(owner, group.id);
  }

  send(owner: string, value: Record<string, unknown>): GroupChat {
    this.owner(owner);
    onlyFields(value, ['groupId', 'text', 'mentionIds', 'requestId', 'replyTo', 'imageId', 'audioId', 'assetId']);
    if (typeof value.requestId !== 'string' || !UUID.test(value.requestId) || typeof value.text !== 'string' || value.text.length > 12000) throw new GroupRequestError(400, '无效群消息');
    const mediaKeys=['imageId','audioId','assetId'].filter(key=>value[key]!==undefined);
    if (mediaKeys.length>1) throw new GroupRequestError(400,'一条群消息只支持一个媒体附件');
    if (value.audioId!==undefined && value.text.trim()) throw new GroupRequestError(400,'请先发送文字，再单独发送语音');
    const mediaPart=mediaKeys.length ? userPart(this.root,owner,value) : null;
    if (mediaKeys.length && (!mediaPart || !['upload','voice','sticker'].includes(mediaPart.type))) throw new GroupRequestError(400,'群媒体不存在或不属于当前账号，请重新发送');
    if (!mediaPart && !value.text.trim()) throw new GroupRequestError(400,'无效群消息');
    if (value.replyTo !== undefined && (typeof value.replyTo !== 'string' || !value.replyTo.trim() || value.replyTo.length > 180)) throw new GroupRequestError(400, '无效引用消息');
    const group = this.stored(owner, value.groupId);
    this.joined(group);
    if (!Array.isArray(value.mentionIds) || value.mentionIds.length > group.members.length
      || value.mentionIds.some(id => typeof id !== 'string' || !group.members.some(member => member.id === id))) throw new GroupRequestError(400, '无效@成员');
    const mentions = [...new Set(value.mentionIds as string[])];
    const replyTo = value.replyTo as string | undefined;
    // Omitting replyTo retains the exact hash shape used by existing request IDs.
    const hash = createHash('sha256').update(JSON.stringify({ text: value.text.trim(), mentions, ...(replyTo ? {replyTo} : {}),
      ...(mediaKeys.length?{media:Object.fromEntries(mediaKeys.map(key=>[key,value[key]]))}:{}) })).digest('hex');
    const prior = this.db.prepare('SELECT data FROM npc_group_jobs WHERE owner=? AND group_id=? AND request_id=?').get(owner, group.id, value.requestId) as { data: string } | undefined;
    if (prior) {
      if ((JSON.parse(prior.data) as JobInput).inputHash !== hash) throw new GroupRequestError(409, '这个发送编号已用于另一条群消息');
      return this.get(owner, group.id);
    }
    const original = replyTo ? group.messages.slice(group.hiddenBefore || 0).find(message => message.id === replyTo) : undefined;
    if (replyTo && !original) throw new GroupRequestError(400, '引用的消息已不可用，请取消引用后重试');
    const eventLabels = {'plan-confirmed': '确认了一周计划', 'reminder-confirmed': '确认了提醒安排', 'reminder-paused': '暂停了提醒', 'reminder-resumed': '恢复了提醒', 'reminder-cancelled': '取消了提醒'};
    const quote = original ? {
      id: original.id, senderId: original.senderId, senderName: original.senderName, type: original.type,
      text: original.type === 'event' ? (original.event ? eventLabels[original.event.kind] : '更新了群任务')
        : original.text || ({text: '', image: '[图片]', sticker: '[动画表情]', voice: '[语音]'}[original.type]),
      ...(original.mentionIds?.length ? {mentionIds: [...original.mentionIds]} : {}),
    } : undefined;
    this.open(owner, group.id);
    group.chatEnabled = true;
    const part=mediaPart?.type==='sticker' ? {...mediaPart,type:'sticker' as const}
      : mediaPart?.type==='upload'||mediaPart?.type==='voice' ? mediaPart : undefined;
    const message: GroupMessage = { id: this.uuid(), senderId: 'user', senderName: group.members.find(member => member.id === 'user')!.name,
      type: part?.type==='upload'?'image':part?.type==='voice'?'voice':part?.type==='sticker'?'sticker':'text',
      text: part?.type==='voice'?part.text:value.text.trim(), ...(part?{part}:{}), mentionIds: mentions, requestId: value.requestId, at: new Date(this.now()).toISOString(),
      ...(quote ? {replyTo, quote} : {}) };
    group.messages.push(message);
    this.save(owner, group);
    this.taskMemory.record(owner, group.id, message.id, message.text!, message.at);
    this.enqueue(owner, group.id, value.requestId, 'message', { messageId: message.id, inputHash: hash });
    return this.get(owner, group.id);
  }

  retry(owner: string, id: unknown): GroupChat {
    const group = this.stored(owner, id);
    this.joined(group);
    this.db.prepare("UPDATE npc_group_jobs SET status='queued',error='' WHERE owner=? AND group_id=? AND status='failed'").run(owner, group.id);
    return this.get(owner, group.id);
  }

  confirmPlan(owner: string, value: Record<string, unknown>): GroupChat {
    onlyFields(value, ['groupId', 'planId', 'requestId']);
    const group = this.stored(owner, value.groupId);
    this.joined(group);
    if (typeof value.requestId !== 'string' || !UUID.test(value.requestId) || !group.plan || value.planId !== group.plan.id) throw new GroupRequestError(400, '无效计划确认');
    const previousEvent = group.messages.find(message => message.requestId === value.requestId);
    if (previousEvent) {
      if (previousEvent.event?.kind !== 'plan-confirmed' || previousEvent.event.planId !== value.planId) throw new GroupRequestError(409, '这个操作编号已用于其他群操作');
      return this.get(owner, group.id);
    }
    const event: GroupMessage = { id: this.uuid(), senderId: 'user', senderName: group.members.find(member => member.id === 'user')!.name,
      type: 'event', event: { kind: 'plan-confirmed', planId: group.plan.id }, requestId: value.requestId, at: new Date(this.now()).toISOString() };
    group.messages.push(event);
    group.plan.status = 'confirmed'; group.plan.confirmedAt = event.at; group.plan.confirmationMessageId = event.id;
    this.save(owner, group);
    this.enqueue(owner, group.id, value.requestId, 'confirmation', { messageId: event.id });
    return this.get(owner, group.id);
  }

  controlReminder(owner: string, value: Record<string, unknown>): GroupChat {
    onlyFields(value, ['groupId', 'reminderId', 'operation', 'requestId']);
    const group = this.stored(owner, value.groupId);
    this.joined(group);
    if (typeof value.requestId !== 'string' || !UUID.test(value.requestId) || !['confirm', 'pause', 'resume', 'cancel'].includes(value.operation as string)) throw new GroupRequestError(400, '无效提醒操作');
    const previousEvent = group.messages.find(message => message.requestId === value.requestId);
    if (previousEvent) {
      const expected = { confirm: 'reminder-confirmed', pause: 'reminder-paused', resume: 'reminder-resumed', cancel: 'reminder-cancelled' }[value.operation as string];
      if (!previousEvent.event || previousEvent.event.kind !== expected || previousEvent.event.reminderId !== value.reminderId) throw new GroupRequestError(409, '这个操作编号已用于其他群操作');
      return this.get(owner, group.id);
    }
    const reminder = group.reminders?.find(reminder => reminder.id === value.reminderId);
    if (!reminder) throw new GroupRequestError(404, '提醒不存在');
    const operation = value.operation as 'confirm' | 'pause' | 'resume' | 'cancel';
    if (reminder.status === 'cancelled' && operation !== 'cancel') throw new GroupRequestError(400, '已取消的提醒需要重新创建并确认');
    if (operation === 'resume' && !reminder.confirmationMessageId) throw new GroupRequestError(400, '请先确认提醒的准确日期和时间');
    if (['confirm', 'resume'].includes(operation) && !group.members.some(member => member.id === 'zhou-chef')) throw new GroupRequestError(400, '请先把赵一帆加入群，再开启做饭提醒');
    if (['confirm', 'resume'].includes(operation) && reminder.endDate < shanghaiDate(this.now())) throw new GroupRequestError(400, '提醒日期已过期');
    const kind = { confirm: 'reminder-confirmed', pause: 'reminder-paused', resume: 'reminder-resumed', cancel: 'reminder-cancelled' } as const;
    const event: GroupMessage = { id: this.uuid(), senderId: 'user', senderName: group.members.find(member => member.id === 'user')!.name, type: 'event',
      event: { kind: kind[operation], reminderId: reminder.id }, requestId: value.requestId, at: new Date(this.now()).toISOString() };
    group.messages.push(event);
    reminder.status = operation === 'pause' ? 'paused' : operation === 'cancel' ? 'cancelled' : 'active';
    if (operation === 'confirm') reminder.confirmationMessageId = event.id;
    this.save(owner, group);
    this.enqueue(owner, group.id, value.requestId, 'confirmation', { messageId: event.id });
    return this.get(owner, group.id);
  }

  clear(owner: string, value: Record<string, unknown>): GroupChat {
    onlyFields(value, ['groupId', 'requestId']);
    const group = this.stored(owner, value.groupId);
    this.joined(group);
    return this.mutate(owner, group, value.requestId, 'clear', {}, () => {
      group.hiddenBefore = group.messages.length;
      group.generationEpoch = (group.generationEpoch || 0) + 1;
      group.clearedAt = new Date(this.now()).toISOString();
      group.openingDone = true;
      this.db.prepare("UPDATE npc_group_jobs SET status='cancelled',error='' WHERE owner=? AND group_id=? AND status IN ('queued','running','failed')").run(owner, group.id);
    });
  }

  exit(owner: string, value: Record<string, unknown>): GroupChat {
    onlyFields(value, ['groupId', 'requestId']);
    const group = this.stored(owner, value.groupId);
    return this.mutate(owner, group, value.requestId, 'exit', {}, () => {
      group.leftAt ||= new Date(this.now()).toISOString();
      group.generationEpoch = (group.generationEpoch || 0) + 1;
      for (const reminder of group.reminders || []) if (reminder.status === 'active') reminder.status = 'paused';
      this.db.prepare("UPDATE npc_group_jobs SET status='cancelled',error='' WHERE owner=? AND group_id=? AND status IN ('queued','running','failed')").run(owner, group.id);
    });
  }

  remember(owner: string, value: Record<string, unknown>) {
    this.owner(owner);
    onlyFields(value, ['sourceCharacterId', 'messageId', 'text', 'at']);
    if (value.sourceCharacterId !== 'zhou-chef' || typeof value.messageId !== 'string' || !value.messageId.trim() || value.messageId.length > 180
      || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 12000
      || (value.at !== undefined && value.at !== null && (typeof value.at !== 'string' || !Number.isFinite(Date.parse(value.at))))) throw new GroupRequestError(400, '无效本机用户消息证据');
    this.taskMemory.record(owner, 'zhou-chef', value.messageId, value.text, typeof value.at === 'string' ? value.at : undefined);
  }

  private applyOperations(group: StoredGroup, output: GroupDialogueOutput, incoming?: GroupMessage) {
    const at = new Date(this.now()).toISOString();
    const evidence = (quote: string) => !!incoming?.text && incoming.text.includes(quote);
    if (output.planDraft) group.plan = { ...output.planDraft, id: `plan-${this.uuid()}`, status: 'draft', createdAt: at, updatedAt: at };
    if (output.confirmPlan) {
      if (group.plan?.id !== output.confirmPlan.planId || !evidence(output.confirmPlan.evidence) || !explicitConfirmation(incoming!.text!)) throw new Error('缺少明确用户计划确认');
      group.plan.status = 'confirmed'; group.plan.confirmedAt = at; group.plan.confirmationMessageId = incoming!.id;
    }
    for (const proposal of output.reminderProposals || []) {
      if (!validDate(proposal.startDate) || !validDate(proposal.endDate) || !validTime(proposal.time)
        || proposal.endDate < shanghaiDate(this.now()) || !group.members.some(member => member.id === 'zhou-chef')) continue;
      group.reminders ||= [];
      if (group.reminders.some(reminder => reminder.status !== 'cancelled' && reminder.meal === proposal.meal && reminder.time === proposal.time && reminder.startDate === proposal.startDate && reminder.endDate === proposal.endDate)) continue;
      const rangeConfirmed = (group.plan?.status === 'confirmed' && group.plan.days[0].date === proposal.startDate && group.plan.days[6].date === proposal.endDate)
        || (!!incoming?.text && incoming.text.includes(proposal.startDate) && incoming.text.includes(proposal.endDate));
      const confirmed = rangeConfirmed && !!proposal.evidence && evidence(proposal.evidence) && explicitTimeMatches(incoming!.text!, proposal.time)
        && /(?:提醒|通知)/.test(incoming!.text!) && !reminderSuppressed(incoming!.text!);
      group.reminders.push({ id: `reminder-${this.uuid()}`, meal: proposal.meal, time: proposal.time, startDate: proposal.startDate, endDate: proposal.endDate,
        timezone: 'Asia/Shanghai', status: confirmed ? 'active' : 'proposed', ...(confirmed ? { confirmationMessageId: incoming!.id } : {}) });
    }
    for (const control of output.reminderControls || []) {
      const reminder = group.reminders?.find(item => item.id === control.reminderId);
      if (!reminder || !evidence(control.evidence) || reminder.status === 'cancelled') throw new Error('缺少当前用户提醒操作证据');
      const userText = incoming!.text!;
      if (['confirm', 'resume'].includes(control.operation) && !group.members.some(member => member.id === 'zhou-chef')) throw new Error('做饭提醒缺少群内厨师');
      if (/(?:不确定|是否|可以吗|可以么|可不可以|会不会|[?？])/.test(userText)) throw new Error('用户尚未确认提醒操作');
      if (control.operation === 'confirm' && !reminderSuppressed(userText) && reminder.endDate >= shanghaiDate(this.now()) && (explicitTimeMatches(userText, reminder.time) && explicitConfirmation(userText))) {
        reminder.status = 'active'; reminder.confirmationMessageId = incoming!.id;
      } else if (control.operation === 'pause' && /(?:暂停|先停|停止|别提醒)/.test(userText)) reminder.status = 'paused';
      else if (control.operation === 'cancel' && /(?:取消|删除|不要提醒)/.test(userText)) reminder.status = 'cancelled';
      else if (control.operation === 'resume' && !reminderSuppressed(userText) && reminder.endDate >= shanghaiDate(this.now()) && reminder.confirmationMessageId && /(?:恢复|继续提醒|重新开启)/.test(userText)) reminder.status = 'active';
      else throw new Error('提醒尚未获得准确日期和时段的确认');
    }
  }

  async run(owner: string, groupId: string): Promise<void> {
    const key = `${owner}:${groupId}`;
    if (this.closed || this.active.has(key)) return;
    const job = this.db.prepare("SELECT * FROM npc_group_jobs WHERE owner=? AND group_id=? AND status IN ('queued','failed') ORDER BY seq LIMIT 1").get(owner, groupId) as GroupJob | undefined;
    if (!job || job.status === 'failed') return;
    if(this.stored(owner,groupId).messages.some(message=>!message.deliveryCancelled&&(message.deliverAt||0)>this.now()))return;
    this.active.add(key);
    this.db.prepare("UPDATE npc_group_jobs SET status='running' WHERE seq=?").run(job.seq);
    try {
      const input = JSON.parse(job.data) as JobInput;
      const storedSnapshot = this.stored(owner, groupId);
      const generationEpoch = storedSnapshot.generationEpoch || 0;
      if (storedSnapshot.leftAt) { this.db.prepare("UPDATE npc_group_jobs SET status='cancelled',error='' WHERE seq=?").run(job.seq); return; }
      const group = this.get(owner, groupId);
      const incoming = group.messages.find(message => message.id === input.messageId);
      const reminder = group.reminders?.find(item => item.id === input.reminderId);
      if (job.kind === 'reminder' && (!group.members.some(member => member.id === 'zhou-chef') || !reminderStillCurrent(reminder, input.occurrence!, this.now()))) {
        this.db.prepare("UPDATE npc_group_jobs SET status='done' WHERE seq=?").run(job.seq); return;
      }
      const media=groupMediaInputs(this.root,owner,group,incoming);
      const socialContexts=observeGroupActivity(this.db,owner,group,incoming,this.now());
      const dialogueContext:GroupDialogueContext={ group, kind: job.kind, incoming, facts: this.taskMemory.collect(owner), reminder, now: this.now(), ...media, socialContexts };
      const output = await this.dialogue(this.root,dialogueContext);
      const participation=groupParticipationPlan(output);
      if (this.closed) return;
      const fresh = this.stored(owner, groupId);
      const currentJob = this.db.prepare('SELECT status FROM npc_group_jobs WHERE seq=?').get(job.seq) as { status: string } | undefined;
      if (fresh.leftAt || (fresh.generationEpoch || 0) !== generationEpoch || currentJob?.status !== 'running') return;
      if (job.kind === 'reminder' && !reminderStillCurrent(fresh.reminders?.find(item => item.id === input.reminderId), input.occurrence!, this.now())) {
        this.db.prepare("UPDATE npc_group_jobs SET status='done' WHERE seq=?").run(job.seq); return;
      }
      const at = new Date(this.now()).toISOString(),beforeMessages=fresh.messages.length;
      // A reply belongs to the same join instance that saw the generation
      // snapshot. Removing and re-adding an ID does not revive stale drafts.
      const stillJoined = (id: string) => {
        const before = group.members.find(member => member.id === id);
        const after = fresh.members.find(member => member.id === id);
        return !!before && !!after && before.order === after.order && before.joinedAt === after.joinedAt;
      };
      const explicitlyAddressed = new Set([...(incoming?.mentionIds || []),...(participation?.requiredReplyIds || [])]);
      const blockedHandoffs = new Set<string>();
      const acceptedMessages: GroupDialogueOutput['messages'] = [];
      for (const message of output.messages) {
        const member = fresh.members.find(member => member.id === message.senderId);
        const obsolete = !member || member.id === 'user' || !stillJoined(message.senderId)
          || message.mentionIds.some(id => !stillJoined(id))
          || (blockedHandoffs.has(message.senderId) && !explicitlyAddressed.has(message.senderId));
        if (obsolete || !member) {
          for (const id of message.mentionIds) if (id !== 'user') blockedHandoffs.add(id);
          continue;
        }
        for (const id of message.mentionIds) blockedHandoffs.delete(id);
        fresh.messages.push({ id: this.uuid(), senderId: member.id, senderName: member.name, type: 'text', text: message.text, mentionIds: message.mentionIds, at });
        acceptedMessages.push(message);
      }
      if (job.kind === 'opening' && acceptedMessages[0]?.senderId !== 'molly') {
        // A member change can invalidate Molly's @ assignment while leaving a
        // later NPC sentence valid. Discard that entire old opening and let
        // the same persisted job generate a fresh Molly-first introduction.
        // Nothing from the obsolete draft has been saved at this point.
        const membersChanged = group.members.length !== fresh.members.length || group.members.some(member => !stillJoined(member.id));
        this.db.prepare('UPDATE npc_group_jobs SET status=?,error=? WHERE seq=?').run(
          membersChanged ? 'queued' : 'failed', membersChanged ? '' : 'Molly 的群开场暂未完成，请点击重试。', job.seq,
        );
        return;
      }
      // Required replies are obligations of the current join instances. A
      // removed/rejoined actor cannot speak from an old snapshot; every still
      // present required actor must nevertheless have an accepted own reply.
      if(participation?.requiredReplyIds.some(id=>stillJoined(id)&&!acceptedMessages.some(message=>message.senderId===id)))
        throw new Error('本轮必要群回应在成员变化后未完整接受');
      const safeOutput = { ...output, messages: acceptedMessages };
      if (output.socialExpressions) safeOutput.socialExpressions=output.socialExpressions.filter(response=>stillJoined(response.characterId)
        && (response.expression!=='expressed' || acceptedMessages.some(message=>message.senderId===response.characterId)));
      // Expressions are currently attributed to an actor, not a bubble. If
      // any of that actor's bubbles was filtered, a surviving ordinary reply
      // cannot stand in for the possibly discarded emotional expression.
      if(safeOutput.socialExpressions?.some(response=>response.expression==='expressed'
        && output.messages.filter(message=>message.senderId===response.characterId).length!==acceptedMessages.filter(message=>message.senderId===response.characterId).length))
        throw new Error('本人情绪台词在成员变化后未完整接受，需重新生成');
      // Rebuild authority from surviving roots and accepted message order.
      // A required broadcast reply may survive a dropped @ handoff, but that
      // obligation must never revive the dropped sender's task permissions.
      const currentPlan=participation?{...participation,
        semanticTargetIds:participation.semanticTargetIds.filter(stillJoined),requiredReplyIds:participation.requiredReplyIds.filter(stillJoined),
        allowedSpeakerIds:participation.allowedSpeakerIds.filter(stillJoined),operationalSpeakerIds:participation.operationalSpeakerIds.filter(stillJoined),
      }:undefined;
      const operational=currentPlan?groupOperationalSpeakers(parseGroupDialogue({messages:acceptedMessages,
        ...(safeOutput.socialExpressions?{socialExpressions:safeOutput.socialExpressions}:{}),
      },{...dialogueContext,group:{...fresh,members:fresh.members.filter(member=>stillJoined(member.id))},
        socialContexts:socialContexts.filter(item=>stillJoined(item.characterId)),participationPlan:currentPlan},currentPlan)):groupOperationalSpeakers(output);
      // Production results carry the parser's exact at-speaking-time authority.
      // In-process injected runners are trusted, but still need a surviving
      // responsible speaker; removed actors cannot leave executable effects.
      const acceptedOperator=(ids:string[])=>acceptedMessages.some(message=>ids.includes(message.senderId)
        && (!operational || operational.has(message.senderId)));
      if (output.planDraft && !acceptedOperator(['liu'])) delete safeOutput.planDraft;
      if (output.confirmPlan && !acceptedOperator(['molly','liu'])) delete safeOutput.confirmPlan;
      if (output.reminderProposals?.length && !acceptedOperator(['molly','zhou-chef'])) delete safeOutput.reminderProposals;
      if (output.reminderControls?.length && !acceptedOperator(['molly','zhou-chef'])) delete safeOutput.reminderControls;
      // When every response became obsolete, its proposed task side effects
      // are also discarded; the already-persisted user input is kept intact.
      if (output.messages.length && !acceptedMessages.length) {
        delete safeOutput.confirmPlan; delete safeOutput.reminderProposals; delete safeOutput.reminderControls;
      }
      this.applyOperations(fresh, safeOutput, incoming);
      scheduleGroupDelivery(fresh.messages,beforeMessages,Date.parse(at),this.now());
      if (job.kind === 'opening') fresh.openingDone = true;
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.save(owner, fresh);
        if (incoming && safeOutput.socialExpressions?.length) recordGroupSocialExpressions(this.db,owner,groupId,incoming.id,safeOutput,this.now());
        this.db.prepare("UPDATE npc_group_jobs SET status='done',error='',data=? WHERE seq=?")
          .run(JSON.stringify({...input,...(participation?{participationPlan:participation}:{})}),job.seq);
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    } catch {
      // A clear/exit may have cancelled this request while generation was in
      // flight. A late rejection must not resurrect its error or retry action.
      if (!this.closed) this.db.prepare("UPDATE npc_group_jobs SET status='failed',error=? WHERE seq=? AND status='running'").run('群成员暂时没有连上，请点击重试。', job.seq);
    } finally { this.active.delete(key); }
  }

  async tick(): Promise<void> {
    if (this.closed) return;
    for (const row of this.db.prepare('SELECT owner,id FROM npc_group_chats').all() as { owner: string; id: string }[]) {
      const group = this.stored(row.owner, row.id);
      if (group.leftAt) continue;
      let changed = false;
      for (const reminder of group.reminders || []) {
        if (!group.members.some(member => member.id === 'zhou-chef')) continue;
        const occurrence = reminderOccurrence(reminder, this.now());
        if (!occurrence) continue;
        reminder.lastOccurrence = occurrence.key; changed = true;
        if (occurrence.due) this.enqueue(row.owner, group.id, `${reminder.id}:${occurrence.key}`, 'reminder', { reminderId: reminder.id, occurrence: occurrence.key });
      }
      if (changed) this.save(row.owner, group);
    }
    const groups = this.db.prepare("SELECT DISTINCT owner,group_id FROM npc_group_jobs WHERE status='queued'").all() as { owner: string; group_id: string }[];
    await Promise.all(groups.map(group => this.run(group.owner, group.group_id)));
  }

  stop() { this.closed = true; }
}

function reply(res: ServerResponse, code: number, value: unknown) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(value));
}

function localOrigin(req: IncomingMessage): string {
  const host = req.headers.host;
  if (!host || /[\s/@\\?#]/u.test(host)) throw new GroupRequestError(403, '仅本机访问');
  let url: URL;
  try { url = new URL(`http://${host}`); } catch { throw new GroupRequestError(403, '仅本机访问'); }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new GroupRequestError(403, '仅本机访问');
  if (req.method !== 'GET' && req.headers.origin !== url.origin) throw new GroupRequestError(403, '请求来源不匹配');
  return url.origin;
}

const activeGroupStores = new Map<string, GroupChatStore>();
/** Share the actual service; constructing a second store would reset active jobs. */
export function groupStoreFor(root: string) { return activeGroupStores.get(root); }

export function groupChatsLocal(deps: { namer?: GroupNamer; now?: () => number; uuid?: () => string; dialogue?: GroupDialogueRunner; automatic?: boolean } = {}): Plugin {
  return {
    name: 'zhiyu-group-chats-local', apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      mkdirSync(join(root, '.npc-runtime'), { recursive: true });
      const db = new DatabaseSync(join(root, '.npc-runtime/state.sqlite'));
      db.exec('PRAGMA journal_mode=WAL');
      const store = new GroupChatStore(db, root, deps.namer, deps.now, deps.uuid, deps.dialogue);
      activeGroupStores.set(root, store);
      const launch = (owner: string, group: GroupChat) => {
        if (deps.automatic !== false) void store.run(owner, group.id);
        return group;
      };
      const interval = deps.automatic === false ? undefined : setInterval(() => { void store.tick().catch(() => {}); }, 1000);
      interval?.unref();
      server.middlewares.use('/api/npc/groups', (req, res) => {
        void (async () => {
          localOrigin(req);
          // authLocal precedes this plugin and replaces the browser owner cookie
          // with the authenticated account owner. No anonymous identity is issued.
          const owner = /(?:^|;\s*)zhiyu_npc=([a-f0-9-]{36})(?:;|$)/i.exec(req.headers.cookie || '')?.[1];
          if (!owner || !UUID.test(owner)) throw new GroupRequestError(401, '请先登录智域');
          if ((req.url || '/').split('?')[0] !== '/') throw new GroupRequestError(404, '群聊接口不存在');
          if (req.method === 'GET') return reply(res, 200, { groups: store.list(owner) });
          if (req.method !== 'POST') throw new GroupRequestError(405, '不支持的方法');
          if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new GroupRequestError(415, '请使用JSON请求');
          const chunks: Buffer[] = [];
          let bytes = 0;
          for await (const chunk of req) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += buffer.length;
            if (bytes > MAX_BODY_BYTES) throw new GroupRequestError(413, '请求内容过长');
            chunks.push(buffer);
          }
          let parsed: unknown;
          try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new GroupRequestError(400, '无效JSON'); }
          const body = objectBody(parsed);
          const { action, ...input } = body;
          if (action === 'remember') { store.remember(owner, input); return reply(res, 200, { ok: true }); }
          if (action === 'create') return reply(res, 200, { group: launch(owner, await store.create(owner, input)) });
          if (action === 'rename') {
            onlyFields(input, ['groupId', 'name']);
            return reply(res, 200, { group: store.rename(owner, input.groupId, input.name) });
          }
          if (action === 'settings') return reply(res, 200, { group: store.settings(owner, input) });
          if (action === 'members') return reply(res, 200, { group: store.members(owner, input) });
          if (action === 'clear') return reply(res, 200, { group: store.clear(owner, input) });
          if (action === 'exit') return reply(res, 200, { group: store.exit(owner, input) });
          if (action === 'send') return reply(res, 200, { group: launch(owner, store.send(owner, input)) });
          if (action === 'open' || action === 'retry') {
            onlyFields(input, ['groupId']);
            return reply(res, 200, { group: launch(owner, action === 'open' ? store.open(owner, input.groupId) : store.retry(owner, input.groupId)) });
          }
          if (action === 'confirm-plan') return reply(res, 200, { group: launch(owner, store.confirmPlan(owner, input)) });
          if (action === 'reminder') return reply(res, 200, { group: launch(owner, store.controlReminder(owner, input)) });
          throw new GroupRequestError(403, '不支持的群聊操作');
        })().catch(error => {
          if (!res.writableEnded) reply(res, error instanceof GroupRequestError ? error.status : 500,
            { error: error instanceof GroupRequestError ? error.message : '群聊服务暂不可用' });
        });
      });
      server.httpServer?.once('close', () => { if (activeGroupStores.get(root) === store) activeGroupStores.delete(root); store.stop(); if (interval) clearInterval(interval); db.close(); });
    },
  };
}
