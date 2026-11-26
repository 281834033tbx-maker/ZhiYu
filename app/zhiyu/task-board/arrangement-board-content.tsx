'use client';

import {useState} from 'react';
import {ArrowRight,CalendarDays,Check,ChevronDown,ClipboardList,Clock3,CreditCard,Flag,Layers3,ShoppingBag,Undo2,type LucideIcon} from 'lucide-react';
import {ARRANGEMENT_SECTIONS,arrangementPaymentCatalog,arrangementCardSubtitle,arrangementSectionForTask,arrangementSectionName,type ArrangementSectionId} from '../../../lib/npc/arrangement-sections';
import type {ArrangementItem} from '../../../lib/npc/arrangement-types';
import {publicGroupDirectory} from '../../../lib/npc/character-directory';
import {categories} from './config';
import {TaskRow,type TaskActions} from './task-components';
import type {useTaskBoard} from './use-task-board';
import type {useArrangements} from './use-arrangements';
import {arrangementBoardCounts,arrangementItemMatches,arrangementLegacyOrder,arrangementPreferenceLabel,arrangementTaskMatches,arrangementTaskNpc,type ArrangementBoardStatus,type ArrangementBoardView} from './arrangement-board-model';
import {arrangementConversationTask} from './send-task';
import {canOperateBoardTask,isTaskFinished,taskMatchesQuery} from './reducer';
import type {Task} from './types';
import './arrangement-board.css';

const sectionIcons:Record<ArrangementSectionId,LucideIcon>={schedule:CalendarDays,todo:ClipboardList,plan:Layers3,purchase:ShoppingBag,payment:CreditCard,procedure:Flag,countdown:Clock3};
export function ArrangementSectionIcon({section,size=18}:{section:ArrangementSectionId;size?:number}){const Icon=sectionIcons[section];return <Icon size={size} strokeWidth={1.6}/>;}
const readableDate=(date:string)=>`${Number(date.slice(5,7))}月${Number(date.slice(8,10))}日`;
type Props={
  board:ReturnType<typeof useTaskBoard>;actions:TaskActions;arrangements:ReturnType<typeof useArrangements>;
  section:ArrangementBoardView;onSelect:(section:ArrangementBoardView)=>void;query:string;mobile?:boolean;
  onOpenConversation:(npcId:string,task?:Task)=>void;onSendTask?:()=>void;
};
export function ArrangementBoardContent({board,actions,arrangements,section,onSelect,query,mobile=false,onOpenConversation,onSendTask}:Props) {
  const {model,now}=board;
  const [status,setStatus]=useState<ArrangementBoardStatus>('all');
  const [listing,setListing]=useState({scope:'',count:40}),[preferenceError,setPreferenceError]=useState('');
  const scope=section+'|'+status+'|'+query,limit=listing.scope===scope?listing.count:40;
  const counts=arrangementBoardCounts(model.tasks,arrangements.items);
  const total=ARRANGEMENT_SECTIONS.reduce((sum,item)=>sum+counts[item.id],0);
  function renderLegacy(task:Task){
    const mode=task.date>model.today?'future':task.date<model.today?'history':'today';
    const category=categories.find(item=>item.id===task.categoryId)||{id:task.categoryId,name:arrangementSectionName(arrangementSectionForTask(task.categoryId)),groupId:'',icon:'ClipboardList',color:'var(--zy-interaction-ink,#527b98)'};
    return <TaskRow key={task.id} task={task} category={category} npc={arrangementTaskNpc(task)} mode={mode} expanded={model.page.expandedTaskIds.includes(task.id)} expandedStepId={model.page.expandedStepId} active={task.id===model.page.activeTaskId} now={now} rest={model.rest} timers={model.timers} today={model.today} canOperate={mode==='history'||canOperateBoardTask(model,task)} actions={task.appendOrder===undefined?actions:{...actions,onPin:undefined}} mobile={mobile}/>;
  }
  const selectedSections=section==='overview'?ARRANGEMENT_SECTIONS:ARRANGEMENT_SECTIONS.filter(item=>item.id===section);
  const todayNative=arrangements.items.filter(item=>item.status==='active'&&(item.time.date===model.today||item.time.deadline===model.today)).length;
  const todayLegacy=model.tasks.filter(task=>task.date===model.today&&!isTaskFinished(task)).length;
  return <div className={'zy-ab-content'+(mobile?' is-mobile':'')} data-arrangement-section={section}>
    <header className="zy-tb-page-heading zy-ab-heading"><div><h1>{section==='overview'?'安排概览':arrangementSectionName(section)}</h1><p>{section==='overview'?`${readableDate(model.today)} · 今天 ${todayNative+todayLegacy} 项 · 共 ${total} 项待处理`:counts[section]?`${counts[section]} 项待处理`:'有想做的事，随时让 Molly 记下'}</p></div><div className="zy-ab-heading-actions">{onSendTask&&<button type="button" className="zy-ab-add" onClick={onSendTask}>发任务<ArrowRight size={14}/></button>}{!mobile&&<button type="button" className="zy-ab-add" onClick={()=>onOpenConversation('molly')}>告诉 Molly<ArrowRight size={14}/></button>}</div></header>
    {section==='overview'&&<div className="zy-ab-overview-grid" aria-label="七个安排板块">{ARRANGEMENT_SECTIONS.map(item=><button type="button" key={item.id} onClick={()=>onSelect(item.id)}><span className="zy-ab-section-mark"><ArrangementSectionIcon section={item.id}/></span><strong>{item.name}</strong><span>{counts[item.id]}<small>项</small></span></button>)}</div>}
    <div className="zy-ab-list-toolbar"><span>{section==='overview'?'全部安排':arrangementSectionName(section)}</span><fieldset aria-label="安排状态筛选">{([{id:'all',name:'全部'},{id:'open',name:'待完成'},{id:'done',name:'已完成'}] as const).map(item=><button type="button" key={item.id} aria-pressed={status===item.id} onClick={()=>setStatus(item.id)}>{item.name}</button>)}</fieldset></div>
    {selectedSections.map(selected=>{
      const items=arrangements.items.filter(item=>item.section===selected.id&&arrangementItemMatches(item,query,status));
      const legacy=model.tasks.filter(task=>arrangementSectionForTask(task.categoryId)===selected.id&&arrangementTaskMatches(task,status)&&taskMatchesQuery(task,query)).sort(arrangementLegacyOrder);
      const savedPlans=selected.id==='plan'?(model.plans||[]).filter(plan=>plan.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())):[];
      // Render complete records on demand rather than mounting thousands of
      // collapsed legacy step/timer trees. Searching still covers every row.
      const visibleItems=items.slice(0,section==='overview'?3:limit);
      const visibleLegacy=legacy.slice(0,section==='overview'?3:Math.max(0,limit-visibleItems.length));
      if(section==='overview'&&!items.length&&!legacy.length&&!savedPlans.length)return null;
      return <section className="zy-ab-section" key={selected.id} aria-label={selected.name+'安排'}>
        {section==='overview'&&<header><h2><ArrangementSectionIcon section={selected.id} size={16}/>{selected.name}</h2><button type="button" onClick={()=>onSelect(selected.id)}>查看全部<ArrowRight size={13}/></button></header>}
        {!!savedPlans.length&&<div className="zy-ab-saved-plans" aria-label="已保存的长期计划">{savedPlans.map(plan=><div key={plan.id}><strong>{plan.name}</strong><span>{plan.progressText}</span><progress aria-label={plan.name+'进度'} value={Math.max(0,Math.min(1,plan.progress))} max={1}/></div>)}</div>}
        {visibleItems.map(item=><ArrangementRecord key={item.id} item={item} arrangements={arrangements} onTalk={()=>{const task=arrangementConversationTask(item,model.today);onOpenConversation(task.npcId,task);}}/>)}
        {!!visibleLegacy.length&&<div className="zy-ab-legacy-list">{visibleLegacy.map((task,index)=><div key={task.id}>{(index===0||visibleLegacy[index-1].date!==task.date)&&<p className="zy-ab-legacy-date">{readableDate(task.date)}{task.date===model.today?' · 今天':''}</p>}{renderLegacy(task)}</div>)}</div>}
        {section!=='overview'&&items.length+legacy.length>visibleItems.length+visibleLegacy.length&&<button type="button" className="zy-ab-load-more" onClick={()=>setListing({scope,count:limit+40})}>显示更多 · 还有 {items.length+legacy.length-visibleItems.length-visibleLegacy.length} 项</button>}
        {!items.length&&!legacy.length&&!savedPlans.length&&<p className="zy-ab-empty">{query?'没有匹配的安排':status==='done'?'这里还没有已完成的安排':`这里还没有${selected.name}，和 Molly 说一声就能记下`}</p>}
      </section>;
    })}
    {section==='overview'&&!selectedSections.some(selected=>arrangements.items.some(item=>item.section===selected.id&&arrangementItemMatches(item,query,status))||model.tasks.some(task=>arrangementSectionForTask(task.categoryId)===selected.id&&arrangementTaskMatches(task,status)&&taskMatchesQuery(task,query))||selected.id==='plan'&&model.plans?.some(plan=>plan.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))&&<p className="zy-ab-empty">{query?'没有匹配的安排':'Molly：有想做的事，随时叫我来安排'}</p>}
    {!!arrangements.preferences.filter(item=>!item.enabled).length&&<details className="zy-ab-preferences"><summary>自动记录偏好</summary>{arrangements.preferences.filter(item=>!item.enabled).map(item=><div key={item.section+':'+(item.category||'')}><span>{arrangementSectionName(item.section)}{item.category?' · '+arrangementPreferenceLabel(item.category):''}已暂停自动记录</span><button type="button" onClick={()=>{setPreferenceError('');void arrangements.mutate({action:'preference',section:item.section,category:item.category,enabled:true}).catch(()=>setPreferenceError('恢复自动记录没有保存成功，请重试。'));}}>恢复</button></div>)}</details>}
    {preferenceError&&<p className="zy-ab-error" role="alert">{preferenceError}</p>}
  </div>;
}
function ArrangementRecord({item,arrangements,onTalk}:{item:ArrangementItem;arrangements:ReturnType<typeof useArrangements>;onTalk:()=>void}) {
  const [expanded,setExpanded]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('');
  const publisher=publicGroupDirectory().find(npc=>npc.id===item.sourceNpcId)?.name||item.sourceNpcId;
  const steps=item.details.steps||[];
  const subtitle=arrangementCardSubtitle(item.section,{time:item.time,publisherName:publisher,itemCount:item.details.items?.length,completedSteps:steps.filter(step=>step.done).length,totalSteps:steps.length});
  async function mutate(action:Parameters<typeof arrangements.mutate>[0]){if(pending)return;setPending(true);setError('');try{await arrangements.mutate(action);}catch(error){setError(error instanceof Error?error.message:'没有保存成功，请重试。');}finally{setPending(false);}}
  return <article className={'zy-ab-record'+(item.status==='completed'?' is-completed':'')} data-arrangement-id={item.id}>
    <div className="zy-ab-record-line"><button type="button" className="zy-ab-check" disabled={pending||item.status==='completed'} aria-label={'完成：'+item.title} aria-pressed={item.status==='completed'} onClick={()=>void mutate({action:'complete',id:item.id})}>{item.status==='completed'&&<Check size={11}/>}</button><button type="button" className="zy-ab-record-copy" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}><strong>{item.title}</strong><small>{subtitle}</small></button><button type="button" className="zy-ab-revoke" disabled={pending} onClick={()=>void mutate({action:'revoke',id:item.id})}><Undo2 size={13}/>撤销</button><button type="button" className={'zy-ab-expand'+(expanded?' is-open':'')} aria-expanded={expanded} aria-label={(expanded?'收起：':'展开：')+item.title} onClick={()=>setExpanded(value=>!value)}><ChevronDown size={17}/></button></div>
    <div className={'zy-ab-expansion'+(expanded?' is-open':'')} aria-hidden={!expanded} inert={!expanded}><div><div className="zy-ab-record-detail">
      {item.time.display&&<p><span>时间</span>{item.time.display}</p>}
      {item.time.recurrence&&<p><span>重复</span>{item.time.recurrence.frequency==='daily'?'每天':item.time.recurrence.frequency==='weekly'?'每周'+['','一','二','三','四','五','六','日'][item.time.recurrence.weekday||1]:'每月'+item.time.recurrence.day+'日'}</p>}
      {!!item.details.items?.length&&<ul className="zy-ab-purchases">{item.details.items.map((name,index)=><li key={index}>{name}</li>)}</ul>}
      {!!steps.length&&<ol className="zy-ab-steps">{steps.map((step,index)=><li key={index}><label><input type="checkbox" checked={step.done} disabled={pending||item.status==='completed'} onChange={event=>void mutate({action:'step',id:item.id,index,done:event.target.checked})}/><span>{step.title}{step.date&&<small>{readableDate(step.date)}</small>}</span></label></li>)}</ol>}
      {item.details.payment&&<p><span>缴费</span>{item.details.payment.name} · 提前{item.details.payment.remindBeforeDays}天提醒<br/>{item.details.payment.destination}{item.details.payment.link&&/^(?:https?:\/\/|\/(?!\/))/.test(item.details.payment.link)&&<a href={item.details.payment.link} target="_blank" rel="noreferrer">{item.details.payment.button||'前往缴费'}</a>}</p>}
      {item.details.payment&&<p><span>参考周期</span>{arrangementPaymentCatalog.find(row=>row.name===item.details.payment?.name)?.cycles.join(' / ')||'按用户设置'}；重复安排以你明确说的周期为准</p>}
      {item.sourceText&&<p className="zy-ab-source"><span>记下的内容</span>{item.sourceText}</p>}
      <div className="zy-ab-record-controls"><label>移动到<select aria-label={'移动'+item.title+'到'} value={item.section} disabled={pending} onChange={event=>void mutate({action:'move',id:item.id,section:event.target.value as ArrangementSectionId})}>{ARRANGEMENT_SECTIONS.map(section=><option key={section.id} value={section.id}>{section.name}</option>)}</select></label><button type="button" onClick={onTalk}>与智友对话</button><button type="button" disabled={pending} onClick={()=>void mutate({action:'preference',section:item.section,category:item.preferenceKey,enabled:false})}>这类不再自动记</button></div>
    </div></div></div>
    {error&&<p role="alert" className="zy-ab-error">{error}</p>}
  </article>;
}
