'use client';

import {useEffect,useMemo} from 'react';
import type {GroupChat} from '../../../lib/npc/group-chat';
import type {ProfessionalTask} from '../../../lib/npc/professional-task';
import type {useTaskBoard} from './use-task-board';
import {projectLiveBoardTasks} from './live-task-import';

/** Subscribe to the existing account-scoped task feeds. A creation snapshot is
 * appended once; routine polls never overwrite the presentation's local progress. */
export function useLiveTaskImport(board:ReturnType<typeof useTaskBoard>,professionalTasks:readonly ProfessionalTask[],groups:readonly GroupChat[]) {
  const {ready,model,dispatch}=board;
  const since=model.liveImport?.since;
  const tasks=useMemo(()=>projectLiveBoardTasks(professionalTasks,groups,since),[professionalTasks,groups,since]);
  useEffect(()=>{
    if(!ready)return;
    if(!since){dispatch({type:'enable-live-import',now:Date.now()});return;}
    if(tasks.length)dispatch({type:'import-tasks',tasks});
  },[ready,since,tasks,dispatch]);
}
