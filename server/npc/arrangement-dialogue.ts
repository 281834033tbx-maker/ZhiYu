import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {ChatMessage} from '../../lib/npc/contracts';
import type {GroupChat} from '../../lib/npc/group-chat';
import type {ArrangementItem} from '../../lib/npc/arrangement-types';
import {scheduleDelivery} from '../../lib/npc/delivery';
import {arrangementPlainUserText,recognizeArrangementLocally,type ArrangementRecognition} from '../../lib/npc/arrangement-intent';
import {arrangementSections,type ArrangementSectionId} from '../../lib/npc/arrangement-sections';
import {isDialogueCrisisInput} from '../../lib/npc/dialogue-output-guard';
import {createMolly} from '../../lib/npc/molly';
import {takeArrangementRecognition} from './arrangement-generation';
import {arrangementPreferenceCategory,type ArrangementStore} from './arrangements-store';

type PrivateHost={messages:ChatMessage[];values?:Record<string,number|null>;interaction?:string;cooldownUntil?:number;emotionTier?:string};
const sectionName=(id:ArrangementSectionId)=>arrangementSections.find(section=>section.id===id)!.name;
const consent=/^(?:好|行|嗯|可以)[。！!\s]*$/u;
const refuse=/^(?:不用|不要|不记|不用了|不需要|不用记|不用记了|不要记了)[。！!\s]*$/u;
const tables=['sessions','yuan_sessions','he_sessions','chen_sessions','liu_sessions','zhou_chef_sessions','molly_sessions'] as const;
const normal=(state:PrivateHost,now:number)=>state.interaction!=='cooldown'&&!(state.cooldownUntil&&state.cooldownUntil>now)&&(state.values?.affection??1)>=0&&(state.values?.anger??0)<20&&!['cold','silent','冷淡','静默'].includes(state.emotionTier||'');
function newMessage(text:string,turnId:string,now:number):ChatMessage{return {id:randomUUID(),turnId,role:'assistant',at:new Date(now).toISOString(),part:{type:'text',text},origin:'chat'};}
function ack(result:{status:'created'|'duplicate';item:ArrangementItem}){return result.status==='duplicate'?'记过了':`记进${sectionName(result.item.section)}了${result.item.time.display?'，'+result.item.time.display:''}`;}
function offerQuestion(id:string,section:ArrangementSectionId){return id==='xia-xia'?`要不要让Molly姐加进${sectionName(section)}里！`:`要不要让Molly记进${sectionName(section)}呀`;}
function pending(messages:ChatMessage[],before:number){const last=messages.slice(0,before).findLast(message=>message.role==='assistant');return last?.arrangementOffer&&!last.arrangementOffer.decision?last.arrangementOffer:undefined;}
function alreadyOffered(messages:ChatMessage[],recognition:ArrangementRecognition){return messages.some(message=>{const prior=message.arrangementOffer?.recognition;return prior&&prior.title===recognition.title&&prior.time.date===recognition.time.date&&prior.section===recognition.section;});}
// The language model may discuss an affair, but only host controls can offer
// consent and only committed host receipts may claim it was recorded.
const unownedArrangementSpeech=/(?:要不要|让)(?:Molly|茉莉)(?:姐)?[^。！？\n]{0,12}(?:记进|记到|加进|加到)(?:日程|待办|计划|采购|缴费|办理|倒计时)|(?:已记|记好了|我(?:帮|给)你记了|记进(?:日程|待办|采购|缴费|办理|倒计时)了)/iu;
function privateSpeechOnly(state:PrivateHost,before:number){const added=state.messages.slice(before);state.messages.splice(before,added.length,...added.filter(message=>!('text' in message.part)||!unownedArrangementSpeech.test(message.part.text)));}
function groupSpeakerAvailable(db:DatabaseSync,owner:string,id:string,now:number){
 const binding:Record<string,string>={'xia-xia':'sessions','yuan-xiaoman':'yuan_sessions','he-jiawei':'he_sessions','chen-nian':'chen_sessions',liu:'liu_sessions','zhou-chef':'zhou_chef_sessions'};
 const table=binding[id];if(!table||!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))return true;
 const row=db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(`${owner}:${id}${id==='xia-xia'?':normal':''}`) as {data:string}|undefined;
 return !row||normal(JSON.parse(row.data) as PrivateHost,now);
}

export function commitPrivateArrangement(input:Parameters<typeof finishPrivateArrangement>[0]&{startedAt:number},save:()=>void){
 const store=input.store?.using(input.db);
 if(!store){save();return;}
 store.atomic(()=>{const previous=input.state.messages.slice(input.before).map(message=>message.id).join(':');finishPrivateArrangement({...input,store});if(input.state.messages.slice(input.before).map(message=>message.id).join(':')!==previous)scheduleDelivery(input.state.messages,input.before,input.startedAt,input.now,{characterId:input.characterId});save();});
}

/** Real saved notices land only in Molly's owner-owned private conversation. */
export function appendMollyArrangement(db:DatabaseSync,owner:string,text:string,item?:ArrangementItem,now=Date.now(),eventId?:string){
 db.exec('CREATE TABLE IF NOT EXISTS molly_sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
 const key=`${owner}:molly-system-secretary`,row=db.prepare('SELECT data FROM molly_sessions WHERE id=?').get(key) as {data:string}|undefined;
 const state=row?JSON.parse(row.data):createMolly();
 const messageId=eventId?`arrangement:${eventId}`:randomUUID();
 if(state.messages.some((message:ChatMessage)=>message.id===messageId))return;
 const message=newMessage(text,messageId,now);message.id=messageId;if(item)message.arrangementCard=item;
 state.messages.push(message);state.revision=(state.revision||0)+1;
 db.prepare('INSERT OR REPLACE INTO molly_sessions VALUES(?,?)').run(key,JSON.stringify(state));
}

function createApproved(store:ArrangementStore,owner:string,recognition:ArrangementRecognition,sourceId:string,npcId:string,chatId?:string){
 return store.create(owner,recognition,{sourceId,sourceNpcId:npcId,...(chatId?{sourceChatId:chatId}:{})});
}
function command(store:ArrangementStore,owner:string,text:string,item:ArrangementItem|undefined):{text:string;item?:ArrangementItem}|undefined {
 const preference=/^(.*?)(?:这类|的)?(?:不用|不要|别)(?:再)?(?:记|提醒)(?:了)?[。！!\s]*$/u.exec(text);
 if(preference&&preference[1].trim()&&!/^(?:这个|这条|这件|刚才的)$/u.test(preference[1].trim())){
  const categoryText=preference[1].replace(/(?:这类|的)$/u,'').trim(),recognition=recognizeArrangementLocally(categoryText);
  if(recognition.isArrangement&&recognition.section){store.setPreference(owner,{section:recognition.section,category:arrangementPreferenceCategory(recognition.section,categoryText),enabled:false});return {text:'OK'};}
 }
 if(!item)return;
 if(/这类.*(?:不用|不要|别).*(?:记|提醒)/u.test(text)){store.setPreference(owner,{section:item.section,category:item.preferenceKey,enabled:false});return {text:'OK'};}
 if(/^(?:不用记了?|删了|删除|别提醒了?|取消提醒)[。！!\s]*$/u.test(text)){store.revoke(owner,item.id);return {text:'OK'};}
 const target=arrangementSections.find(section=>new RegExp(`(?:放到|挪到|移到|改到|放进)${section.name}`,'u').test(text));
 if(target){const moved=store.move(owner,item.id,target.id);return moved?{text:'挪了',item:moved}:{text:'没记上'};}
}

/** Call after ordinary output has applied and stale input checks have passed,
 * before the caller atomically saves its own conversation. */
export function finishPrivateArrangement(input:{db:DatabaseSync;store?:ArrangementStore;owner:string;characterId:string;state:PrivateHost;before:number;incoming:string;turnId:string;now:number;recognition?:ArrangementRecognition}){
 const {db,store,owner,characterId,state,before,incoming,turnId,now}=input;
 const plain=arrangementPlainUserText(incoming);
 if(!store||!incoming.trim()||isDialogueCrisisInput(incoming))return;
 const molly=characterId==='molly'||characterId==='molly-system-secretary';
 const current=state.messages.findLast(message=>message.role==='user'&&('text' in message.part)&&message.part.text===incoming)
  ||state.messages.findLast(message=>message.role==='user');
 if(!current)return;
 const hadReply=state.messages.slice(before).some(message=>message.role==='assistant');
 privateSpeechOnly(state,before);
 const add=(text:string,item?:ArrangementItem)=>{const message=newMessage(text,turnId,now);if(item)message.arrangementCard=item;state.messages.push(message);};
 const previous=pending(state.messages,before);
 if(previous&&(consent.test(plain)||refuse.test(plain))){
  previous.decision=refuse.test(plain)?'declined':'accepted';
  if(previous.decision==='accepted'){
   try{const result=createApproved(store,owner,previous.recognition,previous.sourceMessageId,characterId);appendMollyArrangement(db,owner,ack(result),result.item,now,previous.id);}
   catch{appendMollyArrangement(db,owner,'没记上',undefined,now,previous.id+':failed');previous.decision=undefined;}
  }
  return;
 }
 if(molly){
  const lastItem=state.messages.slice(0,before).findLast(message=>message.arrangementCard)?.arrangementCard;
  const result=command(store,owner,plain,lastItem);
  if(result){state.messages.splice(before);add(result.text,result.item);return;}
 }
 if(!molly&&(!normal(state,now)||!hadReply))return;
 if(state.messages.slice(before).some(message=>message.part.type==='professional_task'))return;
 const recognition=input.recognition||takeArrangementRecognition(turnId,incoming,now);
 if(recognition.level==='ignore'||!recognition.isArrangement||!recognition.section||recognition.section==='plan'||!recognition.time.valid||!store.shouldOffer(owner,recognition))return;
 if(molly){
  state.messages.splice(before);
  try{const result=createApproved(store,owner,recognition,current.id,characterId);add(ack(result),result.item);}
  catch{add('没记上');}
  return;
 }
 if(alreadyOffered(state.messages,recognition))return;
 const message=newMessage('',turnId,now);
 message.arrangementOffer={id:randomUUID(),section:recognition.section,title:recognition.title,question:offerQuestion(characterId,recognition.section),recognition,sourceMessageId:current.id};
 state.messages.push(message);
}

/** Group metadata is host-owned; it does not enable forbidden model choices. */
export function finishGroupArrangement(input:{db:DatabaseSync;store?:ArrangementStore;owner:string;group:GroupChat;before:number;incoming:string;sourceId:string;turnId:string;now:number;recognition?:ArrangementRecognition}){
 const {db,store,owner,group,before,incoming,sourceId,turnId,now}=input;
 const plain=arrangementPlainUserText(incoming);
 if(!store||!incoming.trim()||isDialogueCrisisInput(incoming))return;
 const speakers=group.messages.slice(before).filter(message=>message.senderId!=='user');
 const added=group.messages.slice(before);group.messages.splice(before,added.length,...added.filter(message=>!unownedArrangementSpeech.test(message.text||'')));
 const molly=group.members.find(member=>member.id==='molly'),last=group.messages.slice(0,before).findLast(message=>message.senderId!=='user');
 const offer=last?.arrangementOffer&&!last.arrangementOffer.decision?last.arrangementOffer:undefined;
 if(offer&&(consent.test(plain)||refuse.test(plain))){
  offer.decision=refuse.test(plain)?'declined':'accepted';
  if(offer.decision==='accepted')try{const result=createApproved(store,owner,offer.recognition,offer.sourceMessageId,last!.senderId,group.id);appendMollyArrangement(db,owner,ack(result),result.item,now,offer.id);}
  catch{offer.decision=undefined;appendMollyArrangement(db,owner,'没记上',undefined,now,offer.id+':failed');}
  return;
 }
 const host=(text:string,item?:ArrangementItem)=>group.messages.push({id:randomUUID(),senderId:'molly',senderName:molly?.name||'Molly',type:'text',text,at:new Date(now).toISOString(),...(item?{arrangementCard:item}:{})});
 if(molly){const result=command(store,owner,plain,group.messages.slice(0,before).findLast(message=>message.arrangementCard)?.arrangementCard);if(result){host(result.text,result.item);return;}}
 const recognition=input.recognition||takeArrangementRecognition(turnId,incoming,now);
 if(recognition.level==='ignore'||!recognition.isArrangement||!recognition.section||recognition.section==='plan'||!recognition.time.valid||!store.shouldOffer(owner,recognition))return;
 if(molly){try{const result=createApproved(store,owner,recognition,sourceId,'molly',group.id);host(ack(result),result.item);}catch{host('没记上');}return;}
 const speaker=speakers.findLast(message=>groupSpeakerAvailable(db,owner,message.senderId,now));if(!speaker)return;
 if(group.messages.some(message=>message.arrangementOffer?.recognition.title===recognition.title&&message.arrangementOffer.recognition.time.date===recognition.time.date))return;
 group.messages.push({id:randomUUID(),senderId:speaker.senderId,senderName:speaker.senderName,type:'text',text:'',at:new Date(now).toISOString(),arrangementOffer:{id:randomUUID(),section:recognition.section,title:recognition.title,question:offerQuestion(speaker.senderId,recognition.section),recognition,sourceMessageId:sourceId}});
}

/** Click consent resolves only a host-attached offer in this owner's actual
 * history; the client cannot send recognition, a recipient, or a source text. */
export function decideArrangementOffer(db:DatabaseSync,store:ArrangementStore,owner:string,offerId:string,decision:'accepted'|'declined',now=Date.now()){
 const localStore=store.using(db);
 return localStore.atomic(()=>decideStoredArrangementOffer(db,localStore,owner,offerId,decision,now));
}
function decideStoredArrangementOffer(db:DatabaseSync,store:ArrangementStore,owner:string,offerId:string,decision:'accepted'|'declined',now:number){
 for(const table of tables){
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
  const rows=db.prepare(`SELECT id,data FROM ${table} WHERE substr(id,1,?)=?`).all(owner.length+1,`${owner}:`) as {id:string;data:string}[];
  for(const row of rows){const state=JSON.parse(row.data) as PrivateHost&{revision?:number};const message=state.messages.find(item=>item.arrangementOffer?.id===offerId);if(!message?.arrangementOffer)continue;
   const offer=message.arrangementOffer;if(offer.decision)return {decision:offer.decision};
   if(decision==='accepted'){const result=createApproved(store,owner,offer.recognition,offer.sourceMessageId,row.id.slice(owner.length+1).split(':')[0]);appendMollyArrangement(db,owner,ack(result),result.item,now,offer.id);}
   offer.decision=decision;state.revision=(state.revision||0)+1;
   if(table==='sessions')db.prepare('UPDATE sessions SET revision=?,data=? WHERE id=?').run(state.revision,JSON.stringify(state),row.id);
   else db.prepare(`UPDATE ${table} SET data=? WHERE id=?`).run(JSON.stringify(state),row.id);
   return {decision};
  }
 }
 // Groups use an owner column rather than a private-session key.
 if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='npc_group_chats'").get()){
  const rows=db.prepare('SELECT id,data FROM npc_group_chats WHERE owner=?').all(owner) as {id:string;data:string}[];
  for(const row of rows){const group=JSON.parse(row.data) as GroupChat;const message=group.messages.find(item=>item.arrangementOffer?.id===offerId);if(!message?.arrangementOffer)continue;
   const offer=message.arrangementOffer;if(offer.decision)return {decision:offer.decision};
   if(decision==='accepted'){const result=createApproved(store,owner,offer.recognition,offer.sourceMessageId,message.senderId,group.id);appendMollyArrangement(db,owner,ack(result),result.item,now,offer.id);}
   offer.decision=decision;db.prepare('UPDATE npc_group_chats SET data=? WHERE owner=? AND id=?').run(JSON.stringify(group),owner,row.id);return {decision};
  }
 }
 throw Error('这条转交选项已不可用');
}
