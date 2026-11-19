export const CAPTION_CASE_ID='movie-ending-xiaoman-v1' as const;
export const CAPTION_CASE_TEXT='这个电影我说绝对是烂尾了，也不知道编剧是咋想的，骗我钱呢';
export const CAPTION_CASE_ELAPSED_MS=324000;
export const CAPTION_CASE_CLIP='/desktop-npc/video/xu-xiaoman/06-reply-happy.mp4';
export const CAPTION_CASE_TIME=7.25;
export const CAPTION_CASE_TTL=10*60*1000;
const pendingKey='zhiyu-caption-case-pending-v1';
const windowGateKey='zhiyu-caption-case-window-v1';
const accountKey=(accountId:string)=>`zhiyu-caption-case-v1:${accountId}`;
type Intent={version:1;id:typeof CAPTION_CASE_ID;accountId:string;createdAt:number;nonce:string};
export type CaptionCaseState={kind:'ready';intent:Intent}|{kind:'unavailable';reason:string};
const validAccount=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=160&&!Array.from(value).some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127);
function parse(value:string|null):Intent|null {
  if(!value)return null;
  try{const input=JSON.parse(value) as Intent;return input?.version===1&&input.id===CAPTION_CASE_ID&&validAccount(input.accountId)&&Number.isFinite(input.createdAt)&&typeof input.nonce==='string'&&input.nonce.length>0?input:null;}catch{return null;}
}
/** Short-lived, account-bound staging only; no conversation or model state is written. */
export function beginCaptionCase(accountId:string,now=Date.now()):void {
  if(typeof window==='undefined'||!validAccount(accountId)||!Number.isFinite(now))throw Error('案例画面暂时无法准备，请重试。');
  const intent:Intent={version:1,id:CAPTION_CASE_ID,accountId,createdAt:now,nonce:crypto.randomUUID()};
  try{localStorage.setItem(accountKey(accountId),JSON.stringify(intent));localStorage.setItem(pendingKey,JSON.stringify(intent));}
  catch{clearCaptionCase(accountId);throw Error('案例画面暂时无法准备，请重试。');}
}
/** A normal explicit video action clears stale case staging before opening. */
export function clearCaptionCase(accountId?:string):void {
  if(typeof window==='undefined')return;
  try{const pending=parse(localStorage.getItem(pendingKey));if(pending)localStorage.removeItem(accountKey(pending.accountId));localStorage.removeItem(pendingKey);if(validAccount(accountId))localStorage.removeItem(accountKey(accountId));}catch{/* Closing a case must remain possible when storage is unavailable. */}
  try{sessionStorage.removeItem(windowGateKey);}catch{/* The window can still close. */}
}
export function readCaptionCase(accountId:string,now=Date.now()):CaptionCaseState|null {
  if(typeof window==='undefined')return null;
  const marker=new URLSearchParams(window.location.search),marked=marker.has('captionCase');
  const unavailable:CaptionCaseState={kind:'unavailable',reason:'案例画面已失效，请退出后从设置重新打开。'};
  try{
    const raw=localStorage.getItem(pendingKey),pending=parse(raw);
    const windowMarked=sessionStorage.getItem(windowGateKey)===CAPTION_CASE_ID;
    if(!raw&&!marked&&!windowMarked)return null;
    if(marked&&marker.get('captionCase')!==CAPTION_CASE_ID)return unavailable;
    if(!pending||pending.accountId!==accountId||!Number.isFinite(now)||now<pending.createdAt||now-pending.createdAt>CAPTION_CASE_TTL)return unavailable;
    const owned=parse(localStorage.getItem(accountKey(accountId)));
    if(!owned||owned.nonce!==pending.nonce||owned.accountId!==accountId)return unavailable;
    return {kind:'ready',intent:owned};
  }catch{return unavailable;}
}
/** Retain a safe gate across reload/recovery, including an expired case intent. */
export function markCaptionCaseLocation():void {
  if(typeof window==='undefined')return;
  const target=new URL(window.location.href);target.searchParams.set('captionCase',CAPTION_CASE_ID);
  window.history.replaceState(window.history.state,'',target);
  try{sessionStorage.setItem(windowGateKey,CAPTION_CASE_ID);}catch{/* The visible URL retains its gate. */}
}
/** Release cross-window staging on native close. A surviving reload/recovery
 * keeps its browsing-context gate and can never fall into a live voice call. */
export function releaseCaptionCaseWindow(accountId:string,nonce?:string):void {
  if(typeof window==='undefined')return;
  // A closing older window must not remove a newer preview prepared while
  // its native close event was still queued, even for the same account.
  if(validAccount(accountId)&&nonce)try{
    const pending=parse(localStorage.getItem(pendingKey));
    if(pending?.accountId===accountId&&pending.nonce===nonce)localStorage.removeItem(pendingKey);
    const owned=parse(localStorage.getItem(accountKey(accountId)));
    if(owned?.accountId===accountId&&owned.nonce===nonce)localStorage.removeItem(accountKey(accountId));
  }catch{/* The window still remains safely in preview mode. */}
  try{sessionStorage.setItem(windowGateKey,CAPTION_CASE_ID);}catch{/* The case URL still fails closed. */}
}
