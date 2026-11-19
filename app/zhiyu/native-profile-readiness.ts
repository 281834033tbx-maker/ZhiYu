/** A hidden native card must finish loading its own copied styles and fonts
 * before its frosted window can be revealed. The opener owns cancellation. */
export function waitForProfileStyles(doc:Document,signal:AbortSignal):Promise<void> {
  return new Promise((resolve,reject)=>{
    const cleanups:(()=>void)[]=[];
    let done=false;
    const finish=(error?:Error)=>{
      if(done)return;done=true;
      for(const cleanup of cleanups)cleanup();
      if(error)reject(error);else resolve();
    };
    const abort=()=>finish(new Error('Profile closed before it was ready'));
    if(signal.aborted){abort();return;}
    signal.addEventListener('abort',abort,{once:true});
    cleanups.push(()=>signal.removeEventListener('abort',abort));
    const timeout=setTimeout(()=>finish(new Error('Profile styles did not finish loading')),5000);
    cleanups.push(()=>clearTimeout(timeout));
    const sheets=[...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map(link=>new Promise<void>((loaded,failed)=>{
      if(link.sheet){loaded();return;}
      const ready=()=>loaded(),error=()=>failed(new Error('Profile stylesheet failed to load'));
      link.addEventListener('load',ready,{once:true});link.addEventListener('error',error,{once:true});
      cleanups.push(()=>{link.removeEventListener('load',ready);link.removeEventListener('error',error);});
      if(link.sheet)loaded();
    }));
    void Promise.all(sheets).then(()=>done?undefined:doc.fonts?.ready).then(()=>finish(),reason=>finish(reason instanceof Error?reason:new Error('Profile styles unavailable')));
  });
}
