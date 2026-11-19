export const IMAGE_VIEWER_OPEN_MS=320;
export const IMAGE_VIEWER_CLOSE_MS=260;
export type ImageOrigin={element:HTMLImageElement;src:string};
type Rect={left:number;top:number;width:number;height:number};
export type ImageTransition={finished:Promise<void>;cancel:()=>void};
export type ImageMotionFrame={rect:Rect;crop:string};

function sourceURL(src:string){try{return new URL(src,document.baseURI).href;}catch{return src;}}
export function findImageOrigin(src:string,preferred?:HTMLImageElement|null):ImageOrigin|null {
 const same=(node:HTMLImageElement)=>node.isConnected&&sourceURL(node.currentSrc||node.src)===sourceURL(src)&&!node.closest('.zy-moment-image-viewer')&&node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0;
 if(preferred)return same(preferred)?{element:preferred,src}:null;
 for(const node of document.querySelectorAll<HTMLImageElement>('img'))if(same(node)){const rect=node.getBoundingClientRect();if(rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth)return {element:node,src};}
 return null;
}
function localRect(rect:DOMRect,container:DOMRect):Rect{return {left:rect.left-container.left,top:rect.top-container.top,width:rect.width,height:rect.height};}
function frameStyle(rect:Rect,radius:string){return {left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px',borderRadius:radius};}

/** Animate an isolated image frame between its real thumbnail crop and the
 * full-size viewer. Width/height affect this clone only, never page layout. */
export function animateImageTransition({dialog,picture,origin,closing=false,closingFrom}:{dialog:HTMLDialogElement;picture:HTMLImageElement|null;origin:ImageOrigin|null;closing?:boolean;closingFrom?:ImageMotionFrame}):ImageTransition {
 const duration=closing?IMAGE_VIEWER_CLOSE_MS:IMAGE_VIEWER_OPEN_MS;
 if(matchMedia('(prefers-reduced-motion: reduce)').matches||typeof dialog.animate!=='function')return {finished:Promise.resolve(),cancel:()=>{}};
 const source=origin?.element,sourceRect=source?.isConnected?source.getBoundingClientRect():null,targetRect=picture?.isConnected?picture.getBoundingClientRect():null;
 if(!source||!sourceRect?.width||!sourceRect.height||!targetRect?.width||!targetRect.height||!picture?.naturalWidth){
  const animation=dialog.animate(closing?[{opacity:1},{opacity:0}]:[{opacity:0},{opacity:1}],{duration:closing?180:220,easing:'ease-out',fill:'both'});
  let done=false;const cleanup=()=>{if(done)return;done=true;animation.cancel();};
  return {finished:animation.finished.then(()=>{},()=>{}).finally(cleanup),cancel:cleanup};
 }
 const container=dialog.getBoundingClientRect(),thumbnail=localRect(sourceRect,container),stage=picture.closest('.zy-moment-image-stage')?.getBoundingClientRect();
 const visible=stage?{left:Math.max(targetRect.left,stage.left),top:Math.max(targetRect.top,stage.top),right:Math.min(targetRect.right,stage.right),bottom:Math.min(targetRect.bottom,stage.bottom)}:targetRect;
 const visibleWidth=Math.max(1,visible.right-visible.left),visibleHeight=Math.max(1,visible.bottom-visible.top);
 const expanded=closing&&closingFrom?{left:closingFrom.rect.left-container.left,top:closingFrom.rect.top-container.top,width:closingFrom.rect.width,height:closingFrom.rect.height}:{left:visible.left-container.left,top:visible.top-container.top,width:visibleWidth,height:visibleHeight};
 const cropX=targetRect.width>visibleWidth?(visible.left-targetRect.left)/(targetRect.width-visibleWidth)*100:50,cropY=targetRect.height>visibleHeight?(visible.top-targetRect.top)/(targetRect.height-visibleHeight)*100:50;
 const expandedCrop=closing&&closingFrom?closingFrom.crop:`${cropX}% ${cropY}%`;
 const sourceStyle=getComputedStyle(source),button=source.closest('button'),radius=sourceStyle.borderRadius==='0px'&&button?getComputedStyle(button).borderRadius:sourceStyle.borderRadius;
 const crop=sourceStyle.objectPosition||'50% 50%',frame=document.createElement('div'),clone=document.createElement('img');
 frame.className='zy-image-motion-frame';frame.dataset.imageMotionClone=closing?'closing':'opening';frame.setAttribute('aria-hidden','true');
 clone.src=picture.currentSrc||picture.src;clone.alt='';clone.draggable=false;clone.style.objectPosition=crop;frame.appendChild(clone);
 const from=closing?expanded:thumbnail,to=closing?thumbnail:expanded;
 Object.assign(frame.style,frameStyle(from,closing?'0px':radius));
 const sourceVisibility=source.style.visibility,pictureVisibility=picture.style.visibility;
 source.style.visibility='hidden';picture.style.visibility='hidden';dialog.appendChild(frame);
 const options={duration,easing:'cubic-bezier(.22,.8,.25,1)',fill:'both' as FillMode};
 const motion=frame.animate([frameStyle(from,closing?'0px':radius),frameStyle(to,closing?radius:'0px')],options);
 const cropMotion=clone.animate([{objectPosition:closing?expandedCrop:crop},{objectPosition:closing?crop:expandedCrop}],options);
 let done=false;
 const cleanup=()=>{if(done)return;done=true;motion.cancel();cropMotion.cancel();frame.remove();if(source.style.visibility==='hidden')source.style.visibility=sourceVisibility;if(picture.style.visibility==='hidden')picture.style.visibility=pictureVisibility;};
 return {finished:motion.finished.then(()=>{},()=>{}).finally(cleanup),cancel:cleanup};
}
