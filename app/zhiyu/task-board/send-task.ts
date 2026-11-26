import type {ArrangementItem} from '../../../lib/npc/arrangement-types';
import {parseManualTaskRecord} from './manual-task-record';
import type {ManualTaskRecord, Task} from './types';

// Same closed sets the manual record parser accepts. Names stay in the board config.
const categoryIds=new Set(['fitness','recovery','nutrition','cooking','shopping','sleep','skin','chores','bills','family']);
const npcIds=new Set(['chen-nian','liu','zhou-chef','molly','yuan-xiaoman','xia-xia','he-jiawei']);

export type SendTaskInput={
  title:string;
  note?:string;
  date:string;
  npcId:string;
  categoryId:string;
  order:number;
  id?:string;
};

/** A user-authored board task. Saving still goes through the existing manual record contract. */
export function buildSendTaskRecord(input:SendTaskInput):{record:ManualTaskRecord;task:Task} {
  const note=input.note?.trim();
  const task:Task={
    id:input.id||`manual-task-${crypto.randomUUID()}`,
    title:input.title.trim(),
    date:input.date,
    categoryId:input.categoryId,
    npcId:input.npcId,
    type:'single',
    amount:'',
    status:'todo',
    order:input.order,
    ...(note?{note}:{}),
  };
  const record=parseManualTaskRecord({version:1,name:'发出的任务',selectedDate:input.date,tasks:[task],plans:[]});
  return {record,task:record.tasks[0]};
}

const sectionCategory:Record<string,string>={purchase:'shopping',plan:'chores',schedule:'chores',todo:'chores',payment:'bills',procedure:'chores',countdown:'family'};

/** Conversation context for one saved arrangement. It is not written back to the board. */
export function arrangementConversationTask(item:ArrangementItem,today:string):Task {
  const rawDate=item.time.date||item.time.deadline||today;
  const date=/^\d{4}-\d{2}-\d{2}$/.test(rawDate)?rawDate:today;
  const categoryId=sectionCategory[item.section]||'chores';
  const npcId=npcIds.has(item.sourceNpcId)?item.sourceNpcId:'molly';
  const bought=(item.details.items||[]).filter(name=>name.trim());
  return {
    id:`arrangement-${item.id}`.replace(/[^A-Za-z0-9:_-]/g,'').slice(0,128),
    title:item.title.trim()||'安排',
    categoryId:categoryIds.has(categoryId)?categoryId:'chores',
    npcId,
    type:'single',
    amount:bought.join('、'),
    date,
    order:0,
    status:item.status==='completed'?'done':'todo',
    ...(item.sourceText.trim()?{note:item.sourceText.trim()}:{}),
  };
}
