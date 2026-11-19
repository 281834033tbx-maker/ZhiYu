import type {ArrangementRecognition} from './arrangement-intent';
import type {ArrangementSectionId} from './arrangement-sections';
import type {ArrangementItem} from './arrangement-types';
/** Only the host attaches these fields after validating the original turn. */
export type ArrangementOfferState={id:string;section:ArrangementSectionId;title:string;question?:string;decision?:'accepted'|'declined';recognition:ArrangementRecognition;sourceMessageId:string};
export type ArrangementMessageMetadata={arrangementOffer?:ArrangementOfferState;arrangementCard?:ArrangementItem};
export function arrangementMessagePreview(message:ArrangementMessageMetadata):string|undefined {
 if(message.arrangementCard)return '[安排] '+message.arrangementCard.title;
 if(message.arrangementOffer)return message.arrangementOffer.question||'是否让Molly记录安排';
}
