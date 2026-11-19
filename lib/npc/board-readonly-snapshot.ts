export type ReadonlyBoardTask={id:string;title:string;date:string;status:'todo'|'in_progress'|'paused'|'done'|'ended'|'missed';npcId:string;steps?:Array<{id:string;done:boolean;skipped?:boolean}>;count?:{current:number;target:number};source?:{kind:'professional'|'group';id:string;key?:string;revision?:number;originalDate?:string}};
export type ReadonlyBoardSnapshotPayload={action:'board-snapshot';accountId:string;epoch:string;sequence:number;capturedAt:number;tasks:ReadonlyBoardTask[]};
export const readonlyBoardSnapshotMaxBytes=8*1024*1024;
export const readonlyBoardTaskLimit=10000; // Existing board model uses length <10000.
/** Only minimal board facts cross this bridge. It cannot carry task mutations,
 * execution receipts, messages, health details, images, credentials or prompts. */
export function createReadonlyBoardSnapshot(accountId:string,tasks:ReadonlyBoardTask[],epoch:string,sequence:number,capturedAt=Date.now()):ReadonlyBoardSnapshotPayload{
 return {action:'board-snapshot',accountId,epoch,sequence,capturedAt,tasks:tasks.map(task=>({id:task.id,title:task.title,date:task.date,status:task.status,npcId:task.npcId,
  ...(task.steps?{steps:task.steps.map(step=>({id:step.id,done:step.done,...(step.skipped?{skipped:true}:{})}))}:{}),
  ...(task.count?{count:{current:task.count.current,target:task.count.target}}:{}),
  ...(task.source?{source:{kind:task.source.kind,id:task.source.id,...(task.source.key?{key:task.source.key}:{}),...(task.source.revision!==undefined?{revision:task.source.revision}:{}),...(task.source.originalDate?{originalDate:task.source.originalDate}:{})}}:{})}))};
}
