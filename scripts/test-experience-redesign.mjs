import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';
const runtime=isolatedNpcRuntime();let db;
try{
 const status=await runtime.load('lib/npc/character-status'),experience=await runtime.load('lib/npc/experience'),delivery=await runtime.load('lib/npc/delivery');
 for(const id of ['molly','xia-xia','yuan-xiaoman','he-jiawei','chen-nian','liu','zhou-chef']){
  for(let day=1;day<=10;day++){
   const time=Date.parse(`2026-11-${String(day).padStart(2,'0')}T00:00:00+08:00`),states=[];
   for(let hour=0;hour<24;hour++){
    const value=status.resolveCharacterStatus(id,time+hour*3600000);
    assert.ok(Array.from(value.text).length>=2&&Array.from(value.text).length<=8);
    assert.equal(value.text,status.resolveCharacterStatus(id,time+hour*3600000+3599000).text,'stable within the same hour');
    if(states.at(-1)!==value.text)states.push(value.text);
   }
   assert.ok(states.length>=3&&states.length<=5,`${id}: ${states.length} daily segments`);
  }
 }
 const now=Date.parse('2026-11-03T12:00:00+08:00'),event={text:'写检讨中',since:now-1000,until:now+86400000};
 assert.equal(status.resolveCharacterStatus('chen-nian',now,{event}).kind,'event');
 assert.equal(status.resolveCharacterStatus('chen-nian',now,{event,silentUntil:now+5000}).text,'暂时不想说话');
 assert.equal(status.resolveCharacterStatus('chen-nian',now+5001,{event,silentUntil:now+5000}).kind,'event');
 assert.notEqual(status.resolveCharacterStatus('chen-nian',event.until+1,{event}).kind,'event');
 assert.deepEqual(experience.resolveContactSource('npc-skills/x/profile.json:user_required','chen-nian'),{source:'molly_intro',internalSource:'npc-skills/x/profile.json:user_required'});
 assert.deepEqual(experience.resolveContactSource(undefined,'chen-nian'),{});assert.equal(experience.contactSourceLabel('raw/file.md'),'');
 assert.equal(experience.contactSourceLabel('card:chen-nian',{'chen-nian':'陈年'}),'通过 陈年 的名片添加');
 console.log('PASS stable 3–5 daily statuses, hour boundaries, event/silence precedence, private provenance migration');
 const messages=['好','瘦不了，这是健身圈最老的坑','陈年'.repeat(100)].map((text,index)=>({id:String(index),turnId:'turn',role:'assistant',at:new Date(now).toISOString(),part:{type:'text',text}}));
 delivery.scheduleDelivery(messages,0,now,now,{typingSpeed:1,rng:()=>0});
 assert.ok(messages[0].typingAt-now>=500&&messages[0].typingAt-now<=1500);assert.equal(messages[0].deliverAt-messages[0].typingAt,600);
 assert.equal(messages[1].typingAt-messages[0].deliverAt,300);assert.equal(messages[2].deliverAt-messages[2].typingAt,4000);
 assert.equal(delivery.typingDuration('你好呀',.8),928);assert.equal(delivery.typingDuration('👍🏽'),600);
 let view=delivery.deliveryView(messages,null,messages[0].deliverAt+1);assert.equal(view.messages.length,1);assert.ok(view.typingAfter>messages[0].deliverAt+1);
 view=delivery.deliveryView([], {since:now},now+5000);assert.equal(view.pending,true);assert.ok(view.typingAfter<=now+1500);assert.equal(view.typingUntil,undefined);
 console.log('PASS typing latency, short/emoji pace, person multiplier, inter-message gaps and pending-model state');
 const {initializeNewAccountOpening}=await runtime.load('server/npc/experience-onboarding');
 const {SecretaryStore}=await runtime.load('server/npc/secretary-service');
 const {createMolly: _createMolly}=await runtime.load('lib/npc/molly');
 const {buildSecretaryReport,reportRange,reportParticipants}=await runtime.load('server/npc/secretary-reports');
 db=new DatabaseSync(':memory:');let clock=Date.parse('2026-11-03T06:59:00+08:00');
 const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 const weather={lookup:async(q,source)=>({name:q,source}),forecast:async()=>undefined,ipCity:async()=>undefined};
 const store=new SecretaryStore(db,runtime.root,{now:()=>clock,weather,teamAvailable:()=>false});
 assert.equal(initializeNewAccountOpening(db,runtime.root,owner,clock),true);assert.equal(initializeNewAccountOpening(db,runtime.root,owner,clock),false);
 assert.equal(initializeNewAccountOpening(db,runtime.root,other,clock,true),false);
 const molly=()=>JSON.parse(db.prepare('SELECT data FROM molly_sessions WHERE id=?').get(`${owner}:molly-system-secretary`).data);
 assert.equal(molly().messages.length,3);assert.equal(molly().messages[0].part.text,'我是Molly，你的秘书');
 assert.deepEqual(store.settings(owner),{enabled:true,time:'07:00',weeklyEnabled:true,weeklyDay:0,weeklyTime:'21:30'});clock+=61000;
 assert.equal(await store.morning(owner),false);assert.equal(molly().messages.filter(m=>m.part.type==='city_request').length,0);
 store.updateCity(owner,{name:'深圳',source:'manual'});assert.equal(await store.morning(owner),false);
 assert.equal(db.prepare('SELECT count(*) n FROM molly_sessions').get().n,1,'legacy account remains untouched');
 store.ensureReportDemos(owner);assert.equal(molly().messages.filter(m=>m.part.type==='daily_brief').length,1);assert.equal(molly().messages.filter(m=>m.part.type==='weekly_report').length,1);
 store.ensureReportDemos(owner);assert.equal(molly().messages.filter(m=>m.part.type==='daily_brief').length,1);
 console.log('PASS registration-only opening, no automatic city/weather/report, demo daily and weekly once');
 clock=Date.parse('2026-11-08T21:30:00+08:00');await store.scanReports();await store.scanReports();assert.equal(db.prepare("SELECT count(*) n FROM npc_experience_reports").get().n,0);
 clock=Date.parse('2026-12-01T09:00:00+08:00');await store.scanReports();assert.equal(db.prepare("SELECT count(*) n FROM npc_experience_reports").get().n,0);
 assert.deepEqual(reportRange('monthly',clock),{startDate:'2026-11-01',endDate:'2026-11-30'});
 const measurement={date:'2026-11-02',weightKg:70,sourceMessageId:'actual',sourceCharacterId:'chen-nian'};
 const task=(id,date,done=false)=>({id,characterId:'chen-nian',title:'真实训练',status:done?'completed':'skipped',goalKey:id,createdAt:`${date}T08:00:00+08:00`,updatedAt:`${date}T09:00:00+08:00`,revision:1,sourceMessageId:'u',cardMessageId:'c',steps:[{id:'step',title:'卧推',details:[],hints:[],scheduledDate:date,...(done?{completedAt:`${date}T09:00:00+08:00`}:{skippedAt:`${date}T23:59:00+08:00`})}]});
 const input={now:Date.parse('2026-11-08T20:00:00+08:00'),snapshot:{today:'2026-11-08',todayEntries:[],allEntries:[],groups:[],professionalTasks:[task('one','2026-11-02',true),task('two','2026-11-04')],readErrors:0},completions:{},measurements:[measurement,{...measurement,weightKg:72},{...measurement,date:'2026-11-03',weightKg:69}],conversations:[{characterId:'xia-xia',state:{messages:[{id:'user',role:'user',at:'2026-11-03T08:00:00+08:00',part:{type:'text',text:'真实聊天'}}]}},{characterId:'he-jiawei',state:{messages:[]}}]};
 const report=buildSecretaryReport('weekly',input);assert.deepEqual(report.training,{planned:2,completed:1,missedDates:['2026-11-04']});assert.equal(report.completionPercent,50);assert.equal(report.weightKg,70);assert.equal(report.waistCm,null);assert.equal(report.packedMeals,null);assert.deepEqual(report.team.map(row=>row.characterId),['chen-nian','xia-xia']);
 input.conversations.push({characterId:'chen-nian',state:{messages:[],interaction:'cooldown',cooldownUntil:input.now+1000}});assert.deepEqual(reportParticipants(input,report.startDate,report.endDate).map(row=>row.characterId),['xia-xia']);
 const boundary=buildSecretaryReport('weekly',{...input,now:Date.parse('2027-01-03T20:00:00+08:00')});assert.equal(boundary.weekNumber,53);
 console.log('PASS legacy pure weekly/monthly arithmetic retained, true task arithmetic, missing records, equal daily weighting, real participating team and silence exclusion');
 clock=Date.parse('2026-12-02T10:00:00+08:00');let sent=0;
 for(let i=0;i<=240;i++){sent+=Number(store.usage(owner,{currentNpc:'molly',visible:true,busy:false,clientId:'window-one'}).sent);clock+=30000;}
 assert.equal(sent,1);assert.equal(store.usage(owner,{currentNpc:'molly',visible:true,clientId:'window-two'}).sent,false);
 store.usage(owner,{currentNpc:'molly',visible:false,clientId:'window-one'});store.usage(owner,{currentNpc:'molly',visible:false,clientId:'window-two'});
 assert.equal(store.usage(owner,{currentNpc:'molly',visible:true,clientId:'window-one'}).activeMs,0);
 assert.equal(store.usage(other,{currentNpc:'molly',visible:true,clientId:'window-one'}).activeMs,0);
 assert.throws(()=>store.usage(owner,{currentNpc:'forged',visible:true,clientId:'window-one'}));
 console.log('PASS two-hour visible use once, overlapping clients no double count, hidden reset, owner isolation and target validation');
 const {GroupChatStore}=await runtime.load('server/npc/groups-plugin');
 let release;const groupOutput=new Promise(resolve=>{release=resolve;});
 const groups=new GroupChatStore(db,runtime.root,async()=> '合成节奏群',()=>clock,()=>crypto.randomUUID(),async()=>groupOutput);
 const group=await groups.create(owner,{requestId:crypto.randomUUID(),sourceCharacterId:'molly',goal:'合成测试',memberIds:['chen-nian'],self:{name:'合成用户'}});
 const running=groups.run(owner,group.id);await new Promise(resolve=>setImmediate(resolve));
 let groupView=groups.get(owner,group.id);assert.equal(groupView.pending,true);assert.equal(groupView.typingName,'Molly');assert.ok(groupView.typingAfter>=clock+500&&groupView.typingAfter<=clock+1500);
 release({messages:[{senderId:'molly',text:'群里说',mentionIds:[]},{senderId:'chen-nian',text:'好',mentionIds:[]}]});await running;
 const storedGroup=JSON.parse(db.prepare('SELECT data FROM npc_group_chats WHERE owner=? AND id=?').get(owner,group.id).data);
 assert.equal(groups.get(owner,group.id).messages.length,0,'future bubbles stay private until their actual delivery');
 assert.equal(storedGroup.messages[1].deliverAt-storedGroup.messages[1].typingAt,540,'Chen multiplier applied in groups');
 clock=storedGroup.messages[0].deliverAt+1;groupView=groups.get(owner,group.id);assert.equal(groupView.messages.length,1);assert.equal(groupView.typingName,'陈年');assert.ok(groupView.typingAfter>clock,'quiet gap before next person');
 clock=storedGroup.messages[1].deliverAt+1;assert.equal(groups.get(owner,group.id).messages.length,2);assert.equal(groups.get(owner,group.id).pending,false);groups.stop();
 assert.ok(delivery.presentationPending({messages:[{role:'user',turnId:'queued',at:new Date(clock).toISOString()}],queue:['queued'],pending:null},clock));
 assert.equal(delivery.presentationPending({messages:[],queue:['queued'],error:'failed',pending:null},clock),null);
 console.log('PASS group model-wait indicator, serial per-person pacing, delivery visibility and queued-user typing anchor');
 db.exec('CREATE TABLE sessions(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,data TEXT NOT NULL)');
 db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(`${owner}:xia-xia:normal`,1,JSON.stringify({characterId:'xia-xia',revision:1,messages:[],queue:[],pending:null}));
 const quotedReport={...report,id:'weekly:quote-synthetic',team:[{characterId:'xia-xia',name:'夏夏',avatar:'/test.png',text:'合成原句',quoteId:'synthetic-team-quote'}]};
 db.prepare('INSERT INTO npc_experience_reports VALUES(?,?,?)').run(owner,quotedReport.id,JSON.stringify(quotedReport));
 const quote=store.reportQuote(owner,quotedReport.id,'xia-xia'),again=store.reportQuote(owner,quotedReport.id,'xia-xia');assert.deepEqual(again,quote);
 const quotedState=JSON.parse(db.prepare('SELECT data FROM sessions WHERE id=?').get(`${owner}:xia-xia:normal`).data);assert.equal(quotedState.messages.length,1);assert.equal(quotedState.messages[0].role,'assistant');assert.equal(quotedState.messages[0].part.text,'合成原句');assert.throws(()=>store.reportQuote(other,quotedReport.id,'xia-xia'));
 console.log('PASS report-to-private quote source validation, original text, no fake user, click/refresh dedupe and owner isolation');

 const {extractTaskFacts}=await runtime.load('server/npc/group-task-memory');
 assert.ok(extractTaskFacts('liu','s','我腰围90厘米',new Date(clock).toISOString()).some(op=>op.fact?.key==='waist'&&op.fact.value===90));
 assert.equal(extractTaskFacts('liu','s','朋友腰围90厘米',new Date(clock).toISOString()).length,0);
 assert.ok(extractTaskFacts('liu','s','我睡眠一般',new Date(clock).toISOString()).some(op=>op.fact?.key==='sleep'));
 const {createWeatherProvider}=await runtime.load('server/npc/weather-provider');let calls=0;
 const fakeFetch=async(url,options)=>{calls++;assert.equal(options.headers['X-QW-Api-Key'],'synthetic-key');return {ok:true,json:async()=>url.includes('/geo/')?{code:'200',location:[{name:'南山',adm2:'深圳',id:'101280604',lat:'22.53',lon:'113.93'}]}:{days:[{forecastStartTime:'2026-11-03T07:00:00+08:00',temperatureMin:{value:20},temperatureMax:{value:27},daytime:{condition:{text:'多云',code:'101'}}}]}};};
 const provider=createWeatherProvider({WEATHER_API_KEY:'synthetic-key',WEATHER_API_HOST:'synthetic.xy.qweatherapi.com'},fakeFetch),city=await provider.lookup('深圳','manual');assert.equal(city.name,'深圳');assert.equal((await provider.forecast(city,'2026-11-03')).max,27);assert.equal(calls,2);
 const disabled=createWeatherProvider({},async()=>{throw Error('must not request without configuration');});assert.equal(await disabled.forecast({name:'深圳',source:'manual'},'2026-11-03'),undefined);
 console.log('PASS bounded sourced measurements and optional authenticated dedicated-host weather adapter; no network/model/device/production DB');
 store.stop();db.close();db=undefined;
}finally{db?.close();runtime.cleanup();}
