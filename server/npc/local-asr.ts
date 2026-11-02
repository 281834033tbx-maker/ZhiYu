import {execFile} from 'node:child_process';
import {existsSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';

const run=promisify(execFile);
export const localAsrPython=()=>resolve(process.env.NPC_LOCAL_ASR_PYTHON||'.npc-runtime/asr-venv/bin/python');
export const localAsrModel=()=>resolve(process.env.NPC_LOCAL_ASR_MODEL||'.npc-runtime/models/faster-whisper-base');
export function localAsrReady(){
 return existsSync(localAsrPython())&&existsSync(join(localAsrModel(),'model.bin'));
}

export async function transcribeLocal(bytes:Buffer,ext:string){
 if(!localAsrReady())throw Error('本地语音识别模型尚未安装');
 const dir=mkdtempSync(join(tmpdir(),'zhiyu-asr-'));
 try{
  const audio=join(dir,'recording.'+ext);
  writeFileSync(audio,bytes,{mode:0o600});
  const {stdout}=await run(localAsrPython(),[resolve('server/npc/local-asr.py'),localAsrModel(),audio],{
   timeout:120000,maxBuffer:16384,env:{...process.env,HF_HUB_OFFLINE:'1'},
  });
  const result=JSON.parse(stdout) as {text?:unknown};
  if(typeof result.text!=='string'||!result.text.trim()||result.text.length>4000)throw Error('没有识别到有效语音，请重新录制');
  return result.text.trim();
 }catch(e){
  if(e instanceof Error&&e.message.startsWith('没有识别到'))throw e;
  throw Error('本地语音识别运行失败，请检查模型和 Python 环境');
 }finally{rmSync(dir,{recursive:true,force:true});}
}
