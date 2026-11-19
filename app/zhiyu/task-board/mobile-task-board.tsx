'use client';

import {useEffect,useRef,type ReactNode,type RefObject} from 'react';
import {ArrowLeft,LayoutGrid,Plus} from 'lucide-react';
import {ARRANGEMENT_SECTIONS,arrangementSectionName,type ArrangementSectionId} from '../../../lib/npc/arrangement-sections';
import {ArrangementSectionIcon} from './arrangement-board-content';
import type {ArrangementBoardView} from './arrangement-board-model';
import './mobile-task-board.css';

/** The phone uses the same seven sections and the very same record/detail
 * components as desktop; the surrounding App/navigation shell stays mounted. */
export default function MobileTaskBoard({section,counts,onSelect,onOpenMolly,scrollRef,children}:{
  section:ArrangementBoardView;counts:Record<ArrangementSectionId,number>;onSelect:(value:ArrangementBoardView)=>void;
  onOpenMolly:()=>void;scrollRef:RefObject<HTMLElement|null>;children:ReactNode;
}) {
  const tabs=useRef<HTMLElement>(null);
  useEffect(()=>{const bar=tabs.current,active=bar?.querySelector<HTMLElement>('[aria-current="page"]');if(bar&&active){const right=active.offsetLeft+active.offsetWidth;if(active.offsetLeft<bar.scrollLeft)bar.scrollLeft=active.offsetLeft-12;else if(right>bar.scrollLeft+bar.clientWidth)bar.scrollLeft=right-bar.clientWidth+12;}},[section]);
  return <div className="zy-task-board zy-m-task-board" data-task-view={section} aria-label="安排">
    <header className="zy-m-task-header">{section!=='overview'&&<button type="button" className="zy-ab-mobile-back" aria-label="返回安排概览" onClick={()=>onSelect('overview')}><ArrowLeft size={21}/></button>}<h1>{section==='overview'?'安排':arrangementSectionName(section)}</h1><button type="button" aria-label="让 Molly 记录安排" onClick={onOpenMolly}><Plus size={22}/></button></header>
    <nav ref={tabs} className="zy-ab-mobile-tabs" aria-label="安排板块"><button type="button" aria-current={section==='overview'?'page':undefined} onClick={()=>onSelect('overview')}><LayoutGrid size={14}/><span>概览</span></button>{ARRANGEMENT_SECTIONS.map(item=><button type="button" key={item.id} aria-current={section===item.id?'page':undefined} onClick={()=>onSelect(item.id)}><ArrangementSectionIcon section={item.id} size={14}/><span>{item.name}</span>{counts[item.id]>0&&<small>{counts[item.id]}</small>}</button>)}</nav>
    <section ref={scrollRef} className="zy-m-task-scroll" data-mobile-scroll aria-label="安排内容">{children}</section>
  </div>;
}
