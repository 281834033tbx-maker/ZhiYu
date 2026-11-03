export type ReplyRetryState=Readonly<{attempted:boolean;pending:boolean}>;
export const idleReplyRetry:ReplyRetryState=Object.freeze({attempted:false,pending:false});

/** View remounts must not silently restart a failed turn's automatic retry. */
export class ReplyRetryLedger {
  private entries=new Map<string,ReplyRetryState>();
  private listeners=new Set<()=>void>();
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  snapshot=(key:string):ReplyRetryState=>this.entries.get(key)||idleReplyRetry;
  private publish(key:string,pending:boolean) {
    this.entries.set(key,Object.freeze({attempted:true,pending}));
    if(this.entries.size>1000)for(const [oldKey,state] of this.entries){if(oldKey!==key&&!state.pending){this.entries.delete(oldKey);break;}}
    for(const listener of this.listeners)listener();
  }
  claimAutomatic=(key:string)=>{if(this.snapshot(key).attempted)return false;this.publish(key,true);return true;};
  claimManual=(key:string)=>{if(this.snapshot(key).pending)return false;this.publish(key,true);return true;};
  settle=(key:string)=>{if(this.snapshot(key).attempted)this.publish(key,false);};
}
