import type {GroupChat,GroupMessage} from './group-chat';

// Public-release compatibility only. Private maintenance manuscripts and the
// original account repair workflow are not part of the beta distribution.
export const CUT_OPENING_SCENARIO='three-month-cut-opening-v1' as const;
export const CUT_OPENING_SENDER_NAMES={molly:'Molly','zhou-chef':'赵一帆','chen-nian':'陈年',liu:'柳智敏','yuan-xiaoman':'小满'} as const;
type CutOpeningEntry={
  senderId:keyof typeof CUT_OPENING_SENDER_NAMES;
  text:string;
  mentionIds?:readonly string[];
  quoteIndex?:number;
};
export const CUT_OPENING_MESSAGES:readonly CutOpeningEntry[]=[];

export function canApplyCutOpeningRecord(_group:GroupChat):boolean {
  return false;
}

export function createCutOpeningMessages(_now:number,_group?:Pick<GroupChat,'id'|'members'>):GroupMessage[] {
  throw new Error('当前版本不支持导入历史记录');
}
