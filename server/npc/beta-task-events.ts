import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {ProfessionalTask} from '../../lib/npc/professional-task';
import {BETA_NPC_NAMES} from '../../lib/npc/beta-analytics';
import type {AccountStateSaveHook} from './account-state';
import {recordBetaEvent} from './beta-analytics-store';

const key=(value:string)=>createHash('sha256').update(value).digest('hex');
const domains:Record<string,string>={'chen-nian':'fitness',liu:'nutrition','zhou-chef':'cooking'};
const categories=new Set(['fitness','recovery','nutrition','cooking','shopping','sleep','skin','chores','bills','family']);
function accountForOwner(db:DatabaseSync,owner:string){
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='zhiyu_beta_events'").get())return undefined;
  return db.prepare('SELECT id FROM zhiyu_accounts WHERE owner_id=?').get(owner) as {id:string}|undefined;
}
let sequence=0;
function atomic<T>(db:DatabaseSync,save:()=>T,record:()=>void):T{
  const name='beta_task_'+(++sequence);db.exec('SAVEPOINT '+name);
  try{const result=save();record();db.exec('RELEASE SAVEPOINT '+name);return result;}
  catch(error){db.exec('ROLLBACK TO SAVEPOINT '+name);db.exec('RELEASE SAVEPOINT '+name);throw error;}
}
type ProfessionalState={professionalTasks?:ProfessionalTask[];messages?:{id:string;role:string}[]};
/** The canonical account store and its usage event commit together. Existing
 * snapshots, debug branches, initial seeds and imported history are not new work. */
export function persistBetaProfessionalState<T>(db:DatabaseSync,input:{sessionId:string;npcId:ProfessionalTask['characterId'];table:'chen_sessions'|'liu_sessions'|'zhou_chef_sessions';after:ProfessionalState;at:number},save:()=>T):T{
  const suffix=':'+input.npcId;
  if(!input.sessionId.endsWith(suffix))return save();
  const owner=input.sessionId.slice(0,-suffix.length);
  const account=accountForOwner(db,owner);
  if(!account)return save();
  // Table is a closed literal union controlled by the server, never request data.
  const row=db.prepare('SELECT data FROM '+input.table+' WHERE id=?').get(input.sessionId) as {data:string}|undefined;
  if(!row)return save();
  let before:ProfessionalState;try{before=JSON.parse(row.data);}catch{return save();}
  const previous=new Map((before.professionalTasks||[]).map(task=>[task.id,task]));
  return atomic(db,save,()=>{
    for(const task of input.after.professionalTasks||[]){
      const prior=previous.get(task.id),prefix=input.npcId+':'+key(task.id),meta={domain:domains[input.npcId]};
      if(!prior){
        const created=Date.parse(task.createdAt),source=input.after.messages?.find(m=>m.id===task.sourceMessageId&&m.role==='user');
        if(!source||!Number.isFinite(created)||created>input.at||created<input.at-5*60000)continue;
        recordBetaEvent(db,{accountId:account.id,eventId:'task-created:'+prefix,type:'task_created',npcId:input.npcId,at:input.at,meta});
      }else{
        const priorSessions=new Map((prior.executionSessions||[]).map(s=>[s.id,s]));
        const completedSessions=(task.executionSessions||[]).filter(s=>s.status==='completed'&&priorSessions.get(s.id)?.status!=='completed');
        for(const session of completedSessions)recordBetaEvent(db,{accountId:account.id,eventId:'task-completed:'+prefix+':'+key(session.id).slice(0,16),type:'task_completed',npcId:input.npcId,at:input.at,meta});
        if(!task.executionSessions?.length&&task.status==='completed'&&prior.status!=='completed')recordBetaEvent(db,{accountId:account.id,eventId:'task-completed:'+prefix,type:'task_completed',npcId:input.npcId,at:input.at,meta});
      }
    }
  });
}
export function persistBetaGroupPlanConfirmation<T>(db:DatabaseSync,input:{owner:string;groupId:string;planId:string;at:number},save:()=>T):T{
  const account=accountForOwner(db,input.owner);
  if(!account)return save();
  return atomic(db,save,()=>{recordBetaEvent(db,{accountId:account.id,eventId:'plan-created:group:'+key(input.groupId+':'+input.planId),type:'plan_created',npcId:'liu',at:input.at,meta:{domain:'nutrition',context:'group',groupId:input.groupId}});});
}
type BoardTask={id:string;status:string;source?:{kind?:string};manualRecord?:{name?:string;importedAt?:string};categoryId?:string;npcId?:string;completedAt?:string};
type Board={version?:number;tasks?:BoardTask[];plans?:{id:string}[];demoOverview?:unknown};
function board(value:string|null):Board|null {try{const data=value?JSON.parse(value):null;return data?.version===1&&Array.isArray(data.tasks)&&(!data.plans||Array.isArray(data.plans))?data:null;}catch{return null;}}
/** Hook runs inside the account-state optimistic write transaction. Reads only
 * task identity/status; titles, notes, messages and other account state stay out. */
export const recordBetaBoardState:AccountStateSaveHook=(db,change)=>{
  if(change.key!=='zhiyu-task-board-demo-v1:'+change.account.id)return;
  const after=board(change.after),before=board(change.before);
  // The initial hydration/import is a baseline, never a batch of new activity.
  if(!after||!before||after.demoOverview)return;
  const previous=new Map((before.tasks||[]).map(task=>[task.id,task]));
  for(const task of after.tasks||[]){
    if(!task||typeof task.id!=='string')continue;
    const prior=previous.get(task.id),npcId=task.npcId&&BETA_NPC_NAMES[task.npcId]?task.npcId:undefined;
    const meta={domain:categories.has(task.categoryId||'')?task.categoryId:'life'};
    // Professional/group projections were counted at their authoritative source.
    if(!prior&&!task.source&&/^manual-task-[a-f0-9-]{36}$/i.test(task.id)&&task.manualRecord?.name==='手工任务'&&task.status!=='done')recordBetaEvent(db,{accountId:change.account.id,eventId:'task-created:board:'+key(task.id),type:'task_created',npcId,at:change.at,meta});
    // Group-plan task execution is owned by this board. Professional tasks
    // also persist in their specialist store and must not be counted twice.
    if(prior&&(!task.source||task.source.kind==='group')&&task.status==='done'&&prior.status!=='done'&&typeof task.completedAt==='string'&&Math.abs(Date.parse(task.completedAt)-change.at)<5*60000)recordBetaEvent(db,{accountId:change.account.id,eventId:'task-completed:board:'+key(task.id),type:'task_completed',npcId,at:change.at,meta});
  }
  const plans=new Set((before.plans||[]).map(plan=>plan.id));
  for(const plan of after.plans||[])if(typeof plan?.id==='string'&&!plans.has(plan.id)&&/^manual-plan-[a-f0-9-]{36}$/i.test(plan.id))recordBetaEvent(db,{accountId:change.account.id,eventId:'plan-created:board:'+key(plan.id),type:'plan_created',at:change.at,meta:{domain:'life'}});
};
