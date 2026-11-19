import {readFileSync,realpathSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {imageExtension} from './media';
import {audioExtension} from './audio';

/** Comments only reference a real, bounded upload belonging to this owner.
 * MIME comes from stored file bytes, never a client URL or MIME assertion. */
export function validMomentCommentUpload(root:string,owner:string,kind:'image'|'audio',id:unknown) {
  if(!/^[a-f0-9-]{36}$/.test(owner)||typeof id!=='string'||!(kind==='image'
    ?/^[a-f0-9-]{36}\.(png|jpg|webp|gif)$/
    :/^[a-f0-9-]{36}\.(webm|mp4|ogg|wav|mp3)$/).test(id))return false;
  try{
    const directory=resolve(realpathSync(root),'.npc-runtime',kind==='image'?'uploads':'audio',owner);
    if(realpathSync(directory)!==directory)return false;
    const path=join(directory,id),stat=statSync(path);
    if(realpathSync(path)!==path||!stat.isFile()||stat.size<=0||stat.size>12*1024*1024)return false;
    const bytes=readFileSync(path),extension=kind==='image'?imageExtension(bytes):audioExtension(bytes);
    if(!extension||!id.endsWith('.'+extension))return false;
    if(kind==='audio'){
      const meta=path+'.json',metaStat=statSync(meta);
      if(realpathSync(meta)!==meta||!metaStat.isFile()||metaStat.size<=0||metaStat.size>64*1024)return false;
    }
    return true;
  }catch{return false;}
}
