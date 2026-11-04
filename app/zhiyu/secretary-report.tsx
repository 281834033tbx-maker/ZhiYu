'use client';
import {useState} from 'react';
import Image from 'next/image';
import {Cloud,CloudRain,CloudSnow,Sun} from 'lucide-react';
import type {PublicSession} from '../../lib/npc/contracts';
import type {ReportCity,ReportDecision,ReportMetric,SecretaryReport} from '../../lib/npc/experience';
import {useAccount} from './auth-gate';
import {npcFetch} from './npc-fetch';
import './secretary-report.css';
export {DailyBriefCard,WeeklyReportCard} from './molly-report-cards';

const reportChoiceRequestIds=new Map<string,string>();
type OpenNpc=(id:string,quoteId?:string,prefill?:string)=>void;
const noRecord=(kind:SecretaryReport['kind'])=>kind==='monthly'?'本月没记录':'本周没记录';
async function secretaryRequest(accountId:string,body:Record<string,unknown>){
 const response=await npcFetch('/api/npc/secretary',{method:'POST',headers:{'Content-Type':'application/json','X-Zhiyu-Account':accountId},body:JSON.stringify(body)});
 const result=await response.json() as {city?:ReportCity;settings?:{city?:ReportCity};messageId?:string;text?:string};
 if(!response.ok)throw Error('秘书请求未完成');return result;
}
export function CityPicker({city,onSaved,onClose}:{city?:ReportCity;onSaved?:(city:ReportCity)=>void;onClose?:()=>void}){
 const {account}=useAccount(),[name,setName]=useState(city?.name||''),[candidate,setCandidate]=useState<ReportCity>(),[manual,setManual]=useState(!!city),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function locate(){
  if(busy)return;setBusy(true);setError('');
  try{
   let next:ReportCity|undefined;
   if(navigator.geolocation)try{
    const position=await new Promise<GeolocationPosition>((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,timeout:7000,maximumAge:300000}));
    next=(await secretaryRequest(account.id,{action:'locate-city',source:'geolocation',query:`${position.coords.longitude.toFixed(2)},${position.coords.latitude.toFixed(2)}`})).city;
   }catch{/* System permission is optional; IP is the next explicit-action fallback. */}
   if(!next)next=(await secretaryRequest(account.id,{action:'locate-city',source:'ip'})).city;
   if(next){setCandidate(next);setName(next.name);}else {setError('没定位到城市，请自己输入');setManual(true);}
  }catch{setError('没定位到城市，请自己输入');setManual(true);}finally{setBusy(false);}
 }
 async function save(value?:ReportCity){
  if(busy||!name.trim()&&!value)return;setBusy(true);setError('');
  try{
   const next=value||(await secretaryRequest(account.id,{action:'locate-city',source:'manual',query:name.trim()})).city;
   if(!next)throw Error('City missing');const result=await secretaryRequest(account.id,{action:'city',city:next});
   onSaved?.(result.settings?.city||next);onClose?.();
  }catch{setError('没保存上，再试一次');}finally{setBusy(false);}
 }
 return <div className="zy-report-city-picker">
  <div className="zy-report-city-actions"><button type="button" disabled={busy} onClick={()=>candidate?void save(candidate):void locate()}>{busy?'稍等一下':candidate?`用当前定位：${candidate.name}`:'用当前定位'}</button><button type="button" disabled={busy} onClick={()=>setManual(true)}>我自己输入</button></div>
  {manual&&<form onSubmit={event=>{event.preventDefault();void save();}}><label>我自己输入<input aria-label="早报城市" value={name} maxLength={40} placeholder="输入城市" disabled={busy} onChange={event=>{setName(event.target.value);setCandidate(undefined);}}/></label><button type="submit" disabled={busy||!name.trim()}>确定</button></form>}
  {error&&<p role="alert">{error}</p>}{onClose&&<button type="button" className="zy-report-city-close" onClick={onClose}>收起</button>}
 </div>;
}
export function CityRequest({text}:{text:string}){
 const [saved,setSaved]=useState<ReportCity>();
 return <section className="zy-secretary-report zy-report-city-request" aria-label="设置早报城市"><p>{text}</p>{saved?<p>早报城市：{saved.name}<button type="button" onClick={()=>setSaved(undefined)}>换城市</button></p>:<CityPicker onSaved={setSaved}/>}</section>;
}
function Completion({label,value,kind}:{label:string;value:ReportMetric|null;kind:SecretaryReport['kind']}){
 const percent=value?.planned?Math.round(value.completed/value.planned*100):0;
 return <div className="zy-report-completion"><div><span>{label}</span><span>{value?.planned?`${value.completed}/${value.planned} 次`:noRecord(kind)}</span></div>{!!value?.planned&&<progress max={100} value={percent} aria-label={`${label}完成${percent}%`}/>} {!!value?.missedDates.length&&<p>{value.missedDates.map(day=>`${Number(day.slice(5,7))}/${Number(day.slice(8))}`).join('、')}没完成</p>}</div>;
}
function Decisions({decisions,onOpenNpc}:{decisions:ReportDecision[];onOpenNpc?:OpenNpc}){
 const {account}=useAccount(),[busy,setBusy]=useState(''),[done,setDone]=useState<string[]>([]),[error,setError]=useState('');

 async function choose(decision:ReportDecision,index:number){
  if(busy||done.includes(decision.id))return;setBusy(decision.id);setError('');
  const key=account.id+':'+decision.id+':'+index;let turnId=reportChoiceRequestIds.get(key);if(!turnId){turnId=crypto.randomUUID();reportChoiceRequestIds.set(key,turnId);}
  try{const response=await npcFetch(`/api/npc/${decision.characterId}`,{method:'POST',headers:{'Content-Type':'application/json','X-Zhiyu-Account':account.id},body:JSON.stringify({action:'send',turnId,replyTo:decision.messageId,choice:{messageId:decision.messageId,index},text:decision.options[index]})});if(!response.ok){if(response.status===409){const current=await npcFetch(`/api/npc/${decision.characterId}?mode=normal`,{headers:{'X-Zhiyu-Account':account.id},cache:'no-store'});if(current.ok){const session=await current.json() as PublicSession;const message=session.messages?.find((item:{id:string})=>item.id===decision.messageId);if(message?.part?.type==='choice'&&message.part.selection){setDone(values=>[...values,decision.id]);onOpenNpc?.(decision.characterId);return;}}}throw Error('Choice not accepted');}setDone(values=>[...values,decision.id]);onOpenNpc?.(decision.characterId);}
  catch{setError('这项选择没送到，去原对话再试一下');}finally{setBusy('');}
 }
 return <section><h4>需要你拍板</h4>{decisions.map(row=><div className="zy-report-decision" key={row.id}><p>{row.text}</p><div>{row.options.map((option,index)=><button type="button" key={index} disabled={!!busy||done.includes(row.id)} onClick={()=>void choose(row,index)}>{option}</button>)}</div>{done.includes(row.id)&&<small>已选择</small>}</div>)}{error&&<p role="alert">{error}</p>}</section>;
}
export default function SecretaryReportCard({report,onOpenNpc}:{report:SecretaryReport;onOpenNpc?:OpenNpc}){
 const {account}=useAccount(),[changingCity,setChangingCity]=useState(false),[preferredCity,setPreferredCity]=useState<ReportCity>(),[busy,setBusy]=useState(''),[error,setError]=useState('');
 async function openTeam(id:string){
  if(!onOpenNpc||busy)return;setBusy(id);setError('');
  try{const receipt=await secretaryRequest(account.id,{action:'report-quote',reportId:report.id,characterId:id});if(!receipt.messageId)throw Error('Quote missing');onOpenNpc(id,receipt.messageId,receipt.text);}
  catch{setError('这条话暂时没接上，稍后再点一下');}finally{setBusy('');}
 }
 const missing=noRecord(report.kind),delta=report.weightKg!==null&&report.previousWeightKg!==null?Number((report.weightKg-report.previousWeightKg).toFixed(2)):null;
 const previousPeriod=report.kind==='monthly'?'上月':'上周';
 const waistDelta=report.waistCm!==null&&report.previousWaistCm!=null?Number((report.waistCm-report.previousWaistCm).toFixed(2)):null;
 const weekday=new Date(`${report.startDate}T12:00:00+08:00`).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',weekday:'short'});
 const WeatherIcon=/雪/.test(report.weather?.text||'')?CloudSnow:/雨/.test(report.weather?.text||'')?CloudRain:/晴/.test(report.weather?.text||'')?Sun:Cloud;
 const maxWeight=Math.max(1,...report.weeklyWeights.map(row=>row.weightKg||0));
 return <article className="zy-secretary-report" aria-label={report.title}>
  <header><div><h3>{report.title}{report.kind==='morning'?` ${weekday}`:''}</h3>{report.kind!=='morning'&&<p>{report.startDate} — {report.endDate}</p>}</div>{report.kind==='morning'&&<button type="button" onClick={()=>setChangingCity(value=>!value)}>{report.city?.name||'设置城市'} · 换城市</button>}</header>
  {changingCity&&<CityPicker city={preferredCity||report.city} onSaved={setPreferredCity} onClose={()=>setChangingCity(false)}/>}{preferredCity&&<p className="zy-report-note">之后的早报使用{preferredCity.name}</p>}
  {report.kind==='morning'?<>
   {report.weather&&<section className="zy-report-weather"><WeatherIcon size={24} aria-hidden="true"/><strong>{report.weather.min}–{report.weather.max}°</strong><div><span>{report.weather.text}</span><p>{report.weather.summary}</p><small>{report.weather.attribution}</small></div></section>}
   <section><h4>今天</h4>{report.agenda.length?<ul className="zy-report-agenda">{report.agenda.map(row=><li key={row.id}><time>{row.time||'—'}</time><div><span>{row.title}</span><small>{row.source}{row.completed?' · 已完成':''}</small></div></li>)}</ul>:<p>今天没安排，想做什么跟我说</p>}</section>
   {!!report.decisions.length&&<Decisions decisions={report.decisions} onOpenNpc={onOpenNpc}/>}
  </>:<>
   {report.kind==='monthly'&&<section className="zy-report-month-summary"><strong>{report.completionPercent===null?'—':`${report.completionPercent}%`}</strong><span>{report.completionPercent===null?missing:'整月计划完成'}</span></section>}
   <section className="zy-report-measurements"><div><h4>{report.kind==='monthly'?'月平均体重':'周平均体重'}</h4><strong>{report.weightKg===null?'—':report.weightKg}<small>{report.weightKg===null?'':'kg'}</small></strong><p>{report.weightKg===null?missing:delta===null?`${previousPeriod}没记录`:`比${previousPeriod} ${delta>0?'+':''}${delta} kg`}</p></div><div><h4>腰围</h4><strong>{report.waistCm===null?'—':report.waistCm}<small>{report.waistCm===null?'':'cm'}</small></strong><p>{report.waistCm===null?missing:waistDelta===null?`${previousPeriod}没记录`:`比${previousPeriod} ${waistDelta>0?'+':''}${waistDelta} cm`}</p></div></section>
   {report.kind==='monthly'&&<section><h4>每周平均体重</h4><div className="zy-report-weight-chart">{report.weeklyWeights.map((row,index)=><div key={row.startDate}><span>{row.weightKg===null?'—':row.weightKg}</span><div><i className={index===report.weeklyWeights.length-1?'is-last':''} style={{height:row.weightKg===null?'0%':`${Math.round(row.weightKg/maxWeight*100)}%`}}/></div><small>第{index+1}周</small></div>)}</div></section>}
   <section><Completion label="训练" value={report.training} kind={report.kind}/><Completion label="按计划吃饭" value={report.nutrition} kind={report.kind}/><Completion label="带饭" value={report.packedMeals} kind={report.kind}/>{report.kind==='monthly'&&<Completion label="做饭" value={report.cooking} kind={report.kind}/>}</section>
   {report.kind==='weekly'&&<section><h4>身体感受</h4><p>睡眠：{report.feelings.sleep||missing}</p><p>精力：{report.feelings.energy||missing}</p><p>酸痛：{report.feelings.soreness||missing}</p></section>}
   {report.kind==='monthly'&&<section><h4>本月拿下</h4>{report.milestones.length?report.milestones.map((line,index)=><p key={index}>{line}</p>):<p>{missing}</p>}</section>}
   <section><h4>{report.kind==='weekly'?'下周调整':'下月重点'}</h4>{(report.kind==='weekly'?report.adjustments:report.nextFocus).length?(report.kind==='weekly'?report.adjustments:report.nextFocus).map((line,index)=><p key={index}>{line}</p>):<p>{missing}</p>}</section>
   {!!report.team.length&&<section className="zy-report-team"><h4>团队的话{onOpenNpc?'（点一下直接回复）':''}</h4>{report.team.map(row=><button type="button" key={row.characterId} disabled={!onOpenNpc||!!busy} onClick={()=>void openTeam(row.characterId)}><Image src={row.avatar} alt={row.name} width={30} height={30} unoptimized/><span><b>{row.name}</b><span>{row.text}</span></span></button>)}</section>}
  </>}
  {report.partial&&<p className="zy-report-note">有些记录暂时没同步上，稍后再看</p>}{error&&<p role="alert">{error}</p>}
 </article>;
}
