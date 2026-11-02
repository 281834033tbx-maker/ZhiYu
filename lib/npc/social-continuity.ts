import type { ChatMessage } from './contracts';
import type { ContactLife } from './contact-life';
import { getCharacter } from './character-directory';

export const socialContinuityPolicy = {version:1,longGapMs:3*86400000,maxIncidents:16} as const;
export type SocialFeeling='hurt'|'missed'|'annoyed'|'neutral';
export type SocialExpression = {eventId:string;expression:'expressed'|'defer'|'let-go';feeling?:SocialFeeling};
export type SocialIncident = {
  id:string;kind:'unanswered_in_shared_group'|'return_after_long_gap';createdAt:string;
  waitingAt?:number;gapMs:number;expectation?:'question'|'sharing'|'unresolved_conflict'|'uncertain';status:'pending'|'deferred'|'expressed'|'resolved';
  observations:{groupId:string;messageId:string;at:string}[];
  expressedAt?:string;expressedChannel?:'group'|'private';feeling?:SocialFeeling;resolvedAt?:string;resolution?:'explanation'|'repair'|'private_reply';
};
export type SocialContinuity = {version:1;incidents:SocialIncident[]};
export type SocialHost = {characterId:string;messages:ChatMessage[];values:Record<string,number|null>;relationship?:string;
  queue?:string[];life?:{queue?:string[]};contactLife?:ContactLife;socialContinuity?:SocialContinuity};
export const socialClose = (s:SocialHost) => s.relationship==='lovers'||(Number(s.values.familiarity||0)>=60&&Number(s.values.affection||0)>=60);
export const socialEligible = (s:SocialHost) => !!getCharacter(s.characterId)&&s.relationship!=='broken_up'&&s.messages.some(m=>m.role==='user'&&!m.legacyContent);
export function ensureSocial(s:SocialHost):SocialContinuity {
  return s.socialContinuity ||= {version:1,incidents:[]};
}
export function parseSocialResponse(value:unknown):SocialExpression|undefined {
  if(value===undefined||value===null)return;
  const v=value as SocialExpression;
  if(!v||typeof v!=='object'||Array.isArray(v)||typeof v.eventId!=='string'||!v.eventId.trim()||v.eventId.length>180
    ||!['expressed','defer','let-go'].includes(v.expression)||Object.keys(v).some(key=>!['eventId','expression','feeling'].includes(key))||(v.feeling!==undefined&&!['hurt','missed','annoyed','neutral'].includes(v.feeling)))throw Error('关系连续事件格式无效');
  return {eventId:v.eventId,expression:v.expression,...(v.feeling?{feeling:v.feeling}:{})};
}
const currentQueue=(s:SocialHost)=>s.queue||s.life?.queue||[];
function currentSocialExplanation(s:SocialHost):boolean {
  const current=s.messages.findLast(m=>m.role==='user'&&currentQueue(s).includes(m.turnId));
  if(!current||!('text' in current.part))return false;
  return /刚才.{0,30}(?:在|去|忙|开会|洗澡|电话|睡|有事|开车)|刚.{0,12}(?:开完|忙完|洗完)|没(?:看|注意|来得及)|手机.{0,10}(?:没电|静音)|家里有事/.test(current.part.text);
}
export function currentPrivateSocialIncident(s:SocialHost,now:number):SocialIncident|undefined {
  if(!socialEligible(s))return;
  const c=s.contactLife;
  if(c&&(!c.enabled||c.quietUntil>now))return;
  if(currentSocialExplanation(s))return;
  const active=s.socialContinuity?.incidents.findLast(e=>e.status==='pending'||e.status==='deferred');
  if(active){const current=s.messages.findLast(m=>m.role==='user'&&currentQueue(s).includes(m.turnId));
    // A new private reply closes the old waiting window, but it can itself be
    // a genuine long-gap return. Continue deriving that new event below.
    if(!(active.waitingAt&&current&&Date.parse(current.at)>active.waitingAt))return active;}
  // Long-gap return is a candidate, never an automatic grievance or penalty.
  const users=s.messages.filter(m=>m.role==='user'&&!m.legacyContent&&!m.turnId.startsWith('legacy:'));
  const current=users.at(-1),previous=users.at(-2);
  if(!current||!previous||!currentQueue(s).includes(current.turnId))return;
  const currentAt=Date.parse(current.at),previousAt=Date.parse(previous.at);
  const gapMs=currentAt-previousAt;
  if(!Number.isFinite(gapMs)||gapMs<socialContinuityPolicy.longGapMs||currentAt>now)return;
  if(c&&(c.busyUntil>now||c.sleepingUntil>now||c.returning?.explained))return;
  const id=`return:${current.id}`;
  if(s.socialContinuity?.incidents.some(e=>e.id===id))return;
  return {id,kind:'return_after_long_gap',createdAt:current.at,gapMs,status:'pending',observations:[]};
}
export function socialPrivatePrompt(s:SocialHost,now:number):string {
  const candidate=currentPrivateSocialIncident(s,now);
  const mustReact=!!candidate&&s.contactLife?.requiredSocialReactionId===candidate.id;
  const recent=s.socialContinuity?.incidents.slice(-3).map(({id,kind,status,expressedChannel,feeling})=>({id,kind,status,expressedChannel,feeling}));
  if(!candidate&&!recent?.length)return '';
  return `【本人关系连续性；有限状态数据】${JSON.stringify({mustReact,relationship:s.relationship,close:socialClose(s),values:{familiarity:s.values.familiarity,affection:s.values.affection,trust:s.values.trust,comfort:s.values.comfort},candidate:candidate?{id:candidate.id,kind:candidate.kind,gapMs:candidate.gapMs,status:candidate.status}:null,feelings:s.contactLife?.feelings||null,recent})}
${mustReact?'【本轮必须接续的本人关系事件】当前亲近、本人确有问题/分享/未完争执在等，先前群里已defer，现有调度本来允许这次私聊followup，且非忙/睡眠/免打扰。本轮必须用本人口吻自然表达看到共同群活动及自己在意的一点，可轻微委屈、不满或想念；不机械重复上个旧问题、不再defer或省略socialResponse。表达观察不等于判定对方故意，不能威胁或公开私聊原文。这是该有限场景对普通followup接旧话的优先规则，不扩成每轮质问。':''}
这是你本人实际可观察的关系事件，不是他人私聊。unanswered_in_shared_group只表示本人已送达私聊尚待回应时，在自己加入的群见到用户发言；不证明用户已读、故意忽视、偏爱别人或一定有空。return_after_long_gap只表示真实私聊间隔较久，3天是程序候选默认，不是必须生气的时限。按本人性格、有效关系和当前解释选择自然接话、轻微委屈、晚些再说或放下；不是固定质问、不统一每人撒娇、不影响正常专业任务。可以有不满或自然争执，不威胁、不羞辱、不拿离线当关系扣分依据。
只对candidate可提出可选socialResponse={"eventId":"该真实id","expression":"expressed|defer|let-go","feeling":"hurt|missed|annoyed|neutral"}。expressed表示本轮真实台词已表达这件关系情绪，必须有实际消息；defer只暂不提，let-go表示放下；feeling可选，只描述本人实际表达的受伤/想念/不满/平常心，不把正常重逢自动记成生气。最近已expressed/resolved的同一事件不得再在私聊催问，群里说过不再两头连发。解释合理就接住、修正误会；不能复述或公开私人原话。没有candidate就不编eventId，不把事件内容写成用户自述记忆。`;
}
export function resolveSocialExplanation(s:SocialHost,explained:boolean,basis:'explanation'|'repair'|'private_reply'='explanation',now=Date.now()) {
  if(!explained)return;
  const eligible=(s.socialContinuity?.incidents||[]).filter(e=>e.status==='pending'||e.status==='deferred'||(basis!=='private_reply'&&e.status==='expressed'));
  const latest=eligible.at(-1);if(!latest)return;
  for(const incident of eligible)if(incident.id===latest.id||(latest.waitingAt!==undefined&&incident.waitingAt===latest.waitingAt)){
    incident.status='resolved';incident.resolvedAt=new Date(now).toISOString();incident.resolution=basis;
  }
  if(s.contactLife?.requiredSocialReactionId===latest.id)delete s.contactLife.requiredSocialReactionId;
}
export function resolveSocialPrivateReturn(s:SocialHost,now:number){
  const current=s.messages.findLast(m=>m.role==='user'&&currentQueue(s).includes(m.turnId));
  if(current&&s.socialContinuity?.incidents.some(e=>(e.status==='pending'||e.status==='deferred')&&!!e.waitingAt&&Date.parse(current.at)>e.waitingAt))
    resolveSocialExplanation(s,true,'private_reply',now);
}
export function verifiedSocialRepair(s:SocialHost,event?:{kind:string;basis?:string;evidence?:string}):boolean{
  if(event?.kind!=='repair'||event.basis!=='user_claim'||!event.evidence?.trim())return false;
  const source=s.messages.findLast(m=>m.role==='user'&&currentQueue(s).includes(m.turnId)&&'text' in m.part&&m.part.text.includes(event.evidence!));
  if(!source||!('text' in source.part))return false;
  // A repair proposal needs a current first-person repair of this interaction,
  // not an apology word, another person's story or a hypothetical quote.
  const text=source.part.text;
  return !/^(?:他说|她说|朋友说|假如|如果|假设|举个例子)/.test(text.trim())
    &&!/(?:我朋友|朋友|他向我|她向我|他跟我|她跟我).{0,16}(?:道歉|对不起|抱歉|错了)/.test(text)
    &&/(?:我.{0,24}(?:错了|不对|不好|道歉|对不起|抱歉|不该)|(?:咱们|我们).{0,16}(?:和好|说开|别吵|不吵)|跟你道歉|向你道歉)/.test(text);
}
export function prepareSocialFollowup(s:SocialHost,kind:string,now:number){
  const c=s.contactLife;if(!c)return;
  delete c.requiredSocialReactionId;
  const candidate=currentPrivateSocialIncident(s,now);
  if(['followup','conflict_followup'].includes(kind)&&socialClose(s)&&candidate?.kind==='unanswered_in_shared_group'&&candidate.status==='deferred'
    &&['question','sharing','unresolved_conflict'].includes(candidate.expectation||'')&&c.enabled&&c.quietUntil<=now&&c.busyUntil<=now&&c.sleepingUntil<=now)c.requiredSocialReactionId=candidate.id;
}
export function applySocialExpression(s:SocialHost,incident:SocialIncident,response:SocialExpression,channel:'group'|'private',now:number,hasMessage:boolean) {
  if(response.eventId!==incident.id||incident.status==='expressed'||incident.status==='resolved')return;
  if(response.expression==='expressed'&&!hasMessage)throw Error('关系事件未实际发言不能登记表达');
  incident.status=response.expression==='expressed'?'expressed':response.expression==='let-go'?'resolved':'deferred';
  if(response.expression==='expressed'){
    incident.expressedAt=new Date(now).toISOString();incident.expressedChannel=channel;
    if(response.feeling)incident.feeling=response.feeling;
    // Keep the semantic emotion; do not turn every reunion into a numeric
    // grievance. Existing conflict/repair scoring remains owned by contactLife.
    const c=s.contactLife;
    if(c?.waiting&&incident.waitingAt===c.waiting.at)c.waiting.followedUp=true;
  }
}
export function completePrivateSocialTurn(s:SocialHost,response:SocialExpression|undefined,parts:readonly unknown[],now:number,event?:{kind:string;basis?:string;evidence?:string}) {
  const explained=currentSocialExplanation(s);
  if(explained)resolveSocialExplanation(s,true,'explanation',now);
  else if(verifiedSocialRepair(s,event))resolveSocialExplanation(s,true,'repair',now);
  else resolveSocialPrivateReturn(s,now);
  const required=s.contactLife?.requiredSocialReactionId;
  if(required&&(!response||response.eventId!==required||response.expression!=='expressed'))throw Error('本次私聊跟问必须接续已暂缓的本人关系事件');
  if(!response)return;
  const incident=currentPrivateSocialIncident(s,now);
  if(!incident||incident.id!==response.eventId)throw Error('缺少本人有效关系事件');
  const state=ensureSocial(s);
  if(!state.incidents.some(e=>e.id===incident.id))state.incidents.push(incident);
  applySocialExpression(s,incident,response,'private',now,parts.length>0);
  if(s.contactLife?.requiredSocialReactionId===incident.id)delete s.contactLife.requiredSocialReactionId;
  state.incidents=state.incidents.slice(-socialContinuityPolicy.maxIncidents);
}
