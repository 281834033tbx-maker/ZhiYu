import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';
const runtime=isolatedNpcRuntime();const db=new DatabaseSync(':memory:');
try{
 const {SecretaryStore}=await runtime.load('server/npc/secretary-service');
 const {shoppingPlainText,sortBriefSchedule,reportDate,reportRelativeDate}=await runtime.load('lib/npc/molly-reports');
 const config=await runtime.load('lib/npc/molly-report-config');
 const {isReportDemoMessage}=await runtime.load('lib/npc/report-demo-history');
 const owner=crypto.randomUUID(),other=crypto.randomUUID();let now=Date.parse('2026-11-04T10:00:00+08:00'),weatherCalls=0,modelCalls=0;
 const store=new SecretaryStore(db,runtime.root,{now:()=>now,weather:{lookup:async()=>{weatherCalls++;},ipCity:async()=>{weatherCalls++;},forecast:async()=>{weatherCalls++;}},writeTeam:async()=>{modelCalls++;},teamAvailable:()=>true});
 const saved=(id=owner,table='molly_sessions',suffix='molly-system-secretary')=>JSON.parse(db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(`${id}:${suffix}`).data);
 const molly=()=>saved();
 const ids=store.ensureReportDemos(owner);assert.ok(ids.dailyMessageId);assert.ok(ids.weeklyMessageId);assert.equal(store.ensureReportDemos(owner).dailyMessageId,undefined);
 assert.equal(molly().messages.length,4);assert.equal(molly().messages[0].part.text,'早 两件事等你定');assert.equal(molly().messages[2].part.text,'周报 有两件要紧的');assert.ok(molly().messages.every(isReportDemoMessage));
 const daily=()=>molly().messages.find(m=>m.id===ids.dailyMessageId).part.brief;
 assert.equal(daily().schedule.length,9);assert.equal(daily().bills.length,5);assert.equal(daily().pending.length,2);assert.equal(daily().shopping.length,2);
 const week=molly().messages.find(m=>m.id===ids.weeklyMessageId).part.report,weekBefore=JSON.stringify(week);
 assert.equal(week.blocks.length,8);assert.equal(week.comments.length,6);assert.equal(week.headline,'体重 −1.4斤 · 离目标还差 6.2斤');
 assert.throws(()=>store.reportDemoAction(other,{action:'report-demo-action',messageId:ids.dailyMessageId,itemId:'property',decision:'bill-toggle'}));
 assert.throws(()=>store.reportDemoAction(owner,{action:'report-demo-action',messageId:ids.weeklyMessageId,itemId:'property',decision:'bill-toggle'}));
 assert.throws(()=>store.regenerateReportDemo(owner,'monthly'));
 for(const id of ['move-legs','dinner-takeout'])store.reportDemoAction(owner,{action:'report-demo-action',messageId:ids.dailyMessageId,itemId:id,decision:'confirm'});
 assert.equal(daily().pending.length,0);assert.equal(daily().schedule.length,10);assert.equal(daily().schedule.find(row=>row.id==='legs'),undefined);assert.equal(daily().schedule.find(row=>row.id==='dinner').text,'晚餐：外卖');
 store.reportDemoAction(owner,{action:'report-demo-action',messageId:ids.dailyMessageId,itemId:'move-legs',decision:'confirm'});assert.equal(daily().schedule.length,10,'repeat receipt is idempotent');
 const action={action:'report-demo-action',messageId:ids.dailyMessageId,itemId:'property',decision:'bill-toggle'};
 store.reportDemoAction(owner,{...action,checked:true});store.reportDemoAction(owner,{...action,checked:true});assert.equal(daily().bills[0].paid,true);store.reportDemoAction(owner,{...action,checked:false});assert.equal(daily().bills[0].paid,false);
 const list=daily().shopping[0];for(let gi=0;gi<list.groups.length;gi++)for(let index=0;index<list.groups[gi].items.length;index++)store.reportDemoAction(owner,{action:'report-demo-action',messageId:ids.dailyMessageId,itemId:list.id,decision:'shopping-check',groupIndex:gi,index,checked:true});assert.equal(daily().shopping[0].done,true);
 assert.equal(shoppingPlainText(list),'今日采购（今明两天的食材）\n蔬果：西红柿 3个、西兰花 1颗、青椒 2个\n肉蛋奶：鸡胸肉 1斤、鸡蛋 1盒\n粮油调料：生抽 1瓶\n日用：抽纸 1提\n宠物：狗粮 1袋');
 const quote=store.reportDemoQuote(owner,{action:'report-demo-quote',messageId:ids.dailyMessageId,kind:'schedule',itemId:'parcels'});assert.equal(quote.characterId,'molly');assert.equal(store.reportDemoQuote(owner,{action:'report-demo-quote',messageId:ids.dailyMessageId,kind:'schedule',itemId:'parcels'}).messageId,quote.messageId);
 for(const comment of week.comments){const q=store.reportDemoQuote(owner,{action:'report-demo-quote',messageId:ids.weeklyMessageId,kind:'comment',itemId:comment.npcId});assert.equal(q.text,comment.text);assert.equal(q.characterId,comment.npcId);}
 assert.equal(JSON.stringify(molly().messages.find(m=>m.id===ids.weeklyMessageId).part.report),weekBefore,'quoted snapshot remains frozen');
 const more=store.regenerateReportDemo(owner,'weekly');assert.notEqual(more.messageId,ids.weeklyMessageId);assert.equal(molly().messages.filter(m=>m.part.type==='weekly_report').length,2);
 const fresh=store.regenerateReportDemo(owner,'daily').messageId;store.reportDemoAction(owner,{action:'report-demo-action',messageId:fresh,itemId:'move-legs',decision:'dismiss'});assert.equal(molly().messages.find(m=>m.id===fresh).part.brief.schedule.length,9);
 // A future choose variant uses a server-owned choice card, never the normal model send.
 const row=molly(),b=row.messages.find(m=>m.id===fresh).part.brief;b.pending.push({id:'choice-variant',kind:'choose',text:'晚餐（2 选 1）',ownerId:'liu',apply:{kind:'add'},choices:[{text:'外卖',apply:{kind:'add',item:{id:'dinner2',time:'晚上',category:'meal_out',text:'晚餐：外卖',ownerId:'liu',tag:'改期'}}},{text:'食堂',apply:{kind:'add',item:{id:'dinner2',time:'晚上',category:'meal_out',text:'晚餐：食堂',ownerId:'liu',tag:'改期'}}}]});db.prepare('UPDATE molly_sessions SET data=? WHERE id=?').run(JSON.stringify(row),`${owner}:molly-system-secretary`);
 const choice=store.reportDemoAction(owner,{action:'report-demo-action',messageId:fresh,itemId:'choice-variant',decision:'choose'});assert.ok(choice.choiceMessageId);
 assert.throws(()=>store.reportDemoAction(owner,{action:'report-demo-action',messageId:choice.choiceMessageId,itemId:'choice-variant',decision:'select',optionIndex:-1}));
 store.reportDemoAction(owner,{action:'report-demo-action',messageId:choice.choiceMessageId,itemId:'choice-variant',decision:'select',optionIndex:1});assert.equal(molly().messages.find(m=>m.id===fresh).part.brief.schedule.find(r=>r.id==='dinner2').text,'晚餐：食堂');assert.equal(molly().messages.find(m=>m.id===choice.choiceMessageId).part.selection.index,1);assert.throws(()=>store.reportDemoAction(owner,{action:'report-demo-action',messageId:choice.choiceMessageId,itemId:'choice-variant',decision:'select',optionIndex:0}));
 const count=molly().messages.length;
 const busy=molly();busy.pending={id:'isolated-pending',since:now};db.prepare('UPDATE molly_sessions SET data=? WHERE id=?').run(JSON.stringify(busy),`${owner}:molly-system-secretary`);
 assert.throws(()=>store.regenerateReportDemo(owner,'daily'));assert.equal(molly().messages.length,count);busy.pending=null;db.prepare('UPDATE molly_sessions SET data=? WHERE id=?').run(JSON.stringify(busy),`${owner}:molly-system-secretary`);
 const restarted=new SecretaryStore(db,runtime.root,{now:()=>now});restarted.ensureReportDemos(owner);assert.equal(molly().messages.length,count,'restarted service does not repeat fixed demos');
 store.updateSettings(owner,{enabled:true,time:'09:30',weeklyEnabled:true,weeklyDay:3,weeklyTime:'10:30'});now=Date.parse('2026-12-01T22:00:00+08:00');await store.scanMorning();await store.scanReports();await store.morning(owner);await store.locateCity(owner,'深圳','ip');assert.equal(molly().messages.length,count);assert.equal(modelCalls,0);assert.equal(weatherCalls,0);
 const dates=[{id:'night',time:'06:00'},{id:'pm',time:'晚上'},{id:'all',time:'全天'},{id:'am',time:'上午'},{id:'9',time:'09:00'}];assert.deepEqual(sortBriefSchedule(dates,'2026-11-04').map(r=>r.id),['all','am','9','pm','night']);assert.equal(reportDate('2026-11-06','2026-11-04'),'11月6日 周五');assert.equal(reportDate('2027-04-03','2026-11-04'),'2027年4月3日');assert.equal(reportRelativeDate('2027-04-03','2026-11-04'),'5个月后');
 assert.equal(config.billCatalog.length,19);assert.equal(config.weeklyBlocks.length,9);assert.equal(config.dailyTemplates.shoppingNotes.length,11);assert.equal(config.dailyTemplates.shoppingGroups.length,12);assert.equal(config.briefOpeners.noRepeatDays,7);assert.equal(config.reportOpeners.noRepeatWeeks,4);
 assert.throws(()=>store.reportDemoAction('forged',{}));assert.throws(()=>store.reportDemoQuote(owner,{action:'report-demo-quote',messageId:ids.weeklyMessageId,kind:'comment',itemId:'molly'}));
 console.log('PASS fixed full demo payloads, once-per-owner, original-card actions, shopping completion/copy, same-owner quotes including Molly and six uninitialised NPCs, immutable weekly, future choice isolated, no automatic/weather/model calls, config completeness and overnight formats');
}finally{db.close();runtime.cleanup();}
