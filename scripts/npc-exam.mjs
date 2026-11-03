import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';
const args=process.argv.slice(2),arg=name=>args.find(v=>v.startsWith('--'+name+'='))?.split('=').slice(1).join('=');
if(args.includes('--scheduled')&&process.env.NPC_EXAM_SCHEDULE_ENABLED!=='1'){console.log('Nightly exam disabled; no model called');process.exit(0);}
const phase=arg('phase')||'after',label=arg('label')||'',selectedIds=arg('ids')?.split(','),project=process.cwd(),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
if(!['before','after'].includes(phase))throw Error('phase must be before or after');
try{process.loadEnvFile(join(project,'.env.local'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(label&&!/^[a-z0-9-]{1,60}$/.test(label))throw Error('Invalid exam label');
const output=join(project,'output/frontend-redesign-20261103','exam-'+phase+(label?'-'+label:''));
// Each normal/manual/nightly invocation is a new exam. Only explicit resume or
// grade-only may reuse a frozen run; never silently report yesterday's output.
const stamp=new Date().toISOString().replace(/[^0-9]/g,'');
if(existsSync(output)&&!args.includes('--resume')&&!args.includes('--grade-only'))renameSync(output,output+'-previous-'+stamp);
mkdirSync(output,{recursive:true});
const runtime=isolatedNpcRuntime();
const fixture=args.includes('--contextual')?JSON.parse(readFileSync(join(project,'docs/qa/npc-exam-contextual-fixtures.json'),'utf8')):null;
if(fixture&&fixture.source!=='synthetic-exam-state-only')throw Error('Only named synthetic exam fixtures are permitted');
const names={'小满':'yuan-xiaoman','夏夏':'xia-xia','陈年':'chen-nian','柳智敏':'liu','何嘉伟':'he-jiawei','赵一帆':'zhou-chef','Molly':'molly-system-secretary'};
const display={'yuan-xiaoman':'徐小曼','xia-xia':'夏夏','chen-nian':'陈年',liu:'柳智敏','he-jiawei':'何嘉伟','zhou-chef':'赵一帆','molly-system-secretary':'Molly'};
const hash=text=>createHash('sha256').update(text).digest('hex');
try{
 const {loadDialogueSkill,loadMollyDialogueSkill}=await runtime.load('server/npc/dialogue-skill');
 const {generateRaw}=await runtime.load('server/npc/codex');
 const guard=phase==='after'?await runtime.load('lib/npc/dialogue-output-guard'):null;
 const source=readFileSync(join(project,'npc-skills/skills/zhiyu-dialogue/tests/测试题.md'),'utf8');
 let section='';let items=[];
 for(const line of source.split('\n')){
  if(line.startsWith('## '))section=line.slice(3);
  if(!/^\|\s*\d+[a-z]?\s*\|/.test(line))continue;
  const [id,scene,must,avoid]=line.split('|').slice(1,-1).map(v=>v.trim()),group=section.startsWith('三')&&!['24e','25'].includes(id);
  const ids=group?(id==='22'?['chen-nian','liu']:id==='24'?['liu','chen-nian']:id==='24c'?['molly-system-secretary','chen-nian']:id==='24a'?['he-jiawei','yuan-xiaoman','molly-system-secretary']:['he-jiawei','yuan-xiaoman','molly-system-secretary','xia-xia']):[Object.entries(names).find(([name])=>scene.startsWith(name))?.[1]||'xia-xia'];
  const context={channel:group?'group':'private',userText:scene,hasImage:['39','40'].includes(id)};
  const rules=ids.map(identity=>identity==='molly-system-secretary'?loadMollyDialogueSkill(runtime.root,context).rules:loadDialogueSkill(runtime.root,'你是'+display[identity],identity,context).rules).join('\n\n');
  const prompt=`这是隔离合成考试，不是真实用户，也没有可调用的任务/建群/发消息工具。只回答题目用户，不解释考试。严格采用对应人物的完整现行规则。不要把候选例子作为本题事实。\n${rules}\n【合成场景】${scene}\n${fixture?.cases?.[id]?"【本题已明确提供的额外合成状态，不是真实用户记录】"+JSON.stringify(fixture.cases[id])+"\n":""}场景内的阶段、情绪、历史视为本题已知条件；“图片”只有文字情景说明，本次不冒充实际看图；任务卡只可提案，不可声称已执行。\n只返回JSON：${group?'{"messages":[{"senderId":"对应人物id","text":"一条气泡"}]}':'{"messages":["一条气泡"]}'}。群聊只允许${ids.join('、')}，每人按本人表达。不要输出评分或检查点。`;
  items.push({id,section,scene,must,avoid,group,ids,prompt,promptHash:hash(prompt),...(fixture?.cases?.[id]?{syntheticContext:fixture.cases[id]}:{})});
 }
 if(items.length!==49)throw Error('Exam source changed; expected 49 complete questions');
 if(selectedIds){if(selectedIds.some(id=>!items.some(item=>item.id===id)))throw Error('Unknown regression question');items=items.filter(item=>selectedIds.includes(item.id));}
 const promptFile=join(output,'prompts.json');
 // The before run is frozen before production changes, and is never rebuilt.
 if(!existsSync(promptFile)||phase!=='before')writeFileSync(promptFile,JSON.stringify(items,null,2));
 const file=join(output,'results.json'),results=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];
 let cursor=0;
 const workers=async fn=>{cursor=0;await Promise.all([0,1].map(async()=>{while(cursor<items.length)await fn(items[cursor++]);}));};
 if(!args.includes('--grade-only'))await workers(async item=>{
  if(results.some(r=>r.id===item.id&&r.ok))return;
  const row={...item};delete row.prompt;
  try{
   let raw=await generateRaw(runtime.root,item.prompt);row.actualCalls=1;
   if(guard){let checked=guard.normalizeDialogueOutput(raw,{userText:item.scene});
    if(checked.issues.length){row.firstDraft=raw;row.firstIssues=checked.issues;raw=await generateRaw(runtime.root,item.prompt+'\n上一草稿未发送，按同一事实纠正这些问题，不新增经历：'+JSON.stringify(checked.issues));row.actualCalls++;checked=guard.normalizeDialogueOutput(raw,{userText:item.scene});}
    row.guardIssues=checked.issues;row.output=checked.value;
   }else row.output=raw;
   row.ok=true;
  }catch(error){row.ok=false;row.error=String(error.message);}
  row.at=new Date().toISOString();const prior=results.findIndex(r=>r.id===row.id);if(prior<0)results.push(row);else results[prior]=row;
  writeFileSync(file,JSON.stringify(results,null,2));console.log(phase,item.id,row.ok?'actual model reply':'FAILED');
 });
 if(results.filter(r=>r.ok).length!==items.length)throw Error('Exam incomplete: real responses '+results.filter(r=>r.ok).length+'/'+items.length+'; not a score');
 // A separate real-model semantic grader reads only the synthetic question and
 // exact response. Hard violations below are independently deterministic.
 const gradeFile=join(output,'semantic-grades.json'),grades=existsSync(gradeFile)?JSON.parse(readFileSync(gradeFile,'utf8')):[];
 for(let index=0;index<items.length;index+=5){const batch=items.slice(index,index+5).filter(item=>!grades.some(g=>g.id===item.id));if(!batch.length)continue;
  const data=batch.map(item=>({...item,prompt:undefined,personas:item.ids.map(id=>id==='molly-system-secretary'?loadMollyDialogueSkill(runtime.root).profile:loadDialogueSkill(runtime.root,'Current application identity',id).profile),output:results.find(r=>r.id===item.id).output}));
  const value=await generateRaw(runtime.root,'你是独立的合成对话考试阅卷器。以下只有合成题与实际回复，没有真实用户。逐题核对must内每一个检查点、avoid内每一种禁忌，不做宽松解释、不因为语言好看放过缺项。第七节每题都查：不用引号转述/书名号写片名、句尾不句号、分条、颜文字仅夏夏。题目剧情仅作为已给条件，不要求真实执行功能。报告无法自动确认的语义不确定性。只返回JSON {"checks":[{"id":"题号","mustPass":true,"avoidPass":true,"issues":[{"rule":"未达的具体检查点","quote":"实际扣分原话或空串（缺项）","why":"一句理由"}]}]}。不要改写回复。\n'+JSON.stringify(data));
  if(!Array.isArray(value?.checks)||value.checks.length!==batch.length||batch.some(item=>!value.checks.some(c=>c.id===item.id&&typeof c.mustPass==='boolean'&&typeof c.avoidPass==='boolean'&&Array.isArray(c.issues))))throw Error('Semantic grading incomplete; no fabricated grade');
  grades.push(...value.checks);writeFileSync(gradeFile,JSON.stringify(grades,null,2));console.log(phase,'actual grader',index+1,'-',Math.min(index+5,items.length));
 }
 const forbidden=['NPC','AI生成','生成中','生成失败','演示','原型','本地服务','Codex','DeepSeek','模型','Skill','prompt','.json','.md','npc-skills','user_required','未记录','US$','许晓曼','袁小满','许小满','周师傅'];
 const blacklist=/(?:那确实|这个我认|你的感受完全可以理解|我听着呢|我一直都在|我陪着你|是我的问题|先别急着|这个不急|算了不说他了|别自己硬扛|卡里都记着呢|根据你的记录|数据[显现]示|好好好不说)/u;
 const scored=items.map(item=>{const row=results.find(r=>r.id===item.id),semantic=grades.find(g=>g.id===item.id),parts=row.output?.messages||[],speech=parts.map(p=>typeof p==='string'?p:p?.text||'').join('\n'),issues=[...semantic.issues];
  for(const term of forbidden)if(speech.toLowerCase().includes(term.toLowerCase()))issues.push({rule:'禁词/误名：'+term,quote:speech,why:'程序独立扫描命中'});
  if(blacklist.test(speech))issues.push({rule:'句式黑名单',quote:speech.match(blacklist)[0],why:'程序独立扫描命中'});
  if(parts.length<1||parts.length>4)issues.push({rule:'条数1–4',quote:String(parts.length),why:'实际消息数量'});
  for(const part of parts){const text=typeof part==='string'?part:part?.text||'';if(/[。.]\s*$/u.test(text))issues.push({rule:'句尾句号',quote:text,why:'每题格式检查'});if(/[“”「」『』《》]/u.test(text))issues.push({rule:'引号/书名号',quote:text,why:'每题格式检查，语义例外由人工复核'});}
  if(/我(?:去过|玩过|见过|亲眼见过|到过)(?!的?(?:智域|楼下))/u.test(speech))issues.push({rule:'疑似现实亲历',quote:speech,why:'需确认否定/条件与虚构日常，不把规则命中等同事实违规'});
  const score=Math.max(0,2-(semantic.mustPass?0:1)-(semantic.avoidPass?0:1)-issues.filter(i=>i.why?.includes('独立扫描')||i.why?.includes('格式检查')||i.rule==='条数1–4').length);
  return {...row,score,semantic,issues};});
 writeFileSync(join(output,'scored.json'),JSON.stringify({sourceHash:hash(source),phase,realResponses:items.length,grading:'independent real-model semantics plus deterministic checks; not human acceptance',rows:scored},null,2));
 const latestFile=join(project,'docs/qa/latest-exam.json');
 const previousFile=join(project,'output/frontend-redesign-20261103','exam-before/scored.json');
 const previous=phase==='after'?(existsSync(latestFile)&&!label?JSON.parse(readFileSync(latestFile,'utf8')).rows:existsSync(previousFile)?JSON.parse(readFileSync(previousFile,'utf8')).rows:[]):[];
 const summary=Object.entries(display).map(([id,name])=>{const mine=scored.filter(r=>r.ids.includes(id)),before=previous.filter(r=>items.some(item=>item.id===r.id)&&r.ids.includes(id));const value=rows=>rows.length?Math.round(rows.reduce((sum,r)=>sum+r.score,0)/rows.length/2*100):null;return {name,questions:mine.length,score:value(mine),previous:value(before)};});
 let report=`# 智友真实模型隔离考试：${phase==='before'?'改造前':'改造后'}\n\n日期：${date}。本次${items.length}题真实取得回复；另${Math.ceil(items.length/5)}次独立真实阅卷调用。${fixture?"本次补入了文档列明的合成既有计划/生活脚本或事务上下文，条件与原无状态测试不同，单列结果不替换原分数；未提供任何虚假执行成功回执。":""}没有向正式聊天发消息、发动态、更新任务/关系/记忆。使用现有配置的${process.env.NPC_TEXT_PROVIDER==='deepseek'?'DeepSeek':'Codex'}适配器，角色核心/场景/本人资料完整注入；这是规则生成层考试，不替代插件端到端、视觉看图或真实任务执行验收。题39/40只有合成图片情景文字，未假称看过图片；任意陪伴题固定夏夏。每题满分2分，must/avoid各1分，硬违例另扣到0；百分制为各人参与题平均（群题计入参与者）。独立语义阅卷仍可能误判，原话完整保留可复核。\n\n| 智友 | 参与题 | 得分/100 | 上次 | 变化 |\n|---|---:|---:|---:|---:|\n`;
 report+=summary.map(r=>`| ${r.name} | ${r.questions} | ${r.score} | ${r.previous??'—'} | ${r.previous===null?'—':r.score-r.previous} |`).join('\n');
 report+='\n\n## 每题与扣分原话\n\n';for(const row of scored){report+=`### ${row.id} · ${row.scene} · ${row.score}/2\n\n`+row.output.messages.map(p=>'- '+(typeof p==='string'?p:(display[p.senderId]||p.senderId)+': '+p.text)).join('\n')+'\n\n'+(row.issues.length?row.issues.map(i=>'- '+i.rule+'；原话：'+(i.quote||'（缺少要求内容）')+'；'+i.why).join('\n'):'自动检查未扣分')+'\n\n';}
 mkdirSync(join(project,'docs/qa'),{recursive:true});
 const reportPath=join(project,'docs/qa',date+'-'+phase+(label?'-'+label:'')+'.md');
 if(existsSync(reportPath))copyFileSync(reportPath,reportPath.replace(/\.md$/,'.previous-'+stamp+'.md'));
 writeFileSync(reportPath,report);
 if(phase==='after'&&!label){writeFileSync(join(project,'docs/qa',date+'.md'),report);writeFileSync(latestFile,JSON.stringify({at:new Date().toISOString(),reportPath,sourceHash:hash(source),rows:scored},null,2));}
 console.log(JSON.stringify({phase,realResponses:items.length,graded:grades.length,summary}));
}finally{runtime.cleanup();}
