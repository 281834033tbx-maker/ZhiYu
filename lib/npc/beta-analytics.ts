export const BETA_EVENT_TYPES = ['app_open','session_end','message_sent','proactive_replied','voice_call','video_call','brief_viewed','weekly_viewed','plan_created','task_created','task_completed','platform_opened','card_shared','survey_submitted'] as const;
export type BetaEventType = typeof BETA_EVENT_TYPES[number];
export type BetaAdminRole = 'founder'|'investor';
export type BetaEventMeta = {context?:'private'|'group';groupId?:string;domain?:string;platform?:string;surveyId?:'A'|'B';recipientIds?:string[]};
export type BetaMetric = {value:number|null;unit?:string;detail?:string};
export type BetaRetention = {day:number;eligible:number;retained:number;rate:number|null};
export type BetaUserRow = {id:string;userNumber:string;note?:string;internal?:boolean;joinedAt:number;lastActiveAt:number|null;messageCount:number;activeSeconds:number;favoriteNpc:string|null};
export type BetaSeriesPoint = {date:string;activeUsers:number;messages:number};
export type BetaNpcRow = {npcId:string;messages:number;callMinutes:number};
export type BetaFeatureRow = {id:string;label:string;count:number};
export type BetaCohort = {date:string;users:number;retention:BetaRetention[]};
export type BetaSurveyQuestionAnalytics = {id:string;label:string;kind:string;total:number;options?:{value:string;label:string;count:number;percentage:number|null}[];answers?:{userNumber:string;answer:string;contact?:string}[]};
export type BetaSurveyVersionAnalytics = {received?:number;submitted?:number;completionRate?:number|null;nps?:{score:number|null;total:number;promoters:number;passives:number;detractors:number};completion?:{received:number;submitted:number;rate:number|null};questions:BetaSurveyQuestionAnalytics[]};
export type BetaSurveyAnalytics = {versions:{A:BetaSurveyVersionAnalytics;B:BetaSurveyVersionAnalytics};completion:{received:number;submitted:number;rate:number|null};veryDisappointed:{count:number;total:number;rate:number|null}};
export type BetaDashboard = {
  updatedAt:number;role:BetaAdminRole;metrics:Record<string,BetaMetric>;
  series:BetaSeriesPoint[];cohorts:BetaCohort[];retention:BetaRetention[];
  npcs:BetaNpcRow[];features:BetaFeatureRow[];users:BetaUserRow[];
  surveys:BetaSurveyAnalytics;definition:string;
};
export const BETA_NPC_NAMES:Record<string,string> = {molly:'Molly','xia-xia':'夏夏','yuan-xiaoman':'小满',liu:'柳智敏','chen-nian':'陈年','he-jiawei':'何嘉伟','zhou-chef':'赵一帆'};
export function beijingDate(at:number):string {return new Date(at+8*3600000).toISOString().slice(0,10);}
export function beijingTime(at:number|null):string {return at===null?'暂无记录':new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(at));}
