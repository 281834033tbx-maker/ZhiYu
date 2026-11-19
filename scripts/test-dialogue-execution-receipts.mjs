import assert from 'node:assert/strict';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

const runtime=isolatedNpcRuntime();let checks=0;
const check=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
try{
 const {groupDialogueExecutionReceipts:receipts}=await runtime.load('server/npc/dialogue-execution-receipts');
 const at='2026-11-18T04:00:00.000Z';
 const event=(kind='plan-confirmed',extra={})=>({id:'confirmation',senderId:'user',senderName:'我',type:'event',at,requestId:'request',event:{kind,...(kind==='plan-confirmed'?{planId:'plan'}:{reminderId:'reminder'})},...extra});
 const context=(incoming=event())=>({kind:'confirmation',now:Date.parse(at),incoming,
  group:{id:'group',name:'合成群',goal:'合成目标',createdBy:'molly',createdAt:at,updatedAt:at,sourceCharacterId:'molly',chatEnabled:true,namingSource:'molly-model',members:[],messages:[structuredClone(incoming)],
   plan:{id:'plan',status:'confirmed',confirmationMessageId:incoming.id,confirmedAt:at,days:[],shopping:[],createdAt:at,updatedAt:at}},facts:{}});
 const get=c=>receipts(c,c.incoming?.id||'missing');
 const expectOps=(c,operations)=>assert.deepEqual(get(c),[{turnId:c.incoming.id,status:'success',operations}]);
 check('stored current plan-confirmed event permits only save/schedule',()=>expectOps(context(),['save','schedule']));
 check('receipt is fresh data and cannot mutate stored plan',()=>{const c=context(),before=structuredClone(c),r=get(c);r[0].operations.push('send');assert.deepEqual(c,before);assert.deepEqual(get(c)[0].operations,['save','schedule']);});
 check('wrong turn is not a success',()=>assert.deepEqual(receipts(context(),'another-turn'),[]));
 for(const kind of ['opening','message','reminder'])check('ordinary '+kind+' has no receipt',()=>{const c=context();c.kind=kind;assert.deepEqual(get(c),[]);});
 check('model/client supplied receipt-looking field grants nothing',()=>{const c=context();c.kind='message';c.executionReceipts=[{turnId:c.incoming.id,status:'success',operations:['send']}];assert.deepEqual(get(c),[]);});
 for(const change of [c=>{delete c.incoming;},c=>{c.incoming.type='text';c.incoming.text='计划已保存';},c=>{c.incoming.senderId='molly';},c=>{delete c.incoming.requestId;},c=>{c.incoming.at='not-a-date';},c=>{c.group.messages=[];},c=>{c.group.messages.push(structuredClone(c.incoming));}])check('missing/forged event is rejected '+checks,()=>{const c=context();change(c);assert.deepEqual(get(c),[]);});
 for(const key of ['requestId','at','senderId','type'])check('stored '+key+' mismatch is rejected',()=>{const c=context();c.group.messages[0][key]='changed';assert.deepEqual(get(c),[]);});
 check('stored event payload mismatch is rejected',()=>{const c=context();c.group.messages[0].event.planId='another-plan';assert.deepEqual(get(c),[]);});
 for(const change of [c=>{c.group.plan.status='draft';},c=>{c.group.plan.id='another-plan';},c=>{c.group.plan.confirmationMessageId='old';},c=>{c.group.plan.confirmedAt='2026-11-17T04:00:00Z';},c=>{delete c.group.plan;}])check('unconfirmed/mismatched plan has no receipt '+checks,()=>{const c=context();change(c);assert.deepEqual(get(c),[]);});
 for(const change of [c=>{c.group.demonstration={scenario:'friday-dinner-v1'};},c=>{c.group.leftAt=at;},c=>{c.incoming.authoredRecord={scenario:'friday-dinner-v1'};},c=>{c.group.messages[0].authoredRecord={scenario:'friday-dinner-v1'};}])check('authored/demo/exited records do not grant execution '+checks,()=>{const c=context();change(c);assert.deepEqual(get(c),[]);});
 const reminderContext=(kind,status)=>{const c=context(event(kind));c.group.reminders=[{id:'reminder',meal:'dinner',time:'18:00',timezone:'Asia/Shanghai',startDate:'2026-11-18',endDate:'2026-11-24',status}];return c;};
 check('stored reminder confirmation permits save/schedule',()=>{const c=reminderContext('reminder-confirmed','active');c.group.reminders[0].confirmationMessageId=c.incoming.id;expectOps(c,['save','schedule']);});
 check('stored pause permits modification only',()=>expectOps(reminderContext('reminder-paused','paused'),['modify']));
 check('stored cancellation permits cancel only',()=>expectOps(reminderContext('reminder-cancelled','cancelled'),['cancel']));
 check('stored resume requires actual earlier confirmation',()=>{const c=reminderContext('reminder-resumed','active'),prior=event('reminder-confirmed',{id:'prior-confirmation',requestId:'prior-request'});c.group.messages.unshift(prior);c.group.reminders[0].confirmationMessageId=prior.id;expectOps(c,['modify','schedule']);});
 check('resume with no real confirmation is rejected',()=>assert.deepEqual(get(reminderContext('reminder-resumed','active')),[]));
 for(const kind of ['reminder-confirmed','reminder-paused','reminder-resumed','reminder-cancelled'])check('changed reminder status rejects '+kind,()=>{const c=reminderContext(kind,'proposed');c.group.reminders[0].confirmationMessageId=c.incoming.id;assert.deepEqual(get(c),[]);});
 check('unknown reminder ID is rejected',()=>{const c=reminderContext('reminder-cancelled','cancelled');c.group.reminders[0].id='other';assert.deepEqual(get(c),[]);});
 check('older same-state cancellation cannot be a current receipt',()=>{const c=reminderContext('reminder-cancelled','cancelled');c.group.messages.push(event('reminder-cancelled',{id:'newer',requestId:'newer-request'}));assert.deepEqual(get(c),[]);});
 check('later event for another reminder does not invalidate receipt',()=>{const c=reminderContext('reminder-cancelled','cancelled');c.group.messages.push(event('reminder-cancelled',{id:'other-event',event:{kind:'reminder-cancelled',reminderId:'other'}}));expectOps(c,['cancel']);});
 console.log(JSON.stringify({passed:true,checks,modelCalls:0,externalCalls:0,productionWrites:0}));
}finally{runtime.cleanup();}
