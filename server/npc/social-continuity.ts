import type {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import type {GroupChat,GroupMessage} from '../../lib/npc/group-chat';
import {ensureContact} from '../../lib/npc/contact-life';
import {applySocialExpression,ensureSocial,socialClose,socialEligible,type SocialHost,type SocialIncident,type SocialExpression,type SocialFeeling} from '../../lib/npc/social-continuity';

export type GroupSocialExpression=SocialExpression&{characterId:string};
export type GroupSocialContext={
  characterId:string;relationship:{stage:string;familiarity:number;affection:number;trust:number;comfort:number};
  feelings:{mood:number;dissatisfaction:number;unease:number};
  availability:{busy:boolean;doNotDisturb:boolean;proactiveEnabled:boolean};close:boolean;
  pendingPrivateReply?:{since:string;gapMs:number;expectation:'question'|'sharing'|'unresolved_conflict'|'uncertain'};
  incident?:{id:string;kind:'unanswered_in_shared_group';createdAt:string;status:'pending'|'deferred'|'expressed'|'resolved';feeling?:SocialFeeling};
  recentEmotions?:{feeling:SocialFeeling;status:SocialIncident['status'];at:string}[];
};
const targets:Record<string,[string,string]>={
  'yuan-xiaoman':['yuan_sessions','yuan-xiaoman'],'xia-xia':['sessions','xia-xia:normal'],
  'he-jiawei':['he_sessions','he-jiawei'],liu:['liu_sessions','liu'],'chen-nian':['chen_sessions','chen-nian'],'zhou-chef':['zhou_chef_sessions','zhou-chef']};
type Stored=SocialHost&{revision?:number};
function load(db:DatabaseSync,owner:string,id:string):{state:Stored;table:string;key:string}|undefined{
  const target=targets[id];if(!target)return;
  const [table,suffix]=target;
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))return;
  const key=`${owner}:${suffix}`,row=db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(key) as {data:string}|undefined;
  if(!row)return;
  const state=JSON.parse(row.data) as Stored;
  if(!socialEligible(state))return;
  return {state,table,key};
}
function save(db:DatabaseSync,loaded:NonNullable<ReturnType<typeof load>>){
  loaded.state.revision=(loaded.state.revision||0)+1;
  if(loaded.table==='sessions'&&(db.prepare('PRAGMA table_info(sessions)').all() as {name:string}[]).some(column=>column.name==='revision'))
    db.prepare('UPDATE sessions SET data=?,revision=? WHERE id=?').run(JSON.stringify(loaded.state),loaded.state.revision,loaded.key);
  else db.prepare(`UPDATE ${loaded.table} SET data=? WHERE id=?`).run(JSON.stringify(loaded.state),loaded.key);
}
function pending(s:Stored,now:number){
  const assistant=s.messages.findLast(m=>m.role==='assistant');
  const user=s.messages.findLast(m=>m.role==='user');
  if(!assistant||!user||assistant.legacyContent||assistant.secretaryEvent)return;
  const turn=s.messages.filter(m=>m.role==='assistant'&&m.turnId===assistant.turnId);
  if(turn.some(m=>m.part.type==='professional_task'||!!m.professionalTaskHint||!!m.secretaryEvent)
    ||String(assistant.origin||'').startsWith('secretary')||String(assistant.origin||'').startsWith('task'))return;
  const delivered=turn.map(m=>Math.max(Date.parse(m.at)||0,m.deliverAt||0));
  // One round is one waiting window. Never judge a half-delivered sequence.
  if(delivered.some(at=>at>now))return;
  const since=Math.max(...delivered);
  if(Date.parse(user.at)>=since)return;
  const text=turn.map(m=>'text' in m.part?m.part.text:'').filter(Boolean).join('\n');
  if(!text||/^(?:晚安|好梦|嗯|嗯嗯|好|好的|行|可以|收到|知道了|OK|ok|哈哈|哈哈哈|不客气|回头聊|明天聊)[\s。！!～~]*$/.test(text.trim()))return;
  const expectation=s.contactLife?.conflict?'unresolved_conflict':/[?？]/.test(text)?'question':assistant.origin==='proactive'?'sharing':'uncertain';
  return {since,gapMs:Math.max(0,now-since),expectation:expectation as NonNullable<GroupSocialContext['pendingPrivateReply']>['expectation']};
}
/** The caller supplies its already persisted, current visible group. No private text leaves this function. */
export function observeGroupActivity(db:DatabaseSync,owner:string,group:GroupChat,incoming:GroupMessage|undefined,now:number):GroupSocialContext[]{
  if(!incoming||incoming.senderId!=='user'||!['text','image','sticker','voice'].includes(incoming.type)||group.leftAt||!group.messages.some(m=>m.id===incoming.id&&m.senderId==='user'))return [];
  const sourceAt=Date.parse(incoming.at);if(!Number.isFinite(sourceAt)||sourceAt>now)return [];
  const contexts:GroupSocialContext[]=[];
  for(const member of group.members){
    if(member.id==='user'||member.id==='molly'||Date.parse(member.joinedAt)>sourceAt)continue;
    const loaded=load(db,owner,member.id);if(!loaded)continue;
    const s=loaded.state,c=ensureContact(s,now),wait=pending(s,sourceAt),continuity=ensureSocial(s);
    let incident:SocialIncident|undefined;
    if(wait){
      const id='social:'+createHash('sha256').update(`${owner}:${member.id}:${wait.since}`).digest('hex').slice(0,40);
      incident=continuity.incidents.find(e=>e.id===id);
      if(!incident){incident={id,kind:'unanswered_in_shared_group',createdAt:incoming.at,waitingAt:wait.since,gapMs:wait.gapMs,expectation:wait.expectation,status:'pending',observations:[]};continuity.incidents.push(incident);}
      if(!incident.observations.some(o=>o.groupId===group.id&&o.messageId===incoming.id))incident.observations=[...incident.observations,{groupId:group.id,messageId:incoming.id,at:incoming.at}].slice(-20);
      continuity.incidents=continuity.incidents.slice(-16);save(db,loaded);
    }
    contexts.push({characterId:member.id,relationship:{stage:s.relationship||'strangers',familiarity:Number(s.values.familiarity||0),affection:Number(s.values.affection||0),trust:Number(s.values.trust||0),comfort:Number(s.values.comfort||0)},
      feelings:{...c.feelings},recentEmotions:continuity.incidents.filter(e=>!!e.feeling).slice(-3).map(e=>({feeling:e.feeling!,status:e.status,at:e.expressedAt||e.createdAt})),availability:{busy:c.busyUntil>now,doNotDisturb:c.quietUntil>now,proactiveEnabled:c.enabled},close:socialClose(s),
      ...(wait?{pendingPrivateReply:{since:new Date(wait.since).toISOString(),gapMs:wait.gapMs,expectation:wait.expectation}}:{}),
      ...(incident?{incident:{id:incident.id,kind:'unanswered_in_shared_group',createdAt:incident.createdAt,status:incident.status,...(incident.feeling?{feeling:incident.feeling}:{})}}:{})});
  }
  return contexts;
}
/** Call inside the group's commit transaction after its messages were accepted for storage. */
export function recordGroupSocialExpressions(db:DatabaseSync,owner:string,groupId:string,sourceMessageId:string,output:{messages:{senderId:string}[];socialExpressions?:GroupSocialExpression[]},now:number):void{
  for(const response of output.socialExpressions||[]){
    const loaded=load(db,owner,response.characterId);if(!loaded)throw Error('关系事件不属于当前本人');
    const incident=loaded.state.socialContinuity?.incidents.find(e=>e.id===response.eventId);
    if(!incident||!incident.observations.some(o=>o.groupId===groupId&&o.messageId===sourceMessageId))throw Error('关系事件没有当前可见群来源');
    if(response.expression==='expressed'&&((loaded.state.contactLife?.quietUntil||0)>now||loaded.state.contactLife?.enabled===false))throw Error('免打扰期间不能跨群追问私聊');
    if(response.expression==='expressed'&&['expressed','resolved'].includes(incident.status))throw Error('本人关系事件已在其他渠道处理，需重新生成');
    if(response.expression==='expressed'&&pending(loaded.state,now)?.since!==incident.waitingAt)throw Error('本人私聊等待已变化，需重新生成');
    applySocialExpression(loaded.state,incident,response,'group',now,output.messages.some(message=>message.senderId===response.characterId));
    save(db,loaded);
  }
}
