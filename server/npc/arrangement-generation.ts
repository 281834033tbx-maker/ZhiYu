import {recognizeArrangementLocally,parseArrangementRecognition,type ArrangementRecognition} from '../../lib/npc/arrangement-intent';
import {arrangementSections} from '../../lib/npc/arrangement-sections';

// Generation metadata has no execution authority. It stays server-side and is
// consumed only after the original conversation's stale-turn checks succeed.
const turns=new Map<string,{at:number;recognition:ArrangementRecognition}>();
export function arrangementGenerationPrompt(text:string,now=Date.now()):string {
 if(!text.trim())return '';
 const local=recognizeArrangementLocally(text,now);
 const section=arrangementSections.find(item=>item.id===local.section);
 return '\n【安排识别；与本次回复合并，不执行】在原JSON根上另附 arrangementRecognition={isArrangement,section,title,time,level}。'
  +'section仅schedule/todo/plan/purchase/payment/procedure/countdown，title压缩用户原话至10字，time仅抄原时间短语，不计算日期。level仅direct/ask/ignore。'
  +'只识别本轮用户自己的未来具体行动；过去、第三人、假设、否定、吐槽空想、引用、危机均ignore；有具体时间/截止为direct，有行动但时间模糊为ask。'
  +'提醒我/记一下/帮我记着/别让我忘了/加到某板块为direct，无时间归待办；内容决定板块，交水费归缴费。专业训练饮食菜谱方案及其调整不由此建立计划，仍走现有专家协议。'
  +'识别无效或不确定时返回{isArrangement:false,section:null,title:"",time:"",level:"ignore"}。不要在台词声称写入、不要自行发确认选项，程序处理真实保存/转交。'
  +(local.level!=='ignore'&&section?'\n本轮可问"要不要让Molly记进'+section.name+'"；仅当关系档位正常且非危机，程序会在正常回答末尾附一次真实好/不用按钮。':'');
}
export function stripArrangementRecognition(raw:unknown,text:string,now=Date.now()):{value:unknown;recognition:ArrangementRecognition} {
 const object=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:null;
 // Older providers/test adapters may omit the additive field. The local
 // recognizer applies the same conservative exclusions, never model dates.
 const recognition=object&&Object.hasOwn(object,'arrangementRecognition')
  ?parseArrangementRecognition(object.arrangementRecognition,text,now):recognizeArrangementLocally(text,now);
 if(!object||!Object.hasOwn(object,'arrangementRecognition'))return {value:raw,recognition};
 const value={...object};delete value.arrangementRecognition;return {value,recognition};
}
export function rememberArrangementRecognition(requestId:string,recognition:ArrangementRecognition,now=Date.now()) {
 for(const [key,item] of turns)if(now-item.at>180000)turns.delete(key);
 turns.set(requestId,{at:now,recognition});
}
export function takeArrangementRecognition(requestId:string,text:string,now=Date.now()):ArrangementRecognition {
 const item=turns.get(requestId);turns.delete(requestId);
 return item&&now-item.at<=180000&&item.recognition.sourceText===text?item.recognition:recognizeArrangementLocally(text,now);
}
