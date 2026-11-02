'use client';
import {useCallback,useEffect,useReducer,useState} from 'react';
import {createEmptyTaskBoard,createInitialTaskBoard,taskBoardReducer} from './reducer';
import {mockTaskBoardSource,type TaskBoardDataSource} from './data-source';
import type {TaskBoardAction} from './types';

export function useTaskBoard(accountId:string,source:TaskBoardDataSource=mockTaskBoardSource) {
  const [model,dispatchModel]=useReducer(taskBoardReducer,undefined,()=>source===mockTaskBoardSource?createInitialTaskBoard():createEmptyTaskBoard());
  const [loadedAccount,setLoadedAccount]=useState('');
  const [now,setNow]=useState(()=>Date.now());
  const [storageError,setStorageError]=useState('');
  const dispatch=useCallback((action:TaskBoardAction)=>{
    if('now' in action&&typeof action.now==='number')setNow(action.now);
    dispatchModel(action);
  },[]);
  const ready=loadedAccount===accountId&&!!accountId;
  useEffect(()=>{
    let alive=true;
    void source.load(accountId).then(value=>{if(alive){dispatch({type:'hydrate',model:value});setLoadedAccount(accountId);setNow(Date.now());setStorageError('');}}).catch(()=>{if(alive){dispatch({type:'hydrate',model:source===mockTaskBoardSource?createInitialTaskBoard():createEmptyTaskBoard()});setLoadedAccount(accountId);setStorageError('任务记录暂时无法读取。');}});
    return()=>{alive=false;};
  },[accountId,source,dispatch]);
  useEffect(()=>{
    if(!ready)return;
    let alive=true;
    void source.save(accountId,model).then(()=>{if(alive)setStorageError('');}).catch(()=>{if(alive)setStorageError('任务记录未保存，当前页面仍可继续使用。');});
    return()=>{alive=false;};
  },[accountId,model,ready,source]);
  const hasRunningTimer=!!model.rest&&model.rest.endsAt>now||Object.values(model.timers).some(timer=>timer.endsAt>now);
  useEffect(()=>{
    if(!ready||!hasRunningTimer)return;
    const frame=requestAnimationFrame(()=>setNow(Date.now()));
    const timer=setInterval(()=>setNow(Date.now()),1000);
    return()=>{cancelAnimationFrame(frame);clearInterval(timer);};
  },[ready,hasRunningTimer]);
  return {model,dispatch,now,ready,storageError};
}
export default useTaskBoard;
