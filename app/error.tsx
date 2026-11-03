'use client';
import {useEffect} from 'react';
import {UserFacingErrorFallback} from './zhiyu/page-error-boundary';
export default function AppError({error,reset}:{error:Error&{digest?:string};reset:()=>void}) {
  useEffect(()=>{console.error('[智域] 页面加载失败',error);},[error]);
  return <UserFacingErrorFallback onReset={reset}/>;
}
