import type {TaskPageContext} from '../../../lib/npc/task-page-context';
import type {Task} from './types';

/** A user-selected snapshot, not a task-store mutation or a new instruction. */
export function taskPageContextFor(task:Task):TaskPageContext {
  const progress=task.count?`${task.count.current}/${task.count.target}${task.count.unit}`:task.steps?`${task.steps.filter(step=>step.done).length}/${task.steps.length}步骤完成`:task.status;
  const summary=[`分量：${task.amount}`,task.tip?`提醒：${task.tip}`:'',`进度：${progress}`,task.note||'',...(task.steps||[]).map((step,index)=>`${index+1}. ${step.name}：${step.actual||step.detail}${step.done?'（已完成）':''}`)].filter(Boolean).join('\n').slice(0,1800);
  return {source:'task-page-demo',id:task.id,title:task.title,date:task.date,summary};
}
