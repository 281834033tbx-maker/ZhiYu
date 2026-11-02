'use client';
/* eslint-disable next/no-img-element -- This viewer must display the exact original media. */
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Grid3X3,Download,MoreHorizontal,Pin,Copy,Forward,Heart,X,Minus,Maximize2} from 'lucide-react';
import {useAccount} from '../zhiyu/auth-gate';
import {molly,people} from '../zhiyu/data';
import {appendLocalCharacterMessage,localCharacterIds} from '../zhiyu/local-character-chat';
import {npcFetch} from '../zhiyu/npc-fetch';
import {saveSticker} from '../zhiyu/saved-stickers';
import type {ImageViewerState} from '../zhiyu/desktop-bridge';
import './image-viewer.css';

export default function ImageViewerClient() {
  const {account}=useAccount();
  const [state,setState]=useState<ImageViewerState|null>(null);
  const [loaded,setLoaded]=useState(''),[failed,setFailed]=useState('');
  const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [menu,setMenu]=useState(false),[forward,setForward]=useState(false);
  const [search,setSearch]=useState(''),[target,setTarget]=useState('');
  const [reload,setReload]=useState(0);
  const [nativeMac]=useState(()=>typeof window!=='undefined'&&window.zhiyuDesktop?.platform==='darwin');
  const [desktop]=useState(()=>typeof window!=='undefined'&&!!window.zhiyuDesktop?.getImageViewer);
  const stage=useRef<HTMLDivElement>(null),image=useRef<HTMLImageElement>(null);
  const menuRef=useRef<HTMLDivElement>(null),menuButton=useRef<HTMLButtonElement>(null);
  const forwardDialog=useRef<HTMLDialogElement>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const locked=useRef(false),alive=useRef(true);
  const transform=useRef({scale:1,x:0,y:0,width:0,height:0});
  const latest=useRef(state);
  useLayoutEffect(()=>{latest.current=state;},[state]);
  const forwardRetry=useRef<{key:string;turnId:string;imageId?:string} | null>(null);
  const current=state?.images[state.index];
  const hasImages=state!==null;
  const say=useCallback((message:string)=>{
    setNotice(message);if(timer.current)clearTimeout(timer.current);
    timer.current=setTimeout(()=>setNotice(''),4500);
  },[]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(timer.current)clearTimeout(timer.current);};},[]);
  useEffect(()=>{
    let active=true;
    const bridge=window.zhiyuDesktop;
    if(bridge?.getImageViewer){
      let updated=false;
      const unsubscribe=bridge.onImageViewerState(next=>{updated=true;if(active)setState(next);});
      void bridge.getImageViewer().then(next=>{if(active&&!updated)setState(next);}).catch(()=>say('无法读取图片，请重新打开'));
      return()=>{active=false;unsubscribe();};
    }
    const key=new URLSearchParams(location.search).get('key');
    if(!key)return;
    try{const raw=localStorage.getItem(`zhiyu-image-popup:${key}`);localStorage.removeItem(`zhiyu-image-popup:${key}`);
      if(raw){const snapshot=JSON.parse(raw) as ImageViewerState;queueMicrotask(()=>{if(active)setState(snapshot);});}
    }catch{queueMicrotask(()=>{if(active)say('无法读取图片，请重新打开');});}
  },[say]);
  const select=useCallback((index:number)=>{
    const currentState=latest.current;
    if(!currentState||locked.current||index<0||index>=currentState.images.length)return;
    setMenu(false);setNotice('');setFailed('');
    if(window.zhiyuDesktop?.selectViewerImage)void window.zhiyuDesktop.selectViewerImage(index);
    else setState({...currentState,index});
  },[]);
  const control=useCallback((action:'close'|'minimize'|'maximize')=>{
    if(window.zhiyuDesktop?.imageWindowControl)void window.zhiyuDesktop.imageWindowControl(action);
    else if(action==='close')window.close();
    else if(action==='maximize')void (document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()).catch(()=>say('浏览器无法进入全屏'));
  },[say]);
  function paint() {
    const box=stage.current,img=image.current,value=transform.current;if(!box||!img)return;
    const maxX=Math.max(0,(value.width*value.scale-box.clientWidth)/2);
    const maxY=Math.max(0,(value.height*value.scale-box.clientHeight)/2);
    value.x=Math.max(-maxX,Math.min(maxX,value.x));value.y=Math.max(-maxY,Math.min(maxY,value.y));
    img.style.transform=`translate(-50%,-50%) translate(${value.x}px,${value.y}px) scale(${value.scale})`;
    box.dataset.zoomed=String(value.scale>1.001);
  }
  function layout() {
    const box=stage.current,img=image.current;if(!box||!img||!img.naturalWidth)return;
    const base=Math.min(box.clientWidth/img.naturalWidth,box.clientHeight/img.naturalHeight);
    transform.current.width=img.naturalWidth*base;transform.current.height=img.naturalHeight*base;
    img.style.width=`${transform.current.width}px`;img.style.height=`${transform.current.height}px`;paint();
  }
  function zoom(factor:number,clientX?:number,clientY?:number) {
    const box=stage.current;if(!box||!image.current?.naturalWidth)return;
    const value=transform.current,rect=box.getBoundingClientRect();
    const next=Math.max(.1,Math.min(8,value.scale*factor)),ratio=next/value.scale;
    const anchorX=(clientX??rect.left+rect.width/2)-rect.left-rect.width/2;
    const anchorY=(clientY??rect.top+rect.height/2)-rect.top-rect.height/2;
    value.x=anchorX-(anchorX-value.x)*ratio;value.y=anchorY-(anchorY-value.y)*ratio;
    value.scale=next;paint();
  }
  useLayoutEffect(()=>{
    transform.current={scale:1,x:0,y:0,width:0,height:0};
  },[current?.id]);
  useEffect(()=>{
    const box=stage.current;if(!box)return;
    const observer=new ResizeObserver(layout);observer.observe(box);
    const wheel=(event:WheelEvent)=>{event.preventDefault();if(locked.current)return;
      const delta=event.deltaY*(event.deltaMode===1?20:event.deltaMode===2?box.clientHeight:1);
      zoom(Math.exp(-Math.max(-200,Math.min(200,delta))*(event.ctrlKey ? .01 : .002)),event.clientX,event.clientY);};
    let gestureScale=1;
    const gestureStart=(event:Event)=>{event.preventDefault();gestureScale=1;};
    const gestureChange=(event:Event)=>{event.preventDefault();const scale=(event as Event & {scale:number}).scale;
      if(scale>0){zoom(scale/gestureScale);gestureScale=scale;}};
    const pointers=new Map<number,{x:number;y:number}>();
    const distance=()=>{const [a,b]=[...pointers.values()];return a&&b?Math.hypot(a.x-b.x,a.y-b.y):0;};
    const down=(event:PointerEvent)=>{if(event.button!==0||locked.current)return;box.setPointerCapture(event.pointerId);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});};
    const move=(event:PointerEvent)=>{
      const previous=pointers.get(event.pointerId);if(!previous)return;
      const oldDistance=distance();pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(pointers.size===2&&oldDistance>0){const points=[...pointers.values()];zoom(distance()/oldDistance,(points[0].x+points[1].x)/2,(points[0].y+points[1].y)/2);}
      else{transform.current.x+=event.clientX-previous.x;transform.current.y+=event.clientY-previous.y;paint();}
    };
    const up=(event:PointerEvent)=>pointers.delete(event.pointerId);
    box.addEventListener('wheel',wheel,{passive:false});box.addEventListener('gesturestart',gestureStart,{passive:false});box.addEventListener('gesturechange',gestureChange,{passive:false});
    box.addEventListener('pointerdown',down);box.addEventListener('pointermove',move);box.addEventListener('pointerup',up);box.addEventListener('pointercancel',up);
    return()=>{observer.disconnect();box.removeEventListener('wheel',wheel);box.removeEventListener('gesturestart',gestureStart);box.removeEventListener('gesturechange',gestureChange);box.removeEventListener('pointerdown',down);box.removeEventListener('pointermove',move);box.removeEventListener('pointerup',up);box.removeEventListener('pointercancel',up);};
  },[hasImages]);
  useEffect(()=>{if(state?.history)document.querySelector('.viewer-thumbnails [aria-current=true]')?.scrollIntoView({block:'nearest'});},[state?.history,current?.id]);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(forward||menu||event.target instanceof HTMLInputElement||locked.current)return;
      const currentState=latest.current;if(!currentState)return;
      if(event.key==='ArrowLeft'){event.preventDefault();select(currentState.index-1);}
      if(event.key==='ArrowRight'){event.preventDefault();select(currentState.index+1);}
      if(event.key==='Escape')control('close');
      if(['+','=','-','0'].includes(event.key)){event.preventDefault();if(event.key==='0'){transform.current.scale=1;transform.current.x=0;transform.current.y=0;paint();}else zoom(event.key==='-'?1/1.2:1.2);}
    };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[forward,menu,control,select]);
  useEffect(()=>{
    if(!menu)return;menuRef.current?.querySelector('button')?.focus();
    const close=(event:PointerEvent)=>{if(!menuRef.current?.contains(event.target as Node)&&!menuButton.current?.contains(event.target as Node))setMenu(false);};
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();setMenu(false);menuButton.current?.focus();}
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const buttons=Array.from(menuRef.current?.querySelectorAll('button:not(:disabled)')||[]) as HTMLButtonElement[];
        const index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(index+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();}
    };window.addEventListener('pointerdown',close);window.addEventListener('keydown',key);
    return()=>{window.removeEventListener('pointerdown',close);window.removeEventListener('keydown',key);};
  },[menu]);
  useEffect(()=>{if(forward)forwardDialog.current?.showModal();},[forward]);
  async function run(action:()=>Promise<void>) {
    if(locked.current)return;locked.current=true;setBusy(true);setMenu(false);setNotice('');
    try{await action();}catch(error){if(alive.current)say(error instanceof Error?error.message:'操作失败，请重试');}
    finally{locked.current=false;if(alive.current)setBusy(false);}
  }
  async function pngBlob() {
    const img=image.current;if(!img?.naturalWidth||loaded!==current?.id)throw Error('请等待图片加载完成');
    const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    const context=canvas.getContext('2d');if(!context)throw Error('无法读取图片');context.drawImage(img,0,0);
    return new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('图片转换失败')),'image/png'));
  }
  const copy=()=>run(async()=>{
    const blob=await pngBlob();
    if(window.zhiyuDesktop?.copyViewerImage){const result=await window.zhiyuDesktop.copyViewerImage(new Uint8Array(await blob.arrayBuffer()));if(!result.ok)throw Error(result.error||'复制失败');}
    else await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
    say('图片已复制');
  });
  const save=()=>run(async()=>{
    if(!current)throw Error('没有图片');
    if(window.zhiyuDesktop?.saveViewerImage){const result=await window.zhiyuDesktop.saveViewerImage(current.id);if(result.error)throw Error(result.error);if(result.ok)say('图片已保存');return;}
    const response=await fetch(current.src);if(!response.ok)throw Error('图片读取失败');
    const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
    const extension=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'} as Record<string,string>)[blob.type]||'png';
    link.href=url;link.download=`智域图片-${Date.now()}.${extension}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);say('已开始下载图片');
  });
  const collect=()=>run(async()=>{const blob=await pngBlob();await saveSticker(blob,'收藏表情');say('已添加到表情收藏');});
  async function forwardImage() {
    if(!target||!current)return;
    await run(async()=>{
      const response=await fetch(current.src);if(!response.ok)throw Error('原图读取失败');
      let blob=await response.blob();if(!['image/png','image/jpeg','image/webp','image/gif'].includes(blob.type))blob=await pngBlob();
      if(blob.size>12*1024*1024)throw Error('原图超过12MB，暂时无法转发');
      const key=`${account.id}:${current.id}:${target}`;
      if(forwardRetry.current?.key!==key)forwardRetry.current={key,turnId:crypto.randomUUID()};
      const retry=forwardRetry.current;
      if(localCharacterIds.some(id=>id===target)){
        const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>typeof reader.result==='string'?resolve(reader.result):reject(Error('图片读取失败'));reader.onerror=()=>reject(Error('图片读取失败'));reader.readAsDataURL(blob);});
        appendLocalCharacterMessage(account.id,target,{id:retry.turnId,mine:true,text:'',image:data,at:new Date().toISOString(),time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})});
      }else{
        if(!retry.imageId){const upload=await npcFetch('/api/npc/media',{method:'POST',headers:{'Content-Type':blob.type},body:blob});const result=await upload.json() as {imageId:string;error?:string};if(!upload.ok)throw Error(result.error||'图片上传失败');retry.imageId=result.imageId;}
        const sent=await npcFetch(`/api/npc/${target}?mode=normal`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send',text:'',imageId:retry.imageId,turnId:retry.turnId})});
        const result=await sent.json() as {error?:string};if(!sent.ok)throw Error(result.error||'转发失败，请重试');
      }
      forwardRetry.current=null;setForward(false);say(`已转发给${[molly,...people].find(person=>person.id===target)?.name}`);
    });
  }
  if(!state||!current)return <main className="image-viewer-empty"><p>没有可查看的图片，请从聊天中重新打开。</p><button onClick={()=>control('close')}>关闭窗口</button></main>;
  const contacts=[molly,...people].filter(person=>(person.name+person.nickname+person.account).toLowerCase().includes(search.toLowerCase()));
  return <main className="image-viewer" aria-label="图片查看器">
    <svg className="viewer-gradient-def" aria-hidden="true"><defs><linearGradient id="viewer-logo-gradient" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ff9b38"/><stop offset="1" stopColor="#ee4055"/></linearGradient></defs></svg>
    <header className="viewer-toolbar">
      {nativeMac?<div className="viewer-native-controls" aria-hidden="true"/>:<div className="viewer-controls">
        <button className="close" aria-label="关闭图片窗口" onClick={()=>control('close')}><X size={8}/></button>
        <button className="minimize" aria-label="最小化图片窗口" disabled={!desktop} title={desktop?'最小化':'浏览器不支持最小化'} onClick={()=>control('minimize')}><Minus size={8}/></button>
        <button className="maximize" aria-label="放大图片窗口" onClick={()=>control('maximize')}><Maximize2 size={8}/></button>
      </div>}
      <nav className="viewer-navigation" aria-label="图片工具">
        <button aria-label="上一张图片" title="上一张（←）" disabled={busy||state.index===0} onClick={()=>select(state.index-1)}><ArrowLeft/></button>
        <button aria-label="下一张图片" title="下一张（→）" disabled={busy||state.index===state.images.length-1} onClick={()=>select(state.index+1)}><ArrowRight/></button>
        <button aria-label="历史图片" title="查看当前聊天的全部图片" aria-pressed={state.history} disabled={busy} className={state.history?'active':''} onClick={()=>{if(window.zhiyuDesktop?.setImageHistory)void window.zhiyuDesktop.setImageHistory(!state.history);else setState({...state,history:!state.history});}}><Grid3X3/></button>
        <span className="viewer-separator"/>
        <button aria-label="保存图片" title="保存图片" disabled={busy||loaded!==current.id} onClick={()=>void save()}><Download/></button>
      </nav>
      <div className="viewer-toolbar-space"/>
      <div className="viewer-more">
        <button ref={menuButton} aria-label="更多图片操作" title="更多" aria-haspopup="menu" aria-expanded={menu} disabled={busy} onClick={()=>setMenu(!menu)}><MoreHorizontal/></button>
        {menu&&<div ref={menuRef} className="viewer-menu" role="menu">
          <button role="menuitem" disabled={loaded!==current.id} onClick={()=>void copy()}><Copy/>复制图片</button>
          <button role="menuitem" disabled={loaded!==current.id} onClick={()=>void save()}><Download/>保存图片</button>
          <button role="menuitem" disabled={loaded!==current.id} onClick={()=>{setMenu(false);setTarget('');setSearch('');setForward(true);}}><Forward/>转发</button>
          <hr/>
          <button role="menuitem" disabled={loaded!==current.id} onClick={()=>void collect()}><Heart/>收藏为表情</button>
        </div>}
      </div>
      <span className="viewer-separator"/>
      <button aria-label="固定图片窗口" aria-pressed={state.pinned} title={desktop?(state.pinned?'取消置顶':'窗口置顶'):'置顶仅支持智域桌面版'} disabled={!desktop} className={state.pinned?'active':''} onClick={()=>void window.zhiyuDesktop?.toggleImagePin()}><Pin/></button>
    </header>
    <div className="viewer-body">
      <div ref={stage} className="viewer-stage" aria-label="图片画布" onDoubleClick={()=>{if(busy)return;transform.current.x=0;transform.current.y=0;transform.current.scale=transform.current.scale>1?1:2;paint();}} onContextMenu={event=>{event.preventDefault();if(!busy)setMenu(true);}}>
        <img key={current.id+':'+reload} ref={image} src={current.src} alt={current.alt} draggable={false} className={loaded===current.id?'is-loaded':''} onLoad={event=>{
          const img=event.currentTarget;setLoaded(current.id);setFailed('');layout();
          if(window.zhiyuDesktop?.fitImageViewer)void window.zhiyuDesktop.fitImageViewer({id:current.id,width:img.naturalWidth,height:img.naturalHeight});
          else if(!document.fullscreenElement){const sidebar=state.history?216:0;const scale=Math.min(1,(screen.availWidth*.75-sidebar)/img.naturalWidth,(screen.availHeight*.75-34)/img.naturalHeight);window.resizeTo(Math.round(img.naturalWidth*scale)+sidebar+window.outerWidth-window.innerWidth,Math.round(img.naturalHeight*scale)+34+window.outerHeight-window.innerHeight);}
        }} onError={()=>setFailed(current.id)}/>
        {loaded!==current.id&&failed!==current.id&&<output className="viewer-loading">正在加载图片…</output>}
        {failed===current.id&&<div className="viewer-error" role="alert"><p>图片加载失败</p><button onClick={()=>{setFailed('');setReload(value=>value+1);}}>重新加载</button></div>}
      </div>
      {state.history&&<aside className="viewer-history" aria-label="聊天历史图片">
        <div className="viewer-thumbnails">{state.images.map((item,index)=><button key={item.id} aria-label={`查看历史图片 ${index+1}`} aria-current={index===state.index?'true':undefined} title={`${item.sender||''}${item.at?' '+new Date(item.at).toLocaleString('zh-CN'):''}`} disabled={busy} onClick={()=>select(index)}><img src={item.src} alt={item.alt} loading="lazy"/></button>)}</div>
      </aside>}
    </div>
    {notice&&<output className="viewer-notice">{notice}</output>}
    {forward&&<dialog ref={forwardDialog} className="viewer-forward" aria-label="转发图片" onCancel={event=>{if(busy)event.preventDefault();else setForward(false);}} onClose={()=>setForward(false)}>
      <header><h2>转发图片</h2><button aria-label="取消转发" disabled={busy} onClick={()=>setForward(false)}><X/></button></header>
      <label>选择联系人<input autoFocus placeholder="搜索联系人" value={search} disabled={busy} onChange={event=>setSearch(event.target.value)}/></label>
      <div className="viewer-forward-contacts" role="radiogroup" aria-label="转发联系人">
        {contacts.map(person=><label key={person.id}><input type="radio" name="forward-contact" value={person.id} checked={target===person.id} disabled={busy} onChange={()=>setTarget(person.id)}/><img src={person.avatar} alt=""/><span>{person.name}</span></label>)}
        {!contacts.length&&<p>没有匹配的联系人</p>}
      </div>
      <footer><img src={current.src} alt="待转发的图片"/><button disabled={!target||busy} onClick={()=>void forwardImage()}>{busy?'正在转发…':'确认转发'}</button></footer>
      {notice&&<p className="viewer-forward-error" role="alert">{notice}</p>}
    </dialog>}
  </main>;
}
