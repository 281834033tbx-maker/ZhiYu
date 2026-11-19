import {ensureNpcIdentity} from './npc-fetch';

export type NpcUploadProgress={loaded:number;total:number|null;phase:'preparing'|'uploading'|'processing'};
type UploadOptions={headers?:HeadersInit;signal?:AbortSignal;onProgress?:(progress:NpcUploadProgress)=>void};
const aborted=(signal?:AbortSignal)=>signal?.reason||new DOMException('Upload aborted','AbortError');

/** Same-origin authenticated upload; percentages cover transfer bytes, never server processing. */
export async function npcUpload(url:'/api/npc/media'|'/api/npc/audio/upload',body:Blob,{headers,signal,onProgress}:UploadOptions={}) {
  if(url!=='/api/npc/media'&&url!=='/api/npc/audio/upload')throw new Error('不支持的上传地址');
  if(signal?.aborted)throw aborted(signal);
  onProgress?.({loaded:0,total:null,phase:'preparing'});
  // Share npcFetch's single bootstrap. Cancelling one upload must not abort it
  // while another ordinary NPC request is waiting for its HttpOnly identity.
  await ensureNpcIdentity();
  if(signal?.aborted)throw aborted(signal);
  return new Promise<Response>((resolve,reject)=>{
    const xhr=new XMLHttpRequest();
    let settled=false,loaded=0,total:number|null=null;
    const cleanup=()=>{
      signal?.removeEventListener('abort',cancel);
      xhr.onload=xhr.onerror=xhr.onabort=xhr.ontimeout=null;
      xhr.upload.onprogress=xhr.upload.onload=null;
    };
    const fail=(reason:unknown)=>{if(settled)return;settled=true;cleanup();reject(reason);};
    const cancel=()=>{fail(aborted(signal));xhr.abort();};
    xhr.open('POST',url,true);
    xhr.withCredentials=true;
    new Headers(headers).forEach((value,key)=>xhr.setRequestHeader(key,value));
    xhr.upload.onprogress=event=>{
      loaded=event.loaded;
      total=event.lengthComputable&&event.total>0?event.total:null;
      onProgress?.({loaded,total,phase:'uploading'});
    };
    xhr.upload.onload=event=>{
      loaded=event.loaded||loaded;
      if(event.lengthComputable&&event.total>0)total=event.total;
      onProgress?.({loaded,total,phase:'processing'});
    };
    xhr.onload=()=>{
      if(settled)return;
      try{
        if(xhr.status===0)throw new TypeError('Network upload failed');
        const responseHeaders=new Headers();
        for(const row of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)){
          const divider=row.indexOf(':');
          if(divider>0)responseHeaders.append(row.slice(0,divider).trim(),row.slice(divider+1).trim());
        }
        const response=new Response([204,205,304].includes(xhr.status)?null:xhr.responseText,{status:xhr.status,statusText:xhr.statusText,headers:responseHeaders});
        settled=true;cleanup();resolve(response);
      }catch(error){fail(error);}
    };
    xhr.onerror=()=>fail(new TypeError('Network upload failed'));
    xhr.ontimeout=()=>fail(new Error('上传超时'));
    xhr.onabort=()=>fail(aborted(signal));
    signal?.addEventListener('abort',cancel,{once:true});
    if(signal?.aborted){cancel();return;}
    onProgress?.({loaded,total,phase:'uploading'});
    try{xhr.send(body);}catch(error){fail(error);}
  });
}
