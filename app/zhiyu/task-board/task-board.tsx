'use client';

import {useEffect,useRef,useState} from 'react';
import {LayoutGrid,Plus,Search,SlidersHorizontal,X} from 'lucide-react';
import PressableIconButton from '../pressable-icon-button';
import {useAccount} from '../auth-gate';
import {useReportSchedule,weeklyReviewScheduleLabel} from '../report-schedule-store';
import DirectoryDivider from '../directory-divider';
import {LoadingSkeleton} from '../loading-state';
import {ARRANGEMENT_SECTIONS,isArrangementSectionId,type ArrangementSectionId} from '../../../lib/npc/arrangement-sections';
import {categories,npcs} from './config';
import {isTaskFinished} from './reducer';
import {EndTaskConfirm,NpcAvatar,type TaskActions} from './task-components';
import TaskRecordEditor,{type CommitTaskRecord} from './task-record-editor';
import MobileTaskBoard from './mobile-task-board';
import {ArrangementBoardContent,ArrangementSectionIcon} from './arrangement-board-content';
import {arrangementBoardCounts,type ArrangementBoardView} from './arrangement-board-model';
import {OPEN_ARRANGEMENT,useArrangements} from './use-arrangements';
import type {useTaskBoard} from './use-task-board';
import type {Task} from './types';
import './task-board.css';

export default function TaskBoard({board,dirWidth,onDirectoryWidthChange,onOpenConversation,onCommitRecord,mobile=false,initialSection}: {
  board:ReturnType<typeof useTaskBoard>;dirWidth:number;onDirectoryWidthChange:(width:number)=>void;
  onOpenConversation:(npcId:string,task?:Task)=>void;onCommitRecord?:CommitTaskRecord;mobile?:boolean;initialSection?:ArrangementBoardView;
}) {
  const {model,dispatch,ready,storageError}=board;
  const {account}=useAccount();
  const weeklySchedule=useReportSchedule(account.id);
  const arrangements=useArrangements(account.id);
  const [section,setSection]=useState<ArrangementBoardView>(initialSection||(isArrangementSectionId(model.page.categoryFilter)?model.page.categoryFilter:'overview'));
  const [previousInitialSection,setPreviousInitialSection]=useState(initialSection);
  if(previousInitialSection!==initialSection){setPreviousInitialSection(initialSection);if(initialSection)setSection(initialSection);}
  const [query,setQuery]=useState('');
  const [editor,setEditor]=useState<{task?:Task;anchor:HTMLElement|null}|null>(null);
  const [confirmId,setConfirmId]=useState<string|null>(null),[confirmAnchor,setConfirmAnchor]=useState<HTMLElement|null>(null);
  const content=useRef<HTMLElement>(null);
  // The former date-only page could retain a selected historical day. The
  // seven sections show all dates, so current-day execution uses the real day.
  useEffect(()=>{if(!ready||!model.page.selectedDate)return;const frame=requestAnimationFrame(()=>dispatch({type:'set-selected-date'}));return()=>cancelAnimationFrame(frame);},[ready,model.page.selectedDate,dispatch]);
  useEffect(()=>{
    const open=(event:Event)=>{const value=(event as CustomEvent<{section?:ArrangementSectionId;id?:string}>).detail;if(isArrangementSectionId(value?.section)){setSection(value.section);setQuery('');requestAnimationFrame(()=>{if(value.id){const row=content.current?.querySelector(`[data-arrangement-id="${CSS.escape(value.id)}"]`);row?.scrollIntoView({block:'center',behavior:'smooth'});}else content.current?.scrollTo({top:0});});}};
    window.addEventListener(OPEN_ARRANGEMENT,open);return()=>window.removeEventListener(OPEN_ARRANGEMENT,open);
  },[]);
  function selectSection(value:ArrangementBoardView){setSection(value);setQuery('');content.current?.scrollTo({top:0});}
  function requestFinish(task:Task){setConfirmAnchor(document.activeElement instanceof HTMLElement?document.activeElement:null);setConfirmId(task.id);}
  const actions:TaskActions={
    onToggleStatus(task){if(task.date>model.today)return;if(task.date===model.today&&task.type==='steps'&&!isTaskFinished(task)){requestFinish(task);return;}dispatch({type:'toggle-status',taskId:task.id,now:Date.now()});},
    onStart(task){dispatch({type:'start',taskId:task.id,now:Date.now()});},
    onFinish(task){if(task.type==='steps')requestFinish(task);else dispatch({type:task.type==='count'?'complete-count':'toggle-status',taskId:task.id,now:Date.now()});},
    onTalk(task){onOpenConversation(task.npcId,task);},
    onStepToggle(task,step){dispatch({type:'toggle-step',taskId:task.id,stepId:step.id,now:Date.now()});},
    onSetClick(task,step,index){dispatch({type:'set-step-set',taskId:task.id,stepId:step.id,index,now:Date.now()});},
    onTimerStart(task,step){dispatch({type:'start-timer',taskId:task.id,stepId:step.id,now:Date.now()});},
    onTimerPause(task,step){dispatch({type:'pause-timer',taskId:task.id,stepId:step.id,now:Date.now()});},
    onTimerResume(task,step){dispatch({type:'resume-timer',taskId:task.id,stepId:step.id,now:Date.now()});},
    onPause(task){dispatch({type:'pause',taskId:task.id,now:Date.now()});},
    onEdit(task){if(task.manualRecord)setEditor({task,anchor:document.activeElement instanceof HTMLElement?document.activeElement:null});},
    onExpandTask(task){dispatch({type:'toggle-task',taskId:task.id});},onExpandStep(stepId){dispatch({type:'expand-step',stepId});},
    onPin(task){if(task.appendOrder===undefined)dispatch({type:'pin',taskId:task.id});},
    onCommitFinish:async(task)=>{await board.commitAction({type:task.type==='count'?'complete-count':'toggle-status',taskId:task.id,now:Date.now()});},
  };
  const counts=arrangementBoardCounts(model.tasks,arrangements.items);
  const confirmTask=model.tasks.find(task=>task.id===confirmId)||null;
  const boardContent=<>
    {!ready&&<LoadingSkeleton label="正在读取安排" rows={4}/>}
    {(storageError||arrangements.error)&&<p className="zy-tb-storage-error" role="alert">{storageError||arrangements.error}{arrangements.error&&<button type="button" onClick={()=>void arrangements.refresh()}>重试</button>}</p>}
    {ready&&<ArrangementBoardContent board={board} actions={actions} arrangements={arrangements} section={section} onSelect={selectSection} query={query} mobile={mobile} onOpenConversation={onOpenConversation}/>}
  </>;
  return <>
    {mobile?<MobileTaskBoard section={section} counts={counts} onSelect={selectSection} scrollRef={content} onOpenMolly={()=>onOpenConversation('molly')}>{boardContent}</MobileTaskBoard>:<div className="zy-task-board" data-task-view={section} aria-label="安排工作台">
      <aside className="zy-directory zy-pet-directory zy-task-board-guide" style={{'--zy-directory-width':`${dirWidth}px`} as React.CSSProperties} aria-label="安排指引栏"><div className="zy-tb-guide-scroll">
        <h1 className="zy-tb-guide-title">安排</h1>
        <div className="zy-tb-search-line"><label className="zy-tb-search"><Search size={15}/><input aria-label="搜索安排" placeholder="搜索安排" value={query} onChange={event=>setQuery(event.target.value)}/>{query&&<button type="button" aria-label="清空安排搜索" onClick={()=>setQuery('')}><X size={13}/></button>}</label><PressableIconButton rotateOnClick type="button" aria-label="让 Molly 记录安排" onClick={()=>onOpenConversation('molly')}><Plus size={21}/></PressableIconButton></div>
        <nav className="zy-ab-directory-nav" aria-label="安排板块"><button type="button" aria-current={section==='overview'?'page':undefined} onClick={()=>selectSection('overview')}><LayoutGrid size={18}/><span>概览</span><small>{Object.values(counts).reduce((sum,count)=>sum+count,0)}</small></button><div className="zy-ab-nav-divider"/>{ARRANGEMENT_SECTIONS.map(item=><button type="button" key={item.id} aria-current={section===item.id?'page':undefined} onClick={()=>selectSection(item.id)}><ArrangementSectionIcon section={item.id}/><span>{item.name}</span><small>{counts[item.id]||'—'}</small></button>)}</nav>
      </div><div className="zy-tb-weekly-review"><NpcAvatar npc={npcs.find(npc=>npc.id==='molly')!} size={28}/><div><strong>本周复盘</strong><span>Molly · {weeklyReviewScheduleLabel(weeklySchedule)}</span></div></div></aside>
      <DirectoryDivider width={dirWidth} onWidthChange={onDirectoryWidthChange} label="调整安排指引栏宽度"/>
      <section ref={content} className="zy-task-board-content" aria-busy={!ready||!arrangements.ready} aria-label="安排内容"><div className="zy-tb-content-inner">{ready&&onCommitRecord&&<div className="zy-tb-record-tools"><button type="button" className="zy-tb-manage-button" onClick={event=>setEditor({anchor:event.currentTarget})}><SlidersHorizontal size={14}/>管理安排</button></div>}{boardContent}</div></section>
    </div>}
    {editor&&onCommitRecord&&<TaskRecordEditor key={editor.task?.id||'manage'} model={model} onCommitRecord={onCommitRecord} onClose={()=>setEditor(null)} initialTask={editor.task} anchor={editor.anchor}/>}
    <EndTaskConfirm task={confirmTask} category={confirmTask?categories.find(item=>item.id===confirmTask.categoryId):undefined} anchor={confirmAnchor} onCancel={()=>setConfirmId(null)} onSubmit={mobile?async(task)=>{await board.commitAction({type:'finish',taskId:task.id,now:Date.now()});}:undefined} onConfirm={()=>{if(confirmTask&&!mobile)dispatch({type:'finish',taskId:confirmTask.id,now:Date.now()});setConfirmId(null);}}/>
  </>;
}
