/** Fixed demonstration transport. These cards never mutate real task or health data. */
export type OpenerCategory = 'birthday'|'pending'|'due'|'changed'|'weather'|'weekend'|'monday'|'busy'|'empty'|'normal';
export interface WeatherLine { low:number;high:number;text:string;tip?:string }
export interface ScheduleItem {
 id:string;time:string;category:'pet'|'meal'|'meal_out'|'supplement'|'water'|'training'|'sleep'|'parcel'|'housekeeping'|'pickup'|'work'|'travel'|'shopping'|'other';
 text:string;sub?:{kind:'place'|'timing'|'duration'|'reason'|'amount';text:string};tag?:'每天'|`每周${string}`|'新增'|'顺延'|'改期';ownerId:string;routineId?:string;
 /** Only explicit next-day rows carry a date; display the second-line 明天 marker. */
 date?:string;
}
export type ScheduleChange = {kind:'replace'|'add'|'remove';scheduleId?:string;item?:ScheduleItem};
export interface PendingItem {id:string;kind:'change'|'choose';text:string;ownerId:string;apply:ScheduleChange;choiceId?:string;choices?:{text:string;apply:ScheduleChange}[]}
export interface Routine {id:string;template:string;params:Record<string,string|number>;repeat:'daily'|{weekdays:number[]};defaultTime:string;postpone?:{after:'off_work';minutes:number}|null;ownerId:string;sub?:ScheduleItem['sub']}
export type ShoppingGroup = '蔬果'|'肉蛋奶'|'粮油调料'|'零食饮品'|'日用'|'宠物'|'家居家具'|'工具五金'|'数码家电'|'衣物鞋包'|'药品保健'|'礼物';
export interface ShoppingList {id:string;title:'今日采购'|'本周采购'|`周${string}采购`;notes:string[];groups:{group:ShoppingGroup;items:{name:string;qty:string;daysLeft?:number;checked?:boolean}[]}[];sources:string[];done:boolean}
export interface BillItem {id:string;type:string;name:string;action:'到期'|'自动扣费'|'还款';dueDate:string;amount?:number;button:'缴费'|'充值'|'续费'|'还款'|'管理';link?:string;paid:boolean}
export interface ProgressItem {id:string;name:string;steps:string[];done:number}
export interface UpcomingItem {id:string;text:string;date:string;kind:'birthday'|'anniversary'|'vehicle'|'document'|'event'|'other';showFrom:string}
export interface InterestItem {id:string;when:string;text:string}
export interface DailyBrief {date:string;opener:{category:OpenerCategory;text:string};header:{city:string;weather?:WeatherLine;traffic?:string};pending:PendingItem[];schedule:ScheduleItem[];shopping:ShoppingList[];bills:BillItem[];progress:ProgressItem[];upcoming:UpcomingItem[];interests:InterestItem[]}
export interface ReportRow {itemKey:string;label:string;value?:string;note?:string;danger?:boolean}
export interface ReportBlock {id:string;name:string;ownerIds:string[];rows:ReportRow[]}
export interface ReportComment {npcId:string;name:string;text:string;kind:'professional'|'companion'}
export interface WeeklyReport {range:{from:string;to:string};opener:{category:'urgent'|'progress'|'allDone'|'low'|'normal';text:string};headline:string;blocks:ReportBlock[];comments:ReportComment[]}
export interface FoldState {messageId:string;collapsedBlockIds:string[]}
export type ReportDemoAction = {action:'report-demo-action';messageId:string;itemId:string;decision:'confirm'|'dismiss'|'choose'|'select'|'bill-toggle'|'shopping-check';optionIndex?:number;groupIndex?:number;index?:number;checked?:boolean};
export type ReportDemoQuote = {action:'report-demo-quote';messageId:string;kind:'schedule'|'comment';itemId:string};
export const SHOPPING_GROUPS:ShoppingGroup[]=['蔬果','肉蛋奶','粮油调料','零食饮品','日用','宠物','家居家具','工具五金','数码家电','衣物鞋包','药品保健','礼物'];
const parseDay=(value:string)=>Date.parse(`${value}T00:00:00Z`);
export function reportDate(date:string,referenceDate:string,weekday=true){const d=new Date(parseDay(date)),sameYear=date.slice(0,4)===referenceDate.slice(0,4);return `${sameYear?'':`${d.getUTCFullYear()}年`}${d.getUTCMonth()+1}月${d.getUTCDate()}日${sameYear&&weekday?` 周${'日一二三四五六'[d.getUTCDay()]}`:''}`;}
export function reportRelativeDate(date:string,referenceDate:string){const days=Math.max(0,Math.round((parseDay(date)-parseDay(referenceDate))/86400000));return days===0?'今天':days===1?'明天':days<60?`${days}天后`:`${Math.floor(days/30)}个月后`;}
export function sortBriefSchedule(items:ScheduleItem[],date:string,sendTime='07:00'){
 const minutes=(time:string)=>{if(time==='全天')return -1;if(time==='上午')return 539;if(time==='下午')return 839;if(time==='晚上')return 1139;const [h,m]=time.split(':').map(Number);return h*60+m;};
 const start=minutes(sendTime),value=(item:ScheduleItem)=>{const n=minutes(item.time);return n===-1?-1:(item.date&&item.date>date?1440+n:n<start?n+1440:n);};
 return items.map((item,index)=>({item,index})).sort((a,b)=>value(a.item)-value(b.item)||a.index-b.index).map(row=>row.item);
}
export function shoppingPlainText(list:ShoppingList){return [`${list.title}（${list.notes.join('、')}）`,...SHOPPING_GROUPS.flatMap(group=>{const row=list.groups.find(item=>item.group===group);return row?.items.length?[`${group}：${row.items.map(item=>`${item.name} ${item.qty.replace(/\s+/gu,'')}`).join('、')}`]:[];})].join('\n');}
