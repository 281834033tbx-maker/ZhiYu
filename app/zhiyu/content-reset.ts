import {contentResetStorageKey,validContentResetAt} from '../../lib/npc/content-reset';
import {createClearedTaskBoard,taskBoardStorageKey} from './task-board/data-source';

type BrowserStore=Pick<Storage,'getItem'|'setItem'|'removeItem'|'key'|'length'>;
export class ContentResetStorageError extends Error {
 constructor(){super('本机聊天和任务清理尚未完成，请重新打开智域再试。');this.name='ContentResetStorageError';}
}
export function needsAccountContentReset(accountId:string,at:unknown,storage:BrowserStore):at is number {
 if(!accountId||!validContentResetAt(at))return false;
 const applied=Number(storage.getItem(contentResetStorageKey(accountId))||0);
 return !validContentResetAt(applied)||applied<at;
}
function contentKey(key:string,accountId:string) {
 const encoded=encodeURIComponent(accountId);
 const exact=[`zhiyu-he-pre-ai-history:v1:${accountId}`,`zhiyu-chef-pre-ai-history:v1:${accountId}`,`zhiyu-chef-pre-ai-sources:v1:${accountId}`,`zhiyu-hidden-messages-v1:${encoded}`];
 const prefixes=[`zhiyu-local-character-chat:v1:${accountId}:`,`zhiyu-cleared-local-chat:${accountId}:`,`zhiyu-group-draft-v1:${encoded}:`,`zhiyu-group-last-read:${accountId}:`,`zhiyu:report-expanded-v1:${encoded}:`];
 return exact.includes(key)||prefixes.some(prefix=>key.startsWith(prefix))
  ||key===`zhiyu-task-completion-v1:${encoded}`||key.startsWith(`zhiyu-task-completion-v1:${encoded}:`)
  ||['molly','xia','yuan','liu','chen','chef','he'].some(id=>key===`zhiyu-${id}-last-read:${accountId}`);
}
function clearContentKeys(storage:BrowserStore,accountId:string){
 const keys=Array.from({length:storage.length},(_,index)=>storage.key(index));
 for(const key of keys)if(key&&contentKey(key,accountId))storage.removeItem(key);
}
/** Runs before authenticated children mount. Mark last, so partial failures retry
 * without claiming success; profile/preferences and other accounts stay intact. */
export function applyAccountContentReset(accountId:string,at:unknown,storage:BrowserStore,session?:BrowserStore,now=Date.now(),legacyOwned=false):boolean {
 try{
  if(!needsAccountContentReset(accountId,at,storage))return false;
  const key=`zhiyu-stitch-desktop-v2:${accountId}`,raw=storage.getItem(key);
  let previous:Record<string,unknown>={};
  if(raw){const parsed:unknown=JSON.parse(raw);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))previous=parsed as Record<string,unknown>;}
  // Keep profile, contact remarks, Moments and per-chat preferences, replacing
  // only message histories and unread state. This is not a factory reset.
  const next={...previous,version:2,messages:{liu:[]},posts:Array.isArray(previous.posts)?previous.posts:[],unread:{},markedUnread:[]};
  const legacyRaw=legacyOwned?storage.getItem('zhiyu-stitch-desktop-v2'):null;
  let legacy:Record<string,unknown>|undefined;
  if(legacyRaw){const value:unknown=JSON.parse(legacyRaw);if(value&&typeof value==='object'&&!Array.isArray(value))legacy={...value,version:2,messages:{liu:[]},unread:{},markedUnread:[]};}
  clearContentKeys(storage,accountId);if(session)clearContentKeys(session,accountId);
  storage.setItem(key,JSON.stringify(next));
  storage.setItem(taskBoardStorageKey(accountId),JSON.stringify(createClearedTaskBoard(at,now)));
  if(legacy){storage.setItem('zhiyu-stitch-desktop-v2',JSON.stringify(legacy));for(const id of ['molly','xia','yuan','liu','chen','chef','he'])storage.removeItem(`zhiyu-${id}-last-read`);}
  storage.setItem(contentResetStorageKey(accountId),String(at));
  return true;
 }catch{throw new ContentResetStorageError();}
}
