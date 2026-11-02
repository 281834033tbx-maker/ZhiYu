import assert from 'node:assert/strict';
import ts from 'typescript';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
const dir=mkdtempSync(join(tmpdir(),'zhiyu-media-'));let server;
try {
 for(const folder of ['server/npc','lib/npc'])for(const name of readdirSync(folder).filter(n=>n.endsWith('.ts'))){
  const output=join(dir,folder,name.replace('.ts','.mjs'));mkdirSync(dirname(output),{recursive:true});
  const src=readFileSync(join(folder,name),'utf8').replace(/(from\s+['"])(\.[^'"]+)(['"])/g,'$1$2.mjs$3');
  writeFileSync(output,ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
 }
 for(const name of readdirSync('lib/npc').filter(n=>n.endsWith('.json')))writeFileSync(join(dir,'lib/npc',name+'.mjs'),'export default '+readFileSync(join('lib/npc',name),'utf8'));
 const load=path=>import(pathToFileURL(join(dir,'server/npc',path+'.mjs')));
 const {npcMedia,userPart,imageInputs,partInput}=await load('media');
 const {npcLocal}=await load('plugin'),{mollyLocal}=await load('molly-plugin'),{yuanLocal}=await load('yuan-plugin');
 const handlers=[];
 server=createServer((req,res)=>{const entry=handlers.find(([p])=>req.url.split('?')[0].startsWith(p));if(!entry){res.statusCode=404;res.end();return;}req.url=req.url.slice(entry[0].length)||'/';entry[1](req,res);});
 const fake={config:{root:dir},middlewares:{use:(...entry)=>handlers.push(entry)},httpServer:server};
 const deps={available:()=>false,generate:async()=>{throw Error('should not generate');}};
 for(const plugin of [npcMedia(),npcLocal(deps),mollyLocal(deps),yuanLocal(deps)])plugin.configureServer(fake);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const init=await fetch(origin+'/api/npc/xia-xia');const cookie=init.headers.get('set-cookie').split(';')[0],user=cookie.split('=')[1];
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhZkAAAAASUVORK5CYII=','base64');
 const req=(path,body,extra={})=>fetch(origin+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:origin,...extra},...(body?{body}: {})});
 const up=await req('/api/npc/media',png);assert.equal(up.status,200);const media=await up.json();
 assert.deepEqual(Buffer.from(await(await req(media.url)).arrayBuffer()),png);
 const alien=await fetch(origin+media.url,{headers:{Cookie:'zhiyu_npc='+crypto.randomUUID()}});assert.equal(alien.status,404);
 assert.equal((await req('/api/npc/media',Buffer.from('<svg onload="bad"/>'))).status,400);
 assert.equal((await req('/api/npc/media',png,{Origin:'http://evil.example'})).status,403);
 assert.equal(userPart(dir,user,{imageId:'../../etc/passwd'}),null);
 assert.equal(userPart(dir,user,{assetId:'cake'}),null);
 assert.equal((await req('/api/npc/media',Buffer.alloc(12*1024*1024+1))).status,413);
 console.log('PASS upload, retrieval, ownership isolation, file type, size, origin and traversal validation');
 for(const npc of ['xia-xia','molly','yuan-xiaoman']){
  const path='/api/npc/'+npc+'?mode=normal';const turnId=crypto.randomUUID();
  const send=async body=>{const r=await req(path,JSON.stringify({action:'send',...body}),{'Content-Type':'application/json'});assert.equal(r.status,200);return r.json();};
  const a=await send({imageId:media.imageId,text:'看看这张图',turnId});const saved=a.messages.at(-1);assert.equal(saved.part.type,'upload');assert.equal(saved.part.url,media.url);
  const duplicate=await send({imageId:media.imageId,text:'看看这张图',turnId});assert.equal(duplicate.messages.length,a.messages.length);
  const sticker=await send({assetId:'catHelp',text:'救救我',turnId:crypto.randomUUID(),replyTo:saved.id});assert.equal(sticker.messages.at(-1).part.type,'sticker');assert.match(partInput(sticker.messages.at(-1).part),/救救我.*\n.*help咪/);assert.equal(sticker.messages.at(-1).replyTo,saved.id);
  const fresh=await(await req(path)).json();assert.equal(fresh.messages.length,sticker.messages.length);
  assert.equal(imageInputs(dir,user,fresh.messages).length,1);
  assert.equal(imageInputs(dir,crypto.randomUUID(),fresh.messages).length,0);
  console.log('PASS '+npc+' picture/sticker persistence, caption, quote, idempotency and vision attachment ownership');
 }
 const src=readFileSync('app/zhiyu/chat-composer.tsx','utf8');
 const helper=src.slice(src.indexOf('export function shouldSendEnter'),src.indexOf('export default function'));
 writeFileSync(join(dir,'ime.mjs'),ts.transpileModule(helper,{compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText);
 const {shouldSendEnter}=await import(pathToFileURL(join(dir,'ime.mjs')));
 assert.equal(shouldSendEnter('Enter',false,true,13,0,1000),false);
 assert.equal(shouldSendEnter('Enter',false,false,229,0,1000),false);
 assert.equal(shouldSendEnter('Enter',false,false,13,980,1000),false);
 assert.equal(shouldSendEnter('Enter',false,false,13,500,1000),true);
 assert.equal(shouldSendEnter('Enter',true,false,13,0,1000),false);
 console.log('PASS IME composition, keyCode229, post-composition Enter, ordinary Enter and Shift+Enter');
}finally{if(server)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
