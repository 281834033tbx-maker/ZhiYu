'use client';

import {useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import Image from 'next/image';
import {Copy, X} from 'lucide-react';
import type {DailyBrief, ReportDemoAction, ReportDemoQuote, ScheduleItem, ShoppingList, WeeklyReport} from '../../lib/npc/molly-reports';
import {reportDate, reportRelativeDate, SHOPPING_GROUPS, shoppingPlainText, sortBriefSchedule} from '../../lib/npc/molly-reports';
import {dailyTemplates,weeklyBlocks} from '../../lib/npc/molly-report-config';
import {useAccount} from './auth-gate';
import {people} from './data';
import {npcFetch} from './npc-fetch';
import {ReportSummary, ReportBody, ReportBlock, useReportExpansion} from './report-fold';
import './molly-report-cards.css';

type OpenNpc=(id:string,quoteId?:string,prefill?:string)=>void;
type DemoReceipt={brief?:DailyBrief;choiceMessageId?:string;characterId?:string;messageId?:string;text?:string;notice?:string};
async function reportRequest(accountId:string,body:ReportDemoAction|ReportDemoQuote):Promise<DemoReceipt> {
  const response=await npcFetch('/api/npc/secretary',{method:'POST',headers:{'Content-Type':'application/json','X-Zhiyu-Account':accountId},body:JSON.stringify(body)});
  if(!response.ok)throw Error('Report action not saved');
  return response.json() as Promise<DemoReceipt>;
}

function ReportAvatar({id,name}:{id:string;name?:string}) {
  const person=people.find(item=>item.id===id),label=name||person?.name||'Molly',avatar=id==='molly'?'/stitch/molly-avatar-v2.png':person?.avatar;
  return <span className="zy-molly-report-avatar" title={label}>{avatar?<Image src={avatar} width={22} height={22} alt={label} unoptimized/>:<span aria-label={label}>{label.slice(0,1)}</span>}</span>;
}

function ReportAction({children,confirm=false,disabled,onClick,label}:{children:string;confirm?:boolean;disabled:boolean;onClick:()=>void;label?:string}) {
  return <button type="button" className={'zy-molly-report-action'+(confirm?' is-confirm':'')} disabled={disabled} aria-label={label} onClick={event=>{event.stopPropagation();onClick();}}>{children}</button>;
}

function ScheduleRow({item,date,disabled,onOpen}:{item:ScheduleItem;date:string;disabled:boolean;onOpen:()=>void}) {
  const nextDay=!!item.date&&item.date>date||/^\d\d:\d\d$/u.test(item.time)&&item.time<'07:00';
  const changed=item.tag==='新增'||item.tag==='顺延'||item.tag==='改期';
  return <button type="button" className="zy-molly-report-schedule" onClick={onOpen} disabled={disabled} aria-label={`${item.time}${nextDay?' 明天':''} ${item.text}，和${people.find(person=>person.id===item.ownerId)?.name||'Molly'}聊这件事`}>
    <span className="zy-molly-report-schedule-time"><span>{item.time}</span><small>{nextDay?'明天':'\u00a0'}</small></span>
    <span className="zy-molly-report-schedule-copy"><span>{item.text}{item.tag&&<span className={'zy-molly-report-tag'+(changed?' is-change':'')}>{item.tag}</span>}</span><small>{item.sub?.text||'\u00a0'}</small></span>
    <ReportAvatar id={item.ownerId}/>
  </button>;
}

function ShoppingDialog({list,busy,error,onCheck,onClose,restoreFocus}:{list:ShoppingList;busy:boolean;error:string;onCheck:(groupIndex:number,index:number,checked:boolean)=>void;onClose:()=>void;restoreFocus:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),close=useRef<HTMLButtonElement>(null),titleId=useId(),descriptionId=useId();
  const [notice,setNotice]=useState(''),noticeTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  useLayoutEffect(()=>{
    const node=dialog.current;node?.showModal();close.current?.focus();
    return()=>{node?.close();restoreFocus();};
  },[restoreFocus]);
  useEffect(()=>()=>{if(noticeTimer.current)clearTimeout(noticeTimer.current);},[]);
  async function copy() {
    try {await navigator.clipboard.writeText(shoppingPlainText(list));setNotice('已复制');}
    catch {setNotice('没复制上，再试一下');}
    if(noticeTimer.current)clearTimeout(noticeTimer.current);
    noticeTimer.current=setTimeout(()=>setNotice(''),2200);
  }
  const count=list.groups.reduce((total,group)=>total+group.items.length,0);
  return <dialog ref={dialog} className="zy-dialog zy-molly-shopping-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event=>{event.preventDefault();onClose();}} onPointerDown={event=>{
    if(event.target!==event.currentTarget||event.button!==0)return;
    const rect=event.currentTarget.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)onClose();
  }}>
    <header><div><h2 id={titleId}>{list.title}</h2><p id={descriptionId}>{list.notes.join('、')} · {count} 样</p></div><div className="zy-molly-shopping-tools"><button type="button" aria-label="复制采购清单" title="复制" onClick={()=>void copy()}><Copy size={17}/></button><button ref={close} type="button" aria-label="关闭采购清单" title="关闭" onClick={onClose}><X size={18}/></button></div></header>
    <div className="zy-molly-shopping-scroll">{SHOPPING_GROUPS.map(group=>{
      const groupIndex=list.groups.findIndex(item=>item.group===group),row=list.groups[groupIndex];
      if(!row?.items.length)return null;
      return <section className="zy-molly-shopping-group" key={group}><h3>{group}</h3>{row.items.map((item,index)=><label className={'zy-molly-shopping-item'+(item.checked?' is-checked':'')} key={index}><span><input type="checkbox" checked={!!item.checked} disabled={busy} onChange={event=>onCheck(groupIndex,index,event.target.checked)}/><span>{item.name}</span></span><small>{item.qty}{item.daysLeft!==undefined?` · 还剩 ${item.daysLeft} 天`:''}</small></label>)}</section>;
    })}<p className="zy-molly-shopping-source">{list.sources.join('；')}</p></div>
    {error&&<p className="zy-molly-shopping-error" role="alert">{error}</p>}{notice&&<output className="zy-molly-shopping-toast">{notice}</output>}
  </dialog>;
}

export function DailyBriefCard({brief:incoming,messageId,onOpenNpc,onOpenChoice}:{brief:DailyBrief;messageId:string;onOpenNpc?:OpenNpc;onOpenChoice?:(messageId:string)=>void}) {
  const {account}=useAccount(),[updated,setUpdated]=useState<{source:DailyBrief;brief:DailyBrief}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[shoppingId,setShoppingId]=useState(''),[notice,setNotice]=useState('');
  const brief=updated?.source===incoming?updated.brief:incoming;
  const working=useRef(false),shoppingAnchor=useRef<HTMLButtonElement|null>(null),expansion=useReportExpansion(account.id,messageId),contentId=useId();
  const restoreShoppingFocus=useCallback(()=>{if(shoppingAnchor.current?.isConnected)shoppingAnchor.current.focus();},[]);
  async function action(itemId:string,decision:ReportDemoAction['decision'],extra:Partial<ReportDemoAction>={}) {
    if(working.current)return;
    working.current=true;setBusy(true);setError('');setNotice('');
    try {
      const receipt=await reportRequest(account.id,{...extra,action:'report-demo-action',messageId,itemId,decision});
      if(receipt.brief)setUpdated({source:incoming,brief:receipt.brief});
      if(receipt.notice)setNotice(receipt.notice);
      if(receipt.choiceMessageId){if(onOpenChoice)onOpenChoice(receipt.choiceMessageId);else onOpenNpc?.('molly');}
    }catch{setError('这一步没保存上，再点一次');}
    finally{working.current=false;setBusy(false);}
  }
  async function quote(itemId:string) {
    if(!onOpenNpc||working.current)return;
    working.current=true;setBusy(true);setError('');
    try {
      const receipt=await reportRequest(account.id,{action:'report-demo-quote',messageId,kind:'schedule',itemId});
      if(!receipt.characterId||!receipt.messageId)throw Error('Quote missing');
      onOpenNpc(receipt.characterId,receipt.messageId,receipt.text);
    }catch{setError('这条日程暂时没接上，稍后再点一下');}
    finally{working.current=false;setBusy(false);}
  }
  const block=(id:string,name:string,children:ReactNode)=><ReportBlock key={id} id={id} name={dailyTemplates.blocks.find(item=>item.id===id)?.name||name}>{children}</ReportBlock>;
  const weather=brief.header.weather,shopping=brief.shopping.find(list=>list.id===shoppingId&&!list.done);
  const weatherText=weather?`${weather.low}–${weather.high}° ${weather.text}${weather.tip?`，${weather.tip}`:''}${brief.header.traffic?` · ${brief.header.traffic}`:''}`:'';
  const visibleShopping=brief.shopping.filter(list=>!list.done);
  return <><article className="zy-molly-report" aria-label="Molly 的今日安排" data-report-message={messageId} aria-busy={busy||undefined}>
    <ReportSummary primary={<>{reportDate(brief.date,brief.date)} · {brief.header.city}</>} secondary={weatherText} label="今日简报" expanded={expansion.expanded} contentId={contentId} onToggle={expansion.toggle}/>
    <ReportBody id={contentId} expanded={expansion.expanded}>
    {!!brief.pending.length&&block('pending','待定',brief.pending.slice(0,3).map(item=><div className="zy-molly-report-pending" key={item.id}><span>{item.text}</span><span className="zy-molly-report-actions">{item.kind==='choose'?<ReportAction disabled={busy} onClick={()=>void action(item.id,'choose')}>去选</ReportAction>:<><ReportAction disabled={busy} confirm onClick={()=>void action(item.id,'confirm')}>确认</ReportAction><ReportAction disabled={busy} onClick={()=>void action(item.id,'dismiss')}>暂不</ReportAction></>}</span></div>))}
    {!!brief.schedule.length&&block('schedule','日程',sortBriefSchedule(brief.schedule,brief.date).map(item=><ScheduleRow key={item.id} item={item} date={brief.date} disabled={busy||!onOpenNpc} onOpen={()=>void quote(item.id)}/>))}
    {!!visibleShopping.length&&block('shopping','采购',visibleShopping.slice(0,3).map(list=><div className="zy-molly-report-row" key={list.id}><div className="zy-molly-report-row-copy"><span>{list.title}</span><small>{list.notes.join('、')}</small></div><button type="button" className="zy-molly-report-action" onClick={event=>{shoppingAnchor.current=event.currentTarget;setShoppingId(list.id);}}>清单</button></div>))}
    {!!brief.bills.length&&block('bills','缴费',brief.bills.map(bill=>{
      const days=Math.round((Date.parse(bill.dueDate)-Date.parse(brief.date))/86400000),urgent=!bill.paid&&days<=3;
      const note=bill.paid?'已缴':`${reportRelativeDate(bill.dueDate,brief.date)}${bill.action}${bill.amount!==undefined?` · ¥${bill.amount.toLocaleString('zh-CN')}`:''}`;
      return <div className={'zy-molly-report-row zy-molly-report-bill'+(bill.paid?' is-paid':'')} key={bill.id}>{bill.paid&&<button type="button" className="zy-molly-report-bill-revert" tabIndex={-1} aria-label={`撤回${bill.name}已缴状态`} disabled={busy} onClick={()=>void action(bill.id,'bill-toggle')}/>}<div className="zy-molly-report-row-copy"><span className="zy-molly-report-bill-name">{bill.name}</span><small className={urgent?'is-danger':undefined}>{note}</small></div><ReportAction disabled={busy} label={bill.paid?`撤回${bill.name}已缴状态`:undefined} onClick={()=>void action(bill.id,'bill-toggle')}>{bill.button}</ReportAction></div>;
    }))}
    {!!brief.progress.length&&block('progress','进度',brief.progress.slice(0,3).map(item=><div className="zy-molly-report-progress" key={item.id}><div><span>{item.name}</span><small>{item.done}/{item.steps.length} 步</small></div><progress value={item.done} max={Math.max(1,item.steps.length)} aria-label={`${item.name}，${item.done}/${item.steps.length} 步`}/><small>{item.done>=item.steps.length?'全部完成':`下一步：${item.steps[item.done]}`}</small></div>))}
    {!!brief.upcoming.length&&block('upcoming','近期',[...brief.upcoming].sort((a,b)=>a.date.localeCompare(b.date)).slice(0,5).map(item=><div className="zy-molly-report-upcoming" key={item.id}><span>{item.text}</span><small>{reportDate(item.date,brief.date)} · {reportRelativeDate(item.date,brief.date)}</small></div>))}
    {!!brief.interests.length&&block('interests','关注',brief.interests.slice(0,2).map(item=><p className="zy-molly-report-interest" key={item.id}>{item.when} {item.text}</p>))}
    {notice&&<output className="zy-molly-report-notice">{notice}</output>}{error&&!shopping&&<p className="zy-molly-report-error" role="alert">{error}</p>}
    </ReportBody>
  </article>{shopping&&typeof document!=='undefined'&&createPortal(<ShoppingDialog list={shopping} busy={busy} error={error} onCheck={(groupIndex,index,checked)=>void action(shopping.id,'shopping-check',{groupIndex,index,checked})} onClose={()=>setShoppingId('')} restoreFocus={restoreShoppingFocus}/>,document.body)}</>;
}

export function WeeklyReportCard({report,messageId,onOpenNpc}:{report:WeeklyReport;messageId:string;onOpenNpc?:OpenNpc}) {
  const {account}=useAccount(),expansion=useReportExpansion(account.id,messageId),contentId=useId(),[busy,setBusy]=useState(false),[error,setError]=useState(''),working=useRef(false);
  async function quote(npcId:string) {
    if(!onOpenNpc||working.current)return;
    working.current=true;setBusy(true);setError('');
    try {
      const receipt=await reportRequest(account.id,{action:'report-demo-quote',messageId,kind:'comment',itemId:npcId});
      if(!receipt.characterId||!receipt.messageId)throw Error('Quote missing');
      onOpenNpc(receipt.characterId,receipt.messageId,receipt.text);
    }catch{setError('这条话暂时没接上，稍后再点一下');}
    finally{working.current=false;setBusy(false);}
  }
  const from=report.range.from.slice(0,10),to=report.range.to.slice(0,10);
  const orderedBlocks=[...report.blocks].filter(block=>block.rows.length).sort((a,b)=>{
    const rank=(id:string)=>{const index=weeklyBlocks.findIndex(block=>block.id===id);return index===-1?weeklyBlocks.length-1:index;};
    return rank(a.id)-rank(b.id);
  });
  return <article className="zy-molly-report" aria-label="Molly 的本周回顾" data-report-message={messageId}>
    <ReportSummary primary={<>{reportDate(from,to,false)}–{reportDate(to,to,false)}</>} secondary={report.headline} label="周报" expanded={expansion.expanded} contentId={contentId} onToggle={expansion.toggle}/>
    <ReportBody id={contentId} expanded={expansion.expanded}>
    {orderedBlocks.map(block=><ReportBlock key={block.id} id={block.id} name={weeklyBlocks.find(config=>config.id===block.id)?.name||block.name}>{block.rows.map((row,index)=><div className="zy-molly-report-week-row" key={`${row.itemKey}:${index}`}><div><span>{row.label}</span>{block.id!=='urgent'&&row.value&&<strong>{row.value}</strong>}</div><small className={row.danger||block.id==='urgent'?'is-danger':undefined}>{row.note||'\u00a0'}</small></div>)}</ReportBlock>)}
    {!!report.comments.length&&<ReportBlock id="comments" name="评语">{report.comments.map(comment=><button type="button" className="zy-molly-report-comment" disabled={busy||!onOpenNpc} key={comment.npcId} onClick={()=>void quote(comment.npcId)}><ReportAvatar id={comment.npcId} name={comment.name}/><span><b>{comment.name}</b><span>{comment.text}</span></span></button>)}</ReportBlock>}
    {error&&<p className="zy-molly-report-error" role="alert">{error}</p>}
    </ReportBody>
  </article>;
}
