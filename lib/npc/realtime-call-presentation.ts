import type {RealtimeCaption} from './realtime-transcript';

export const CAPTION_IDLE_HIDE_MS=4000;
export type CallCaptionPhase='listening'|'thinking'|'speaking';
export type CallCaptionWindow={
  previous?:RealtimeCaption;
  current?:RealtimeCaption;
  waiting:boolean;
  hidden:boolean;
  phase:CallCaptionPhase;
  lastActivityAt:number|null;
  /** Retain identities, not a subtitle history, to ignore late older turns. */
  seen:readonly string[];
};
export type CallCaptionAction=
  | {type:'transcript';line:RealtimeCaption;now:number}
  | {type:'phase';phase:CallCaptionPhase;now:number}
  | {type:'tick';now:number}
  | {type:'interrupt';now:number}
  | {type:'reset'};

export function createCallCaptionWindow():CallCaptionWindow {
  return {waiting:false,hidden:true,phase:'listening',lastActivityAt:null,seen:[]};
}
const identity=(line:RealtimeCaption)=>`${line.role}:${line.id}`;
const identical=(left:RealtimeCaption,right:RealtimeCaption)=>left.id===right.id&&left.role===right.role&&left.text===right.text&&left.final===right.final&&left.interrupted===right.interrupted;
const stale=(previous:RealtimeCaption,line:RealtimeCaption)=>previous.interrupted||previous.final&&!line.final;
const at=(now:number,fallback:number|null)=>Number.isFinite(now)?now:fallback;

/** Receives whole server transcript snapshots. It never concatenates partials
 * or manufactures sentence IDs for thinking dots. Only current and previous
 * sentences are retained; CSS controls the actual two-line text clipping. */
export function callCaptionWindowReducer(state:CallCaptionWindow,action:CallCaptionAction):CallCaptionWindow {
  if(action.type==='reset')return createCallCaptionWindow();
  if(action.type==='tick') {
    if(state.hidden||state.phase!=='listening'||state.lastActivityAt===null||!Number.isFinite(action.now)
      ||action.now-state.lastActivityAt<CAPTION_IDLE_HIDE_MS)return state;
    // Keep the two rows while opacity fades; a later utterance discards them
    // rather than promoting a pre-silence line back into the caption window.
    return {...state,hidden:true,waiting:false};
  }
  if(action.type==='phase') {
    if(action.phase===state.phase)return state;
    if(action.phase==='listening')return {...state,phase:action.phase,waiting:false,lastActivityAt:at(action.now,state.lastActivityAt)};
    const current=state.hidden?undefined:state.current;
    const previous=state.hidden?undefined:state.previous;
    return {...state,current,previous,phase:action.phase,hidden:false,
      waiting:action.phase==='thinking'||!current||current.role!=='assistant'||!current.text.trim(),
      lastActivityAt:at(action.now,state.lastActivityAt)};
  }
  if(action.type==='interrupt') {
    const current=state.current?.role==='assistant'?{...state.current,final:true,interrupted:true}:state.current;
    return {...state,current,phase:'listening',waiting:false,lastActivityAt:at(action.now,state.lastActivityAt)};
  }
  const line=action.line;
  if(!line.id||!line.text.trim())return state;
  const key=identity(line),current=state.current,previous=state.previous;
  if(current&&identity(current)===key) {
    if(stale(current,line)||identical(current,line))return state;
    return {...state,current:{...line},previous:state.hidden?undefined:previous,waiting:false,hidden:false,lastActivityAt:at(action.now,state.lastActivityAt)};
  }
  if(previous&&identity(previous)===key) {
    if(stale(previous,line)||identical(previous,line))return state;
    // A late final can correct its older row, but cannot displace the speaker
    // currently on screen or keep the idle timer alive.
    return {...state,previous:{...line}};
  }
  if(state.seen.includes(key))return state;
  return {...state,current:{...line},previous:state.hidden?undefined:current,waiting:false,hidden:false,
    lastActivityAt:at(action.now,state.lastActivityAt),seen:[...state.seen,key].slice(-80)};
}

/** While waiting, the latest visible sentence occupies the previous position.
 * The first real assistant snapshot then takes current with its real ID. */
export function getCallCaptionFrame(state:CallCaptionWindow) {
  return {previous:state.waiting?state.current||state.previous:state.previous,
    current:state.waiting?undefined:state.current,waiting:state.waiting,hidden:state.hidden};
}

/** Timing starts at ready, and an optional terminal timestamp freezes it. */
export function callElapsedMs(readyAt:number|null,now:number,endedAt?:number|null):number {
  if(readyAt===null||!Number.isFinite(readyAt))return 0;
  const end=typeof endedAt==='number'&&Number.isFinite(endedAt)?endedAt:Number.isFinite(now)?now:readyAt;
  return Math.max(0,end-readyAt);
}
export function formatCallDuration(elapsedMs:number):string {
  const seconds=Number.isFinite(elapsedMs)?Math.max(0,Math.floor(elapsedMs/1000)):0;
  const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds/60)%60,remainder=seconds%60;
  return hours?`${hours}:${String(minutes).padStart(2,'0')}:${String(remainder).padStart(2,'0')}`
    :`${String(minutes).padStart(2,'0')}:${String(remainder).padStart(2,'0')}`;
}
