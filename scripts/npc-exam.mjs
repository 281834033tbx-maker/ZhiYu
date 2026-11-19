import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {parseEnv} from 'node:util';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';
import {legacyExamUserText} from './npc-exam-file-parser.mjs';
import {hasExamSentenceFinalPeriod} from './npc-exam-grading-rules.mjs';
const args=process.argv.slice(2),arg=name=>args.find(v=>v.startsWith('--'+name+'='))?.split('=').slice(1).join('=');
if(args.includes('--scheduled')&&process.env.NPC_EXAM_SCHEDULE_ENABLED!=='1'){console.log('Nightly exam disabled; no model called');process.exit(0);}
if(arg('exam-file')){const {runExamFile}=await import('./npc-exam-file.mjs');await runExamFile({args});}else{
const phase=arg('phase')||'after',label=arg('label')||'',selectedIds=arg('ids')?.split(','),project=process.cwd(),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
if(!['before','after'].includes(phase))throw Error('phase must be before or after');
try{process.loadEnvFile(join(project,'.env.local'));}catch(error){if(error.code!=='ENOENT')throw error;}
// An explicitly selected server configuration wins over inherited/default
// values. Never serialize the file, its digest, or credential-bearing fields.
const envFile=arg('env-file');
if(envFile)Object.assign(process.env,parseEnv(readFileSync(resolve(project,envFile),'utf8')));
if(label&&!/^[a-z0-9-]{1,60}$/.test(label))throw Error('Invalid exam label');
const output=join(project,'output/frontend-redesign-20261103','exam-'+phase+(label?'-'+label:''));
// Each normal/manual/nightly invocation is a new exam. Only explicit resume or
// grade-only may reuse a frozen run; never silently report yesterday's output.
const stamp=new Date().toISOString().replace(/[^0-9]/g,'');
if(existsSync(output)&&!args.includes('--resume')&&!args.includes('--grade-only'))renameSync(output,output+'-previous-'+stamp);
mkdirSync(output,{recursive:true});
const runtime=isolatedNpcRuntime();
const names={'小满':'yuan-xiaoman','夏夏':'xia-xia','陈年':'chen-nian','柳智敏':'liu','何嘉伟':'he-jiawei','赵一帆':'zhou-chef','Molly':'molly-system-secretary'};
const display={'yuan-xiaoman':'徐小曼','xia-xia':'夏夏','chen-nian':'陈年',liu:'柳智敏','he-jiawei':'何嘉伟','zhou-chef':'赵一帆','molly-system-secretary':'Molly'};
const hash=text=>createHash('sha256').update(text).digest('hex');
const metadataFile=join(output,'run-metadata.json'),reusing=args.includes('--resume')||args.includes('--grade-only');
let metadata,session,sessionStarted=0,completed=false;
const saveMetadata=()=>{if(metadata)writeFileSync(metadataFile,JSON.stringify(metadata,null,2));};
try{
 // A targeted fixture keeps this round's question-30 correction from
 // silently changing the other questions. The existing full-fixture flag
 // remains explicit, and the no-fixture exam is still the default.
 const fixtureArgument=arg('contextual'),fullFixture=args.includes('--contextual');
 if(fullFixture&&fixtureArgument!==undefined)throw Error('Use either --contextual or --contextual=questionIds');
 const fixtureSource=fullFixture||fixtureArgument!==undefined?readFileSync(join(project,'docs/qa/npc-exam-contextual-fixtures.json'),'utf8'):null;
 const allFixtures=fixtureSource?JSON.parse(fixtureSource):null;
 if(allFixtures&&allFixtures.source!=='synthetic-exam-state-only')throw Error('Only named synthetic exam fixtures are permitted');
 const fixtureIds=fixtureArgument===undefined?null:fixtureArgument.split(',');
 if(fixtureIds&&(fixtureIds.some(id=>!/^\d+[a-z]?$/u.test(id)||!Object.hasOwn(allFixtures.cases,id))||new Set(fixtureIds).size!==fixtureIds.length))throw Error('Unknown or duplicate contextual fixture question');
 const fixture=allFixtures?{...allFixtures,cases:fixtureIds?Object.fromEntries(fixtureIds.map(id=>[id,allFixtures.cases[id]])):allFixtures.cases}:null;
 const fixtureSelection=fixture?(fixtureIds||'all'):null;
 const {loadDialogueSkill,loadMollyDialogueSkill}=await runtime.load('server/npc/dialogue-skill');
 const {generateRaw}=await runtime.load('server/npc/codex');
 const {textProvider,deepseekMetadata}=await runtime.load('server/npc/deepseek');
 const resolvedConfiguration=textProvider()==='deepseek'?deepseekMetadata():{provider:'codex',model:process.env.NPC_CODEX_MODEL||null,thinking:null};
 const configuration={provider:resolvedConfiguration.provider,model:resolvedConfiguration.model,thinking:resolvedConfiguration.thinking};
 const guard=phase==='after'?await runtime.load('lib/npc/dialogue-output-guard'):null;
 const source=readFileSync(join(project,'npc-skills/skills/zhiyu-dialogue/tests/测试题.md'),'utf8');
 // Grading follows the transport protocol, not private-chat bubble guidance.
 // Freeze it alongside the question source so a resume cannot reuse stale grades.
 const groupProtocol=readFileSync(join(project,'npc-skills/protocols/group-collaboration.md'),'utf8');
 const groupMessageLimit=Number(/最多(\d+)条是现有传输上限/u.exec(groupProtocol)?.[1]);
 if(!Number.isInteger(groupMessageLimit)||groupMessageLimit<1)throw Error('Current group protocol message limit is missing');
 const skillSources=new Map();let section='';let items=[];
 for(const line of source.split('\n')){
  if(line.startsWith('## '))section=line.slice(3);
  if(!/^\|\s*\d+[a-z]?\s*\|/.test(line))continue;
  const [id,scene,must,avoid]=line.split('|').slice(1,-1).map(v=>v.trim()),group=section.startsWith('三')&&!['24e','25'].includes(id);
  const maxMessages=group?groupMessageLimit:4;
  const ids=group?(id==='22'?['chen-nian','liu']:id==='24'?['liu','chen-nian']:id==='24c'?['molly-system-secretary','chen-nian']:id==='24a'?['he-jiawei','yuan-xiaoman','molly-system-secretary']:['he-jiawei','yuan-xiaoman','molly-system-secretary','xia-xia']):[Object.entries(names).find(([name])=>scene.startsWith(name))?.[1]||'xia-xia'];
  const context={channel:group?'group':'private',userText:scene,hasImage:['39','40'].includes(id)};
  const rules=ids.map(identity=>{const loaded=identity==='molly-system-secretary'?loadMollyDialogueSkill(runtime.root,context):loadDialogueSkill(runtime.root,'你是'+display[identity],identity,context);for(const file of loaded.metadata.sources)skillSources.set(file.path,file.sha256);return loaded.rules;}).join('\n\n');
  const prompt=`这是隔离合成考试，不是真实用户，也没有可调用的任务/建群/发消息工具。只回答题目用户，不解释考试。严格采用对应人物的完整现行规则。不要把候选例子作为本题事实。\n${rules}\n【合成场景】${scene}\n${fixture?.cases?.[id]?"【本题已明确提供的额外合成状态，不是真实用户记录】"+JSON.stringify(fixture.cases[id])+"\n":""}场景内的阶段、情绪、历史视为本题已知条件；“图片”只有文字情景说明，本次不冒充实际看图；任务卡只可提案，不可声称已执行。\n只返回JSON：${group?'{"messages":[{"senderId":"对应人物id","text":"一条气泡"}]}':'{"messages":["一条气泡"]}'}。群聊只允许${ids.join('、')}，每人按本人表达。不要输出评分或检查点。`;
  items.push({id,section,scene,must,avoid,group,maxMessages,ids,prompt,promptHash:hash(prompt),...(fixture?.cases?.[id]?{syntheticContext:fixture.cases[id]}:{})});
 }
 if(items.length!==49)throw Error('Exam source changed; expected 49 complete questions');
 if(selectedIds){if(selectedIds.some(id=>!items.some(item=>item.id===id)))throw Error('Unknown regression question');items=items.filter(item=>selectedIds.includes(item.id));}
 const manifest={version:1,phase,configuration,questionSourceHash:hash(source),groupProtocolHash:hash(groupProtocol),examSourceHash:hash(readFileSync(new URL(import.meta.url),'utf8')),gradingRulesHash:hash(readFileSync(new URL('./npc-exam-grading-rules.mjs',import.meta.url),'utf8')),questionParserHash:hash(readFileSync(new URL('./npc-exam-file-parser.mjs',import.meta.url),'utf8')),guardHash:guard?hash(readFileSync(join(runtime.root,'lib/npc/dialogue-output-guard.mjs'),'utf8')):null,adapterHash:hash(readFileSync(join(runtime.root,'server/npc/codex.mjs'),'utf8')+readFileSync(join(runtime.root,'server/npc/deepseek.mjs'),'utf8')),skillHash:hash(JSON.stringify([...skillSources].sort(([a],[b])=>a<b?-1:a>b?1:0))),fixtureHash:fixtureSource?hash(fixtureSource):null,fixtureSelection,selectionHash:hash(JSON.stringify(items.map(item=>item.id))),promptSetHash:hash(JSON.stringify(items.map(item=>({id:item.id,promptHash:item.promptHash}))))};
 const fingerprint=hash(JSON.stringify(manifest));
 if(reusing){
  if(!existsSync(metadataFile))throw Error('Cannot resume/grade an unverified legacy run; start a new labelled exam');
  const previous=JSON.parse(readFileSync(metadataFile,'utf8'));
  if(previous.fingerprint!==fingerprint)throw Error('Exam metadata mismatch (provider/model/thinking, questions, Skill, fixture or selection); start a new labelled exam');
  metadata=previous;
 }else metadata={...manifest,fingerprint,environmentSource:envFile?'explicit-file':'default-environment',startedAt:new Date().toISOString(),finishedAt:null,status:'running',actualCalls:{generation:0,grading:0,total:0},sessions:[],gradingAttempts:[]};
 const file=join(output,'results.json'),results=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];
 if(results.some(row=>!items.some(item=>item.id===row.id&&item.promptHash===row.promptHash))||new Set(results.map(row=>row.id)).size!==results.length)throw Error('Stored responses do not match this frozen question selection');
 session={mode:args.includes('--grade-only')?'grade-only':args.includes('--resume')?'resume':'fresh',startedAt:new Date().toISOString(),finishedAt:null,durationMs:0,status:'running',actualCalls:{generation:0,grading:0,total:0}};sessionStarted=performance.now();
 metadata.sessions.push(session);metadata.status='running';metadata.finishedAt=null;saveMetadata();
 const countCall=kind=>{for(const count of [metadata.actualCalls,session.actualCalls]){count[kind]++;count.total++;}saveMetadata();};
 const promptFile=join(output,'prompts.json');
 // The before run is frozen before production changes, and is never rebuilt.
 if(!existsSync(promptFile)||phase!=='before')writeFileSync(promptFile,JSON.stringify(items,null,2));
 let cursor=0;
 const workers=async fn=>{cursor=0;await Promise.all([0,1].map(async()=>{while(cursor<items.length)await fn(items[cursor++]);}));};
 if(!args.includes('--grade-only'))await workers(async item=>{
  if(results.some(r=>r.id===item.id&&r.ok))return;
  const prior=results.find(row=>row.id===item.id),attempt={startedAt:new Date().toISOString(),finishedAt:null,durationMs:0,actualCalls:0};
  const row={...item,actualCalls:prior?.actualCalls||0,attempts:[...(prior?.attempts||[]),attempt]};delete row.prompt;
  const started=performance.now(),call=async prompt=>{attempt.actualCalls++;row.actualCalls++;countCall('generation');return generateRaw(runtime.root,prompt);};
  try{
   let raw=await call(item.prompt);
   if(guard){const guardContext={userText:legacyExamUserText(item.scene),channel:item.group?'group':'private',characterId:item.ids[0],...(item.group?{fallbackSenderId:item.ids[0]}:{})};let checked=guard.normalizeDialogueOutput(raw,guardContext);
    if(checked.issues.length){row.firstDraft=raw;row.firstIssues=checked.issues;raw=await call(item.prompt+'\n上一草稿未发送，按同一事实纠正这些问题，不新增经历：'+JSON.stringify(checked.issues));checked=guard.normalizeDialogueOutput(raw,{...guardContext,afterRewrite:true});}
    row.guardIssues=checked.issues;row.output=checked.value;
   }else row.output=raw;
   row.ok=true;
  }catch(error){row.ok=false;row.error=String(error.message);}
  attempt.finishedAt=new Date().toISOString();attempt.durationMs=Math.round(performance.now()-started);attempt.status=row.ok?'complete':'failed';row.durationMs=row.attempts.reduce((sum,attempt)=>sum+attempt.durationMs,0);
  row.at=new Date().toISOString();const priorIndex=results.findIndex(r=>r.id===row.id);if(priorIndex<0)results.push(row);else results[priorIndex]=row;
  writeFileSync(file,JSON.stringify(results,null,2));console.log(phase,item.id,row.ok?'actual model reply':'FAILED');
 });
 if(results.filter(r=>r.ok).length!==items.length)throw Error('Exam incomplete: real responses '+results.filter(r=>r.ok).length+'/'+items.length+'; not a score');
 // A separate real-model semantic grader reads only the synthetic question and
 // exact response. Hard violations below are independently deterministic.
 const gradeFile=join(output,'semantic-grades.json'),grades=existsSync(gradeFile)?JSON.parse(readFileSync(gradeFile,'utf8')):[];
 if(grades.some(grade=>!items.some(item=>item.id===grade.id))||new Set(grades.map(grade=>grade.id)).size!==grades.length)throw Error('Stored grading does not match this frozen question selection');
 for(let index=0;index<items.length;index+=5){const batch=items.slice(index,index+5).filter(item=>!grades.some(g=>g.id===item.id));if(!batch.length)continue;
  const data=batch.map(item=>({...item,prompt:undefined,personas:item.ids.map(id=>id==='molly-system-secretary'?loadMollyDialogueSkill(runtime.root).profile:loadDialogueSkill(runtime.root,'Current application identity',id).profile),output:results.find(r=>r.id===item.id).output}));
  const gradingAttempt={ids:batch.map(item=>item.id),startedAt:new Date().toISOString(),finishedAt:null,durationMs:0,actualCalls:1,status:'running'},gradingStarted=performance.now();metadata.gradingAttempts.push(gradingAttempt);countCall('grading');
  let value;try{value=await generateRaw(runtime.root,'你是独立的合成对话考试阅卷器。以下只有合成题与实际回复，没有真实用户。逐题核对must内每一个检查点、avoid内每一种禁忌，不做宽松解释、不因为语言好看放过缺项。must中的“如”仅是示例，按语义检查，不要求照抄示例台词；第28题查是否质疑敷衍道歉的诚意，第29题查是否点出对方反复这样，第30题还查认真时刻是否没有提自己的爱好。群聊条数按每题maxMessages所示的当前群聊传输上限检查，不套用私聊1–4条，也不把上限当应发条数；发言人和职责仍按本题要求检查。第七节每题都查：不用引号转述/书名号写片名、句尾不句号（省略号……、......、…及聊天式。。。不是句号，不因此扣分）、分条、颜文字仅夏夏。第30题共同经历只可采用本题scene或syntheticContext明示的记忆，题设外过去经历不能编，人物示例不作为本题事实。题目剧情仅作为已给条件，不要求真实执行功能。报告无法自动确认的语义不确定性。只返回JSON {"checks":[{"id":"题号","mustPass":true,"avoidPass":true,"issues":[{"rule":"未达的具体检查点","quote":"实际扣分原话或空串（缺项）","why":"一句理由"}]}]}。不要改写回复。\n'+JSON.stringify(data));gradingAttempt.status='returned';}finally{gradingAttempt.finishedAt=new Date().toISOString();gradingAttempt.durationMs=Math.round(performance.now()-gradingStarted);if(gradingAttempt.status==='running')gradingAttempt.status='failed';saveMetadata();}
  if(!Array.isArray(value?.checks)||value.checks.length!==batch.length||batch.some(item=>!value.checks.some(c=>c.id===item.id&&typeof c.mustPass==='boolean'&&typeof c.avoidPass==='boolean'&&Array.isArray(c.issues))))throw Error('Semantic grading incomplete; no fabricated grade');
  grades.push(...value.checks);writeFileSync(gradeFile,JSON.stringify(grades,null,2));console.log(phase,'actual grader',index+1,'-',Math.min(index+5,items.length));
 }
 const forbidden=['NPC','AI生成','生成中','生成失败','演示','原型','本地服务','Codex','DeepSeek','模型','Skill','prompt','.json','.md','npc-skills','user_required','未记录','US$','许晓曼','袁小满','许小满','周师傅'];
 const blacklist=/(?:那确实|这个我认|你的感受完全可以理解|我听着呢|我一直都在|我陪着你|是我的问题|先别急着|这个不急|算了不说他了|别自己硬扛|卡里都记着呢|根据你的记录|数据[显现]示|好好好不说)/u;
 const scored=items.map(item=>{const row=results.find(r=>r.id===item.id),semantic=grades.find(g=>g.id===item.id),parts=row.output?.messages||[],speech=parts.map(p=>typeof p==='string'?p:p?.text||'').join('\n'),issues=[...semantic.issues];
  for(const term of forbidden)if(speech.toLowerCase().includes(term.toLowerCase()))issues.push({rule:'禁词/误名：'+term,quote:speech,why:'程序独立扫描命中'});
  if(blacklist.test(speech))issues.push({rule:'句式黑名单',quote:speech.match(blacklist)[0],why:'程序独立扫描命中'});
  if(parts.length<1||parts.length>item.maxMessages)issues.push({rule:'条数1–'+item.maxMessages,quote:String(parts.length),why:'实际消息数量，按'+(item.group?'当前群聊协议':'私聊协议')+'独立扫描'});
  for(const part of parts){const text=typeof part==='string'?part:part?.text||'';if(hasExamSentenceFinalPeriod(text))issues.push({rule:'句尾句号',quote:text,why:'每题格式检查'});if(/[“”「」『』《》]/u.test(text))issues.push({rule:'引号/书名号',quote:text,why:'每题格式检查，语义例外由人工复核'});}
  if(/我(?:去过|玩过|见过|亲眼见过|到过)(?!的?(?:智域|楼下))/u.test(speech))issues.push({rule:'疑似现实亲历',quote:speech,why:'需确认否定/条件与虚构日常，不把规则命中等同事实违规'});
  const score=Math.max(0,2-(semantic.mustPass?0:1)-(semantic.avoidPass?0:1)-issues.filter(i=>i.why?.includes('独立扫描')||i.why?.includes('格式检查')).length);
  return {...row,score,semantic,issues};});
 writeFileSync(join(output,'scored.json'),JSON.stringify({sourceHash:hash(source),phase,configuration,runFingerprint:fingerprint,actualCalls:metadata.actualCalls,realResponses:items.length,grading:'same configured model in separate grading requests plus deterministic checks; not human acceptance',rows:scored},null,2));
 const latestFile=join(project,'docs/qa/latest-exam.json');
 const previousFile=join(project,'output/frontend-redesign-20261103','exam-before/scored.json');
 const previous=phase==='after'?(existsSync(latestFile)&&!label?JSON.parse(readFileSync(latestFile,'utf8')).rows:existsSync(previousFile)?JSON.parse(readFileSync(previousFile,'utf8')).rows:[]):[];
 const summary=Object.entries(display).map(([id,name])=>{const mine=scored.filter(r=>r.ids.includes(id)),before=previous.filter(r=>items.some(item=>item.id===r.id)&&r.ids.includes(id));const value=rows=>rows.length?Math.round(rows.reduce((sum,r)=>sum+r.score,0)/rows.length/2*100):null;return {name,questions:mine.length,score:value(mine),previous:value(before)};});
 let report=`# 智友真实模型隔离考试：${phase==='before'?'改造前':'改造后'}\n\n日期：${date}。本次${items.length}题真实取得回复（${items.filter(item=>!item.group).length}个私聊单轮、${items.filter(item=>item.group).length}个群聊模拟；不是连续多轮）。同一配置模型另起请求阅卷，每批最多5题，非另一模型或人工独立验收。本次新增生成${session.actualCalls.generation}次、阅卷${session.actualCalls.grading}次；本run累计生成${metadata.actualCalls.generation}次、阅卷${metadata.actualCalls.grading}次，包含失败请求与有界重写。${fixture?"本次仅对"+(fixtureIds?"第"+fixtureIds.join("、")+"题":"文档列明的题目")+"补入合成题设（如已知共同经历、计划或生活脚本），条件与原无状态测试不同，单列结果不替换原分数；题设外过去经历不可编，未提供任何虚假执行成功回执。":""}没有向正式聊天发消息、发动态、更新任务/关系/记忆。配置：provider=${configuration.provider}；model=${configuration.model??'未显式指定，使用适配器默认'}；thinking=${configuration.thinking??'不适用'}。角色核心/场景/本人资料完整注入；这是规则生成层考试，不替代生产generate/reviewVoice或群路由复核、插件端到端、视觉看图或真实任务执行验收。题39/40只有合成图片情景文字，未假称看过图片；任意陪伴题固定夏夏。固定49题中赵一帆仅1题，不能将其百分制得分当厨师能力全面评价。本次评分标准：群聊总消息上限按当前群聊协议为${groupMessageLimit}条，私聊上限4条；28/29按质疑道歉诚意/指出反复行为的语义检查，30补查认真时刻不提自身爱好。省略号（……、......、…以及聊天式。。。）不按句尾句号扣分；普通单个中文/英文句号仍检查。新标准只用于本次新考试，不改旧成绩。每题满分2分，must/avoid各1分，硬违例另扣到0；百分制为各人参与题平均（群题计入参与者）。语义阅卷仍可能误判，原话完整保留可复核，未作人工验收。元数据、题目/Skill/fixture/选题/提示hash、起止时间、各题耗时及实际请求次数见本run的run-metadata.json/results.json；不记录密钥。\n\n| 智友 | 参与题 | 得分/100 | 上次 | 变化 |\n|---|---:|---:|---:|---:|\n`;
 report+=summary.map(r=>`| ${r.name} | ${r.questions} | ${r.score} | ${r.previous??'—'} | ${r.previous===null?'—':r.score-r.previous} |`).join('\n');
 report+='\n\n## 每题与扣分原话\n\n';for(const row of scored){report+=`### ${row.id} · ${row.scene} · ${row.score}/2\n\n`+row.output.messages.map(p=>'- '+(typeof p==='string'?p:(display[p.senderId]||p.senderId)+': '+p.text)).join('\n')+'\n\n'+(row.issues.length?row.issues.map(i=>'- '+i.rule+'；原话：'+(i.quote||'（缺少要求内容）')+'；'+i.why).join('\n'):'自动检查未扣分')+'\n\n';}
 mkdirSync(join(project,'docs/qa'),{recursive:true});
 const reportPath=join(project,'docs/qa',date+'-'+phase+(label?'-'+label:'')+'.md');
 if(existsSync(reportPath))copyFileSync(reportPath,reportPath.replace(/\.md$/,'.previous-'+stamp+'.md'));
 writeFileSync(reportPath,report);
 if(phase==='after'&&!label){writeFileSync(join(project,'docs/qa',date+'.md'),report);writeFileSync(latestFile,JSON.stringify({at:new Date().toISOString(),reportPath,sourceHash:hash(source),rows:scored},null,2));}
 completed=true;console.log(JSON.stringify({phase,configuration,realResponses:items.length,graded:grades.length,actualCalls:session.actualCalls,summary}));
}finally{try{if(metadata&&session){session.finishedAt=new Date().toISOString();session.durationMs=Math.round(performance.now()-sessionStarted);session.status=completed?'complete':'failed';metadata.finishedAt=session.finishedAt;metadata.status=session.status;metadata.durationMs=metadata.sessions.reduce((sum,item)=>sum+(item.durationMs||0),0);saveMetadata();}}finally{runtime.cleanup();}}
}
