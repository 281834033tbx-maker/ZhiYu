'use client';

import {useCallback,useEffect,useImperativeHandle,useLayoutEffect,useMemo,useRef,useState,type Ref,type RefObject} from 'react';
import {ChevronDown,Delete,ArrowBigUp} from 'lucide-react';
import {loadPreviewPinyinDictionary,normalizePreviewPinyin,type PreviewPinyinCandidate,type PreviewPinyinDictionary} from './preview-pinyin';
import './mobile-preview-keyboard.css';

export const MOBILE_PREVIEW_KEYBOARD_HEIGHT=260;

/** Desktop phone previews need their own keys. Touch devices keep their OS IME. */
export function mobilePreviewKeyboardAvailable(){
 if(typeof window==='undefined')return false;
 const viewport=window.visualViewport;
 if(viewport&&window.innerHeight-viewport.height-viewport.offsetTop>80)return false;
 const agent=navigator.userAgent,phone=/Android|iPhone|iPad|iPod/i.test(agent),touchTablet=/Macintosh/i.test(agent)&&navigator.maxTouchPoints>1;
 if(phone||touchTablet)return false;
 const desktopShell=window.zhiyuDesktop?.mobilePreview===true||document.documentElement.dataset.zyMobileNative==='true';
 if(desktopShell)return true;
 return !(navigator.maxTouchPoints>0&&window.matchMedia('(pointer: coarse)').matches);
}

export function useMobilePreviewKeyboard({editorRef,enabled=true}:{editorRef:RefObject<HTMLTextAreaElement|null>;enabled?:boolean}){
 const [preview,setPreview]=useState(false),[requested,setRequested]=useState(false);
 const requestedRef=useRef(false);
 const show=useCallback(()=>{const available=mobilePreviewKeyboardAvailable();setPreview(available);if(available){requestedRef.current=true;setRequested(true);}},[]);
 const hide=useCallback(()=>{requestedRef.current=false;setRequested(false);},[]);
 const isRequested=useCallback(()=>requestedRef.current,[]);
 useEffect(()=>{
  const refresh=()=>{const available=mobilePreviewKeyboardAvailable();setPreview(available);if(!available)hide();};
  const focus=(event:FocusEvent)=>{const target=event.target;if(target===editorRef.current){show();return;}if(target instanceof Element&&target.closest('.zy-m-preview-keyboard,.zy-m-composer'))return;if(!editorRef.current?.disabled)hide();};
  const pointer=(event:PointerEvent)=>{const target=event.target;if(target===editorRef.current){show();return;}if(target instanceof Element&&target.closest('.zy-m-preview-keyboard,.zy-m-composer'))return;hide();};
  const escape=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape')hide();};
  const viewport=window.visualViewport;
  refresh();document.addEventListener('focusin',focus);document.addEventListener('pointerdown',pointer,true);document.addEventListener('keydown',escape);window.addEventListener('blur',hide);window.addEventListener('resize',refresh);viewport?.addEventListener('resize',refresh);
  return()=>{document.removeEventListener('focusin',focus);document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('keydown',escape);window.removeEventListener('blur',hide);window.removeEventListener('resize',refresh);viewport?.removeEventListener('resize',refresh);};
 },[editorRef,show,hide]);
 return {preview,open:preview&&requested&&enabled,height:preview&&requested&&enabled?MOBILE_PREVIEW_KEYBOARD_HEIGHT:0,show,hide,isRequested};
}

export type MobilePreviewKeyboardActions={commitPending:()=>boolean;handleKey:(event:KeyboardEvent)=>boolean};
type Props={onInsert:(text:string)=>boolean|void;onDelete:()=>void;onSend:()=>void;onClose:()=>void;composition:string;onCompositionChange:(text:string)=>void;actionsRef?:Ref<MobilePreviewKeyboardActions>;disabled?:boolean;canSend?:boolean};

export default function MobilePreviewKeyboard({onInsert,onDelete,onSend,onClose,composition,onCompositionChange,actionsRef,disabled=false,canSend=true}:Props){
 const [shift,setShift]=useState(false),[symbols,setSymbols]=useState(false),[english,setEnglish]=useState(false),[dictionary,setDictionary]=useState<PreviewPinyinDictionary|null>(null),[loadError,setLoadError]=useState(false),[retry,setRetry]=useState(0);
 const pending=useRef(composition);useLayoutEffect(()=>{pending.current=composition;},[composition]);
 useEffect(()=>{let active=true;void loadPreviewPinyinDictionary().then(result=>{if(active)setDictionary(result);},()=>{if(active)setLoadError(true);});return()=>{active=false;};},[retry]);
 const candidates=useMemo(()=>dictionary?.candidates(composition)||[],[dictionary,composition]);
 const changeComposition=(text:string)=>{pending.current=normalizePreviewPinyin(text);onCompositionChange(pending.current);};
 function choose(candidate:PreviewPinyinCandidate){if(onInsert(candidate.text)!==false)changeComposition(pending.current.slice(candidate.consumed));}
 function commitPending(){if(!pending.current)return true;const first=dictionary?.candidates(pending.current)[0];if(!first)return false;choose(first);return !pending.current;}
 const punctuation=(text:string)=>{if(!pending.current||commitPending())onInsert(text);};
 const erase=()=>{if(pending.current)changeComposition(pending.current.slice(0,-1));else onDelete();};
 function handleKey(event:KeyboardEvent){
  if(disabled||english||event.isComposing||event.key==='Process'||Reflect.get(event,'keyCode')===229||event.ctrlKey||event.metaKey||event.altKey)return false;
  if(/^[a-z]$/i.test(event.key)){changeComposition(pending.current+event.key);return true;}
  if(event.key==="'"&&pending.current){changeComposition(pending.current+"'");return true;}
  if(!pending.current)return false;
  if(event.key==='Backspace'){erase();return true;}
  if(event.key===' '){commitPending();return true;}
  if(/^[1-9]$/.test(event.key)){const candidate=dictionary?.candidates(pending.current)[Number(event.key)-1];if(candidate)choose(candidate);return true;}
  if(event.key===','||event.key==='.'){punctuation(event.key===','?'，':'。');return true;}
  return false;
 }
 useImperativeHandle(actionsRef,()=>({commitPending,handleKey}));
 const rows=symbols?['1234567890','-/:;()$&@"','.,?!\'']:['qwertyuiop','asdfghjkl','zxcvbnm'];
 const insert=(key:string)=>{if(!english&&!symbols){changeComposition(pending.current+key);return;}punctuation(shift&&!symbols?key.toUpperCase():key);if(shift&&!symbols)setShift(false);};
 const toggleLanguage=()=>{if(pending.current&&!commitPending())return;setEnglish(value=>!value);setShift(false);setSymbols(false);};
 return <section className="zy-m-preview-keyboard" aria-label="26键键盘" data-mobile-preview-keyboard data-input-mode={english?'english':'pinyin'} style={{height:MOBILE_PREVIEW_KEYBOARD_HEIGHT}} onPointerDown={event=>event.preventDefault()}>
  <div className="zy-m-preview-keyboard-tools"><button type="button" className="zy-m-preview-keyboard-language" aria-label={english?'切换中文拼音':'切换英文'} disabled={disabled} onClick={toggleLanguage}>{english?'EN':'中文'}</button><output aria-label="待选拼音" aria-live="polite">{composition||(!english?'拼音 · v 代表 ü':'English')}</output>{composition&&<button type="button" className="zy-m-preview-keyboard-clear" aria-label="清除待选拼音" disabled={disabled} onClick={()=>changeComposition('')}>清除</button>}<button type="button" aria-label="收起键盘" onClick={onClose}><ChevronDown size={20} strokeWidth={1.6}/></button></div>
  <div className="zy-m-preview-keyboard-candidates" aria-label="拼音候选词">
   {composition?candidates.length?candidates.map((candidate,index)=><button type="button" key={candidate.text+'-'+candidate.consumed} disabled={disabled} aria-label={`选择候选：${candidate.text}`} title={candidate.reading} onClick={()=>choose(candidate)}><span>{candidate.text}</span>{index===0&&<small>{candidate.reading}</small>}</button>):<output>{loadError?'词库载入失败':dictionary?'暂无候选，请修改拼音':'正在载入离线词库…'}</output>:<span>{english?'英文直接输入':'输入拼音后点击候选，空格选首词'}</span>}
   {loadError&&<button type="button" onClick={()=>{setLoadError(false);setRetry(value=>value+1);}}>重试词库</button>}
  </div>
  <div className="zy-m-preview-keyboard-rows">
   {rows.map((row,index)=><div className={`zy-m-preview-keyboard-row row-${index+1}${symbols?' is-symbols':''}`} key={index}>
    {index===2&&<button type="button" className="zy-m-preview-keyboard-function" aria-label={symbols?'切换字母键盘':english?shift?'切换小写':'切换大写':'拼音分隔符'} aria-pressed={shift&&!symbols&&english} disabled={disabled} onClick={()=>symbols?setSymbols(false):english?setShift(value=>!value):changeComposition(pending.current?pending.current+"'":'')}>{symbols?'ABC':english?<ArrowBigUp size={20} strokeWidth={1.6} fill={shift?'currentColor':'none'}/>:"分词 '"}</button>}
    {Array.from(row).map(key=><button type="button" className="zy-m-preview-keyboard-letter" key={key} aria-label={shift&&!symbols&&english?key.toUpperCase():key} disabled={disabled} onClick={()=>insert(key)}>{shift&&!symbols&&english?key.toUpperCase():key}</button>)}
    {index===2&&<button type="button" className="zy-m-preview-keyboard-function" aria-label="删除上一个字符" disabled={disabled} onClick={erase}><Delete size={22} strokeWidth={1.6}/></button>}
   </div>)}
   <div className="zy-m-preview-keyboard-row row-4"><button type="button" className="zy-m-preview-keyboard-function" disabled={disabled} aria-label={symbols?'切换字母键盘':'切换数字和符号'} onClick={()=>{setSymbols(value=>!value);setShift(false);}}>{symbols?'ABC':'123'}</button><button type="button" className="zy-m-preview-keyboard-letter is-punctuation" disabled={disabled} aria-label="逗号" onClick={()=>punctuation(english?',':'，')}>{english?',':'，'}</button><button type="button" className="zy-m-preview-keyboard-space" disabled={disabled||!!composition&&!candidates.length} aria-label={composition?'空格选词':'空格'} onClick={()=>pending.current?commitPending():onInsert(' ')}>{composition?'选词':'空格'}</button><button type="button" className="zy-m-preview-keyboard-letter is-punctuation" disabled={disabled} aria-label="句号" onClick={()=>punctuation(english?'.':'。')}>{english?'.':'。'}</button><button type="button" className="zy-m-preview-keyboard-send" disabled={disabled||(composition?!candidates.length:!canSend)} onClick={()=>pending.current?commitPending():onSend()}>{composition?'选词':'发送'}</button></div>
  </div>
 </section>;
}
