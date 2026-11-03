import {existsSync,readFileSync,realpathSync,statSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,sep,resolve} from 'node:path';
import {createHash} from 'node:crypto';
export type IdentityReference={file:string;view:string;reviewed:boolean;source:string};
export type ImageIdentityPackage={version:1;characterId:string;appearance:string;references:IdentityReference[];missingViews:string[]};
const ids=new Set(['xia-xia','yuan-xiaoman','liu','chen-nian','he-jiawei','zhou-chef','molly']);
export function readImageIdentity(root:string,id:string):ImageIdentityPackage{
 if(!ids.has(id))throw Error('人物身份无效');const base=join(root,'npc-skills/assets',id,'identity');
 if(!realpathSync(base).startsWith(realpathSync(root)+sep))throw Error('身份参考越界');
 const value=JSON.parse(readFileSync(join(base,'manifest.json'),'utf8')) as ImageIdentityPackage;
 if(value.version!==1||value.characterId!==id||typeof value.appearance!=='string'||!Array.isArray(value.references)||!value.references.length)throw Error('人物身份包无效');
 value.references=value.references.filter(ref=>ref.reviewed===true&&typeof ref.file==='string'&&/^[a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|webp)$/.test(ref.file));
 if(!value.references.length)throw Error('没有已确认身份参考');
 for(const ref of value.references){const path=realpathSync(join(base,ref.file));if(!path.startsWith(realpathSync(base)+sep)||!statSync(path).isFile())throw Error('身份参考越界');}
 return value;
}
export const imageSceneKey=(prompt:string,withCharacter:boolean,references:readonly string[]=[])=>createHash('sha256').update(JSON.stringify({prompt,withCharacter,references})).digest('hex');
export function findReviewedLibraryImage(root:string,id:string,prompt:string,withCharacter:boolean):string|null{
 if(!ids.has(id))throw Error('人物素材库无效');if(prompt.length>1200)return null;
 const base=join(root,'npc-skills/assets',id,'library'),file=join(base,'manifest.json');if(!existsSync(file))return null;
 if(!realpathSync(base).startsWith(realpathSync(root)+sep))throw Error('素材参考越界');
 const value=JSON.parse(readFileSync(file,'utf8'));if(value.version!==1||value.characterId!==id||!Array.isArray(value.items))throw Error('素材清单无效');
 const season=prompt.match(/春天|夏天|秋天|冬天/)?.[0],slot=prompt.match(/早上|中午|下午|晚上|深夜/)?.[0];
 for(const item of value.items){
  if(item.reviewed!==true||!item.review||item.withCharacter!==withCharacter||!Array.isArray(item.matchAll)||!item.matchAll.length||!item.matchAll.every((tag:unknown)=>typeof tag==='string'&&tag.length>=2&&prompt.includes(tag)))continue;
  if(season&&(!Array.isArray(item.seasons)||!item.seasons.some((v:string)=>v==='any'||v===season)))continue;
  if(slot&&(!Array.isArray(item.timeSlots)||!item.timeSlots.some((v:string)=>v==='any'||v===slot)))continue;
  if(typeof item.file!=='string'||!/^[a-zA-Z0-9_-]+\.(?:png|jpg|webp|gif)$/.test(item.file))continue;
  try{const path=realpathSync(join(base,item.file));if(path.startsWith(realpathSync(base)+sep)&&statSync(path).isFile())return path;}catch{/* retain unavailable reference as a real gap */}
 }
 return null;
}
/** Private request scenes stay account-scoped, never copied into a public
 * source/library manifest. Only exact reviewed scenes are eligible for reuse. */
export function privateReviewedImage(root:string,owner:string,id:string,key:string):string|null{
 if(!/^[a-f0-9-]{36}$/.test(owner)||!ids.has(id)||!/^[a-f0-9]{64}$/.test(key))throw Error('私人素材索引无效');
 const file=join(root,'.npc-runtime/image-library',owner,id,key+'.json');if(!existsSync(file))return null;
 try{const item=JSON.parse(readFileSync(file,'utf8'));if(item.reviewed!==true||item.review?.method!=='vision-model'||typeof item.file!=='string'||!/^[a-f0-9-]{36}\.(?:png|jpg|webp|gif)$/.test(item.file))return null;const base=resolve(root,'.npc-runtime/uploads',owner),path=realpathSync(join(base,item.file));return path.startsWith(realpathSync(base)+sep)&&statSync(path).isFile()?path:null;}catch{return null;}
}
export function savePrivateImageReview(root:string,owner:string,id:string,key:string,file:string,reviewed:boolean,review:unknown){
 if(!/^[a-f0-9-]{36}$/.test(owner)||!ids.has(id)||!/^[a-f0-9]{64}$/.test(key)||!/^[a-f0-9-]{36}\.(?:png|jpg|webp|gif)$/.test(file))throw Error('私人素材审查索引无效');
 const base=join(root,'.npc-runtime/image-library',owner,id);mkdirSync(base,{recursive:true});writeFileSync(join(base,key+'.json'),JSON.stringify({version:1,characterId:id,file,reviewed,review,at:new Date().toISOString()}));
}
