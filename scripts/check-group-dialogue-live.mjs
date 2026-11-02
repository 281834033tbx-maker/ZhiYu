import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Real configured text model, copied Skills, fictional data, disposable state.
// It never connects to the App API or writes a production conversation.
const runtime=isolatedNpcRuntime();
const {generateGroupDialogue}=await runtime.load('server/npc/group-dialogue');
const {extractTaskFacts}=await runtime.load('server/npc/group-task-memory');
const now=Date.parse('2026-10-07T04:00:00.000Z');
const at=new Date(now).toISOString();
const members=[['user','虚构测试用户','user'],['molly','Molly','admin'],['chen-nian','陈年','npc'],['zhou-chef','赵一帆','npc']].map(([id,name,role],order)=>({id,name,role,order,joinedAt:at}));
const group={id:`group-${randomUUID()}`,name:'吃好再进步',goal:'安排2026年10月8日至14日一周减脂饮食，自己做饭，需要厨师教。',sourceCharacterId:'zhou-chef',createdAt:at,updatedAt:at,createdBy:'molly',chatEnabled:true,members,messages:[],namingSource:'molly-model'};
const evidence='我对海鲜过敏，身高175厘米，体重72公斤，体脂率22%。';
const facts={version:'group-task-memory-20261007-v1',facts:extractTaskFacts('chen-nian','synthetic-history',evidence,at).filter(op=>op.action==='set').map(op=>op.fact)};
const results={isolated:true,realModel:true,syntheticUser:true,steps:[]};
const out=join('output','group-chat-live-20261007');mkdirSync(out,{recursive:true});
const outputFile=join(out,process.argv.includes('--opening-only')?'real-model-opening.json':'real-model-dialogue.json');
function check(kind,output) {
  if(kind==='opening') {
    assert.equal(output.messages[0].senderId,'molly');
    assert.match(output.messages[0].text,/老大/);
    assert.ok(output.messages[0].mentionIds.includes('chen-nian'));
    assert.ok(output.messages[0].mentionIds.includes('zhou-chef'));
    assert.match(output.messages[0].text,/\n/);
    assert.ok(output.messages.some(message=>message.senderId==='chen-nian'));
    if(process.argv.includes('--opening-only'))assert.ok(output.messages.some(message=>message.senderId==='zhou-chef'),'self-cooking introduction needs the chef handoff');
  } else {
    assert.ok(output.planDraft,'confirmed conditions must yield the seven-day draft');
    assert.equal(output.planDraft.days.length,7);
    assert.ok(!output.confirmPlan,'user asks to review, without confirming plan');
    assert.ok(!output.reminderControls?.length,'user explicitly leaves reminders disabled');
    // A warning to avoid seafood is not an ingredient assignment.
    const meals=output.planDraft.days.flatMap(day=>[day.breakfast,day.lunch,day.dinner]);
    assert.ok(meals.every(meal=>!/海鲜|虾|蟹|三文鱼|鳕鱼|金枪鱼|牡蛎|生蚝|扇贝/.test(meal.replace(/(?:不安排|避开)[^，。；]*/g,''))),'seafood allergy must be reflected in meals');
  }
}
try {
  if(process.argv.includes('--recheck')) {
    const saved=JSON.parse(readFileSync(join(out,'real-model-dialogue.json'),'utf8'));
    for(const step of saved.steps)check(step.kind,step.output);
    delete saved.error;saved.passed=true;saved.recheckedAt=new Date().toISOString();
    writeFileSync(join(out,'real-model-dialogue.json'),JSON.stringify(saved,null,2));
    console.log('PASS saved real-model output: corrected ingredient check excludes allergy warnings.');
    runtime.cleanup();process.exit(0);
  }
  for(const kind of process.argv.includes('--opening-only')?['opening']:['opening','message']) {
    const incoming=kind==='message'?{id:randomUUID(),senderId:'user',senderName:'虚构测试用户',type:'text',at,text:'其他过敏和忌口都没有。我是28岁成年男性，三餐自己做，每餐有30分钟，平时每周运动三次。这周日期是2026年10月8日到14日，不用高低碳，周六晚饭安排一顿自由餐。家里有4个鸡蛋、500克燕麦和1公斤大米，其他食材没有。早餐08:00、午餐12:30、晚餐18:30，先看计划，提醒暂时不开。',mentionIds:['chen-nian']}:undefined;
    if(incoming)group.messages.push(incoming);
    console.log(`Real model ${kind} started (fictional user only)`);
    const started=Date.now();
    const output=await generateGroupDialogue(runtime.root,{group,kind,incoming,facts,now});
    results.steps.push({kind,elapsedMs:Date.now()-started,output});
    for(const message of output.messages)group.messages.push({...message,id:randomUUID(),senderName:members.find(member=>member.id===message.senderId).name,type:'text',at});
    writeFileSync(outputFile,JSON.stringify(results,null,2));
    check(kind,output);
    console.log(`PASS real model ${kind}: ${output.messages.map(message=>message.senderId).join(', ')}, ${Date.now()-started}ms`);
  }
  results.passed=true;writeFileSync(outputFile,JSON.stringify(results,null,2));
} catch(error) {
  results.error=error instanceof Error?error.message:String(error);writeFileSync(outputFile,JSON.stringify(results,null,2));throw error;
} finally {runtime.cleanup();}
