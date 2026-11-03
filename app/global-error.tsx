'use client';
import {useEffect} from 'react';
import {UserFacingErrorFallback} from './zhiyu/page-error-boundary';
export default function GlobalError({error,reset}:{error:Error&{digest?:string};reset:()=>void}) {
  useEffect(()=>{console.error('[智域] 应用加载失败',error);},[error]);
  return <html lang="zh-CN"><body><UserFacingErrorFallback onReset={reset}/></body></html>;
}
