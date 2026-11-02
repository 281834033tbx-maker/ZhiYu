'use client';

import {useRef} from 'react';

const MIN_WIDTH=200;
const MAX_WIDTH=420;
const clamp=(width:number)=>Math.max(MIN_WIDTH,Math.min(MAX_WIDTH,width));

/** Shared seam for the conversation, contacts, tasks and utility directories. */
export default function DirectoryDivider({width,onWidthChange,label='调整列表宽度'}:{
  width:number;
  onWidthChange:(width:number)=>void;
  label?:string;
}) {
  const drag=useRef<{pointerId:number;x:number;width:number}|null>(null);
  // A focusable window splitter is interactive; a native hr is a static separator.
  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
  return <div className="zy-panel-divider zy-directory-divider" role="separator"
    tabIndex={0} aria-orientation="vertical" aria-label={label}
    aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={width}
    onPointerDown={event=>{
      if(event.button!==0)return;
      event.preventDefault();
      drag.current={pointerId:event.pointerId,x:event.clientX,width};
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event=>{
      const current=drag.current;
      if(current?.pointerId===event.pointerId)onWidthChange(clamp(current.width+event.clientX-current.x));
    }}
    onPointerUp={()=>{drag.current=null;}}
    onPointerCancel={()=>{drag.current=null;}}
    onLostPointerCapture={()=>{drag.current=null;}}
    onKeyDown={event=>{
      const next=event.key==='ArrowLeft'?width-10:event.key==='ArrowRight'?width+10:event.key==='Home'?MIN_WIDTH:event.key==='End'?MAX_WIDTH:null;
      if(next===null)return;
      event.preventDefault();onWidthChange(clamp(next));
    }}/>;
}
