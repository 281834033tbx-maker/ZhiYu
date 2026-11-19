import type {ArrangementSectionId} from './arrangement-sections';
import type {ParsedArrangementTime} from './arrangement-time';

export type ArrangementDetails={
 items?:string[];
 steps?:Array<{title:string;done:boolean;date?:string}>;
 payment?:{name:string;remindBeforeDays:number;destination:string;button:string;link?:string};
 countdownKind?:'birthday'|'anniversary'|'vehicle'|'document'|'event'|'other';
};
export type ArrangementItem={
 id:string;section:ArrangementSectionId;title:string;time:ParsedArrangementTime;sourceText:string;
 sourceId:string;sourceNpcId:string;sourceChatId?:string;createdAt:number;updatedAt:number;
 status:'active'|'revoked'|'completed';details:ArrangementDetails;preferenceKey:string;
};
export type ArrangementSource={sourceId:string;sourceNpcId:string;sourceChatId?:string;professionalPlan?:boolean};
export type ArrangementPreference={section:ArrangementSectionId;category:string;enabled:boolean;updatedAt:number};
export type ArrangementReminder={
 id:string;item:ArrangementItem;kind:'schedule'|'deadline'|'inactive'|'payment'|'procedure'|'countdown'|'explicit';
 occurrence:string;dueAt:number;explicit:boolean;status:'pending'|'delivered'|'deferred';briefDate:string|null;text:string;
};
export type ArrangementCreateResult={status:'created'|'duplicate';item:ArrangementItem};
