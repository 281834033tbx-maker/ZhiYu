'use client';

import {useCallback,useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft,Check,ChevronRight,ClipboardList} from 'lucide-react';
import {BETA_SURVEY_REMINDER,BETA_SURVEY_THANKS,betaSurveyQuestions,validateBetaSurveyAnswers,type BetaSurveyAnswer,type BetaSurveyAnswers,type BetaSurveyCard,type BetaSurveyDocument,type BetaSurveyQuestion,type BetaSurveyVersion} from '../../lib/npc/beta-surveys';
import './beta-surveys.css';

type Inbox={cards:BetaSurveyCard[];unread:number};
class SurveyClientError extends Error{constructor(message:string,public status:number){super(message);}}
async function request<T>(accountId:string,path='',method='GET',body?:unknown):Promise<T>{
  const response=await fetch(`/api/npc/beta-surveys${path}`,{method,credentials:'same-origin',cache:'no-store',headers:{'X-Zhiyu-Account':accountId,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json() as T&{error?:string};
  if(!response.ok)throw new SurveyClientError(data.error||'问卷暂时没保存上，请重试',response.status);return data;
}
const timestamp=(at:number)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(at);
const errorText=(error:unknown)=>error instanceof Error?error.message:'网络暂时不可用，请重试';
type InboxProps={accountId:string;visible?:boolean;container?:HTMLElement|null;onUnread?:(count:number)=>void};

/** Mount once with an account key. The cards are a server-owned Molly inbox
 * supplement, never entries in model dialogue or browser business storage. */
export default function BetaSurveyInbox(props:InboxProps){return <AccountSurveyInbox key={props.accountId} {...props}/>;}
export {BetaSurveyInbox};
function AccountSurveyInbox({accountId,visible=true,container,onUnread}:InboxProps){
  const [inbox,setInbox]=useState<Inbox>({cards:[],unread:0}),[open,setOpen]=useState<BetaSurveyVersion|null>(null),[error,setError]=useState('');
  const unreadCallback=useRef(onUnread),seenRequests=useRef(new Set<string>());
  useEffect(()=>{unreadCallback.current=onUnread;},[onUnread]);
  const apply=useCallback((value:Inbox)=>{setInbox(value);unreadCallback.current?.(value.unread);},[]);
  const refresh=useCallback(async()=>{const value=await request<Inbox>(accountId);apply(value);},[accountId,apply]);
  useEffect(()=>{
    let alive=true,working=false;
    const poll=async()=>{if(working)return;working=true;try{const value=await request<Inbox>(accountId);if(alive){apply(value);setError('');}}catch{if(alive)setError('问卷暂时无法读取');}finally{working=false;}};
    void poll();const timer=setInterval(()=>void poll(),15000);
    return()=>{alive=false;clearInterval(timer);unreadCallback.current?.(0);};
  },[accountId,apply]);
  useEffect(()=>{
    if(!visible||(container===null))return;
    let alive=true;
    for(const card of inbox.cards){
      const through=Math.max(card.receivedAt,card.remindedAt||0,card.submittedAt||0),key=`${card.version}:${through}`;
      if(through<=(card.seenAt||0)||seenRequests.current.has(key))continue;
      seenRequests.current.add(key);
      void request<Inbox>(accountId,`/${card.version}/seen`,'POST',{through}).then(value=>{if(alive)apply(value);}).catch(()=>{seenRequests.current.delete(key);});
    }
    return()=>{alive=false;};
  },[accountId,inbox.cards,visible,container,apply]);
  const cards=<div className="zy-beta-survey-inbox" data-beta-survey-inbox="true">{inbox.cards.map(card=><article className="zy-beta-survey-message" key={card.version} data-beta-survey-version={card.version}>
    <time dateTime={new Date(card.receivedAt).toISOString()}>{timestamp(card.receivedAt)}</time>
    {card.opener.map(text=><p className="xx-bubble zy-beta-survey-copy" key={text}>{text}</p>)}
    <button type="button" className="xx-bubble zy-beta-survey-card" onClick={()=>setOpen(card.version)} aria-label={`${card.title}，问卷${card.version}${card.submittedAt?'，已填写':''}`}>
      <span className="zy-beta-survey-card-icon"><ClipboardList size={23} strokeWidth={1.6}/></span>
      <span><strong>{card.title}</strong><small>{card.durationLabel}{card.submittedAt?' · 已填写':card.hasDraft?' · 已保存进度':''}</small></span><ChevronRight size={18}/>
    </button>
    {card.remindedAt&&<><time dateTime={new Date(card.remindedAt).toISOString()}>{timestamp(card.remindedAt)}</time>{BETA_SURVEY_REMINDER.map(text=><p className="xx-bubble zy-beta-survey-copy" key={text}>{text}</p>)}</>}
    {card.submittedAt&&<><time dateTime={new Date(card.submittedAt).toISOString()}>{timestamp(card.submittedAt)}</time><p className="xx-bubble zy-beta-survey-copy">{BETA_SURVEY_THANKS}</p></>}
  </article>)}{error&&!!inbox.cards.length&&<output className="zy-beta-survey-inbox-error">{error}</output>}</div>;
  return <>{visible&&(container?createPortal(cards,container):container===undefined?cards:null)}{open&&<BetaSurveyForm accountId={accountId} version={open} onClose={()=>setOpen(null)} onSubmitted={()=>void refresh()}/>}</>;
}

function BetaSurveyForm({accountId,version,onClose,onSubmitted}:{accountId:string;version:BetaSurveyVersion;onClose:()=>void;onSubmitted:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),back=useRef<HTMLButtonElement>(null),alive=useRef(true);
  const [loaded,setLoaded]=useState(false),[answers,setAnswers]=useState<BetaSurveyAnswers>({}),[submittedAt,setSubmittedAt]=useState<number|undefined>(),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[errors,setErrors]=useState<Record<string,string>>({}),[savedSignature,setSavedSignature]=useState('{}'),[hasConflict,setHasConflict]=useState(false);
  const latest=useRef<BetaSurveyAnswers>({}),revision=useRef(0),saved=useRef('{}'),queue=useRef<Promise<void>>(Promise.resolve()),conflict=useRef(false),submitting=useRef(false),saveCount=useRef(0),submitted=useRef(false);
  useLayoutEffect(()=>{alive.current=true;const element=dialog.current;element?.showModal();back.current?.focus();return()=>{alive.current=false;element?.close();};},[]);
  const load=useCallback(async()=>{
    try{const value=await request<BetaSurveyDocument>(accountId,`/${version}`);if(!alive.current)return;setError('');
      latest.current=value.answers;revision.current=value.revision;saved.current=JSON.stringify(value.answers);conflict.current=false;submitted.current=!!value.submittedAt;
      setAnswers(value.answers);setSubmittedAt(value.submittedAt);setSavedSignature(JSON.stringify(value.answers));setHasConflict(false);setLoaded(true);
    }catch(reason){if(alive.current)setError(errorText(reason));}
  },[accountId,version]);
  useEffect(()=>{let cancelled=false;queueMicrotask(()=>{if(!cancelled)void load();});return()=>{cancelled=true;};},[load]);
  const persist=useCallback(()=>{
    const work=async()=>{
      if(submitted.current)return;
      if(conflict.current)throw new SurveyClientError('问卷已在其他页面更新，请重新加载已保存答案',409);
      const snapshot=latest.current,signature=JSON.stringify(snapshot);if(signature===saved.current)return;
      saveCount.current++;if(alive.current)setSaving(true);
      try{const receipt=await request<BetaSurveyDocument>(accountId,`/${version}`,'PUT',{answers:snapshot,revision:revision.current});revision.current=receipt.revision;saved.current=signature;if(alive.current)setSavedSignature(signature);}
      catch(reason){if(reason instanceof SurveyClientError&&reason.status===409){conflict.current=true;if(alive.current)setHasConflict(true);}throw reason;}
      finally{saveCount.current--;if(alive.current)setSaving(saveCount.current>0);}
    };
    const result=queue.current.then(work);queue.current=result.catch(()=>{});return result;
  },[accountId,version]);
  useEffect(()=>{
    if(!loaded||submittedAt||submitting.current||JSON.stringify(answers)===saved.current)return;
    const timer=setTimeout(()=>void persist().catch(reason=>{if(alive.current)setError(errorText(reason));}),350);
    return()=>clearTimeout(timer);
  },[answers,loaded,submittedAt,persist]);
  useEffect(()=>{
    if(!loaded||submittedAt||JSON.stringify(answers)===savedSignature)return;
    // Closing the in-app form awaits persistence. A tab refresh/close must not
    // silently discard a pending network save during the autosave debounce.
    const guard=(event:BeforeUnloadEvent)=>event.preventDefault();
    window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);
  },[answers,loaded,savedSignature,submittedAt]);
  const edit=(id:string,value:BetaSurveyAnswer)=>{const next={...latest.current,[id]:value};latest.current=next;setAnswers(next);setError('');setErrors(current=>{const copy={...current};delete copy[id];return copy;});};
  async function close(){
    if(busy||submitting.current)return;
    setBusy(true);try{if(loaded&&!submitted.current)await persist();onClose();}catch(reason){setError(errorText(reason));}finally{if(alive.current)setBusy(false);}
  }
  async function submit(event:{preventDefault:()=>void}){
    event.preventDefault();if(!loaded||submitting.current||submitted.current)return;
    const validation=validateBetaSurveyAnswers(version,latest.current,true);setErrors(validation.errors);
    const first=Object.keys(validation.errors)[0];if(first){dialog.current?.querySelector(`[data-question-id="${first}"]`)?.scrollIntoView({block:'center',behavior:'smooth'});return;}
    submitting.current=true;setBusy(true);setError('');
    try{await persist();const receipt=await request<BetaSurveyDocument>(accountId,`/${version}/submit`,'POST',{answers:latest.current,revision:revision.current});
      revision.current=receipt.revision;saved.current=JSON.stringify(receipt.answers);submitted.current=true;if(alive.current){setSubmittedAt(receipt.submittedAt);setAnswers(receipt.answers);setSavedSignature(JSON.stringify(receipt.answers));}onSubmitted();
    }catch(reason){if(reason instanceof SurveyClientError&&reason.status===409){conflict.current=true;if(alive.current)setHasConflict(true);}if(alive.current)setError(errorText(reason));}
    finally{submitting.current=false;if(alive.current)setBusy(false);}
  }
  if(typeof document==='undefined')return null;
  return createPortal(<dialog ref={dialog} className="zy-beta-survey-dialog" aria-labelledby="zy-beta-survey-title" onCancel={event=>{event.preventDefault();void close();}}>
    <header><button ref={back} type="button" className="zy-beta-survey-back" aria-label="保存并退出问卷" disabled={busy} onClick={()=>void close()}><ArrowLeft size={22}/></button><div><h1 id="zy-beta-survey-title">智域内测问卷</h1><p>{submittedAt?'已提交，感谢你的反馈':'大约 3 分钟 · 你的回答会直接保存'}</p></div><output className="zy-beta-survey-save">{submittedAt?<><Check size={14}/>已提交</>:saving?'正在保存…':loaded&&JSON.stringify(answers)===savedSignature?'已保存':''}</output></header>
    {!loaded?<div className="zy-beta-survey-loading">{error?<><p role="alert">{error}</p><button type="button" onClick={()=>void load()}>重新加载</button></>:'正在打开问卷…'}</div>:<form onSubmit={event=>void submit(event)}>
      {submittedAt&&<p className="zy-beta-survey-thanks">{BETA_SURVEY_THANKS}</p>}
      {betaSurveyQuestions(version).map((question,index)=><SurveyQuestion key={question.id} question={question} index={index} value={answers[question.id]} disabled={busy||!!submittedAt} error={errors[question.id]} onChange={value=>edit(question.id,value)}/>)}
      {error&&<div className="zy-beta-survey-form-error" role="alert"><p>{error}</p>{hasConflict&&<button type="button" onClick={()=>void load()}>重新加载已保存答案</button>}</div>}
      <footer>{submittedAt?<button type="button" onClick={()=>void close()}>返回聊天</button>:<><p>中途退出后，可以从卡片继续填写。</p><button type="submit" disabled={busy}>{busy?'正在保存…':'提交问卷'}</button></>}</footer>
    </form>}
  </dialog>,document.body);
}
export function SurveyQuestion({question,index,value,disabled,error,onChange}:{question:BetaSurveyQuestion;index:number;value:BetaSurveyAnswer|undefined;disabled:boolean;error?:string;onChange:(value:BetaSurveyAnswer)=>void}){
  const id=`beta-survey-${question.id}`,label=<>{index+1}. {question.label}{question.optional&&<small>（选填）</small>}</>;
  let content:ReactNode;
  if(question.kind==='text')content=<><textarea id={id} rows={question.contact?2:3} value={typeof value==='string'?value:''} maxLength={question.maxLength} disabled={disabled} onChange={event=>onChange(event.target.value)} aria-invalid={!!error} aria-describedby={question.hint?`${id}-hint`:undefined}/>{question.hint&&<p className="zy-beta-survey-hint" id={`${id}-hint`}>{question.hint}</p>}</>;
  else if(question.kind==='score'){
    const selected=typeof value==='number';
    content=<div className="zy-beta-survey-score"><output>{selected?`${value} 分`:'请选择 0–10 分'}</output><input id={id} type="range" min={0} max={10} step={1} value={selected?value:5} disabled={disabled} onChange={event=>onChange(Number(event.target.value))} onPointerUp={event=>{if(!selected)onChange(Number(event.currentTarget.value));}} aria-valuetext={selected?`${value} 分`:'尚未选择'} aria-invalid={!!error}/><div><span>0 分 · 完全不可能</span><span>10 分 · 非常可能</span></div><div className="zy-beta-survey-score-choices">{Array.from({length:11},(_,score)=><button type="button" aria-label={`选择 ${score} 分`} aria-pressed={value===score} disabled={disabled} key={score} onClick={()=>onChange(score)}>{score}</button>)}</div></div>;
  }else content=<div className="zy-beta-survey-options">{question.options?.map(option=>{
    const checked=question.kind==='single'?value===option.value:Array.isArray(value)&&value.includes(option.value);
    return <label key={option.value} className={checked?'is-checked':''}><input type={question.kind==='single'?'radio':'checkbox'} name={id} value={option.value} checked={checked} disabled={disabled} onChange={()=>onChange(question.kind==='single'?option.value:checked?(Array.isArray(value)?value:[]).filter(item=>item!==option.value):[...(Array.isArray(value)?value:[]),option.value])}/><span>{option.label}</span></label>;
  })}</div>;
  return <fieldset className="zy-beta-survey-question" data-question-id={question.id} aria-invalid={!!error}><legend>{label}</legend>{content}{error&&<p className="zy-beta-survey-field-error" role="alert">{error}</p>}</fieldset>;
}
