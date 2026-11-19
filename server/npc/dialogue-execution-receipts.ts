import type {DialogueExecutionReceipt} from '../../lib/npc/dialogue-output-guard';
import type {GroupMessage} from '../../lib/npc/group-chat';
import type {GroupDialogueContext} from './group-dialogue';

/** These are stored server control events, never a model proposal or a user
 * text claiming success. A receipt is scoped to this event and operation. */
export function groupDialogueExecutionReceipts(context:GroupDialogueContext,turnId:string):DialogueExecutionReceipt[]{
  const incoming=context.incoming,group=context.group;
  if(context.kind!=='confirmation'||!incoming||!turnId||turnId!==incoming.id
    ||group.demonstration||group.leftAt||incoming.authoredRecord
    ||incoming.type!=='event'||incoming.senderId!=='user'||!incoming.event
    ||!incoming.requestId||!Number.isFinite(Date.parse(incoming.at)))return [];
  const matches=group.messages.filter(message=>message.id===incoming.id);
  if(matches.length!==1)return [];
  const stored=matches[0];
  if(stored.type!=='event'||stored.senderId!=='user'||stored.authoredRecord||!stored.event
    ||stored.at!==incoming.at||stored.requestId!==incoming.requestId
    ||stored.event?.kind!==incoming.event.kind||stored.event?.planId!==incoming.event.planId
    ||stored.event?.reminderId!==incoming.event.reminderId)return [];
  const success=(operations:DialogueExecutionReceipt['operations']):DialogueExecutionReceipt[]=>[
    {turnId,status:'success',operations},
  ];
  if(stored.event.kind==='plan-confirmed'){
    const plan=group.plan;
    return plan&&stored.event.planId===plan.id&&plan.status==='confirmed'
      &&plan.confirmationMessageId===stored.id&&plan.confirmedAt===stored.at
      ?success(['save','schedule']):[];
  }
  const reminderId=stored.event.reminderId;
  const reminder=group.reminders?.find(item=>item.id===reminderId);
  if(!reminderId||!reminder)return [];
  // Pause/resume/cancel do not have their own last-mutation ID on a reminder.
  // Require the actual latest stored control event, not an older equal state.
  const controls=group.messages.filter(message=>message.type==='event'
    &&message.senderId==='user'&&message.event?.reminderId===reminderId);
  if(controls.at(-1)?.id!==stored.id)return [];
  const confirmed=():boolean=>!!reminder.confirmationMessageId&&group.messages.some((message:GroupMessage)=>
    message.id===reminder.confirmationMessageId&&message.type==='event'&&message.senderId==='user'
    &&!message.authoredRecord&&message.event?.kind==='reminder-confirmed'
    &&message.event.reminderId===reminderId);
  switch(stored.event.kind){
    case 'reminder-confirmed':return reminder.status==='active'
      &&reminder.confirmationMessageId===stored.id?success(['save','schedule']):[];
    case 'reminder-paused':return reminder.status==='paused'?success(['modify']):[];
    case 'reminder-resumed':return reminder.status==='active'&&confirmed()?success(['modify','schedule']):[];
    case 'reminder-cancelled':return reminder.status==='cancelled'?success(['cancel']):[];
    default:return [];
  }
}
