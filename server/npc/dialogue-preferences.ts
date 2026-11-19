import type {DatabaseSync} from 'node:sqlite';
import {isDialogueCrisisInput} from '../../lib/npc/dialogue-output-guard';
import {shanghaiToday} from '../../lib/npc/task-items';
import {readArrangementStatus,type ReadonlyArrangementItem} from './arrangement-readonly';
import {validTaskDate} from '../../lib/npc/task-items';
import {readonlyBoardTaskLimit,type ReadonlyBoardSnapshotPayload} from '../../lib/npc/board-readonly-snapshot';

export const dialoguePreferenceNpcIds=['molly','he-jiawei','chen-nian','liu','zhou-chef','yuan-xiaoman','xia-xia'] as const;
export type DialoguePreferenceNpcId=typeof dialoguePreferenceNpcIds[number];
type AddressState={global:string|null;overrides:Partial<Record<DialoguePreferenceNpcId,string|null>>;previousGlobal?:string|null;lastGlobalNpc?:DialoguePreferenceNpcId};
export type EffectiveAddress={name:string;source:'default'|'global'|'personal';pronoun:'您'|'你'};
export type SupervisionSetting={npcId:DialoguePreferenceNpcId;scope:'all'|'items'|'off';itemIds:string[];updatedAt:number};
export type SupervisionContext={crisis?:boolean;cold?:boolean;silent?:boolean;canContact?:boolean;channel?:'private'|'group'|'realtime';proactive?:boolean;supervisionItemId?:string};
const checkOwner=(owner:string)=>{if(!owner||owner.length>128)throw Error('请先登录智域');};
export function preferenceNpcId(id:string):DialoguePreferenceNpcId{const normalized=id==='molly-system-secretary'?'molly':id==='xia-xia:normal'?'xia-xia':id;if(!(dialoguePreferenceNpcIds as readonly string[]).includes(normalized))throw Error('人物不存在');return normalized as DialoguePreferenceNpcId;}
const emptyAddress=():AddressState=>({global:null,overrides:{}});
const normalize=(text:string)=>text.replace(/[\s\p{P}\p{S}]/gu,'');
const quotedOrHypothetical=(text:string)=>/[“”「」『』"`]|假如|假设|比如|例如|如果|测试|模拟|转述|(?:朋友|别人|他|她|Molly|小满|陈年|柳智敏|赵一帆|夏夏|何嘉伟)(?:说|让我|希望)/u.test(text);
type AddressIntent={kind:'set';name:string;scope:'global'|'personal'}|{kind:'personalize'}|{kind:'reset'};
export function addressingIntent(text:string):AddressIntent|null{
 const input=text.trim();if(!input||quotedOrHypothetical(input)||isDialogueCrisisInput(input))return null;
 if(/^(?:以后)?(?:别|不要|不用)(?:再)?这样叫(?:我)?了?[。！!\s]*$/u.test(input))return {kind:'reset'};
 if(/^(?:以后)?只有你(?:这样叫我?|叫我)[。！!\s]*$/u.test(input))return {kind:'personalize'};
 const match=/^(?:(?:请|你|你们|以后|今后|大家|都|就|统一|只|有|这样|以后都|以后你们都|我喜欢别人)[，,\s]*)*(?:叫我|称呼我)([^，,。！!？?\n]{1,35})/u.exec(input);
 if(!match)return null;const name=match[1].trim().replace(/(?:吧|就好|就行|好了|可以吗|好吗|就可以了)$/u,'').trim();
 if(!/^[\p{L}\p{N}_·\- ]{1,20}$/u.test(name)||/别|不要|不用|不叫|这样|这个|那个|去做|去买/u.test(name))return null;
 return {kind:'set',name,scope:/只有你|只让你|仅你/u.test(input)?'personal':'global'};
}
export class DialoguePreferencesStore{
 private sequence=0;private connections=new WeakMap<DatabaseSync,DialoguePreferencesStore>();
 constructor(readonly db:DatabaseSync,private now:()=>number=Date.now,private options:{readOnly?:boolean}={}){if(!options.readOnly)db.exec(`CREATE TABLE IF NOT EXISTS npc_dialogue_addressing(owner TEXT PRIMARY KEY,data TEXT NOT NULL,updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS npc_dialogue_supervision(owner TEXT NOT NULL,npc_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(owner,npc_id));
  CREATE TABLE IF NOT EXISTS npc_dialogue_supervision_sent(owner TEXT NOT NULL,npc_id TEXT NOT NULL,item_id TEXT NOT NULL,date TEXT NOT NULL,event_id TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(owner,npc_id,item_id,date));
  CREATE TABLE IF NOT EXISTS npc_dialogue_board_snapshots(owner TEXT PRIMARY KEY,account_id TEXT NOT NULL,epoch TEXT NOT NULL,sequence INTEGER NOT NULL,captured_at INTEGER NOT NULL,data TEXT NOT NULL,updated_at INTEGER NOT NULL);`);}
 using(db:DatabaseSync){if(db===this.db)return this;let store=this.connections.get(db);if(!store){store=new DialoguePreferencesStore(db,this.now,this.options);this.connections.set(db,store);}return store;}
 private hasTable(name:string){return !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);}
 atomic<T>(fn:()=>T){if(this.options.readOnly)throw Error('只读偏好不能修改');const key=`dialogue_prefs_${++this.sequence}`;this.db.exec('SAVEPOINT '+key);try{const result=fn();this.db.exec('RELEASE SAVEPOINT '+key);return result;}catch(error){this.db.exec('ROLLBACK TO SAVEPOINT '+key);this.db.exec('RELEASE SAVEPOINT '+key);throw error;}}
 private addressing(owner:string):AddressState{checkOwner(owner);if(!this.hasTable('npc_dialogue_addressing'))return emptyAddress();const row=this.db.prepare('SELECT data FROM npc_dialogue_addressing WHERE owner=?').get(owner) as {data:string}|undefined;return row?JSON.parse(row.data):emptyAddress();}
 effectiveAddress(owner:string,npc:string):EffectiveAddress{const id=preferenceNpcId(npc),state=this.addressing(owner),personal=Object.hasOwn(state.overrides,id),name=personal?state.overrides[id]:state.global;return {name:name||'老大',source:!name?'default':personal?'personal':'global',pronoun:id==='zhou-chef'?'您':'你'};}
 setAddress(owner:string,npc:string,input:AddressIntent){const id=preferenceNpcId(npc);return this.atomic(()=>{const state=this.addressing(owner);
  if(input.kind==='set'){if(addressingIntent('叫我'+input.name)?.kind!=='set')throw Error('称呼无效');if(input.scope==='personal')state.overrides[id]=input.name;else {state.previousGlobal=state.global;state.global=input.name;state.lastGlobalNpc=id;state.overrides={};}}
  else if(input.kind==='personalize'){const current=this.effectiveAddress(owner,id);if(current.source==='global'){state.global=state.previousGlobal??null;delete state.lastGlobalNpc;}state.overrides[id]=current.name;}
  else if(Object.hasOwn(state.overrides,id))state.overrides[id]=null;else {state.global=null;delete state.lastGlobalNpc;}
  this.db.prepare('INSERT INTO npc_dialogue_addressing VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').run(owner,JSON.stringify(state),this.now());return this.effectiveAddress(owner,id);
 });}
 supervision(owner:string,npc:string):SupervisionSetting{checkOwner(owner);const id=preferenceNpcId(npc),row=this.hasTable('npc_dialogue_supervision')?this.db.prepare('SELECT data FROM npc_dialogue_supervision WHERE owner=? AND npc_id=?').get(owner,id) as {data:string}|undefined:undefined;return row?JSON.parse(row.data):{npcId:id,scope:'off',itemIds:[],updatedAt:0};}
 saveBoardSnapshot(owner:string,accountId:string,input:ReadonlyBoardSnapshotPayload){
  checkOwner(owner);const exact=(value:object,keys:string[])=>Object.keys(value).every(key=>keys.includes(key)),short=(value:unknown,max:number)=>typeof value==='string'&&value.length>0&&value.length<=max;
  if(!input||!exact(input,['action','accountId','epoch','sequence','capturedAt','tasks'])||input.action!=='board-snapshot'||input.accountId!==accountId||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(input.epoch)||!Number.isSafeInteger(input.sequence)||input.sequence<1||!Number.isSafeInteger(input.capturedAt)||input.capturedAt>this.now()+30000||input.capturedAt<this.now()-10*60000||!Array.isArray(input.tasks)||input.tasks.length>=readonlyBoardTaskLimit)throw Error('只读安排快照无效');
  const account=this.hasTable('zhiyu_accounts')?this.db.prepare('SELECT id FROM zhiyu_accounts WHERE owner_id=?').get(owner) as {id:string}|undefined:undefined;if(!account||account.id!==accountId)throw Error('快照账号不匹配');
  const ids=new Set<string>();for(const task of input.tasks){if(!task||!exact(task,['id','title','date','status','npcId','steps','count','source'])||!short(task.id,4096)||ids.has(task.id)||!short(task.title,8192)||!short(task.npcId,80)||!(task.date===''||validTaskDate(task.date))||!['todo','in_progress','paused','done','ended','missed'].includes(task.status))throw Error('只读安排条目无效');ids.add(task.id);
   if(task.steps!==undefined&&(!Array.isArray(task.steps)||task.steps.length>=readonlyBoardTaskLimit||task.steps.some(step=>!step||!exact(step,['id','done','skipped'])||!short(step.id,4096)||typeof step.done!=='boolean'||step.skipped!==undefined&&typeof step.skipped!=='boolean')))throw Error('只读步骤无效');
   if(task.count!==undefined&&(!task.count||!exact(task.count,['current','target'])||![task.count.current,task.count.target].every(value=>Number.isFinite(value)&&value>=0&&value<=1e9)))throw Error('只读计数无效');
   if(task.source!==undefined&&(!task.source||!exact(task.source,['kind','id','key','revision','originalDate'])||!['professional','group'].includes(task.source.kind)||!short(task.source.id,2048)||task.source.key!==undefined&&!short(task.source.key,4096)||task.source.revision!==undefined&&(!Number.isSafeInteger(task.source.revision)||task.source.revision<0)||task.source.originalDate!==undefined&&!validTaskDate(task.source.originalDate)))throw Error('只读来源无效');
  }
  return this.atomic(()=>{const prior=this.db.prepare('SELECT epoch,sequence,captured_at FROM npc_dialogue_board_snapshots WHERE owner=?').get(owner) as {epoch:string;sequence:number;captured_at:number}|undefined;
   if(prior&&(input.epoch===prior.epoch?input.sequence<=prior.sequence||input.capturedAt<prior.captured_at:input.capturedAt<=prior.captured_at))return {status:'stale' as const,sequence:prior.sequence,readOnly:true};
   this.db.prepare('INSERT INTO npc_dialogue_board_snapshots VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET account_id=excluded.account_id,epoch=excluded.epoch,sequence=excluded.sequence,captured_at=excluded.captured_at,data=excluded.data,updated_at=excluded.updated_at').run(owner,accountId,input.epoch,input.sequence,input.capturedAt,JSON.stringify({tasks:input.tasks}),this.now());return {status:'saved' as const,sequence:input.sequence,readOnly:true};
  });
 }
 setSupervision(owner:string,npc:string,input:{scope:'all'|'items'|'off';itemIds?:string[]}){checkOwner(owner);const id=preferenceNpcId(npc);if(!['all','items','off'].includes(input.scope))throw Error('监督范围无效');
  const itemIds=input.scope==='items'?[...new Set(input.itemIds||[])]:[];if(input.scope==='items'&&(!itemIds.length||itemIds.some(key=>!readArrangementStatus(this.db,owner,this.now()).items.some(item=>item.id===key))))throw Error('请选择当前账号已有安排');
  const setting:SupervisionSetting={npcId:id,scope:input.scope,itemIds,updatedAt:this.now()};return this.atomic(()=>{this.db.prepare('INSERT INTO npc_dialogue_supervision VALUES(?,?,?) ON CONFLICT(owner,npc_id) DO UPDATE SET data=excluded.data').run(owner,id,JSON.stringify(setting));return setting;});
 }
 applyIncoming(owner:string,npc:string,text:string,options:{agreeToXiaomanOpening?:boolean}={}){
  const id=preferenceNpcId(npc),intent=addressingIntent(text);let address:EffectiveAddress|undefined,supervision:SupervisionSetting|undefined;
  return this.atomic(()=>{if(intent)address=this.setAddress(owner,id,intent);
   if(!quotedOrHypothetical(text)&&!isDialogueCrisisInput(text)){
    if(/(?:不用|不要|别|停止|取消).{0,6}(?:盯|监督)|不用盯了/u.test(text))supervision=this.setSupervision(owner,id,{scope:'off'});
    else if(/帮我盯着|监督我|我偷懒你就说我|(?:请|你|帮我).{0,8}(?:盯着|盯住).{0,20}(?:安排|进度|报告|任务)/u.test(text)||(id==='yuan-xiaoman'&&options.agreeToXiaomanOpening===true&&/^(?:好|行|嗯|可以|同意|好的|没问题|你盯着|拜托了)[啊呀吧呢。！!\s]*$/u.test(text))){
     const snapshot=readArrangementStatus(this.db,owner,this.now()),targets=snapshot.items.filter(item=>normalize(text).includes(normalize(item.title)));
     const explicitAll=/全部|所有|都盯|都监督|所有安排/u.test(text),ambiguousTarget=/(?:盯着|盯住|监督)(?:我)?(?:的)?[^，,。！!]{2,}/u.test(text)&&!/(?:帮我盯着|监督我|我偷懒你就说我)[。！!\s]*$/u.test(text);
     if(targets.length)supervision=this.setSupervision(owner,id,{scope:'items',itemIds:targets.map(item=>item.id)});
     else if(explicitAll||!ambiguousTarget||options.agreeToXiaomanOpening)supervision=this.setSupervision(owner,id,{scope:'all'});
    }
   }return {addressChanged:!!address,supervisionChanged:!!supervision,address,supervision};
  });
 }
 prompt(owner:string,npc:string,context:SupervisionContext={}){const id=preferenceNpcId(npc),address=this.effectiveAddress(owner,id),snapshot=readArrangementStatus(this.db,owner,this.now()),supervision=this.supervision(owner,id);
  const activeCandidate=!!context.supervisionItemId&&this.supervisionCandidates(owner,id,context).some(item=>item.id===context.supervisionItemId);
  return '\n【本轮服务端称呼与安排只读事实】'+JSON.stringify({addressing:{...address,rule:'用户指定的称呼优先于默认称呼，不每句都带称呼；固定开场白仍原样使用老大'},arrangements:{...snapshot,readOnly:true,rule:'只读状态，不授予新增、修改、完成、取消或转派安排的权限；未读取不能当作零'},supervision:{...supervision,channel:context.channel||'private',proactive:!!context.proactive,canProactivelyAsk:activeCandidate,rule:'没有明确授权不得主动催安排；已授权也只能在本轮程序指定的监督candidate上主动提一次，普通主动聊天不得借只读快照重复催。用户主动聊到已有安排时可顺口问，不承诺已修改或完成'}});
 }
 supervisionCandidates(owner:string,npc:string,context:SupervisionContext={}){const id=preferenceNpcId(npc);if(context.crisis||context.cold||context.silent||context.canContact===false)return [];
  const setting=this.supervision(owner,id);if(setting.scope==='off')return [];const today=shanghaiToday(this.now());return readArrangementStatus(this.db,owner,this.now()).items.filter(item=>(setting.scope==='all'||setting.itemIds.includes(item.id))&&item.supervisable!==false&&['not_started','overdue'].includes(item.status)&&(!item.date||item.date<=today)&&(!this.hasTable('npc_dialogue_supervision_sent')||!this.db.prepare('SELECT 1 FROM npc_dialogue_supervision_sent WHERE owner=? AND npc_id=? AND item_id=? AND date=?').get(owner,id,item.id,today)));
 }
 markSupervisionDelivered(owner:string,npc:string,itemId:string,eventId:string){const id=preferenceNpcId(npc);if(!eventId||eventId.length>200)throw Error('缺少真实送达事件');return this.atomic(()=>this.db.prepare('INSERT OR IGNORE INTO npc_dialogue_supervision_sent VALUES(?,?,?,?,?,?)').run(owner,id,itemId,shanghaiToday(this.now()),eventId,this.now()).changes>0);}
 supervisionText(npc:string,item:ReadonlyArrangementItem,addressName='老大'){switch(preferenceNpcId(npc)){case 'yuan-xiaoman':return `${item.title}还没做完呀，做到哪儿了`;case 'xia-xia':return `${item.title}还没完成诶，${addressName}是不是偷懒啦`;case 'zhou-chef':return `${item.title}还没完成，您现在进展怎么样`;case 'chen-nian':return `${item.title}还没完成呢，做到哪了${addressName}`;case 'he-jiawei':return `${item.title}还没完成，进度怎么样`;case 'liu':return `${item.title}还没完成，进度怎么样`;default:return `${item.title}，办了没`;}}
}
const stores=new Map<string,DialoguePreferencesStore>();
export const dialoguePreferencesFor=(root:string)=>stores.get(root);
export function bindDialoguePreferences(root:string,store:DialoguePreferencesStore){stores.set(root,store);return ()=>{if(stores.get(root)===store)stores.delete(root);};}
