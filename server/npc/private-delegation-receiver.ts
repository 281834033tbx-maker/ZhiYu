import type { DatabaseSync } from 'node:sqlite';
import { codexAvailable, generate } from './codex';
import { createChen, normalizeChen, parseChen, applyChen, type ChenState } from '../../lib/npc/chen-nian';
import { createChef, parseChef, applyChef, type ChefState } from '../../lib/npc/zhou-chef';
import { createLiu, parseLiu, applyLiu, nextNutritionWeek, type LiuState } from '../../lib/npc/liu';
import { createHe, parseHe, applyHe, type HeState } from '../../lib/npc/he-jiawei';
import { createYuan, parseYuan, applyYuan, type YuanState } from '../../lib/npc/yuan-xiaoman';
import { createState, parseOutput, finishTurn } from '../../lib/npc/engine';
import type { ChatMessage, NpcState } from '../../lib/npc/contracts';
import { ensureLife } from '../../lib/npc/life';
import { ensureContact } from '../../lib/npc/contact-life';
import { scheduleDelivery, deliveredMessages } from '../../lib/npc/delivery';
import { professionalTaskDelegationEvidence } from '../../lib/npc/professional-task-chat';
import { ProfessionalTaskError, type ProfessionalTask } from '../../lib/npc/professional-task';
import { reconcileProfessionalTaskState } from './professional-task-mutation';
import { secretaryDelegationContext, SECRETARY_DELEGATION_INPUT_MARKER, type SecretaryDelegationEvent, type SecretaryDelegationState } from '../../lib/npc/secretary-delegation';
import { chenPrompt } from './chen-prompt';
import { chefPrompt, chefApplicationEvidence } from './zhou-chef-prompt';
import { liuPrompt } from './liu-prompt';
import { hePrompt } from './he-prompt';
import { yuanPrompt } from './yuan-prompt';
import { buildPrompt } from './prompt';
import { TaskMemoryStore } from './group-task-memory';
import type { GroupChat } from '../../lib/npc/group-chat';

export type PrivateDelegationTargetId = 'chen-nian' | 'zhou-chef' | 'liu' | 'he-jiawei' | 'yuan-xiaoman' | 'xia-xia';
export type PrivateDelegationReceiverInput = {
  owner: string; id: string; targetId: PrivateDelegationTargetId; goal: string; createdAt: string;
  source: SecretaryDelegationEvent['source']; mode: SecretaryDelegationEvent['mode'];
  planMode?: SecretaryDelegationEvent['planMode']; previousPlan?: unknown;
};
export type PrivateDelegationReceiverDeps = { now?: () => number; generate?: typeof generate; available?: typeof codexAvailable };
export type PrivateDelegationReceipt = { status: 'delivered' | 'busy'; messageIds: string[]; taskIds: string[] };
type PrivateState = SecretaryDelegationState & {
  characterId: string; branch: string; revision: number; messages: ChatMessage[];
  pending: {id:string;since:number} | null; queue?: string[]; inputRevision?: number;
  typing?: Record<string,{sequence:number;until:number}>; error?: string; retryAt?: number;
  professionalTasks?: ProfessionalTask[]; privateHistoryHiddenIds?: string[];
  life?: NpcState['life']; paused?: boolean; cooldownUntil?: number;
};
const targets = {
  'chen-nian': ['chen_sessions','chen-nian'], 'zhou-chef': ['zhou_chef_sessions','zhou-chef'],
  'liu': ['liu_sessions','liu'], 'he-jiawei': ['he_sessions','he-jiawei'],
  'yuan-xiaoman': ['yuan_sessions','yuan-xiaoman'], 'xia-xia': ['sessions','xia-xia:normal'],
} as const;
export const privateDelegationTargetIds = (): PrivateDelegationTargetId[] => Object.keys(targets) as PrivateDelegationTargetId[];
export const supportsPrivateDelegationTarget = (id: string): id is PrivateDelegationTargetId => Object.hasOwn(targets,id);
const OWNER = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const busy = (): PrivateDelegationReceipt => ({status:'busy',messageIds:[],taskIds:[]});
const receipt = (event: SecretaryDelegationEvent): PrivateDelegationReceipt => ({status:'delivered',messageIds:event.messageIds,taskIds:event.taskIds});
const sourceKey = (event: Pick<SecretaryDelegationEvent,'targetId'|'goal'|'source'|'mode'|'planMode'>) =>
  JSON.stringify([event.targetId,event.goal,event.source.conversationId,event.source.messageId,event.source.text,event.source.at,event.mode,event.planMode || null]);

function create(target: PrivateDelegationTargetId, now: number): PrivateState {
  if (target === 'chen-nian') return normalizeChen(createChen()) as PrivateState;
  if (target === 'zhou-chef') return createChef() as PrivateState;
  if (target === 'he-jiawei') return createHe() as PrivateState;
  if (target === 'liu') {const state=createLiu(now);ensureContact(state,now);return state as PrivateState;}
  if (target === 'yuan-xiaoman') {const state=createYuan(now);ensureContact(state,now);return state as PrivateState;}
  const state=createState('normal');ensureLife(state,now);return state as PrivateState;
}

/** Re-check the source in this account; callers cannot manufacture a source id or quotation. */
function verifySource(db: DatabaseSync, input: PrivateDelegationReceiverInput, now: number) {
  if (!OWNER.test(input.owner) || !supportsPrivateDelegationTarget(input.targetId) || typeof input.id !== 'string' || !input.id.trim() || input.id.length > 160
    || typeof input.goal !== 'string' || !input.goal.trim() || input.goal.length > 1500
    || !['request','weekly-renewal'].includes(input.mode) || input.planMode && !['new','continue-plan','confirm-plan'].includes(input.planMode)
    || !input.source || input.source.conversationId !== 'molly-system-secretary'
    || typeof input.source.messageId !== 'string' || typeof input.source.text !== 'string'
    || !Number.isFinite(Date.parse(input.source.at)) || Date.parse(input.source.at) > now
    || !Number.isFinite(Date.parse(input.createdAt)) || Date.parse(input.createdAt) > now) throw new Error('无效秘书转交来源');
  const row=db.prepare('SELECT data FROM molly_sessions WHERE id=?').get(`${input.owner}:molly-system-secretary`) as {data:string}|undefined;
  const state=row && JSON.parse(row.data) as {messages:ChatMessage[];privateHistoryHiddenIds?:string[]};
  // Clearing the display does not revoke an already persisted outbox job.
  // The original immutable message must still match this owner, id, text and time.
  const message=state && deliveredMessages(state.messages,now).find(message=>message.id===input.source.messageId && message.role==='user');
  if (!message || !('text' in message.part) || message.part.text !== input.source.text || message.at !== input.source.at)
    throw new Error('秘书转交缺少本账号真实用户原文');
}

function previousNutritionPlan(db: DatabaseSync, owner: string, state: PrivateState, now: number): SecretaryDelegationEvent['previousPlan'] | undefined {
  const start=nextNutritionWeek(now)[0];
  const saved=[...(state.professionalTasks || [])].reverse().find(task=>task.characterId==='liu' && task.status!=='cancelled'
    && task.steps.some(step=>!!step.scheduledDate && step.scheduledDate<start));
  if (saved) return {id:saved.id,title:saved.title,steps:saved.steps.map(step=>({title:step.title,scheduledDate:step.scheduledDate,instructions:step.instructions,details:step.details}))};
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='npc_group_chats'").get()) return;
  const groups=db.prepare('SELECT data FROM npc_group_chats WHERE owner=? ORDER BY updated_at DESC').all(owner) as {data:string}[];
  for (const row of groups) {
    const group=JSON.parse(row.data) as GroupChat;
    if (!group.members.some(member=>member.id==='liu') || group.plan?.status!=='confirmed' || !group.plan.days.every(day=>day.date<start)) continue;
    return {id:group.plan.id,title:group.goal,steps:group.plan.days.map(day=>({title:day.label,scheduledDate:day.date,
      instructions:[`早餐 ${day.breakfast}`,`午餐 ${day.lunch}`,`晚餐 ${day.dinner}`]}))};
  }
}

/** Called only by the server's persisted outbox, never exposed as an HTTP action. */
export async function receivePrivateDelegation(root: string, db: DatabaseSync, input: PrivateDelegationReceiverInput,
  deps: PrivateDelegationReceiverDeps = {}): Promise<PrivateDelegationReceipt> {
  const clock=deps.now || Date.now, startedAt=clock();
  verifySource(db,input,startedAt);
  const [table,suffix]=targets[input.targetId], key=`${input.owner}:${suffix}`;
  if (table==='sessions') db.exec('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL)');
  else db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  const load=()=>{
    const row=db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(key) as {data:string}|undefined;
    if(!row)return;
    const saved=JSON.parse(row.data) as PrivateState;
    if(reconcileProfessionalTaskState(saved,clock())){
      saved.revision=(saved.revision||0)+1;
      const serialized=JSON.stringify(saved);
      if(table==='sessions')db.prepare('UPDATE sessions SET revision=?,data=? WHERE id=? AND data=?').run(saved.revision,serialized,key,row.data);
      else db.prepare(`UPDATE ${table} SET data=? WHERE id=? AND data=?`).run(serialized,key,row.data);
      return db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(key) as {data:string}|undefined;
    }
    return row;
  };
  let row=load();
  if (!row) {
    const state=create(input.targetId,startedAt), data=JSON.stringify(state);
    if (table==='sessions') db.prepare('INSERT OR IGNORE INTO sessions(id,revision,data) VALUES(?,?,?)').run(key,state.revision,data);
    else db.prepare(`INSERT OR IGNORE INTO ${table}(id,data) VALUES(?,?)`).run(key,data);
    row=load()!;
  }
  const state=JSON.parse(row.data) as PrivateState;
  if (input.targetId==='liu') {state.professionalTasks ||= []; (state as LiuState).taskEvents ||= []; (state as LiuState).taskMutations ||= [];}
  const existing=state.secretaryDelegations?.find(event=>event.id===input.id);
  if (existing && sourceKey(existing)!==sourceKey(input)) throw new Error('秘书转交事件ID冲突');
  if (existing?.status==='delivered') return receipt(existing);
  if (!(deps.available || codexAvailable)() || state.paused || (state.cooldownUntil || 0)>startedAt
    || state.pending && startedAt-state.pending.since<180_000 || (state.queue || state.life?.queue || []).length
    || Object.values(state.typing || state.life?.typingClients || {}).some(client=>client.until>startedAt)
    || state.messages.some(message=>(message.deliverAt || 0)>startedAt)) return busy();
  const save=(next:PrivateState, expected:string) => {
    next.revision=(next.revision || 0)+1;
    const result=table==='sessions'
      ? db.prepare('UPDATE sessions SET revision=?,data=? WHERE id=? AND data=?').run(next.revision,JSON.stringify(next),key,expected)
      : db.prepare(`UPDATE ${table} SET data=? WHERE id=? AND data=?`).run(JSON.stringify(next),key,expected);
    return !!result.changes;
  };
  const event:SecretaryDelegationEvent=existing || {id:input.id,targetId:input.targetId,goal:input.goal,createdAt:input.createdAt,
    source:structuredClone(input.source),mode:input.mode,...(input.planMode?{planMode:input.planMode}:{}),
    status:'pending',branch:state.branch,messageIds:[],taskIds:[]};
  if (input.targetId==='liu') event.previousPlan=previousNutritionPlan(db,input.owner,state,startedAt);
  if (!existing) (state.secretaryDelegations ||= []).push(event);
  const job=crypto.randomUUID(), inputRevision=state.inputRevision || state.life?.inputRevision || 0;
  state.pending={id:job,since:startedAt};
  if (!save(state,row.data)) return busy();
  try {
  const frozen=structuredClone(state);frozen.activeSecretaryDelegationId=event.id;
  let prompt:string;
  if (input.targetId==='chen-nian') prompt=chenPrompt(root,frozen as ChenState,'',startedAt);
  else if (input.targetId==='zhou-chef') prompt=chefPrompt(root,frozen as ChefState,'',startedAt);
  else if (input.targetId==='liu') prompt=liuPrompt(root,frozen as LiuState,'',null,startedAt);
  else if (input.targetId==='he-jiawei') prompt=hePrompt(root,frozen as HeState,'',startedAt);
  else if (input.targetId==='yuan-xiaoman') prompt=yuanPrompt(root,frozen as YuanState,'');
  else prompt=buildPrompt(root,frozen as NpcState,'','reply');
  const facts=new TaskMemoryStore(db).collect(input.owner);
  prompt+=secretaryDelegationContext(frozen)
    +'\n【本轮由秘书转交触发，没有新用户私聊】'+JSON.stringify(event)
    +'\n【本账号有真实原文支持的任务条件，仅按目标使用】'+JSON.stringify(facts)
    +'\n这是已保存的秘书委托，不是陌生人开场。主动发消息承接具体目标，已知不重问，只补必要缺口；不要求用户再点联系人或重发请求。保持本人人格和已有历史，event=null、memories=[]，不能从委托加关系分。没有用户新消息，禁止声称用户刚在本会话说过这些话。专业任务须用来源窗口真实source id和原文，必要条件齐全时保存卡片；陪伴型不输出task，也不假称自己能创建专业任务、建群或设置提醒。'
    +'\n'+SECRETARY_DELEGATION_INPUT_MARKER+JSON.stringify(event);
    const raw=await (deps.generate || generate)(root,prompt,{characterId:input.targetId,requestId:job,
      ...(input.targetId==='zhou-chef'?{chefEvidence:chefApplicationEvidence(frozen as ChefState)}:{})});
    const freshRow=load()!, fresh=JSON.parse(freshRow.data) as PrivateState;
    const stale=fresh.branch!==frozen.branch || fresh.pending?.id!==job || (fresh.inputRevision || fresh.life?.inputRevision || 0)!==inputRevision
      || (fresh.queue || fresh.life?.queue || []).length>0 || Object.values(fresh.typing || fresh.life?.typingClients || {}).some(client=>client.until>clock());
    if (stale) {
      if (fresh.pending?.id===job) {fresh.pending=null;save(fresh,freshRow.data);}
      return busy();
    }
    fresh.activeSecretaryDelegationId=event.id;
    const before=fresh.messages.length;
    const taskBefore=new Set((fresh.professionalTasks || []).map(task=>task.id));
    const evidence=['chen-nian','zhou-chef','liu'].includes(input.targetId)
      ? professionalTaskDelegationEvidence(fresh as Parameters<typeof professionalTaskDelegationEvidence>[0],clock(),[]) : undefined;
    const text=input.source.text;
    if (input.targetId==='chen-nian') {const out=parseChen(raw,text);out.event=undefined;out.memories=[];applyChen(fresh as ChenState,out,job,clock(),[],evidence);}
    else if (input.targetId==='zhou-chef') {const out=parseChef(raw,text);out.event=undefined;out.memories=[];applyChef(fresh as ChefState,out,job,clock(),[],evidence);}
    else if (input.targetId==='liu') {const out=parseLiu(raw,text);out.event=undefined;out.memories=[];applyLiu(fresh as LiuState,out,job,clock(),[],evidence);}
    else if (input.targetId==='he-jiawei') {const out=parseHe(raw,text);out.event=undefined;out.memories=[];applyHe(fresh as HeState,out,job,clock());}
    else if (input.targetId==='yuan-xiaoman') {const out=parseYuan(raw,text);out.event=undefined;out.memories=[];applyYuan(fresh as YuanState,out,job);}
    else {const out=parseOutput(raw,text);out.event=undefined;out.memories=[];finishTurn(fresh as NpcState,job,'',out,clock(),false);}
    reconcileProfessionalTaskState(fresh,clock());
    delete fresh.activeSecretaryDelegationId;
    const messages=fresh.messages.slice(before);
    if (!messages.length) throw new ProfessionalTaskError('秘书转交需要可见的承接回复','DELEGATION_REPLY_OMITTED');
    for (const message of messages) {message.origin='proactive';message.secretaryEvent={id:event.id,kind:'handoff',sourceMessageId:event.source.messageId,targetId:input.targetId};}
    scheduleDelivery(fresh.messages,before,startedAt,clock());
    const delivered=fresh.secretaryDelegations!.find(row=>row.id===event.id)!;
    delivered.status='delivered';delivered.deliveredAt=new Date(clock()).toISOString();delivered.messageIds=messages.map(message=>message.id);
    delivered.taskIds=(fresh.professionalTasks || []).filter(task=>!taskBefore.has(task.id)).map(task=>task.id);
    fresh.pending=null;fresh.error='';fresh.retryAt=0;
    if (!save(fresh,freshRow.data)) return busy();
    return receipt(delivered);
  } catch (error) {
    const freshRow=load(), fresh=freshRow && JSON.parse(freshRow.data) as PrivateState;
    if (freshRow && fresh?.pending?.id===job) {fresh.pending=null;save(fresh,freshRow.data);}
    throw error;
  }
}
