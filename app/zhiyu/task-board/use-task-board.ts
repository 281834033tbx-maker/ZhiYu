'use client';
import {useCallback,useEffect,useLayoutEffect,useMemo,useReducer,useRef,useState} from 'react';
import {createEmptyTaskBoard,taskBoardReducer} from './reducer';
import {mockTaskBoardSource,taskBoardFallback,taskBoardStorageKey,type TaskBoardDataSource} from './data-source';
import type {TaskBoardAction} from './types';
import {applyManualTaskRecord,parseManualTaskRecord} from './manual-task-record';
import {getActiveAccountStorageIdentity} from '../account-storage';

const CLOUD_MERGE_CONFLICT='安排已在其他设备更新，本次后续操作尚未保存。请刷新页面载入云端版本，再重新执行这些操作。';
type CloudGate={epoch:number;needsHydrate:boolean;blocked:boolean};

export function useTaskBoard(accountId:string,source:TaskBoardDataSource=mockTaskBoardSource) {
  const [model,dispatchModel]=useReducer(taskBoardReducer,undefined,()=>source===mockTaskBoardSource?taskBoardFallback(accountId):createEmptyTaskBoard());
  const [loadedAccount,setLoadedAccount]=useState('');
  const [loadedSource,setLoadedSource]=useState<TaskBoardDataSource|null>(null);
  const [loadedScope,setLoadedScope]=useState<object|null>(null);
  const currentScope=useMemo(()=>({accountId,source}),[accountId,source]);
  const [now,setNow]=useState(()=>Date.now());
  const [storageError,setStorageError]=useState('');
  const [recordSaving,setRecordSaving]=useState(false);
  const [actionSaving,setActionSaving]=useState(false);
  const modelRef=useRef(model);
  const accountRef=useRef(accountId);
  const sourceRef=useRef(source);
  const loadedRef=useRef('');
  const loadedSourceRef=useRef<TaskBoardDataSource|null>(null);
  const scopeRef=useRef<object|null>(null);
  const saveQueue=useRef<Promise<void>>(Promise.resolve());
  const cloudGates=useRef(new Map<string,CloudGate>());
  const cloudGate=useCallback((owner:string)=>{
    if(source!==mockTaskBoardSource)return undefined;
    const active=getActiveAccountStorageIdentity();if(active?.id!==owner||active.storageMode!=='server')return undefined;
    let gate=cloudGates.current.get(owner);if(!gate){gate={epoch:0,needsHydrate:false,blocked:false};cloudGates.current.set(owner,gate);}return gate;
  },[source]);
  const importing=useRef<{owner:string;source:TaskBoardDataSource;actions:TaskBoardAction[];finished:Promise<void>}|null>(null);
  useLayoutEffect(()=>{accountRef.current=accountId;sourceRef.current=source;scopeRef.current=currentScope;},[accountId,source,currentScope]);
  const save=useCallback((owner:string,value:typeof model)=>{
    const gate=cloudGate(owner),epoch=gate?.epoch,needsHydrate=gate?.needsHydrate;
    const pending=saveQueue.current.catch(()=>{}).then(()=>{
      // A complete snapshot queued before an external merge cannot be replayed
      // as a new authoritative value: even toggle→undo may equal the old base.
      if(gate&&(gate.blocked||needsHydrate||gate.epoch!==epoch)){gate.blocked=true;throw Error(CLOUD_MERGE_CONFLICT);}
      return source.save(owner,value);
    });
    saveQueue.current=pending;
    return pending;
  },[source,cloudGate]);
  const dispatch=useCallback((action:TaskBoardAction)=>{
    if('now' in action&&typeof action.now==='number')setNow(action.now);
    if(accountRef.current!==accountId||loadedRef.current!==accountId||sourceRef.current!==source||loadedSourceRef.current!==source)return;
    if(importing.current?.owner===accountId&&importing.current.source===source){importing.current.actions.push(action);return;}
    const next=taskBoardReducer(modelRef.current,action);
    modelRef.current=next;
    dispatchModel({type:'hydrate',model:next});
  },[accountId,source]);
  const ready=loadedAccount===accountId&&loadedSource===source&&loadedScope===currentScope&&!!accountId;
  useEffect(()=>{
    let alive=true;
    const scope=scopeRef.current;
    loadedRef.current='';loadedSourceRef.current=null;
    const current=()=>alive&&scopeRef.current===scope&&accountRef.current===accountId&&sourceRef.current===source;
    const hydrate=(value:typeof model)=>{const gate=cloudGate(accountId);if(gate){gate.blocked=false;gate.needsHydrate=false;}modelRef.current=value;loadedRef.current=accountId;loadedSourceRef.current=source;dispatchModel({type:'hydrate',model:value});setLoadedAccount(accountId);setLoadedSource(source);setLoadedScope(scope);setNow(Date.now());};
    void (async()=>{
      // A transaction includes replayed clicks and their final save, not just
      // its initial imported snapshot. A returning account reads after both.
      while(importing.current)await importing.current.finished;
      await saveQueue.current.catch(()=>{});
      if(!current())return;
      try {const value=await source.load(accountId);if(current()){hydrate(value);setStorageError('');}}
      catch {if(current()){hydrate(source===mockTaskBoardSource?taskBoardFallback(accountId):createEmptyTaskBoard());setStorageError('安排记录暂时无法读取。');}}
    })();
    return()=>{alive=false;};
  },[accountId,source,cloudGate]);
  useEffect(()=>{
    const gate=cloudGate(accountId);if(!gate)return;
    let alive=true,working=false,pending=false;
    const scope=scopeRef.current;
    const current=()=>alive&&scopeRef.current===scope&&accountRef.current===accountId&&sourceRef.current===source;
    const reconcile=async()=>{
      if(working)return;working=true;
      try{while(pending&&current()){
        pending=false;
        while(importing.current)await importing.current.finished;
        const queued=saveQueue.current;await queued.catch(()=>{});
        if(!current())return;
        if(queued!==saveQueue.current||importing.current){pending=true;continue;}
        if(gate.blocked){setStorageError(CLOUD_MERGE_CONFLICT);return;}
        const before=modelRef.current;
        try{const value=await source.load(accountId);
          if(!current())return;
          if(queued!==saveQueue.current||before!==modelRef.current||importing.current){pending=true;continue;}
          gate.needsHydrate=false;modelRef.current=value;dispatchModel({type:'hydrate',model:value});setStorageError('');
        }catch{if(current())setStorageError('合并后的安排记录暂时无法读取，请重新加载安排页。');}
      }}finally{working=false;}
    };
    const onStorage=(event:StorageEvent)=>{
      if(event.key!==taskBoardStorageKey(accountId)||!current())return;
      gate.epoch++;gate.needsHydrate=true;pending=true;void reconcile();
    };
    window.addEventListener('storage',onStorage);
    return()=>{alive=false;window.removeEventListener('storage',onStorage);};
  },[accountId,source,cloudGate]);
  useEffect(()=>{
    if(!ready||loadedSourceRef.current!==source||model!==modelRef.current||importing.current?.owner===accountId&&importing.current.source===source)return;
    let alive=true;
    void save(accountId,model).then(()=>{if(alive)setStorageError('');}).catch(error=>{if(alive)setStorageError(error instanceof Error&&error.message===CLOUD_MERGE_CONFLICT?CLOUD_MERGE_CONFLICT:'安排记录未保存，当前页面仍可继续使用。');});
    return()=>{alive=false;};
  },[accountId,model,ready,save,source]);
  const commitRecord=useCallback(async(payload:unknown)=>{
    if(!accountId||accountRef.current!==accountId||loadedRef.current!==accountId||sourceRef.current!==source||loadedSourceRef.current!==source)throw Error('安排记录尚未载入，请稍后再试。');
    if(importing.current)throw Error('上一份安排记录正在保存，请稍后再试。');
    const record=parseManualTaskRecord(payload);
    const base=modelRef.current,next=applyManualTaskRecord(base,record),scope=scopeRef.current;
    let finishTransaction:()=>void=()=>{};
    const finished=new Promise<void>(resolve=>{finishTransaction=resolve;});
    const transaction={owner:accountId,source,actions:[] as TaskBoardAction[],finished};
    importing.current=transaction;setRecordSaving(true);
    const current=()=>scopeRef.current===scope&&accountRef.current===accountId&&loadedRef.current===accountId&&sourceRef.current===source&&loadedSourceRef.current===source;
    let settled=base,consumed=0,imported=false,initialFailed=false,initialError:unknown;
    try {
      // Only report success after the account-scoped source accepted the record.
      try {await save(accountId,next);settled=next;imported=true;}
      catch(error){initialFailed=true;initialError=error;}
      // Clicks remain owned by the original account even after navigation.
      // New clicks arriving during a delayed replay save are drained as well.
      while(consumed<transaction.actions.length){
        const through=transaction.actions.length;
        settled=transaction.actions.slice(consumed,through).reduce(taskBoardReducer,settled);consumed=through;
        await save(accountId,settled);
      }
      if(initialFailed)throw initialError;
      if(!current())throw Error('账号或数据源已切换；记录和期间操作已保存到原位置，请返回后查看。');
      modelRef.current=settled;dispatchModel({type:'hydrate',model:settled});setNow(Date.now());setStorageError('');
      return {taskCount:record.tasks.length,planCount:record.plans.length};
    } catch(error) {
      // If storage failed, retain every queued operation in the visible owner
      // snapshot. Never reduce this queue over another account's modelRef.
      settled=transaction.actions.slice(consumed).reduce(taskBoardReducer,settled);
      if(current()){
        modelRef.current=settled;dispatchModel({type:'hydrate',model:settled});
        setStorageError(error instanceof Error&&error.message===CLOUD_MERGE_CONFLICT?CLOUD_MERGE_CONFLICT:imported?'记录已导入，但期间操作未全部保存，请检查后重试。':'安排记录未导入，请检查保存状态后重试。');
      }
      throw error;
    } finally {
      if(importing.current===transaction)importing.current=null;
      finishTransaction();
      setRecordSaving(false);
    }
  },[accountId,save,source]);
  /** Explicit phone submission. The ordinary dispatch/effect and record-import
   * paths remain intact; success means this owner's source accepted the action. */
  const commitAction=useCallback(async(action:{type:'finish'|'complete-count'|'toggle-status';taskId:string;now:number})=>{
    if(!accountId||accountRef.current!==accountId||loadedRef.current!==accountId||sourceRef.current!==source||loadedSourceRef.current!==source)throw Error('安排记录尚未载入，请稍后再试。');
    if(importing.current)throw Error('安排记录正在保存，请稍后再试。');
    const base=modelRef.current,next=taskBoardReducer(base,action),scope=scopeRef.current;
    let finishTransaction:()=>void=()=>{};
    const finished=new Promise<void>(resolve=>{finishTransaction=resolve;});
    const transaction={owner:accountId,source,actions:[] as TaskBoardAction[],finished};
    importing.current=transaction;setActionSaving(true);
    const current=()=>scopeRef.current===scope&&accountRef.current===accountId&&loadedRef.current===accountId&&sourceRef.current===source&&loadedSourceRef.current===source;
    let settled=base,consumed=0,saved=false,initialFailed=false,initialError:unknown;
    try {
      try{await save(accountId,next);settled=next;saved=true;}
      catch(error){initialFailed=true;initialError=error;}
      while(consumed<transaction.actions.length){
        const through=transaction.actions.length;
        settled=transaction.actions.slice(consumed,through).reduce(taskBoardReducer,settled);consumed=through;
        await save(accountId,settled);
      }
      if(initialFailed)throw initialError;
      if(!current())throw Error('账号或数据源已切换；操作已保存到原位置，请返回后查看。');
      modelRef.current=settled;dispatchModel({type:'hydrate',model:settled});setNow(Date.now());setStorageError('');
    } catch(error) {
      settled=transaction.actions.slice(consumed).reduce(taskBoardReducer,settled);
      if(current()){
        modelRef.current=settled;dispatchModel({type:'hydrate',model:settled});
        setStorageError(error instanceof Error&&error.message===CLOUD_MERGE_CONFLICT?CLOUD_MERGE_CONFLICT:saved?'操作已保存，但期间修改未全部保存，请检查后重试。':'安排状态未保存，请稍后重试。');
      }
      throw error;
    } finally {
      if(importing.current===transaction)importing.current=null;
      finishTransaction();setActionSaving(false);
    }
  },[accountId,save,source]);
  const hasRunningTimer=!!model.rest&&model.rest.pausedRemainingMs===undefined&&model.rest.endsAt>now||Object.values(model.timers).some(timer=>timer.pausedRemainingMs===undefined&&timer.endsAt>now);
  useEffect(()=>{
    if(!ready||!hasRunningTimer)return;
    const frame=requestAnimationFrame(()=>setNow(Date.now()));
    const timer=setInterval(()=>setNow(Date.now()),1000);
    return()=>{cancelAnimationFrame(frame);clearInterval(timer);};
  },[ready,hasRunningTimer]);
  return {model,dispatch,now,ready,storageError,commitRecord,recordSaving,commitAction,actionSaving};
}
export default useTaskBoard;
