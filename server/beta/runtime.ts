import { npcMoments } from '../npc/moments-plugin';
import { npcImageWorker } from '../npc/image-worker';
import { npcAudio } from '../npc/audio';
import { npcVoiceWorker } from '../npc/voice-worker';
import { npcMedia } from '../npc/media';
import { npcLocal } from '../npc/plugin';
import { liuLocal } from '../npc/liu-plugin';
import { yuanLocal } from '../npc/yuan-plugin';
import { mollyLocal } from '../npc/molly-plugin';
import { chenLocal } from '../npc/chen-plugin';
import { heLocal } from '../npc/he-plugin';
import { chefLocal } from '../npc/zhou-chef-plugin';
import { authLocal } from '../npc/auth-plugin';
import { groupChatsLocal } from '../npc/groups-plugin';
import { secretaryLocal } from '../npc/secretary-plugin';
import {arrangementsLocal} from '../npc/arrangements-plugin';
import {npcOpeningLocal} from '../npc/opening-plugin';
import {dialoguePreferencesLocal} from '../npc/dialogue-preferences-plugin';
import { dialogueHealth } from '../npc/dialogue-health';
import { localServiceHealth } from '../npc/local-service-health';
import { npcQwenLocalWorker } from '../npc/qwen-local-worker';
import { npcRealtimeSpeechSettings } from '../npc/realtime-speech-settings';
import { npcRealtimeSpeechGateway } from '../npc/realtime-speech-gateway';
import { loadXiaomanRealtimeContext, updateXiaomanRealtimeContext, recordXiaomanRealtimeEvent } from '../npc/realtime-speech-context';
import {betaAnalyticsLocal} from '../npc/beta-analytics-plugin';
import {betaSurveysLocal} from '../npc/beta-surveys-plugin';
import {noteBetaSurveyOpen} from '../npc/beta-survey-store';
import {recordBetaEvent} from '../npc/beta-analytics-store';
import type {Plugin} from 'vite';
import {recordBetaBoardState} from '../npc/beta-task-events';

/** The same authenticated API chain serves desktop dev and the Node beta release. */
export function zhiyuRuntimePlugins():Plugin[]{return [
      localServiceHealth(),
      dialogueHealth(),
      authLocal({onStateSaved:recordBetaBoardState}),
      betaAnalyticsLocal({onOpen:noteBetaSurveyOpen}),
      betaSurveysLocal({onSubmitted:(db,event)=>{recordBetaEvent(db,{accountId:event.accountId,eventId:'survey:'+event.submissionId,type:'survey_submitted',at:event.at,meta:{surveyId:event.surveyId}});}}),
      arrangementsLocal(),
      dialoguePreferencesLocal(),
      npcOpeningLocal(),
      groupChatsLocal(),
      secretaryLocal(),
      // Realtime credentials/context stay in the local Node service; the
      // browser uses an authenticated PCM socket for Xiaoman's voice calls.
      npcRealtimeSpeechSettings(),
      npcRealtimeSpeechGateway({ loadContext: loadXiaomanRealtimeContext, updateContextForInput:updateXiaomanRealtimeContext, recordEvent: recordXiaomanRealtimeEvent }),
      npcMedia(),
      npcAudio(),
      npcVoiceWorker(),
      npcQwenLocalWorker(),
      npcLocal(),
      mollyLocal(),
      yuanLocal(),
      liuLocal(),
      chenLocal(),
      heLocal(),
      chefLocal(),
      npcImageWorker(),
      npcMoments(),
];}
