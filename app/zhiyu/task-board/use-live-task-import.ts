'use client';

import {useEffect,useMemo} from 'react';
import type {GroupChat} from '../../../lib/npc/group-chat';
import type {ProfessionalTask} from '../../../lib/npc/professional-task';
import type {useTaskBoard} from './use-task-board';
import {projectLiveBoardTasks} from './live-task-import';
import {validContentResetAt} from '../../../lib/npc/content-reset';

/** The arrangement system exposes every retained persisted source at its real
 * original date. Only an explicit account reset excludes older sources; normal
 * polls never overwrite local completion, edits or append positions. */
export function useLiveTaskImport(board:ReturnType<typeof useTaskBoard>,professionalTasks:readonly ProfessionalTask[],groups:readonly GroupChat[]) {
  const {ready,model,dispatch}=board;
  const since=validContentResetAt(model.contentResetAt)?new Date(model.contentResetAt).toISOString():undefined;
  const tasks=useMemo(()=>projectLiveBoardTasks(professionalTasks,groups,since),[professionalTasks,groups,since]);
  useEffect(()=>{
    if(!ready)return;
    if(tasks.length)dispatch({type:'import-arrangement-records',tasks});
  },[ready,since,tasks,dispatch]);
}
