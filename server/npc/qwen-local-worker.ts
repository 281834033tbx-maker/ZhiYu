import {spawn,type ChildProcess} from 'node:child_process';
import {openSync,existsSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import type {Plugin} from 'vite';
import {qwenLocalModel,qwenLocalPython,qwenLocalUrl} from './qwen-audio';

export function npcQwenLocalWorker():Plugin{
 return {name:'zhiyu-qwen-local-worker',apply:'serve',configureServer(server){
  if(process.env.NPC_AUDIO_PROVIDER!=='qwen-local')return;
  const root=server.config.root;
  const python=qwenLocalPython(),model=qwenLocalModel(),script=resolve(root,'scripts/qwen3-tts-server.py');
  if(!existsSync(python)||!existsSync(join(model,'model.safetensors'))||!existsSync(script))return;
  let child:ChildProcess|undefined,closing=false;
  const start=async()=>{
   try{const ready=await fetch(qwenLocalUrl()+'/health',{signal:AbortSignal.timeout(800)});if(ready.ok)return;}catch{}
   if(closing)return;
   const logDir=join(root,'.npc-runtime');mkdirSync(logDir,{recursive:true});
   const log=openSync(join(logDir,'qwen3-tts.log'),'a');
   const endpoint=new URL(qwenLocalUrl());
   child=spawn(python,[script,'--model',model,'--host',endpoint.hostname,'--port',endpoint.port||'9873'],{
    cwd:root,env:{...process.env,HF_HOME:join(root,'.npc-runtime/hf-cache'),HF_HUB_OFFLINE:'1',PYTORCH_ENABLE_MPS_FALLBACK:'1'},
    stdio:['ignore',log,log],
   });
  };
  void start();
  server.httpServer?.once('close',()=>{closing=true;if(child&&!child.killed)child.kill('SIGTERM');});
 }};
}
