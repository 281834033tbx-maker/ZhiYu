import xia from '../../npc-skills/skills/zhiyu-dialogue/npcs/xia-xia/status.json';
import yuan from '../../npc-skills/skills/zhiyu-dialogue/npcs/yuan-xiaoman/status.json';
import he from '../../npc-skills/skills/zhiyu-dialogue/npcs/he-jiawei/status.json';
import chen from '../../npc-skills/skills/zhiyu-dialogue/npcs/chen-nian/status.json';
import liu from '../../npc-skills/skills/zhiyu-dialogue/npcs/liu/status.json';
import chef from '../../npc-skills/skills/zhiyu-dialogue/npcs/zhou-chef/status.json';
import molly from '../../npc-skills/skills/zhiyu-dialogue/npcs/molly/status.json';
import type {CharacterStatus,CharacterStatusOverride} from './experience';
export type {CharacterStatus,CharacterStatusOverride} from './experience';
type Slot='morning'|'noon'|'afternoon'|'evening'|'night';
type StatusItem={text:string;slots:string[];weight:number};
const libraries:Record<string,{items:StatusItem[]}>={'xia-xia':xia,'yuan-xiaoman':yuan,'he-jiawei':he,'chen-nian':chen,liu,'zhou-chef':chef,molly};
const hash=(s:string)=>Array.from(s).reduce((n,c)=>(Math.imul(n,31)+c.codePointAt(0)!)>>>0,0);
const allowed=(s:string)=>Array.from(s).length>=2&&Array.from(s).length<=8&&!/[。.!！?？\p{Extended_Pictographic}]/u.test(s)&&!/睡觉中|勿扰|晚点回|离线|在打排位|在迪士尼|^忙$/.test(s);
export function resolveCharacterStatus(characterId:string,now:number,context:{silentUntil?:number;event?:CharacterStatusOverride}={}):CharacterStatus {
  const id=characterId==='molly-system-secretary'?'molly':characterId;
  if(context.silentUntil&&context.silentUntil>now)return {text:'暂时不想说话',kind:'silent',until:context.silentUntil};
  const event=context.event;
  if(event&&allowed(event.text)&&event.since<=now&&event.until>now&&event.until-event.since<=2*86400000)return {text:event.text,kind:'event',until:event.until};
  const shifted=new Date(now+8*3600000),day=shifted.toISOString().slice(0,10),hour=shifted.getUTCHours();
  const seed=hash(`${id}:${day}`),count=4+seed%2;
  // One deterministic daily script: 3–5 states, each boundary on a separate hour.
  // Refreshes and devices cannot reroll a status during the same segment.
  const boundaries=count===4?[0,7,13,19]:[0,7,11,15,20];
  const index=boundaries.findLastIndex(value=>hour>=value);
  let chosen=molly.items[0];
  for(let segment=0;segment<=index;segment++){
    const at=boundaries[segment];
    const slot:Slot=at>=20||at<6?'night':at<11?'morning':at<14?'noon':at<18?'afternoon':'evening';
    const items=(libraries[id]||molly).items.filter(item=>item.slots.includes(slot)&&allowed(item.text)&&!(item.text==='周三螺蛳粉日'&&shifted.getUTCDay()!==3));
    const available=items.length?items:molly.items;
    const different=segment?available.filter(item=>item.text!==chosen.text):available;
    const pool=different.length?different:available,weight=pool.reduce((n,item)=>n+item.weight,0);
    let pick=hash(`${seed}:${segment}`)%weight;
    chosen=pool[0];for(const item of pool){pick-=item.weight;if(pick<0){chosen=item;break;}}
  }
  const midnight=Date.parse(`${day}T00:00:00+08:00`),until=midnight+(boundaries[index+1]??24)*3600000;
  return {text:chosen.text,kind:'daily',until};
}
/** Only an explicit interaction cooldown is anger; user do-not-disturb is not. */
export function statusFromState(id:string,state:unknown,now:number):CharacterStatus {
  const value=state as {interaction?:string;cooldownUntil?:number;characterStatusEvent?:CharacterStatusOverride};
  return resolveCharacterStatus(id,now,{silentUntil:value?.interaction==='cooldown'?value.cooldownUntil:undefined,event:value?.characterStatusEvent});
}
