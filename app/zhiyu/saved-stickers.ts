export type SavedSticker={id:string;name:string;data:string};
function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open('zhiyu-saved-stickers',1);request.onupgradeneeded=()=>request.result.createObjectStore('images',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(Error('无法打开表情收藏'));});}
export async function listStickers():Promise<SavedSticker[]>{const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('images');const req=tx.objectStore('images').getAll();req.onsuccess=()=>resolve(req.result.reverse());req.onerror=()=>reject(Error('读取表情失败'));tx.oncomplete=()=>db.close();});}
export async function saveSticker(blob:Blob,name='收藏表情'){
 if(!['image/png','image/jpeg','image/webp','image/gif'].includes(blob.type)||blob.size>12*1024*1024)throw Error('请选择12MB以内的PNG、JPEG、WebP或GIF');
 const data=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(Error('图片读取失败'));r.readAsDataURL(blob);});
 const digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());const id=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
 const db=await database();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').put({id,name,data});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(Error('保存失败，本机存储可能已满'));};});window.dispatchEvent(new Event('zhiyu-stickers-changed'));
}
export async function removeSticker(id:string){const db=await database();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').delete(id);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(Error('移除失败'));};});window.dispatchEvent(new Event('zhiyu-stickers-changed'));}
