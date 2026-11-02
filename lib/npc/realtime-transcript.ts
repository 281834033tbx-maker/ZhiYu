export type RealtimeInputTranscript = {type:'transcript';role:'user';text:string;final:boolean;turnId:string};
type InputUpdate = {kind:'delta'|'snapshot'|'complete';itemId?:string;eventId?:string;text?:string};
type InputTurn = {turnId:string;text:string;final:boolean;snapshotDeltas:boolean;snapshotBase:string;lastDelta?:string;prefixGrowths:number;candidateStart?:number;events:Set<string>};
const TEXT_LIMIT=12000;
const identifier=(value?:string)=>typeof value==='string'&&value.length>0&&value.length<=256?value:undefined;
function eventFingerprint(update:InputUpdate) {
  if(!identifier(update.eventId))return;
  let hash=0x811c9dc5;
  const text=update.text||'';
  for(let index=0;index<text.length;index++)hash=Math.imul(hash^text.charCodeAt(index),0x01000193);
  // Some providers reuse a tracing ID across different partial payloads.
  // Only an exact event/payload replay is redundant, never equal spoken words.
  return `${update.kind}:${update.eventId}:${text.length}:${hash>>>0}`;
}
function lowInformationLoop(text:string) {
  // Neither 哈→哈哈→哈哈哈 nor ha→haha→hahaha is evidence that a provider
  // sends cumulative sentences: those can just be genuine repeated tokens.
  for(let size=1;size<=Math.min(8,Math.floor(text.length/2));size++) {
    let repeats=true;
    for(let index=size;index<text.length;index++)if(text[index]!==text[index%size]){repeats=false;break;}
    if(repeats)return true;
  }
  return false;
}
function relatedHypothesis(previous:string|undefined,next:string) {
  if(!previous||!next)return false;
  if(next.startsWith(previous)||previous.startsWith(next))return true;
  let common=0;
  while(common<previous.length&&common<next.length&&previous[common]===next[common])common++;
  return common>=2&&common>=Math.ceil(Math.min(previous.length,next.length)/2);
}

/** ASR state belongs to an input item, not to the latest sentence globally.
 * Explicit snapshots replace hypotheses; documented delta packets append.
 * Auto compatibility requires two consecutive strict prefix extensions
 * (three hypotheses), excluding simple token loops, before treating a delta
 * chain as cumulative. A single "不要" + "不要这样" remains two fragments.
 * Two unmarked hypotheses remain incremental even if they were snapshots;
 * three growing hypotheses can still be genuinely repeated speech. No
 * text-only heuristic can guarantee lossless distinction. Callers with an
 * explicit pure-delta contract can select incremental mode instead.
 * Equal short fragments are never deduplicated solely by their text. */
export class RealtimeInputTranscriptAssembler {
  private readonly turns=new Map<string,InputTurn>();
  private readonly starts=new Map<string,string>();
  private activeId?:string;
  private sequence=0;
  constructor(private readonly makeId:()=>string=()=>`input-${++this.sequence}`,private readonly deltaMode:'incremental'|'auto'='auto') {}

  get currentTurnId(){return this.activeId;}
  private create(turnId:string) {
    const turn:InputTurn={turnId,text:'',final:false,snapshotDeltas:false,snapshotBase:'',prefixGrowths:0,events:new Set()};
    this.turns.set(turnId,turn);this.activeId=turnId;
    if(this.turns.size>64)this.turns.delete(this.turns.keys().next().value!);
    return turn;
  }
  start(itemId?:string,eventId?:string):{turnId:string;fresh:boolean} {
    const trace=identifier(eventId),known=trace?this.starts.get(trace):undefined;
    const turnId=identifier(itemId)||known||this.makeId();
    if(this.turns.has(turnId))return {turnId,fresh:false};
    this.create(turnId);
    if(trace){this.starts.set(trace,turnId);if(this.starts.size>64)this.starts.delete(this.starts.keys().next().value!);}
    return {turnId,fresh:true};
  }
  update(update:InputUpdate):RealtimeInputTranscript|undefined {
    const turnId=identifier(update.itemId)||this.activeId||this.makeId();
    const turn=this.turns.get(turnId)||this.create(turnId);
    if(turn.final)return;
    const fingerprint=eventFingerprint(update);
    if(fingerprint&&turn.events.has(fingerprint))return;
    if(fingerprint){turn.events.add(fingerprint);if(turn.events.size>256)turn.events.delete(turn.events.values().next().value!);}
    const text=typeof update.text==='string'?update.text.slice(0,TEXT_LIMIT):undefined;
    if(update.kind==='complete') {
      if(text!==undefined)turn.text=text;
      turn.final=true;
    } else if(text===undefined) return;
    else if(update.kind==='snapshot') {
      turn.text=text;turn.snapshotDeltas=false;turn.snapshotBase='';turn.lastDelta=undefined;turn.prefixGrowths=0;turn.candidateStart=undefined;
    }
    else {
      if(this.deltaMode==='auto'&&turn.snapshotDeltas&&relatedHypothesis(turn.lastDelta,text))turn.text=(turn.snapshotBase+text).slice(0,TEXT_LIMIT);
      else {
        if(turn.snapshotDeltas) {
          // A provider can switch back to actual short deltas after a
          // cumulative chain. Keep the corrected sentence and relearn from
          // subsequent packets rather than replacing it with one fragment.
          turn.snapshotDeltas=false;turn.snapshotBase='';turn.prefixGrowths=0;turn.candidateStart=undefined;
        }
        const previous=turn.lastDelta;
        const grows=!!previous&&text.length>previous.length&&text.startsWith(previous)&&!lowInformationLoop(text);
        if(this.deltaMode==='auto'&&grows) {
          if(!turn.prefixGrowths)turn.candidateStart=Math.max(0,turn.text.length-previous.length);
          turn.prefixGrowths++;
        } else {turn.prefixGrowths=0;turn.candidateStart=undefined;}
        if(this.deltaMode==='auto'&&turn.prefixGrowths>=2) {
          turn.snapshotBase=turn.text.slice(0,turn.candidateStart);
          turn.text=(turn.snapshotBase+text).slice(0,TEXT_LIMIT);turn.snapshotDeltas=true;
        } else turn.text=(turn.text+text).slice(0,TEXT_LIMIT);
      }
      turn.lastDelta=text;
    }
    return {type:'transcript',role:'user',text:turn.text,final:turn.final,turnId};
  }
  fail(itemId?:string) {
    const turn=this.turns.get(identifier(itemId)||this.activeId||'');
    if(turn)turn.final=true;
  }
}

export type RealtimeCaption = {id:string;role:'user'|'assistant';text:string;final:boolean;interrupted?:boolean};
/** Gateway captions are complete snapshots. A late partial cannot reopen a
 * finalized/interrupted row; repeated finals update the same row at most. */
export function upsertRealtimeCaption<T extends RealtimeCaption>(items:T[],line:T):T[] {
  const previous=items.find(item=>item.id===line.id);
  if(previous?.interrupted||previous?.final&&!line.final)return items;
  if(previous&&previous.text===line.text&&previous.final===line.final&&previous.interrupted===line.interrupted)return items;
  return (previous?items.map(item=>item.id===line.id?{...item,...line}:item):[...items,line]).slice(-80);
}
