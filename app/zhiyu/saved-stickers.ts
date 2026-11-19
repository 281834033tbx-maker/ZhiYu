import {accountStorage,flushAccountStorage,getActiveAccountStorageIdentity,type StorageAccount} from './account-storage';

export type SavedSticker={id:string;name:string;data:string};
const cloudPrefix='zhiyu-saved-sticker-v1:';
function identity(){const account=getActiveAccountStorageIdentity();if(!account)throw Error('请先登录后打开表情收藏');return account;}
function assertCurrent(account:StorageAccount){if(getActiveAccountStorageIdentity()?.id!==account.id)throw Error('账号已变化，请重新打开表情收藏');}
/** Existing desktop collections remain intact. Invitation users never open the
 * old shared device database and cannot see another account's collection. */
function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open('zhiyu-saved-stickers',1);request.onupgradeneeded=()=>request.result.createObjectStore('images',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(Error('无法打开表情收藏'));});}
export async function listStickers():Promise<SavedSticker[]>{
 const account=identity();
 if(account.storageMode==='server'){
  const storage=accountStorage(account.id),items:SavedSticker[]=[];
  for(let index=0;index<storage.length;index++){const key=storage.key(index);if(!key?.startsWith(cloudPrefix))continue;
   try{const value=JSON.parse(storage.getItem(key)||'null') as SavedSticker|null;if(value&&typeof value.id==='string'&&typeof value.name==='string'&&typeof value.data==='string'&&/^data:image\/(png|jpeg|webp|gif);base64,/.test(value.data))items.push(value);}catch{/* A malformed collection entry must not hide the rest. */}
  }return items.reverse();
 }
 const db=await database();assertCurrent(account);return new Promise((resolve,reject)=>{const tx=db.transaction('images');const req=tx.objectStore('images').getAll();req.onsuccess=()=>resolve(req.result.reverse());req.onerror=()=>reject(Error('读取表情失败'));tx.oncomplete=()=>db.close();});
}
export async function saveSticker(blob:Blob,name='收藏表情'){
 const account=identity(),storage=accountStorage(account.id);
 if(!['image/png','image/jpeg','image/webp','image/gif'].includes(blob.type)||blob.size>12*1024*1024)throw Error('请选择12MB以内的PNG、JPEG、WebP或GIF');
 const data=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>{if(typeof r.result==='string')resolve(r.result);else reject(new Error('读取文件失败'));};r.onerror=()=>reject(Error('图片读取失败'));r.readAsDataURL(blob);});
 const digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());const id=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
 assertCurrent(account);
 if(account.storageMode==='server'){storage.setItem(cloudPrefix+id,JSON.stringify({id,name,data}));await flushAccountStorage(account.id);assertCurrent(account);}
 else{const db=await database();assertCurrent(account);await new Promise<void>((resolve,reject)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').put({id,name,data});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(Error('保存失败，本机存储可能已满'));};});}
 window.dispatchEvent(new Event('zhiyu-stickers-changed'));
}
export async function removeSticker(id:string){
 const account=identity();
 if(account.storageMode==='server'){accountStorage(account.id).removeItem(cloudPrefix+id);await flushAccountStorage(account.id);assertCurrent(account);}
 else{const db=await database();assertCurrent(account);await new Promise<void>((resolve,reject)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').delete(id);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(Error('移除失败'));};});}
 window.dispatchEvent(new Event('zhiyu-stickers-changed'));
}
