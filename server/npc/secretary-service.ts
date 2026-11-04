import {MollyReportDemos} from './molly-report-demos';
import {ExperienceReportsStore,type ReportStoreDependencies} from './experience-reports-store';
import {parseReportCity} from './weather-provider';
import type {SecretarySettings} from '../../lib/npc/experience';
export type {SecretarySettings} from '../../lib/npc/experience';
import {createHash, randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {MollyAction, MollyState} from '../../lib/npc/molly';
import {createMolly} from '../../lib/npc/molly';
import type {ChatMessage} from '../../lib/npc/contracts';
import {validTime} from './group-dialogue';
import {groupStoreFor, type GroupChatStore} from './groups-plugin';
import {receivePrivateDelegation,supportsPrivateDelegationTarget, type PrivateDelegationReceiverDeps} from './private-delegation-receiver';
import {getCharacter} from '../../lib/npc/character-directory';
import {readSecretaryTasks, readSecretaryCompletions, secretaryTaskContext, secretaryPlanContext, existingTables, reconcileStoredPrivateTasks} from './secretary-tasks';
import {reconcileGroupTaskExpiry,readGroupTaskSkips} from './group-task-expiry';

type SavedSettings=SecretarySettings&{effectiveSince:number};
type DelegationInput=Parameters<typeof receivePrivateDelegation>[2];
type JobRow={owner:string;id:string;data:string;attempts:number;next_at:number;status:string;notified:number};
export type SecretaryDependencies={now?:()=>number;receiver?:typeof receivePrivateDelegation;receiverDeps?:PrivateDelegationReceiverDeps;groups?:GroupChatStore}&ReportStoreDependencies;
const OWNER=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function stableUuid(value:string){const h=createHash('sha256').update(value).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
export function explicitlyContinuePlan(text:string){
  if(/(?:不要|不用|别|不想|不再|不按|不照).{0,12}(?:照旧|一样|上周|之前|原来|这份)/u.test(text))return false;
  return /照旧|照原(?:来|先)?(?:的)?(?:计划|方案)|(?:还|继续|就)?按.{0,18}(?:上周|之前|以前|原来|这份|现在这份)|(?:和|跟).{0,12}(?:上周|之前|以前).{0,6}一样/u.test(text);
}

/** One durable outbox shared by Molly, private NPC receivers and the daily clock. */
export class SecretaryStore {
  private now:()=>number;
  private active=new Set<string>();
  private stopped=false;
  private reports:ExperienceReportsStore;
  private demos:MollyReportDemos;
  constructor(private db:DatabaseSync,private root:string,private deps:SecretaryDependencies={}){
    this.now=deps.now||Date.now;
    db.exec(`CREATE TABLE IF NOT EXISTS npc_secretary_settings(owner TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS npc_secretary_jobs(owner TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,notified INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '',PRIMARY KEY(owner,id));
      CREATE TABLE IF NOT EXISTS npc_secretary_occurrences(owner TEXT NOT NULL,date TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(owner,date));
      CREATE TABLE IF NOT EXISTS npc_secretary_receipts(owner TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(owner,id));
      CREATE TABLE IF NOT EXISTS npc_secretary_completions(owner TEXT NOT NULL,task_id TEXT NOT NULL,completed INTEGER NOT NULL,PRIMARY KEY(owner,task_id));
      CREATE TABLE IF NOT EXISTS molly_sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL);`);
    db.prepare("UPDATE npc_secretary_jobs SET status='queued' WHERE status='running'").run();
    this.reports=new ExperienceReportsStore(db,root,this.now,deps);
    this.demos=new MollyReportDemos(db,this.now);
  }
  private checkOwner(owner:string){if(!OWNER.test(owner))throw Error('请先登录智域');}
  private savedSettings(owner:string):SavedSettings{
    this.checkOwner(owner);
    const row=this.db.prepare('SELECT data FROM npc_secretary_settings WHERE owner=?').get(owner) as {data:string}|undefined;
    if(row)return JSON.parse(row.data) as SavedSettings;
    const settings={enabled:true,time:'07:00',effectiveSince:this.now()};
    this.db.prepare('INSERT INTO npc_secretary_settings VALUES(?,?)').run(owner,JSON.stringify(settings));
    return settings;
  }
  settings(owner:string):SecretarySettings{const {enabled,time,city,weeklyEnabled=true,weeklyDay=0,weeklyTime='21:30'}=this.savedSettings(owner);return {enabled,time,...(city?{city}:{}),weeklyEnabled,weeklyDay,weeklyTime};}
  updateSettings(owner:string,value:unknown):SecretarySettings{
    this.checkOwner(owner);
    const input=value as SecretarySettings;
    if(!input||typeof input.enabled!=='boolean'||!validTime(input.time))throw Error('请选择有效的提醒开关和时间');
    const old=this.savedSettings(owner);
    if(input.weeklyEnabled!==undefined&&typeof input.weeklyEnabled!=='boolean'||input.weeklyDay!==undefined&&(!Number.isInteger(input.weeklyDay)||input.weeklyDay<0||input.weeklyDay>6)||input.weeklyTime!==undefined&&!validTime(input.weeklyTime))throw Error('请选择有效的周报时间');
    const city=input.city===undefined?old.city:parseReportCity(input.city);
    if(input.city!==undefined&&!city)throw Error('请选择有效城市');
    const saved:SavedSettings={enabled:input.enabled,time:input.time,effectiveSince:this.now(),...(city?{city}:{}),weeklyEnabled:input.weeklyEnabled??old.weeklyEnabled??true,weeklyDay:input.weeklyDay??old.weeklyDay??0,weeklyTime:input.weeklyTime??old.weeklyTime??'21:30'};
    this.db.prepare('INSERT OR REPLACE INTO npc_secretary_settings VALUES(?,?)').run(owner,JSON.stringify(saved));
    return this.settings(owner);
  }
  completions(owner:string){this.checkOwner(owner);reconcileGroupTaskExpiry(this.db,owner,this.now());return readSecretaryCompletions(this.db,owner);}
  updateCompletions(owner:string,changes:unknown){
    this.checkOwner(owner);
    if(!changes||typeof changes!=='object'||Array.isArray(changes)||Object.keys(changes).length>1000
      ||Object.entries(changes).some(([id,done])=>!id||id.length>400||typeof done!=='boolean'))throw Error('任务完成状态无效');
    const snapshot=readSecretaryTasks(this.db,owner,this.now());
    const entries=new Map(snapshot.allEntries.filter(item=>!!item.groupId).map(item=>[item.id,item]));
    const skips=readGroupTaskSkips(this.db,owner);
    // Old local snapshots may contain a deleted/left-group item; ignore it, never
    // import foreign IDs or erase the rest of the valid migration.
    const write=this.db.prepare('INSERT OR REPLACE INTO npc_secretary_completions VALUES(?,?,?)');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      for(const [id,done] of Object.entries(changes)){
        const item=entries.get(id);
        // A stale offline snapshot is acknowledged with canonical server
        // state so the client can clear its pending mutation without reviving
        // yesterday's skipped task or undoing a genuine historical completion.
        if(item&&!skips[id]&&!item.dates.some(date=>date<snapshot.today))write.run(owner,id,done?1:0);
      }
      this.db.exec('COMMIT');
    }
    catch(error){this.db.exec('ROLLBACK');throw error;}
    return this.completions(owner);
  }
  context(owner:string){
    this.checkOwner(owner);const snapshot=readSecretaryTasks(this.db,owner,this.now());
    const pending=this.db.prepare("SELECT data,status FROM npc_secretary_jobs WHERE owner=? AND status!='delivered' ORDER BY rowid DESC LIMIT 12").all(owner) as {data:string;status:string}[];
    return {taskSummary:{...secretaryTaskContext(snapshot),pendingDelegations:pending.map(row=>{const input=JSON.parse(row.data) as DelegationInput;return {targetId:input.targetId,goal:input.goal,status:row.status};})},planSummary:secretaryPlanContext(snapshot)};
  }
  async execute(owner:string,actions:readonly MollyAction[],state:MollyState){
    this.checkOwner(owner);
    const taskLinks:NonNullable<ChatMessage['taskLinks']>=[];
    let groupEvent:ChatMessage['secretaryEvent'];
    for(const action of actions){
      const source=state.messages.find(message=>message.id===action.sourceMessageId&&message.role==='user'&&state.queue.includes(message.turnId));
      if(!source||!('text' in source.part)||typeof source.part.text!=='string'||!source.part.text.includes(action.evidence))throw Error('秘书委托来源已失效');
      const discriminator=action.type==='handoff'?action.targetId:action.type==='tasks'?action.taskScope:'group';
      const id=`secretary:${source.id}:${action.type}:${discriminator}`;
      if(action.type==='tasks'){
        taskLinks.push({scope:action.taskScope,label:action.taskScope==='today'?'查看今日任务':'查看全部任务'});
      }else if(action.type==='handoff'){
        const target=getCharacter(action.targetId);
        if(!target||!target.services.includes(action.service)||!supportsPrivateDelegationTarget(action.targetId))throw Error('该人物不能承接这项委托');
        const weekly=action.targetId==='liu'&&(/(?:周|星期|七天|7天)/u.test(source.part.text)||action.mode!=='new');
        let planMode=action.mode;
        if(weekly&&planMode==='continue-plan'&&!explicitlyContinuePlan(source.part.text))planMode='confirm-plan';
        const input:DelegationInput={owner,id,targetId:action.targetId,
          source:{conversationId:'molly-system-secretary',messageId:source.id,text:source.part.text,at:source.at},
          goal:action.request,mode:weekly?'weekly-renewal':'request',planMode,createdAt:new Date(this.now()).toISOString()};
        const serialized=JSON.stringify(input),previous=this.db.prepare('SELECT data FROM npc_secretary_jobs WHERE owner=? AND id=?').get(owner,id) as {data:string}|undefined;
        if(previous){const old=JSON.parse(previous.data) as DelegationInput;if(old.targetId!==input.targetId||old.source.messageId!==input.source.messageId)throw Error('秘书委托编号冲突');}
        else this.db.prepare("INSERT INTO npc_secretary_jobs(owner,id,data,status) VALUES(?,?,?,'queued')").run(owner,id,serialized);
      }else if(action.type==='create-group'){
        const store=this.deps.groups||groupStoreFor(this.root);
        if(!store)throw Error('群聊服务尚未就绪');
        const receipt=this.db.prepare('SELECT data FROM npc_secretary_receipts WHERE owner=? AND id=?').get(owner,id) as {data:string}|undefined;
        if(receipt){const event=JSON.parse(receipt.data) as NonNullable<ChatMessage['secretaryEvent']>;const saved=store.get(owner,event.groupId);if(saved.leftAt)throw Error('你已退出这个群');groupEvent=event;continue;}
        const account=existingTables(this.db).has('zhiyu_accounts')
          ?this.db.prepare('SELECT username FROM zhiyu_accounts WHERE owner_id=?').get(owner) as {username:string}|undefined:undefined;
        const group=await store.create(owner,{requestId:stableUuid(`${owner}:${id}`),sourceCharacterId:'molly',goal:action.goal,
          memberIds:action.memberIds,self:{name:account?.username?.slice(0,40)||'我'}});
        groupEvent={id,kind:'group',groupId:group.id,sourceMessageId:source.id};
        this.db.prepare('INSERT OR REPLACE INTO npc_secretary_receipts VALUES(?,?,?)').run(owner,id,JSON.stringify(groupEvent));
      }
    }
    return {taskLinks:[...new Map(taskLinks.map(link=>[link.scope,link])).values()],groupEvent};
  }
  private appendMolly(owner:string,eventId:string,text:string,kind:'morning'|'handoff',taskLinks?:ChatMessage['taskLinks']){
    const key=`${owner}:molly-system-secretary`,row=this.db.prepare('SELECT data FROM molly_sessions WHERE id=?').get(key) as {data:string}|undefined;
    const state:MollyState=row?JSON.parse(row.data):createMolly();
    if(state.messages.some(message=>message.secretaryEvent?.id===eventId))return;
    state.messages.push({id:randomUUID(),turnId:eventId,role:'assistant',at:new Date(this.now()).toISOString(),origin:'proactive',
      part:{type:'text',text},secretaryEvent:{id:eventId,kind},...(taskLinks?{taskLinks}:{})});
    state.revision=(state.revision||0)+1;
    this.db.prepare('INSERT OR REPLACE INTO molly_sessions VALUES(?,?)').run(key,JSON.stringify(state));
  }
  async drain(owner?:string){
    if(this.stopped)return;
    const rows=(owner?this.db.prepare("SELECT * FROM npc_secretary_jobs WHERE owner=? AND status IN ('queued','retrying') AND next_at<=? ORDER BY rowid").all(owner,this.now())
      :this.db.prepare("SELECT * FROM npc_secretary_jobs WHERE status IN ('queued','retrying') AND next_at<=? ORDER BY rowid").all(this.now())) as JobRow[];
    for(const row of rows){
      const key=`${row.owner}:${row.id}`;if(this.active.has(key)||this.stopped)continue;
      this.active.add(key);
      try{
        this.db.prepare("UPDATE npc_secretary_jobs SET status='running' WHERE owner=? AND id=?").run(row.owner,row.id);
        const result=await (this.deps.receiver||receivePrivateDelegation)(this.root,this.db,JSON.parse(row.data),{...this.deps.receiverDeps,now:this.now});
        if(this.stopped)return;
        if(result.status==='busy'){
          this.db.prepare("UPDATE npc_secretary_jobs SET status='queued',next_at=?,error='等待NPC空闲或服务恢复' WHERE owner=? AND id=?").run(this.now()+1000,row.owner,row.id);
          const input=JSON.parse(row.data) as DelegationInput;
          if(!row.notified&&this.now()-Date.parse(input.createdAt)>=120000){this.appendMolly(row.owner,`waiting:${row.id}`,'还没接上，稍后重试','handoff');this.db.prepare('UPDATE npc_secretary_jobs SET notified=1 WHERE owner=? AND id=?').run(row.owner,row.id);}
        }
        else this.db.prepare("UPDATE npc_secretary_jobs SET status='delivered',error='' WHERE owner=? AND id=?").run(row.owner,row.id);
      }catch{
        if(!this.stopped){
          const attempts=row.attempts+1;
          this.db.prepare("UPDATE npc_secretary_jobs SET status='retrying',attempts=?,next_at=?,error='暂未接通，稍后自动重试' WHERE owner=? AND id=?")
            .run(attempts,this.now()+Math.min(3600000,15000*2**Math.min(attempts,8)),row.owner,row.id);
          if(!row.notified&&attempts>=2){this.appendMolly(row.owner,`failed:${row.id}`,'暂时没接上，稍后重试','handoff');this.db.prepare('UPDATE npc_secretary_jobs SET notified=1 WHERE owner=? AND id=?').run(row.owner,row.id);}
        }
      }finally{this.active.delete(key);}
    }
  }
  // This release intentionally has no real scheduled report producer. Keep old
  // messages and pure arithmetic available for historical rendering only.
  async morning(owner:string){this.checkOwner(owner);return false;}
  async scanMorning(){return;}
  async scanReports(){return;}
  async locateCity(owner:string,query:unknown,source:unknown){
    this.checkOwner(owner);if(source!=='manual'||typeof query!=='string'||query.length>100)return undefined;
    return parseReportCity({name:query,source:'manual'});
  }
  ensureReportDemos(owner:string){this.checkOwner(owner);if(this.stopped)return {};return this.demos.ensure(owner);}
  regenerateReportDemo(owner:string,kind:unknown){this.checkOwner(owner);if(this.stopped)throw Error('服务已停止');return this.demos.regenerate(owner,kind);}
  reportDemoAction(owner:string,input:Record<string,unknown>){this.checkOwner(owner);if(this.stopped)throw Error('服务已停止');return this.demos.action(owner,input);}
  reportDemoQuote(owner:string,input:Record<string,unknown>){this.checkOwner(owner);if(this.stopped)throw Error('服务已停止');return this.demos.quote(owner,input);}
  updateCity(owner:string,value:unknown):SecretarySettings{
    this.checkOwner(owner);const city=parseReportCity(value);if(!city)throw Error('请选择有效城市');
    const saved={...this.savedSettings(owner),city};this.db.prepare('INSERT OR REPLACE INTO npc_secretary_settings VALUES(?,?)').run(owner,JSON.stringify(saved));
    return this.settings(owner);
  }
  reportQuote(owner:string,reportId:unknown,characterId:unknown){this.checkOwner(owner);return this.reports.reportQuote(owner,reportId,characterId);}
  usage(owner:string,value:{currentNpc:string;visible:boolean;busy?:boolean;clientId:string}){this.checkOwner(owner);return this.reports.usage(owner,value);}
  scanTaskExpiry(){
    if(this.stopped)return;
    reconcileStoredPrivateTasks(this.db,this.now());
    if(existingTables(this.db).has('npc_group_chats'))for(const row of this.db.prepare('SELECT DISTINCT owner FROM npc_group_chats').all() as {owner:string}[])
      reconcileGroupTaskExpiry(this.db,row.owner,this.now());
  }
  async tick(){
    this.scanTaskExpiry();
    await this.scanMorning();
    await this.scanReports();
    await this.drain();
  }
  stop(){this.stopped=true;this.reports.stop();}
}
