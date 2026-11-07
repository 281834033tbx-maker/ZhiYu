import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

// Execute the real component with synthetic DOM/canvas/clipboard objects only.
// No browser, Electron, storage, network, account or OS clipboard is used.
const file='app/zhiyu/moment-image-viewer.tsx';
const source=readFileSync(file,'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const jsx=(type,props,key)=>({type,props:props||{},key});
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'&&'props' in value?[value,...nodes(value.props.children)]:[];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness({images=['/synthetic/post-a.png','/synthetic/post-b.png','/synthetic/post-c.png'],start=0}={}) {
 const hooks=[],listeners=new Map(),effects=[],calls={close:0,show:0,dialogClose:0,clipboard:[],canvases:[],draws:[],postUnmountStateWrites:0};
 const controls={blobMode:'ok',blobError:null,contextAvailable:true,drawError:null,write:async()=>{}};
 let cursor=0,tree,picture,disposed=false,dirty=false;
 const effect=(callback,deps)=>{
  const slot=cursor++,previous=hooks[slot];
  if(!previous||deps.some((value,index)=>value!==previous.deps[index]))effects.push(()=>{previous?.cleanup?.();hooks[slot]={deps,cleanup:callback()};});
 };
 const react={
  useState:initial=>{const slot=cursor++;if(!(slot in hooks))hooks[slot]=typeof initial==='function'?initial():initial;return [hooks[slot],value=>{if(disposed)calls.postUnmountStateWrites++;const next=typeof value==='function'?value(hooks[slot]):value;if(next!==hooks[slot]){hooks[slot]=next;dirty=true;}}];},
  useRef:initial=>{const slot=cursor++;return hooks[slot]??(hooks[slot]={current:initial});},
  useCallback:(callback,deps)=>{const slot=cursor++,previous=hooks[slot];if(!previous||deps.some((value,index)=>value!==previous.deps[index]))hooks[slot]={deps,callback};return hooks[slot].callback;},
  useEffect:effect,useLayoutEffect:effect,
 };
 const fakeDialog={showModal:()=>calls.show++,close:()=>calls.dialogClose++};
 const document={body:{synthetic:true},
  addEventListener:(name,callback)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(callback);},
  removeEventListener:(name,callback)=>listeners.get(name)?.delete(callback),
  createElement:tag=>{
   assert.equal(tag,'canvas','copy may only create an in-memory canvas');
   const canvas={width:0,height:0,getContext:kind=>{
    assert.equal(kind,'2d');return controls.contextAvailable?{drawImage:(image,x,y)=>{if(controls.drawError)throw controls.drawError;calls.draws.push({image,x,y});}}:null;
   },toBlob:(callback,mime)=>{assert.equal(mime,'image/png');if(controls.blobError)throw controls.blobError;callback(controls.blobMode==='null'?null:new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'}));}};
   calls.canvases.push(canvas);return canvas;
  },
 };
 class ClipboardItem {constructor(data){this.data=data;}}
 const navigator={clipboard:{write:items=>{calls.clipboard.push(items);return controls.write(items);}}};
 const dependencies={react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-dom':{createPortal:(child,target)=>{assert.equal(target,document.body);return child;}},'lucide-react':new Proxy({},{get:(_,name)=>name}),'./moment-image-viewer.css':{}};
 const exports={};runInNewContext(compiled,{exports,require:name=>{assert.ok(name in dependencies,'Unexpected dependency: '+name);return dependencies[name];},document,navigator,ClipboardItem,Blob,DOMException,Error},{filename:file});
 const render=()=>{
  let loops=0;
  do{
   assert.ok(++loops<8,'effects must settle');dirty=false;cursor=0;tree=exports.default({images,start,close:()=>calls.close++});
   const all=nodes(tree),dialog=all.find(node=>node.type==='dialog'),img=all.find(node=>node.type==='img');
   if(dialog)dialog.props.ref.current=fakeDialog;
   if(img){if(picture?.key!==img.key)picture={key:img.key,src:img.props.src,naturalWidth:0,naturalHeight:0};img.props.ref.current=picture;}
   for(const callback of effects.splice(0))callback();
  }while(dirty);
  return tree;
 };
 const find=label=>nodes(tree).find(node=>node.props['aria-label']===label);
 const image=()=>nodes(tree).find(node=>node.type==='img');
 const load=(width=1280,height=720)=>{picture.naturalWidth=width;picture.naturalHeight=height;image().props.onLoad();render();};
 const key=(value,extra={})=>{
  let prevented=0;const event={key:value,altKey:false,ctrlKey:false,metaKey:false,preventDefault:()=>prevented++,...extra};
  for(const callback of listeners.get('keydown')||[])callback(event);render();return prevented;
 };
 const click=label=>{const node=find(label);assert.ok(node,'Missing '+label);node.props.onClick();render();};
 const dispose=()=>{for(const hook of hooks)hook?.cleanup?.();disposed=true;};
 render();return {render,find,image,load,key,click,dispose,calls,controls,navigator,nodes:()=>nodes(tree),picture:()=>picture};
}

const gallery=harness({start:1});
assert.equal(gallery.calls.show,1,'the real dialog is shown once');
assert.equal(gallery.image().props.src,'/synthetic/post-b.png','start selects the clicked image in this post');
assert.equal(gallery.image().props.crossOrigin,'anonymous');
assert.equal(gallery.find('复制图片').props.disabled,true,'copy is disabled before image load');
assert.equal(gallery.find('上一张').props.disabled,false);assert.equal(gallery.find('下一张').props.disabled,false);
const dots=gallery.nodes().filter(node=>/^查看第\d+张图片$/u.test(node.props['aria-label']||''));
assert.equal(dots.length,3,'dots represent this post only');assert.equal(dots.filter(node=>node.props['aria-pressed']).length,1);
gallery.click('上一张');assert.equal(gallery.find('上一张').props.disabled,true);assert.equal(gallery.image().props.src,'/synthetic/post-a.png');
gallery.click('上一张');assert.equal(gallery.image().props.src,'/synthetic/post-a.png','button update clamps at the first image');
assert.equal(gallery.key('ArrowLeft'),1);assert.equal(gallery.image().props.src,'/synthetic/post-a.png');
assert.equal(gallery.key('ArrowRight'),1);assert.equal(gallery.image().props.src,'/synthetic/post-b.png');
gallery.key('ArrowRight');assert.equal(gallery.image().props.src,'/synthetic/post-c.png');assert.equal(gallery.find('下一张').props.disabled,true);
gallery.key('ArrowRight');assert.equal(gallery.image().props.src,'/synthetic/post-c.png','keyboard clamps at the last image');
assert.equal(gallery.key('ArrowLeft',{ctrlKey:true}),0);assert.equal(gallery.image().props.src,'/synthetic/post-c.png','modified shortcuts do not navigate');
gallery.click('查看第1张图片');assert.equal(gallery.image().props.src,'/synthetic/post-a.png');assert.equal(gallery.find('查看第1张图片').props['aria-pressed'],true);
gallery.load();assert.equal(gallery.find('复制图片').props.disabled,false);
gallery.click('下一张');assert.equal(gallery.find('复制图片').props.disabled,true,'a new image must load before copying');
gallery.click('上一张');assert.equal(gallery.find('复制图片').props.disabled,true,'returning to a previous source must wait for its new image load');
gallery.load(1600,900);

let releaseClipboard;
gallery.controls.write=()=>new Promise(resolve=>{releaseClipboard=resolve;});
const copy=gallery.find('复制图片');copy.props.onClick();copy.props.onClick();gallery.render();
await tick();assert.equal(gallery.calls.clipboard.length,1,'a synchronous double click makes one clipboard write');
assert.equal(gallery.find('复制图片').props.disabled,true,'copy stays disabled while an operation is pending');
assert.equal(gallery.calls.canvases[0].width,1600);assert.equal(gallery.calls.canvases[0].height,900,'copy uses natural dimensions');
assert.equal(gallery.calls.draws[0].image,gallery.picture());assert.equal(gallery.calls.draws[0].x,0);assert.equal(gallery.calls.draws[0].y,0);
assert.equal(gallery.calls.clipboard[0][0].data['image/png'].type,'image/png','copy writes PNG bytes, never URL text');
releaseClipboard();await tick();gallery.render();
assert.equal(gallery.nodes().find(node=>node.type==='output').props.children,'图片已复制');assert.equal(gallery.find('复制图片').props.disabled,false);

gallery.controls.write=async()=>{throw Error('Synthetic clipboard refused');};gallery.click('复制图片');await tick();gallery.render();
assert.equal(gallery.nodes().find(node=>node.type==='output').props.children,'Synthetic clipboard refused','clipboard failure is visible and retry remains available');
assert.equal(gallery.find('复制图片').props.disabled,false);
gallery.controls.contextAvailable=false;gallery.click('复制图片');await tick();gallery.render();assert.equal(gallery.nodes().find(node=>node.type==='output').props.children,'图片读取失败，请重试');gallery.controls.contextAvailable=true;
gallery.controls.blobMode='null';gallery.click('复制图片');await tick();gallery.render();assert.equal(gallery.nodes().find(node=>node.type==='output').props.children,'图片转换失败，请重试');gallery.controls.blobMode='ok';
gallery.controls.drawError=new DOMException('Synthetic tainted canvas','SecurityError');gallery.click('复制图片');await tick();gallery.render();assert.equal(gallery.nodes().find(node=>node.type==='output').props.children,'这张图片不允许复制，请换一张重试');gallery.controls.drawError=null;
gallery.navigator.clipboard=null;gallery.click('复制图片');await tick();gallery.render();assert.equal(gallery.nodes().find(node=>node.type==='output').props.children,'当前环境暂不支持复制图片');

gallery.click('下一张');gallery.image().props.onError();gallery.render();
assert.equal(gallery.image().props.crossOrigin,undefined,'an anonymous load failure retries the same source for display only');
assert.equal(gallery.nodes().some(node=>node.props.role==='alert'),false,'the first anonymous failure is not a final display failure');
gallery.image().props.onError();gallery.render();assert.ok(gallery.nodes().some(node=>node.props.role==='alert'));assert.equal(gallery.find('复制图片').props.disabled,true);
gallery.click('下一张');gallery.click('上一张');gallery.load();
assert.equal(gallery.nodes().some(node=>node.props.role==='alert'),false,'a later successful load clears the same image failure');assert.equal(gallery.find('复制图片').props.disabled,false);
let prevented=0;gallery.nodes().find(node=>node.type==='dialog').props.onCancel({preventDefault:()=>prevented++});assert.equal(prevented,1);assert.equal(gallery.calls.close,1,'native dialog Escape/cancel delegates close to its owner');
gallery.click('关闭图片');assert.equal(gallery.calls.close,2);gallery.dispose();assert.equal(gallery.calls.dialogClose,1);assert.equal(gallery.key('ArrowRight'),0,'keyboard listeners are removed when the overlay closes');

const one=harness({images:['/synthetic/only-post.png'],start:99});assert.equal(one.image().props.src,'/synthetic/only-post.png');assert.equal(one.find('上一张'),undefined);assert.equal(one.find('下一张'),undefined);assert.equal(one.find('图片切换'),undefined,'single-image posts have no unrelated gallery controls');one.dispose();
const external=harness({images:['https://images.example.invalid/no-cors.png','/synthetic/local.png']});
const anonymousKey=external.image().key;external.image().props.onError();external.render();
assert.equal(external.image().props.src,'https://images.example.invalid/no-cors.png','display fallback never changes the image source or adds a proxy');
assert.notEqual(external.image().key,anonymousKey,'retry creates a fresh non-CORS image element');assert.equal(external.image().props.crossOrigin,undefined);
assert.equal(external.find('复制图片').props.disabled,true,'the display retry must load before copy is offered');
external.load();assert.equal(external.find('复制图片').props.disabled,false);
external.controls.blobError=new DOMException('Synthetic display-only image taints canvas','SecurityError');external.click('复制图片');await tick();external.render();
assert.equal(external.nodes().find(node=>node.type==='output').props.children,'这张图片不允许复制，请换一张重试');assert.equal(external.calls.clipboard.length,0,'display fallback never bypasses the canvas origin check');
external.click('下一张');assert.equal(external.image().props.crossOrigin,'anonymous','another source still starts with copy-capable anonymous loading');external.click('上一张');
assert.equal(external.image().props.crossOrigin,undefined,'returning to the same source does not repeat the anonymous attempt');
const displayKey=external.image().key;external.image().props.onError();external.render();assert.equal(external.image().key,displayKey);assert.ok(external.nodes().some(node=>node.props.role==='alert'),'a non-CORS retry failure is final, without an image reload loop');external.dispose();
const pending=harness();pending.load();let finishPending;pending.controls.write=()=>new Promise(resolve=>{finishPending=resolve;});pending.click('复制图片');await tick();pending.dispose();finishPending();await tick();assert.equal(pending.calls.postUnmountStateWrites,0,'a late clipboard result never updates an unmounted surface');
assert.ok(!source.includes('zhiyuDesktop')&&!source.includes('image-gallery'),'the Moments overlay cannot call the ordinary native viewer');
const ordinary=readFileSync('app/zhiyu/chat-image.tsx','utf8');assert.match(ordinary,/openImageViewer/);assert.ok(!ordinary.includes('moment-image-viewer'),'ordinary chat images retain their established viewer entry');
console.log('PASS: real Moments viewer post-scoped navigation/dots/boundaries, pre-load gating, one-shot CORS display retry with honest canvas copy failure, PNG clipboard success/errors/deduplication, Escape and cleanup; ordinary native viewer entry retained; synthetic only.');
