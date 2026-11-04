/** Application-owned presentation data. Reports never accept model-computed totals. */
export type ContactSource = 'default' | 'molly_intro' | 'search' | `card:${string}` | `group:${string}`;
export type CharacterStatus = {text:string;kind:'daily'|'event'|'silent';until:number};
export type CharacterStatusOverride = {text:string;since:number;until:number};
export type ReportCity = {name:string;source:'manual'|'geolocation'|'ip';locationId?:string;latitude?:number;longitude?:number};
export type ReportWeather = {min:number;max:number;text:string;icon?:string;summary:string;attribution:string;url?:string};
export type ReportAgendaItem = {id:string;date:string;time?:string;title:string;source:string;characterId?:string;groupId?:string;completed:boolean};
export type ReportDecision = {id:string;characterId:string;messageId:string;text:string;options:string[]};
export type ReportMetric = {completed:number;planned:number;missedDates:string[]};
export type ReportMeasurement = {date:string;weightKg?:number;waistCm?:number;sleep?:string;energy?:string;soreness?:string;sourceMessageId:string;sourceCharacterId:string};
export type ReportTeamMessage = {characterId:string;name:string;avatar:string;text:string;quoteId:string};
export type SecretaryReport = {
  id:string;kind:'morning'|'weekly'|'monthly';title:string;createdAt:string;startDate:string;endDate:string;
  city?:ReportCity;weather?:ReportWeather;agenda:ReportAgendaItem[];decisions:ReportDecision[];
  weekNumber?:number;completionPercent:number|null;training:ReportMetric;nutrition:ReportMetric;cooking:ReportMetric;
  packedMeals:ReportMetric|null;weightKg:number|null;previousWeightKg:number|null;waistCm:number|null;
  previousWaistCm?:number|null;goalCountdown?:{label:string;days:number};weeklyWeights:{startDate:string;weightKg:number|null}[];feelings:{sleep:string|null;energy:string|null;soreness:string|null};
  adjustments:string[];milestones:string[];nextFocus:string[];team:ReportTeamMessage[];partial:boolean;
};
export type SecretarySettings = {enabled:boolean;time:string;city?:ReportCity;weeklyEnabled?:boolean;weeklyDay?:number;weeklyTime?:string};
export type UsageHeartbeat = {action:'usage';currentNpc:string;visible:boolean;busy?:boolean;clientId:string};

export function resolveContactSource(value:unknown,characterId:string):{source?:ContactSource;internalSource?:string} {
  if(typeof value!=='string'||!value.trim())return {};
  if(value==='default'||value==='molly_intro'||value==='search'||/^(?:card|group):[a-zA-Z0-9_-]{1,128}$/.test(value))return {source:value as ContactSource};
  // Migrate old provenance without exposing its file names or revision markers.
  return {source:characterId==='molly'||characterId==='molly-system-secretary'?'default':'molly_intro',internalSource:value};
}
export function contactSourceLabel(source:unknown,names:Record<string,string>={}):string {
  if(source==='default')return '智域默认好友';
  if(source==='molly_intro')return '通过 Molly 介绍添加';
  if(source==='search')return '通过搜索添加';
  if(typeof source==='string'&&/^card:[a-zA-Z0-9_-]{1,128}$/.test(source))return names[source.slice(5)]?`通过 ${names[source.slice(5)]} 的名片添加`:'通过名片添加';
  if(typeof source==='string'&&/^group:[a-zA-Z0-9_-]{1,128}$/.test(source))return '通过群聊添加';
  return '';
}
