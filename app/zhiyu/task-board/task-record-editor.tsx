'use client';

import {useId, useLayoutEffect, useRef, useState, type SubmitEvent} from 'react';
import {FileUp, Plus, Trash2, X} from 'lucide-react';
import PressableIconButton from '../pressable-icon-button';
import {useAnchoredPopupPresence} from '../anchored-popup-motion';
import {categories, npcs, plans as originalPlans} from './config';
import {parseManualTaskRecord} from './manual-task-record';
import type {ManualTaskRecord, Plan, Step, Task, TaskBoardModel, TaskType} from './types';
import './task-record-editor.css';

export type CommitTaskRecord = (payload:unknown)=>Promise<{taskCount:number;planCount:number}>;
type StepDraft = {id:string;name:string;detail:string;durationText:string;timerSeconds:string};
type TaskDraft = {
  id:string;title:string;date:string;categoryId:string;npcId:string;type:TaskType;amount:string;note:string;
  steps:StepDraft[];current:string;target:string;perTime:string;unit:'ml'|'步'|'次';
};
const jsonPayload=(value:unknown):unknown=>JSON.parse(JSON.stringify(value));
const newId=(prefix:string)=>`${prefix}-${crypto.randomUUID()}`;
const stepDraft=(step?:Step):StepDraft=>({id:step?.id||newId('step'),name:step?.name||'',detail:step?.detail||'',durationText:step?.durationText||'',timerSeconds:step?.timerSeconds?String(step.timerSeconds):''});
const taskDraft=(date:string,task?:Task):TaskDraft=>({
  id:task?.id||newId('manual-task'),title:task?.title||'',date:task?.date||date,categoryId:task?.categoryId||categories[0].id,npcId:task?.npcId||'molly',type:task?.type||'single',amount:task?.amount||'',note:task?.note||'',
  steps:task?.steps?.map(step=>stepDraft(step))||[stepDraft()],current:String(task?.count?.current||0),target:String(task?.count?.target||1),perTime:String(task?.count?.perTime||1),unit:task?.count?.unit||'次',
});
function taskPayload(draft:TaskDraft,original:Task|undefined,model:TaskBoardModel):Task {
  const {source:_source,appendOrder:_appendOrder,manualRecord:_manualRecord,...existing}=original||{} as Task;
  const task:Task={...existing,id:draft.id,title:draft.title.trim(),date:draft.date,categoryId:draft.categoryId,npcId:draft.npcId,type:draft.type,amount:draft.amount.trim(),status:original?.status||'todo',order:original?.order??model.tasks.filter(item=>item.date===draft.date).length,note:draft.note.trim()||undefined};
  delete task.steps;delete task.count;
  if(draft.type==='steps')task.steps=draft.steps.map(step=>({
    ...original?.steps?.find(item=>item.id===step.id),id:step.id,name:step.name.trim(),detail:step.detail.trim(),done:original?.steps?.find(item=>item.id===step.id)?.done||false,
    durationText:step.durationText.trim()||undefined,timerSeconds:step.timerSeconds?Number(step.timerSeconds):undefined,
  }));
  if(draft.type==='count')task.count={current:Number(draft.current),target:Number(draft.target),perTime:Number(draft.perTime),unit:draft.unit};
  return task;
}

export default function TaskRecordEditor({model,onCommitRecord,onClose,initialTask,anchor}:{model:TaskBoardModel;onCommitRecord:CommitTaskRecord;onClose:()=>void;initialTask?:Task;anchor?:HTMLElement|null}) {
  const dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLElement|null>(anchor||null),titleId=useId();
  const date=model.page.selectedDate||model.today;
  const boardPlans=model.plans||(model.contentResetAt?[]:originalPlans);
  const [tab,setTab]=useState<'import'|'task'|'plan'>(initialTask?'task':'import');
  const [json,setJson]=useState('');
  const [preview,setPreview]=useState<ManualTaskRecord|null>(null);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [original,setOriginal]=useState<Task|undefined>(initialTask);
  const [draft,setDraft]=useState(()=>taskDraft(date,initialTask));
  const [planId,setPlanId]=useState(''),[planName,setPlanName]=useState(''),[planText,setPlanText]=useState(''),[planProgress,setPlanProgress]=useState('0');
  const present=useAnchoredPopupPresence(true,dialog,()=>anchor||opener.current);
  useLayoutEffect(()=>{
    if(!present)return;
    const node=dialog.current;if(!node)return;
    if(!opener.current)opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    if(!node.open)node.showModal();
    return()=>{node.close();if(opener.current?.isConnected)opener.current.focus({preventScroll:true});};
  },[present]);
  const changeTab=(value:typeof tab)=>{setTab(value);setError('');setNotice('');};
  const changeTask=(id:string)=>{const task=model.tasks.find(item=>item.id===id&&item.manualRecord);setOriginal(task);setDraft(taskDraft(date,task));setError('');setNotice('');};
  const changePlan=(id:string)=>{const plan=boardPlans.find(item=>item.id===id);setPlanId(id);setPlanName(plan?.name||'');setPlanText(plan?.progressText||'');setPlanProgress(String(Math.round((plan?.progress||0)*100)));setError('');setNotice('');};
  const patch=(patch:Partial<TaskDraft>)=>setDraft(previous=>({...previous,...patch}));
  const patchStep=(id:string,patch:Partial<StepDraft>)=>setDraft(previous=>({...previous,steps:previous.steps.map(step=>step.id===id?{...step,...patch}:step)}));
  async function commit(record:ManualTaskRecord) {
    setBusy(true);setError('');setNotice('');
    try {const result=await onCommitRecord(record);setNotice(`已保存 ${result.taskCount} 项安排、${result.planCount} 个计划`);setPreview(null);return true;}
    catch(cause){setError(cause instanceof Error?cause.message:'保存失败，请重试。');return false;}
    finally{setBusy(false);}
  }
  function previewImport() {
    setError('');setNotice('');setPreview(null);
    try{setPreview(parseManualTaskRecord(JSON.parse(json)));}
    catch(cause){setError(cause instanceof SyntaxError?'JSON 格式有误，请检查后重试。':cause instanceof Error?cause.message:'无法读取这份安排记录。');}
  }
  async function loadFile(file?:File) {
    if(!file)return;
    if(file.size>1024*1024){setError('文件需小于 1 MB。');return;}
    try{setJson(await file.text());setPreview(null);setError('');setNotice('');}
    catch{setError('文件读取失败，请重新选择。');}
  }
  async function saveTask(event:SubmitEvent<HTMLFormElement>) {
    event.preventDefault();setError('');
    try{
      const task=taskPayload(draft,original,model);
      const record=parseManualTaskRecord(jsonPayload({version:1,recordId:original?.manualRecord?.id,name:original?.manualRecord?.name||'手工安排',selectedDate:draft.date,tasks:[task],plans:[]}));
      await commit(record);
    }catch(cause){setError(cause instanceof Error?cause.message:'安排填写有误，请检查。');}
  }
  async function savePlan(event:SubmitEvent<HTMLFormElement>) {
    event.preventDefault();setError('');
    try{
      const previous=boardPlans.find(item=>item.id===planId);
      const plan:Plan={id:previous?.id||newId('manual-plan'),name:planName.trim(),color:previous?.color||categories[0].color,progress:Number(planProgress)/100,progressText:planText.trim()};
      const record=parseManualTaskRecord({version:1,name:'手工计划',selectedDate:date,tasks:[],plans:[plan]});
      if(await commit(record))setPlanId(plan.id);
    }catch(cause){setError(cause instanceof Error?cause.message:'计划填写有误，请检查。');}
  }
  if(!present)return null;
  return <dialog ref={dialog} className="zy-dialog zy-task-record-editor" aria-labelledby={titleId} onCancel={event=>{event.preventDefault();if(!busy)onClose();}} onPointerDown={event=>{if(busy||event.target!==event.currentTarget||event.button!==0)return;const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)onClose();}}>
    <header className="zy-tre-header"><h2 id={titleId}>管理安排</h2><PressableIconButton type="button" aria-label="关闭安排管理" disabled={busy} onClick={onClose}><X size={18}/></PressableIconButton></header>
    <nav className="zy-tre-tabs" aria-label="安排管理方式">{([{id:'import',label:'导入记录'},{id:'task',label:'手工安排'},{id:'plan',label:'长期计划'}] as const).map(item=><button type="button" key={item.id} disabled={busy} aria-pressed={tab===item.id} className={tab===item.id?'is-selected':''} onClick={()=>changeTab(item.id)}>{item.label}</button>)}</nav>
    <div className="zy-tre-body">
      {tab==='import'&&<section aria-label="导入安排记录"><p className="zy-tre-help">粘贴 JSON 或选择文件，先预览，再保存到安排页。</p><label className="zy-tre-file"><FileUp size={16}/><span>选择 JSON 文件</span><input type="file" accept=".json,application/json" disabled={busy} aria-label="选择安排 JSON 文件" onChange={event=>{void loadFile(event.target.files?.[0]);event.target.value='';}}/></label><label className="zy-tre-field"><span>安排记录 JSON</span><textarea rows={8} value={json} disabled={busy} spellCheck={false} onChange={event=>{setJson(event.target.value);setPreview(null);setError('');}} placeholder={'{"version":1,"name":"周六安排","selectedDate":"2026-11-14","tasks":[],"plans":[]}'}/></label><details className="zy-tre-format"><summary>查看导入格式</summary><pre>{JSON.stringify({version:1,name:'我的安排',selectedDate:date,tasks:[{id:'my-task-1',title:'整理房间',date,categoryId:'chores',npcId:'molly',type:'single',amount:'20 分钟',status:'todo',order:0}],plans:[]},null,2)}</pre><p>分类：{categories.map(item=>`${item.name} (${item.id})`).join('、')}。智友：{npcs.map(item=>`${item.name} (${item.id})`).join('、')}。</p></details><div className="zy-tre-actions"><button type="button" className="zy-tre-button" disabled={busy||!json.trim()} onClick={previewImport}>预览导入</button></div>
        {preview&&<section className="zy-tre-preview" aria-label="导入预览"><h3>{preview.name}</h3><p>{preview.selectedDate} · {preview.tasks.length} 项安排 · {preview.plans.length} 个计划</p>{preview.tasks.length>0&&<ul>{preview.tasks.map(task=><li key={task.id}><strong>{task.title}</strong><span>{task.date} · {npcs.find(item=>item.id===task.npcId)?.name} · {categories.find(item=>item.id===task.categoryId)?.name}</span></li>)}</ul>}{preview.plans.length>0&&<ul>{preview.plans.map(plan=><li key={plan.id}><strong>{plan.name}</strong><span>{plan.progressText} · {Math.round(plan.progress*100)}%</span></li>)}</ul>}<div className="zy-tre-actions"><button type="button" className="zy-tre-button is-primary" disabled={busy} onClick={()=>void commit(preview)}>{busy?'保存中…':'确认导入'}</button></div></section>}
      </section>}
      {tab==='task'&&<form onSubmit={event=>void saveTask(event)} aria-label="手工安排编辑"><label className="zy-tre-field"><span>新建或编辑</span><select disabled={busy} value={original?.id||''} onChange={event=>changeTask(event.target.value)}><option value="">新建安排</option>{model.tasks.filter(task=>task.manualRecord).map(task=><option key={task.id} value={task.id}>{task.date} · {task.title}</option>)}</select></label><div className="zy-tre-grid"><label className="zy-tre-field is-wide"><span>安排名称</span><input value={draft.title} required maxLength={160} disabled={busy} onChange={event=>patch({title:event.target.value})}/></label><label className="zy-tre-field"><span>日期</span><input type="date" required value={draft.date} disabled={busy} onChange={event=>patch({date:event.target.value})}/></label><label className="zy-tre-field"><span>安排类型</span><select value={draft.type} disabled={busy} onChange={event=>patch({type:event.target.value as TaskType})}><option value="single">单项安排</option><option value="steps">分步安排</option><option value="count">计数安排</option></select></label><label className="zy-tre-field"><span>分类</span><select value={draft.categoryId} disabled={busy} onChange={event=>patch({categoryId:event.target.value})}>{categories.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="zy-tre-field"><span>关联智友</span><select value={draft.npcId} disabled={busy} onChange={event=>patch({npcId:event.target.value})}>{npcs.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="zy-tre-field is-wide"><span>用量或时长</span><input value={draft.amount} maxLength={160} disabled={busy} onChange={event=>patch({amount:event.target.value})} placeholder="例如：20 分钟"/></label></div>
        {draft.type==='steps'&&<fieldset className="zy-tre-steps"><legend>安排步骤</legend>{draft.steps.map((step,index)=><div className="zy-tre-step" key={step.id}><div className="zy-tre-step-heading"><strong>第 {index+1} 步</strong><PressableIconButton type="button" aria-label={`删除第 ${index+1} 步`} disabled={busy||draft.steps.length===1} onClick={()=>patch({steps:draft.steps.filter(item=>item.id!==step.id)})}><Trash2 size={14}/></PressableIconButton></div><label className="zy-tre-field"><span>步骤名称</span><input value={step.name} required maxLength={160} disabled={busy} onChange={event=>patchStep(step.id,{name:event.target.value})}/></label><label className="zy-tre-field"><span>操作说明</span><textarea rows={2} value={step.detail} disabled={busy} onChange={event=>patchStep(step.id,{detail:event.target.value})}/></label><div className="zy-tre-grid"><label className="zy-tre-field"><span>时长说明</span><input value={step.durationText} disabled={busy} onChange={event=>patchStep(step.id,{durationText:event.target.value})} placeholder="例如：10 分钟"/></label><label className="zy-tre-field"><span>倒计时秒数（可选）</span><input type="number" min="1" max="86400" step="1" value={step.timerSeconds} disabled={busy} onChange={event=>patchStep(step.id,{timerSeconds:event.target.value})}/></label></div></div>)}<button type="button" className="zy-tre-button" disabled={busy||draft.steps.length>=50} onClick={()=>patch({steps:[...draft.steps,stepDraft()]})}><Plus size={14}/>添加步骤</button></fieldset>}
        {draft.type==='count'&&<div className="zy-tre-grid"><label className="zy-tre-field"><span>目标数量</span><input type="number" required min="1" step="any" value={draft.target} disabled={busy} onChange={event=>patch({target:event.target.value})}/></label><label className="zy-tre-field"><span>每次记录</span><input type="number" required min="0.01" step="any" value={draft.perTime} disabled={busy} onChange={event=>patch({perTime:event.target.value})}/></label><label className="zy-tre-field"><span>当前数量</span><input type="number" required min="0" step="any" value={draft.current} disabled={busy} onChange={event=>patch({current:event.target.value})}/></label><label className="zy-tre-field"><span>单位</span><select value={draft.unit} disabled={busy} onChange={event=>patch({unit:event.target.value as TaskDraft['unit']})}><option value="次">次</option><option value="ml">ml</option><option value="步">步</option></select></label></div>}
        <label className="zy-tre-field"><span>备注（可选）</span><textarea rows={2} value={draft.note} disabled={busy} onChange={event=>patch({note:event.target.value})}/></label><div className="zy-tre-actions"><button type="submit" className="zy-tre-button is-primary" disabled={busy}>{busy?'保存中…':original?'保存安排修改':'添加安排'}</button></div>
      </form>}
      {tab==='plan'&&<form onSubmit={event=>void savePlan(event)} aria-label="长期计划编辑"><label className="zy-tre-field"><span>新建或编辑</span><select value={planId} disabled={busy} onChange={event=>changePlan(event.target.value)}><option value="">新建长期计划</option>{boardPlans.map(plan=><option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label><label className="zy-tre-field"><span>计划名称</span><input value={planName} required maxLength={160} disabled={busy} onChange={event=>setPlanName(event.target.value)}/></label><label className="zy-tre-field"><span>进度说明</span><input value={planText} required maxLength={160} disabled={busy} onChange={event=>setPlanText(event.target.value)} placeholder="例如：第 2/12 周"/></label><label className="zy-tre-field"><span>已完成百分比</span><input type="number" required min="0" max="100" step="1" value={planProgress} disabled={busy} onChange={event=>setPlanProgress(event.target.value)}/></label><div className="zy-tre-actions"><button type="submit" className="zy-tre-button is-primary" disabled={busy}>{busy?'保存中…':planId?'保存计划修改':'添加长期计划'}</button></div></form>}
      {error&&<p className="zy-tre-error" role="alert">{error}</p>}{notice&&<output className="zy-tre-notice">{notice}</output>}
    </div>
  </dialog>;
}
