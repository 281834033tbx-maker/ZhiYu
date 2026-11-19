'use client';

import './loading-state.css';

/** Geometry is present immediately; the shimmer waits briefly to avoid a flash on quick reads. */
export function LoadingSkeleton({label='正在读取',rows=3,variant='list',className=''}:{label?:string;rows?:number;variant?:'list'|'compact'|'media';className?:string}) {
  return <output className={`zy-loading-skeleton is-${variant} ${className}`} aria-label={label} aria-busy="true">
    <span className="zy-loading-label">{label}</span>
    {Array.from({length:variant==='media'?1:Math.max(1,Math.min(8,rows))},(_,index)=><span className="zy-loading-row" key={index} aria-hidden="true">
      {variant==='list'&&<i className="zy-loading-avatar"/>}<span className="zy-loading-lines"><i/><i/></span>
    </span>)}
  </output>;
}

/** Callers must provide measured work. Unknown-duration requests use a skeleton or a phase label. */
export function MeasuredProgress({value,total,label='正在上传'}:{value:number;total:number;label?:string}) {
  if(!Number.isFinite(total)||total<=0||!Number.isFinite(value))return <output className="zy-loading-phase">{label}</output>;
  const measured=Math.max(0,Math.min(total,value));
  return <div className="zy-measured-progress"><label>{label}<progress max={total} value={measured}/></label><output aria-live="off">{Math.floor(measured/total*100)}%</output></div>;
}
