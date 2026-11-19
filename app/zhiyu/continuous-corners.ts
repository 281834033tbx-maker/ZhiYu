/**
 * Continuous corner compatibility for the shipped Chromium 130 runtime.
 * Geometry follows Figma's straight / Bezier / circular-arc construction:
 * https://www.figma.com/blog/desperately-seeking-squircles/
 * https://developers.figma.com/docs/plugins/api/properties/nodes-cornersmoothing/
 * This is a web approximation, not Apple's native continuous-corner API.
 *
 * The smoothed contour stays inside the existing CSS rounded rectangle.
 * Its even-odd clip removes only those small corner wedges: the outer frame
 * remains visible, preserving the host's existing cast shadow / focus rings.
 * No DOM children are moved or wrapped, and no wheel/scroll events are changed.
 */

export type CornerRadius={x:number;y:number};
export type CornerRadii=[CornerRadius,CornerRadius,CornerRadius,CornerRadius];

const SMOOTHING=.6;
const EPSILON=.01;
const n=(value:number)=>String(Math.round(value*1000000)/1000000);

/** Resolve the CSS percentage axes and its common radius-overlap scale. */
export function resolveCornerRadii(values:readonly string[],width:number,height:number):CornerRadii {
  const radii=values.map(value=>{
    const parts=value.trim().split(/\s+/);
    const read=(part:string,axis:number)=>Math.max(0,(parseFloat(part)||0)*(part.endsWith('%')?axis/100:1));
    const x=read(parts[0]||'0',width),y=read(parts[1]||parts[0]||'0',height);
    return x>0&&y>0?{x,y}:{x:0,y:0};
  }) as CornerRadii;
  const [tl,tr,br,bl]=radii;
  const ratio=(size:number,sum:number)=>sum?size/sum:1;
  const scale=Math.min(1,ratio(width,tl.x+tr.x),ratio(width,bl.x+br.x),ratio(height,tl.y+bl.y),ratio(height,tr.y+br.y));
  return radii.map(radius=>({x:radius.x*scale,y:radius.y*scale})) as CornerRadii;
}

export function isCircularOrPill(width:number,height:number,radii:CornerRadii):boolean {
  const half=Math.min(width,height)/2;
  return half>0&&radii.every(radius=>radius.x>=half-EPSILON&&radius.y>=half-EPSILON);
}

/** Four independent corners, in CSS order TL/TR/BR/BL. Elliptical radii use
 * the same construction scaled along each axis, preserving their proportions. */
export function continuousCornerPath(width:number,height:number,radii:CornerRadii,smoothing=SMOOTHING):string {
  if(width<=0||height<=0)return '';
  const [tl,tr,br,bl]=radii;
  const share=(size:number,own:number,other:number)=>own+other?size*own/(own+other):0;
  const budgets=[
    [share(width,tl.x,tr.x),share(height,tl.y,bl.y)],
    [share(width,tr.x,tl.x),share(height,tr.y,br.y)],
    [share(width,br.x,bl.x),share(height,br.y,tr.y)],
    [share(width,bl.x,br.x),share(height,bl.y,tl.y)],
  ];
  const params=radii.map((radius,index)=>{
    if(!radius.x||!radius.y)return {radius,s:0,p:0,a:0,b:0,c:0,d:0,arc:0};
    const budget=Math.min(budgets[index][0]/radius.x,budgets[index][1]/radius.y);
    const s=Math.max(0,Math.min(smoothing,budget-1));
    const p=1+s;
    const angle=Math.PI*s/4;
    const arc=Math.SQRT2*Math.sin(Math.PI*(1-s)/4);
    const tangent=Math.tan(angle/2);
    const c=tangent*Math.cos(angle),d=c*Math.tan(angle);
    // Matching the Bezier's terminal curvature to the unit circular arc
    // gives 2*b*d / (3*(c*c+d*d)^(3/2)) = 1. Its initial three points
    // are collinear, so curvature starts at zero on the straight edge.
    const b=d>1e-12?3*Math.pow(c*c+d*d,1.5)/(2*d):0;
    const a=Math.max(0,p-arc-c-d-b);
    return {radius,s,p,a,b,c,d,arc};
  });
  // Each corner's basis rotates a normalized top-right turn clockwise.
  const turn=(index:number)=>{
    const {radius,s,p,a,b,c,d,arc}=params[index];
    const {x:rx,y:ry}=radius;
    const transform=(x:number,y:number):[number,number]=>{
      if(index===1)return [width-p*rx+x*rx,y*ry];
      if(index===2)return [width-y*rx,height-p*ry+x*ry];
      if(index===3)return [p*rx-x*rx,height-y*ry];
      return [y*rx,p*ry-x*ry];
    };
    const pt=(x:number,y:number)=>transform(x,y).map(n).join(' ');
    const start=pt(0,0);
    if(!rx||!ry){
      const corners=[[0,0],[width,0],[width,height],[0,height]];
      return {start:corners[index].map(n).join(' '),body:''};
    }
    if(s<1e-8)return {start,body:`A ${n(rx)} ${n(ry)} 0 0 1 ${pt(p,p)}`};
    return {
      start,
      body:`C ${pt(a,0)} ${pt(a+b,0)} ${pt(a+b+c,d)} A ${n(rx)} ${n(ry)} 0 0 1 ${pt(a+b+c+arc,d+arc)} C ${pt(p,p-a-b)} ${pt(p,p-a)} ${pt(p,p)}`,
    };
  };
  const corners=[turn(1),turn(2),turn(3),turn(0)];
  return `M ${corners[0].start} ${corners.map((corner,index)=>`${index?'L '+corner.start+' ':''}${corner.body}`).join(' ')} Z`;
}

export function continuousCornerClip(width:number,height:number,radii:CornerRadii,outset=96):string {
  const path=continuousCornerPath(width,height,radii);
  if(!path)return 'none';
  const pad=Math.max(96,outset);
  const outer=`M ${n(-pad)} ${n(-pad)} H ${n(width+pad)} V ${n(height+pad)} H ${n(-pad)} Z`;
  const box=`M 0 0 H ${n(width)} V ${n(height)} H 0 Z`;
  return `path(evenodd, "${outer} ${box} ${path}")`;
}

type CornerState={
  element:HTMLElement;
  previousClip:string;
  previousClipPriority:string;
  previousShape:string;
  previousShapePriority:string;
  previousMark:string|null;
  appliedClip:string;
  appliedStyle:string;
  signature:string;
};
type Installation={users:number;dispose:()=>void};
const installations=new WeakMap<Document,Installation>();

/** Install once per browser document, including native popover child windows.
 * The returned cleanup is reference-counted and restores only our own paint. */
export function installContinuousCorners(doc:Document|undefined=typeof document==='undefined'?undefined:document):()=>void {
  const win=doc?.defaultView;
  if(!doc||!win||!doc.documentElement)return ()=>{};
  const existing=installations.get(doc);
  if(existing){
    existing.users++;
    let active=true;
    return ()=>{if(active){active=false;if(!--existing.users){existing.dispose();installations.delete(doc);}}};
  }
  const native=win.CSS?.supports('corner-shape','squircle')??false;
  if(!native&&!win.CSS?.supports('clip-path','path(evenodd, "M 0 0 H 1 V 1 H 0 Z")'))return ()=>{};
  const states=new Map<HTMLElement,CornerState>();
  const sizes=new WeakMap<HTMLElement,{width:number;height:number}>();
  const styleInputs=new WeakMap<HTMLElement,string>();
  const pending=new Set<HTMLElement>();
  let frame=0,disposed=false;

  const inputStyle=(element:HTMLElement)=>{
    const owned=states.get(element);
    return Array.from(element.style).filter(property=>{
      // Motion-only updates are intentionally layout-free and cannot change
      // a local border box or its radii. Do not schedule a computed-style read
      // on every spring frame of the card, pressable, carousel or viewer.
      if(/^(?:transform|translate|rotate|scale|opacity|will-change|filter)$/.test(property))return false;
      if(/^(?:--reflect-rotate-[xy]|--zy-pressure-scale|--zy-icon-click-rotation)$/.test(property))return false;
      if(property==='clip-path'&&owned?.appliedClip===element.style.getPropertyValue(property))return false;
      if(property==='corner-shape'&&native&&owned)return false;
      return true;
    }).map(property=>property+':'+element.style.getPropertyValue(property)).sort().join(';');
  };

  const restore=(state:CornerState)=>{
    const element=state.element;
    if(element.style.getPropertyValue('clip-path')===state.appliedClip){
      if(state.previousClip)element.style.setProperty('clip-path',state.previousClip,state.previousClipPriority);
      else element.style.removeProperty('clip-path');
    }
    if(native&&element.style.getPropertyValue('corner-shape')==='squircle'){
      if(state.previousShape)element.style.setProperty('corner-shape',state.previousShape,state.previousShapePriority);
      else element.style.removeProperty('corner-shape');
    }
    if(state.previousMark===null)element.removeAttribute('data-zy-corner-curve');
    else element.setAttribute('data-zy-corner-curve',state.previousMark);
    observer?.unobserve(element);
    states.delete(element);
    styleInputs.set(element,inputStyle(element));
  };
  const painted=(style:CSSStyleDeclaration,element:HTMLElement)=>{
    const color=style.backgroundColor;
    const fill=color!=='transparent'&&color!=='rgba(0, 0, 0, 0)';
    return fill||style.backgroundImage!=='none'||style.boxShadow!=='none'||
      style.overflowX!=='visible'||style.overflowY!=='visible'||
      /^(IMG|VIDEO|CANVAS|IFRAME)$/.test(element.tagName)||
      ['Top','Right','Bottom','Left'].some(side=>{
        const width=style.getPropertyValue('border-'+side.toLowerCase()+'-width');
        const border=style.getPropertyValue('border-'+side.toLowerCase()+'-style');
        return parseFloat(width)>0&&border!=='none';
      });
  };
  const update=(element:HTMLElement)=>{
    const state=states.get(element);
    styleInputs.set(element,inputStyle(element));
    if(!element.isConnected||element.closest('[data-zy-corners="off"]')){if(state)restore(state);return;}
    // Detached panels have their cast shadow in a sibling SVG. Clip their
    // complete paint (including backdrop blur/descendants) to the contour.
    // The old outside-preserving widget clip can leave a corner outside the
    // panel, and native window clipping cannot round this inset panel's base.
    const isolatedPanel=element.matches('.zy-layout-v3 .zy-directory,.zy-layout-v3 .zy-task-board>.zy-task-board-content,.zy-layout-v3>.zy-base>:is(.xx-layout,.zy-chat,.zy-contact-detail,.zy-pets,.zy-moments,.zy-me-page,.zy-user-facing-error),.zy-topbar');
    // Keep Mac structural plates under the native compositor's control in
    // Chromium 130. A second CSS clip on the frame can lose native paint;
    // the inset painted surfaces supply the strict visible contour instead.
    if(!isolatedPanel&&!native&&doc.documentElement.dataset.zyNativeMaterial==='macos'&&element.matches('.zy-desktop-stage,.zy-desktop-slot,.zy-app,.zy-base')){if(state)restore(state);return;}
    const style=win.getComputedStyle(element);
    if(style.display==='none'||style.visibility==='hidden'){return;}
    const size=sizes.get(element)||{width:element.offsetWidth,height:element.offsetHeight};
    const {width,height}=size;
    if(!width||!height)return;
    const radii=resolveCornerRadii([style.borderTopLeftRadius,style.borderTopRightRadius,style.borderBottomRightRadius,style.borderBottomLeftRadius],width,height);
    const ownClip=!!state&&element.style.getPropertyValue('clip-path')===state.appliedClip;
    const specialClip=style.clipPath!=='none'&&!ownClip;
    const webkitMask=style.getPropertyValue('-webkit-mask-image');
    const specialMask=(!!style.maskImage&&style.maskImage!=='none')||(!!webkitMask&&webkitMask!=='none');
    if(specialClip||specialMask||!radii.some(radius=>radius.x>EPSILON)||isCircularOrPill(width,height,radii)){
      if(state)restore(state);
      return;
    }
    if(!state&&!painted(style,element))return;
    const signature=[isolatedPanel?'panel':'widget',n(width),n(height),...radii.flatMap(radius=>[n(radius.x),n(radius.y)])].join(',');
    if(state?.signature===signature)return;
    const current=state||{
      element,
      previousClip:element.style.getPropertyValue('clip-path'),
      previousClipPriority:element.style.getPropertyPriority('clip-path'),
      previousShape:element.style.getPropertyValue('corner-shape'),
      previousShapePriority:element.style.getPropertyPriority('corner-shape'),
      previousMark:element.getAttribute('data-zy-corner-curve'),
      appliedClip:'',appliedStyle:'',signature:'',
    };
    current.signature=signature;
    if(native)element.style.setProperty('corner-shape','squircle');
    else{
      current.appliedClip=isolatedPanel?`path("${continuousCornerPath(width,height,radii)}")`:continuousCornerClip(width,height,radii);
      element.style.setProperty('clip-path',current.appliedClip);
      current.appliedClip=element.style.getPropertyValue('clip-path');
    }
    element.setAttribute('data-zy-corner-curve',native?'native':'compatible');
    current.appliedStyle=element.getAttribute('style')||'';
    if(!state){states.set(element,current);observer?.observe(element);}
    styleInputs.set(element,inputStyle(element));
  };
  const flush=()=>{
    frame=0;
    const deadline=win.performance.now()+8;
    for(const element of pending){
      pending.delete(element);
      update(element);
      if(win.performance.now()>deadline)break;
    }
    if(pending.size&&!disposed)frame=win.requestAnimationFrame(flush);
  };
  const enqueue=(node:Element)=>{
    if(disposed||!(node instanceof win.HTMLElement))return;
    pending.add(node);
    if(!frame)frame=win.requestAnimationFrame(flush);
  };
  const scan=(node:Element)=>{
    enqueue(node);
    node.querySelectorAll('*').forEach(enqueue);
  };
  const refresh=()=>{if(!disposed&&doc.body)scan(doc.body);};
  const observer=typeof win.ResizeObserver==='function'?new win.ResizeObserver(entries=>{
    for(const entry of entries){
      const element=entry.target as HTMLElement;
      const box=entry.borderBoxSize?.[0];
      if(box)sizes.set(element,{width:box.inlineSize,height:box.blockSize});
      enqueue(element);
    }
  }):null;
  const mutations=new win.MutationObserver(records=>{
    for(const record of records){
      const element=record.target as HTMLElement;
      if(record.type==='childList'){
        record.addedNodes.forEach(node=>{if(node instanceof win.HTMLElement)scan(node);});
        if(record.removedNodes.length)for(const state of states.values())if(!state.element.isConnected)restore(state);
        enqueue(element);
      }else if(element===doc.documentElement){refresh();}
      else{
        const state=states.get(element);
        if(record.attributeName==='style'&&state?.appliedStyle===(element.getAttribute('style')||''))continue;
        if(record.attributeName==='style'){
          const input=inputStyle(element),previous=styleInputs.get(element);
          styleInputs.set(element,input);
          if(input===previous)continue;
        }
        enqueue(element);
        // A class such as incoming/outgoing can change a descendant bubble's
        // asymmetric corners. Its local subtree is refreshed, not the page.
        if(record.attributeName==='class'&&element!==doc.body&&element.childElementCount<32)element.querySelectorAll('*').forEach(enqueue);
        if(record.attributeName==='style'&&(element.style.visibility||element.style.display)&&element.childElementCount<32)element.querySelectorAll('*').forEach(enqueue);
      }
    }
  });
  mutations.observe(doc.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','open','data-zy-theme','data-zy-font-size','data-zy-native-material','data-zy-corners']});
  const interaction=(event:Event)=>{
    let element=event.target instanceof win.Element?event.target:null;
    for(let i=0;element&&i<4;i++,element=element.parentElement)enqueue(element);
  };
  const load=(event:Event)=>{
    if(event.target instanceof win.HTMLLinkElement)refresh();
    else interaction(event);
  };
  doc.addEventListener('pointerover',interaction,{passive:true});
  doc.addEventListener('pointerout',interaction,{passive:true});
  doc.addEventListener('focusin',interaction);
  doc.addEventListener('focusout',interaction);
  doc.addEventListener('load',load,true);
  doc.fonts?.addEventListener('loadingdone',refresh);
  win.addEventListener('resize',refresh,{passive:true});
  refresh();
  const installation:Installation={users:1,dispose:()=>{
    disposed=true;
    if(frame)win.cancelAnimationFrame(frame);
    mutations.disconnect();
    observer?.disconnect();
    for(const state of states.values())restore(state);
    pending.clear();
    doc.removeEventListener('pointerover',interaction);
    doc.removeEventListener('pointerout',interaction);
    doc.removeEventListener('focusin',interaction);
    doc.removeEventListener('focusout',interaction);
    doc.removeEventListener('load',load,true);
    doc.fonts?.removeEventListener('loadingdone',refresh);
    win.removeEventListener('resize',refresh);
  }};
  installations.set(doc,installation);
  let active=true;
  return ()=>{if(active){active=false;if(!--installation.users){installation.dispose();installations.delete(doc);}}};
}
