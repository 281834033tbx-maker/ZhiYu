import {ARRANGEMENT_SECTIONS,arrangementSectionForTask,type ArrangementSectionId} from '../../../lib/npc/arrangement-sections';
import type {ArrangementItem} from '../../../lib/npc/arrangement-types';
import {npcs} from './config';
import {isTaskFinished} from './reducer';
import type {Npc,Task} from './types';

export type ArrangementBoardView='overview'|ArrangementSectionId;
export type ArrangementBoardStatus='all'|'open'|'done';
export function arrangementPreferenceLabel(category:string) {
  return ({grocery:'食材',other:'其他',all:'全部',birthday:'生日',anniversary:'纪念日',vehicle:'车辆',document:'证件',event:'出行与活动'} as Record<string,string>)[category]||(/[\u4e00-\u9fff]/.test(category)?category:'这一类');
}
export function arrangementTaskNpc(task:Task):Npc {
  return npcs.find(npc=>npc.id===task.npcId)||{id:task.npcId,name:task.publisherName||task.npcId||'智友',avatar:task.publisherAvatar||''};
}
export function arrangementBoardCounts(tasks:readonly Task[],items:readonly ArrangementItem[]) {
  return Object.fromEntries(ARRANGEMENT_SECTIONS.map(section=>[section.id,
    tasks.filter(task=>arrangementSectionForTask(task.categoryId)===section.id&&!isTaskFinished(task)).length+
    items.filter(item=>item.section===section.id&&item.status==='active').length,
  ])) as Record<ArrangementSectionId,number>;
}
export function arrangementItemMatches(item:ArrangementItem,query:string,status:ArrangementBoardStatus) {
  return item.status!=='revoked'&&(status==='all'||(status==='done'?item.status==='completed':item.status==='active'))&&
    [item.title,item.sourceText,...(item.details.items||[]),...(item.details.steps||[]).map(step=>step.title)].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}
export function arrangementTaskMatches(task:Task,status:ArrangementBoardStatus) {
  return status==='all'||(status==='done'?isTaskFinished(task):!isTaskFinished(task));
}
export const arrangementLegacyOrder=(a:Task,b:Task)=>{
  if(a.appendOrder!==undefined||b.appendOrder!==undefined)return a.appendOrder===undefined?-1:b.appendOrder===undefined?1:a.appendOrder-b.appendOrder;
  return a.date.localeCompare(b.date)||Number(!!b.pinned)-Number(!!a.pinned)||a.order-b.order;
};
