import {useCallback,useSyncExternalStore} from 'react';
import {idleReplyRetry,ReplyRetryLedger} from '../../lib/npc/reply-retry';
const ledger=new ReplyRetryLedger();
export function useReplyRetry(key:string) {
  const snapshot=useSyncExternalStore(ledger.subscribe,()=>ledger.snapshot(key),()=>idleReplyRetry);
  const claimAutomatic=useCallback(()=>ledger.claimAutomatic(key),[key]);
  const claimManual=useCallback(()=>ledger.claimManual(key),[key]);
  const settle=useCallback(()=>ledger.settle(key),[key]);
  return {...snapshot,claimAutomatic,claimManual,settle};
}
