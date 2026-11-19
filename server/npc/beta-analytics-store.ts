import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import type {DatabaseSync} from 'node:sqlite';
import {BETA_EVENT_TYPES,beijingDate,type BetaEventMeta,type BetaEventType,type BetaRetention,type BetaAdminRole,type BetaUserRow,type BetaDashboard,BETA_NPC_NAMES} from '../../lib/npc/beta-analytics';
import {initBetaIdentity} from './beta-identity';
import {buildSurveyAnalytics} from './beta-survey-store';

const DAY=86400000,SESSION_GAP=30*60000;
/** Private, payload-free cache invalidation. It never carries user content. */
export const betaAnalyticsChanges=new EventEmitter();
betaAnalyticsChanges.setMaxListeners(100);
const npcIds=new Set(Object.keys(BETA_NPC_NAMES));
const eventTypes=new Set<string>(BETA_EVENT_TYPES);
const word=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
export type BetaEventInput={accountId:string;eventId:string;type:BetaEventType;npcId?:string;at?:number;value?:number;meta?:BetaEventMeta};
type EventRow={account_id:string;event_id:string;type:BetaEventType;npc_id:string|null;at:number;value:number|null;meta_json:string};
type AccountRow={id:string;display_number:string|number;created_at:number;note?:string;is_internal:number};
type SessionRow={id:string;account_id:string;started_at:number;last_activity_at:number;active_ms:number;ended_at:number|null};
type TabRow={session_id:string;last_at:number;last_seq:number;last_total_ms:number};
export function initBetaAnalytics(db:DatabaseSync) {
  initBetaIdentity(db);
  db.exec(`CREATE TABLE IF NOT EXISTS zhiyu_beta_events (
    account_id TEXT NOT NULL,event_id TEXT NOT NULL,type TEXT NOT NULL,npc_id TEXT,at INTEGER NOT NULL,value REAL,meta_json TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY(account_id,event_id));
    CREATE INDEX IF NOT EXISTS zhiyu_beta_events_time ON zhiyu_beta_events(at,type);
    CREATE TABLE IF NOT EXISTS zhiyu_beta_sessions (
      id TEXT PRIMARY KEY,account_id TEXT NOT NULL,started_at INTEGER NOT NULL,last_activity_at INTEGER NOT NULL,active_ms INTEGER NOT NULL DEFAULT 0,ended_at INTEGER);
    CREATE INDEX IF NOT EXISTS zhiyu_beta_session_owner ON zhiyu_beta_sessions(account_id,last_activity_at);
    CREATE TABLE IF NOT EXISTS zhiyu_beta_activity_tabs (
      account_id TEXT NOT NULL,tab_id TEXT NOT NULL,session_id TEXT NOT NULL,last_at INTEGER NOT NULL,last_seq INTEGER NOT NULL,last_total_ms INTEGER NOT NULL,
      PRIMARY KEY(account_id,tab_id));
    CREATE TABLE IF NOT EXISTS zhiyu_beta_active_intervals (
      session_id TEXT NOT NULL,start_at INTEGER NOT NULL,end_at INTEGER NOT NULL,PRIMARY KEY(session_id,start_at,end_at));
    CREATE TABLE IF NOT EXISTS zhiyu_beta_app_opens (
      account_id TEXT NOT NULL,day TEXT NOT NULL,first_at INTEGER NOT NULL,last_at INTEGER NOT NULL,PRIMARY KEY(account_id,day));`);
}
function sanitizedMeta(meta:BetaEventMeta|undefined):BetaEventMeta {
  if(meta===undefined)return {};
  if(!meta||typeof meta!=='object'||Array.isArray(meta))throw Error('事件附加信息无效');
  const allowed=new Set(['context','groupId','domain','platform','surveyId','recipientIds']);
  if(Object.keys(meta).some(key=>!allowed.has(key)))throw Error('事件不能包含正文或其他资料');
  const result:BetaEventMeta={};
  if(meta.context!==undefined){if(meta.context!=='private'&&meta.context!=='group')throw Error('对话类型无效');result.context=meta.context;}
  for(const key of ['groupId','domain','platform'] as const)if(meta[key]!==undefined){if(typeof meta[key]!=='string'||!word.test(meta[key]!))throw Error('事件附加信息无效');result[key]=meta[key];}
  if(meta.surveyId!==undefined){if(meta.surveyId!=='A'&&meta.surveyId!=='B')throw Error('问卷编号无效');result.surveyId=meta.surveyId;}
  if(meta.recipientIds!==undefined){if(!Array.isArray(meta.recipientIds)||meta.recipientIds.length>7||meta.recipientIds.some(id=>!npcIds.has(id)))throw Error('收信智友无效');result.recipientIds=[...new Set(meta.recipientIds)];}
  return result;
}
/** Call only after the corresponding real server action has succeeded. No text enters this table. */
export function recordBetaEvent(db:DatabaseSync,input:BetaEventInput):boolean {
  if(typeof input.accountId!=='string'||!input.accountId||typeof input.eventId!=='string'||!word.test(input.eventId)||!eventTypes.has(input.type))throw Error('使用事件无效');
  if(input.npcId!==undefined&&!npcIds.has(input.npcId))throw Error('智友编号无效');
  const at=input.at??Date.now();
  if(!Number.isSafeInteger(at)||at<0||input.value!==undefined&&(!Number.isFinite(input.value)||input.value<0||input.value>86400*31))throw Error('事件数值无效');
  if(!db.prepare('SELECT id FROM zhiyu_accounts WHERE id=?').get(input.accountId))throw Error('用户不存在');
  const meta=sanitizedMeta(input.meta);
  if(meta.recipientIds!==undefined&&input.type!=='message_sent')throw Error('此事件不能指定收信智友');
  const inserted=!!db.prepare('INSERT OR IGNORE INTO zhiyu_beta_events(account_id,event_id,type,npc_id,at,value,meta_json) VALUES(?,?,?,?,?,?,?)')
    .run(input.accountId,input.eventId,input.type,input.npcId??null,at,input.value??null,JSON.stringify(meta)).changes;
  if(inserted)betaAnalyticsChanges.emit('change');return inserted;
}
export type BetaActivityInput={action:'open'|'heartbeat'|'end';tabId:string;seq:number;totalActiveMs?:number;activeMs?:number;visible?:boolean;segments?:{startAt:number;endAt:number}[]};
function addInterval(db:DatabaseSync,sessionId:string,start:number,end:number):number {
  if(end<=start)return 0;
  const overlaps=db.prepare('SELECT start_at,end_at FROM zhiyu_beta_active_intervals WHERE session_id=? AND end_at>=? AND start_at<=? ORDER BY start_at').all(sessionId,start,end) as {start_at:number;end_at:number}[];
  let from=start,to=end,prior=0;
  for(const row of overlaps){from=Math.min(from,row.start_at);to=Math.max(to,row.end_at);prior+=row.end_at-row.start_at;db.prepare('DELETE FROM zhiyu_beta_active_intervals WHERE session_id=? AND start_at=? AND end_at=?').run(sessionId,row.start_at,row.end_at);}
  db.prepare('INSERT INTO zhiyu_beta_active_intervals VALUES(?,?,?)').run(sessionId,from,to);
  return to-from-prior;
}
/** Persists only confirmed foreground intervals; never extrapolates a missing heartbeat or adds an idle tail. */
export function recordBetaActivity(db:DatabaseSync,accountId:string,input:BetaActivityInput,now=Date.now()) {
  if(!input||!['open','heartbeat','end'].includes(input.action)||typeof input.tabId!=='string'||!word.test(input.tabId)||!Number.isSafeInteger(input.seq)||input.seq<0)throw Error('会话信息无效');
  if(input.visible!==undefined&&typeof input.visible!=='boolean')throw Error('前台状态无效');
  for(const n of [input.totalActiveMs,input.activeMs])if(n!==undefined&&(!Number.isSafeInteger(n)||n<0||n>31*DAY))throw Error('使用时长无效');
  if(input.segments!==undefined&&(!Array.isArray(input.segments)||input.segments.length>64||input.segments.some(s=>!s||!Number.isSafeInteger(s.startAt)||!Number.isSafeInteger(s.endAt)||s.endAt<s.startAt)))throw Error('使用区间无效');
  db.exec('BEGIN IMMEDIATE');
  try {
    const tab=db.prepare('SELECT session_id,last_at,last_seq,last_total_ms FROM zhiyu_beta_activity_tabs WHERE account_id=? AND tab_id=?').get(accountId,input.tabId) as TabRow|undefined;
    if(tab&&input.seq<=tab.last_seq){db.exec('COMMIT');return {sessionId:tab.session_id,newSession:false,duplicate:true,confirmedActiveMs:0};}
    let session=db.prepare('SELECT * FROM zhiyu_beta_sessions WHERE account_id=? ORDER BY last_activity_at DESC LIMIT 1').get(accountId) as SessionRow|undefined;
    const fresh=!session||now-session.last_activity_at>=SESSION_GAP;
    if(fresh){
      if(session&&session.ended_at===null){db.prepare('UPDATE zhiyu_beta_sessions SET ended_at=last_activity_at WHERE id=?').run(session.id);recordBetaEvent(db,{accountId,eventId:'session-end:'+session.id,type:'session_end',at:session.last_activity_at,value:session.active_ms/1000});}
      // Closing a long-hidden tab is not an application open. Its unconfirmed
      // tail cannot create a session or inflate daily active/retention counts.
      if(input.action==='end'||input.action==='heartbeat'&&input.visible!==true){db.exec('COMMIT');return {sessionId:session?.id??null,newSession:false,duplicate:false,confirmedActiveMs:0};}
      session={id:randomUUID(),account_id:accountId,started_at:now,last_activity_at:now,active_ms:0,ended_at:null};
      db.prepare('INSERT INTO zhiyu_beta_sessions VALUES(?,?,?,?,?,NULL)').run(session.id,accountId,now,now,0);
      recordBetaEvent(db,{accountId,eventId:'session-open:'+session.id,type:'app_open',at:now});
    }
    const current=session!;
    if(input.action==='open')db.prepare(`INSERT INTO zhiyu_beta_app_opens VALUES(?,?,?,?) ON CONFLICT(account_id,day) DO UPDATE SET last_at=excluded.last_at`).run(accountId,beijingDate(now),now,now);
    // A new tab starts at zero; prior-tab cumulative counters never enter a new session.
    const sameTab=tab?.session_id===current.id;
    const delta=sameTab?input.totalActiveMs!==undefined?Math.max(0,input.totalActiveMs-tab!.last_total_ms):input.activeMs??0:0;
    const floor=sameTab?Math.max(tab!.last_at,current.started_at):now;
    const budget=Math.max(0,Math.min(delta,now-floor));
    let confirmed=0;
    if(input.segments?.length&&sameTab){
      let remaining=budget;
      for(const segment of input.segments){
        // The client may report exact visible segments, but may not backdate a session or count future time.
        const end=Math.min(now,segment.endAt),start=Math.max(floor,segment.startAt,end-remaining);
        if(end>start){confirmed+=addInterval(db,current.id,start,end);remaining-=end-start;}
        if(remaining<=0)break;
      }
    }else if(budget>0)confirmed=addInterval(db,current.id,now-budget,now);
    const active=!!input.visible||budget>0||input.action==='open';
    db.prepare('UPDATE zhiyu_beta_sessions SET active_ms=active_ms+?,last_activity_at=?,ended_at=NULL WHERE id=?').run(confirmed,active?now:current.last_activity_at,current.id);
    db.prepare(`INSERT INTO zhiyu_beta_activity_tabs VALUES(?,?,?,?,?,?) ON CONFLICT(account_id,tab_id) DO UPDATE SET session_id=excluded.session_id,last_at=excluded.last_at,last_seq=excluded.last_seq,last_total_ms=excluded.last_total_ms`)
      .run(accountId,input.tabId,current.id,now,input.seq,input.totalActiveMs??((sameTab?tab!.last_total_ms:0)+(input.activeMs??0)));
    db.exec('COMMIT');if(confirmed||input.action==='open')betaAnalyticsChanges.emit('change');return {sessionId:current.id,newSession:fresh,duplicate:false,confirmedActiveMs:confirmed};
  }catch(error){try{db.exec('ROLLBACK');}catch{/* Already rolled back. */}throw error;}
}
export function finalizeIdleBetaSessions(db:DatabaseSync,now=Date.now()) {
  const idle=db.prepare('SELECT * FROM zhiyu_beta_sessions WHERE ended_at IS NULL AND last_activity_at<=?').all(now-SESSION_GAP) as SessionRow[];
  for(const row of idle){db.prepare('UPDATE zhiyu_beta_sessions SET ended_at=last_activity_at WHERE id=? AND ended_at IS NULL').run(row.id);recordBetaEvent(db,{accountId:row.account_id,eventId:'session-end:'+row.id,type:'session_end',at:row.last_activity_at,value:row.active_ms/1000});}
}
function ratio(n:number,d:number){return d?Math.round(n/d*10000)/100:null;}
function dayStart(date:string){return Date.parse(date+'T00:00:00+08:00');}
export function buildBetaDashboard(db:DatabaseSync,role:BetaAdminRole,now=Date.now(),filter:{npcId?:string;ageGroup?:string}={}):BetaDashboard {
  finalizeIdleBetaSessions(db,now);
  const accounts=db.prepare(`SELECT a.id,a.display_number,a.created_at,a.is_internal${role==='founder'?',i.note':''} FROM zhiyu_accounts a LEFT JOIN zhiyu_beta_invites i ON i.account_id=a.id WHERE a.is_internal=0`).all() as AccountRow[];
  const ids=new Set(accounts.map(a=>a.id));
  const events=(db.prepare(`SELECT e.* FROM zhiyu_beta_events e JOIN zhiyu_accounts a ON a.id=e.account_id WHERE a.is_internal=0 AND e.at<=? ORDER BY e.at`).all(now) as EventRow[]).filter(e=>ids.has(e.account_id));
  const sessions=db.prepare('SELECT s.* FROM zhiyu_beta_sessions s JOIN zhiyu_accounts a ON a.id=s.account_id WHERE a.is_internal=0 AND s.started_at<=?').all(now) as SessionRow[];
  const today=beijingDate(now),todayAt=dayStart(today),yesterday=beijingDate(todayAt-1),days=Array.from({length:30},(_,i)=>beijingDate(todayAt-(29-i)*DAY));
  // Active and retained mean a real application open, never a message or a scheduled delivery.
  const activeByDay=new Map<string,Set<string>>();
  const addActive=(date:string,id:string)=>{if(!activeByDay.has(date))activeByDay.set(date,new Set());activeByDay.get(date)!.add(id);};
  for(const event of events)if(event.type==='app_open')addActive(beijingDate(event.at),event.account_id);
  for(const row of db.prepare(`SELECT o.account_id,o.day FROM zhiyu_beta_app_opens o JOIN zhiyu_accounts a ON a.id=o.account_id WHERE a.is_internal=0 AND o.first_at<=?`).all(now) as {account_id:string;day:string}[])addActive(row.day,row.account_id);
  const messages=events.filter(e=>e.type==='message_sent');
  const recipients=new Map(messages.map(event=>{let group:string[]=[];try{group=JSON.parse(event.meta_json).recipientIds||[];}catch{/* Historical events without metadata remain direct-only. */}return [event,new Set([...(event.npc_id?[event.npc_id]:[]),...group])];}));
  const receivedBy=(event:EventRow,npcId:string)=>recipients.get(event)?.has(npcId)===true;
  const retained=(pool:AccountRow[],n:number):BetaRetention=>{
    // An incomplete target day cannot be called a failed retention day.
    const eligible=pool.filter(a=>dayStart(beijingDate(a.created_at))+n*DAY<todayAt);
    const count=eligible.filter(a=>activeByDay.get(beijingDate(dayStart(beijingDate(a.created_at))+n*DAY))?.has(a.id)).length;
    return {day:n,eligible:eligible.length,retained:count,rate:ratio(count,eligible.length)};
  };
  const retention=[1,3,7,14,30].map(n=>retained(accounts,n));
  const cohortDates=[...new Set(accounts.map(a=>beijingDate(a.created_at)))].sort().reverse();
  const cohorts=cohortDates.map(date=>{const pool=accounts.filter(a=>beijingDate(a.created_at)===date);return {date,users:pool.length,retention:[1,3,7,14,30].map(n=>retained(pool,n))};});
  const series=days.map(date=>({date,activeUsers:activeByDay.get(date)?.size??0,messages:messages.filter(e=>beijingDate(e.at)===date).length}));
  const npcs=Object.keys(BETA_NPC_NAMES).map(npcId=>({npcId,messages:messages.filter(e=>receivedBy(e,npcId)).length,callMinutes:Math.round(events.filter(e=>e.npc_id===npcId&&(e.type==='voice_call'||e.type==='video_call')).reduce((sum,e)=>sum+(e.value??0),0)/60*100)/100})).sort((a,b)=>b.messages-a.messages||b.callMinutes-a.callMinutes);
  const users:BetaUserRow[]=accounts.map(account=>{
    const own=events.filter(e=>e.account_id===account.id),ownMessages=own.filter(e=>e.type==='message_sent');
    const favorite=[...npcIds].map(id=>({id,n:ownMessages.filter(e=>receivedBy(e,id)).length})).sort((a,b)=>b.n-a.n)[0];
    const last=own.filter(e=>e.type!=='session_end').at(-1)?.at??null;
    const lastSession=sessions.filter(s=>s.account_id===account.id).reduce((v,s)=>Math.max(v,s.last_activity_at),0);
    return {id:role==='founder'?account.id:String(account.display_number),userNumber:String(account.display_number),...(role==='founder'?{note:account.note??'',internal:false}:{}),joinedAt:account.created_at,lastActiveAt:Math.max(last??0,lastSession)||null,messageCount:ownMessages.length,activeSeconds:sessions.filter(s=>s.account_id===account.id).reduce((n,s)=>n+s.active_ms,0)/1000,favoriteNpc:favorite?.n?favorite.id:null};
  }).sort((a,b)=>b.joinedAt-a.joinedAt);
  const activeSeven=new Set<string>();for(let i=0;i<7;i++)for(const id of activeByDay.get(beijingDate(todayAt-i*DAY))??[])activeSeven.add(id);
  const completedDays=Array.from({length:30},(_,i)=>beijingDate(todayAt-(30-i)*DAY)),activeUserDays=completedDays.reduce((sum,d)=>sum+(activeByDay.get(d)?.size??0),0);
  const monthMessages=messages.filter(e=>beijingDate(e.at)<today&&beijingDate(e.at)>=completedDays[0]).length;
  const intervalRows=db.prepare(`SELECT s.account_id,i.start_at,i.end_at FROM zhiyu_beta_active_intervals i JOIN zhiyu_beta_sessions s ON s.id=i.session_id JOIN zhiyu_accounts a ON a.id=s.account_id WHERE a.is_internal=0`).all() as {account_id:string;start_at:number;end_at:number}[];
  const completedActiveMs=intervalRows.reduce((n,i)=>n+Math.max(0,Math.min(todayAt,i.end_at)-Math.max(dayStart(completedDays[0]),i.start_at)),0);
  const surveys=buildSurveyAnalytics(db,{role,...filter}) as BetaDashboard['surveys'];
  const count=(types:BetaEventType[])=>events.filter(e=>types.includes(e.type)).length;
  return {updatedAt:now,role,metrics:{totalUsers:{value:accounts.length},yesterdayActive:{value:activeByDay.get(yesterday)?.size??0},sevenDayActive:{value:activeSeven.size},messagesPerDay:{value:activeUserDays?Math.round(monthMessages/activeUserDays*100)/100:null,detail:'近30个已结束自然日，每个活跃用户日'},minutesPerDay:{value:activeUserDays?Math.round(completedActiveMs/60000/activeUserDays*100)/100:null,detail:'近30个已结束自然日，仅已确认的前台使用时长'},retention1:{value:retention.find(r=>r.day===1)!.rate,unit:'%'},retention7:{value:retention.find(r=>r.day===7)!.rate,unit:'%'},retention30:{value:retention.find(r=>r.day===30)!.rate,unit:'%'},npsA:{value:surveys.versions.A.nps?.score??null},npsB:{value:surveys.versions.B.nps?.score??null},surveyCompletion:{value:surveys.completion.rate,unit:'%'},veryDisappointed:{value:surveys.veryDisappointed.rate,unit:'%'}},series,cohorts,retention,npcs,features:[{id:'brief',label:'今日简报',count:count(['brief_viewed'])},{id:'weekly',label:'周报',count:count(['weekly_viewed'])},{id:'plan',label:'新建计划',count:count(['plan_created'])},{id:'task',label:'新建 / 完成任务',count:count(['task_created','task_completed'])},{id:'call',label:'语音 / 视频通话',count:count(['voice_call','video_call'])},{id:'platform',label:'外卖 / 买菜跳转',count:count(['platform_opened'])},{id:'share',label:'分享卡片',count:count(['card_shared'])}],users,surveys,definition:'北京时间自然日；内部账号不计入任何统计。群消息总数只计一条，发送时每位真实群成员各计收到一条；已确认的群饮食计划计为新建计划。留存只计算目标日已完整结束的用户，未满足条件显示数据不足；使用时长仅累计已上报确认的前台区间，不补数、不推算离开后的时间。'};
}
