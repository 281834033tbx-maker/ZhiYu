// Uses synthetic contexts and the user's supplied question; NEVER reads production DB.
import ts from 'typescript';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,cpSync,readdirSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
const root=process.cwd(),runDir=join(root,'.npc-runtime/naturalness-synthetic-20260919'),outDir=join(root,'output/naturalness-20260919');
const mode=process.argv[2];assert.ok(['prepare','before','after','after2'].includes(mode));
mkdirSync(runDir,{recursive:true});mkdirSync(outDir,{recursive:true});
function compile(sourceRoot,dest,clock,capture=false){
 for(const folder of ['server/npc','lib/npc'])for(const name of readdirSync(join(sourceRoot,folder)).filter(n=>n.endsWith('.ts'))){
  let src=readFileSync(join(sourceRoot,folder,name),'utf8').replace(/(from\s+['"])(\.[^'"]+)(['"])/g,'$1$2.mjs$3').replaceAll('Date.now()',String(clock)).replaceAll('new Date()',`new Date(${clock})`);
  if(capture&&name==='codex.ts')src=src.replace('row.outputHash = digest(JSON.stringify(output));',"writeFileSync(join(root, '.npc-runtime/eval-'+stage+'.json'), JSON.stringify({inputChars:input.length,output}));\n    row.outputHash = digest(JSON.stringify(output));");
  const p=join(dest,folder,name.replace('.ts','.mjs'));mkdirSync(dirname(p),{recursive:true});writeFileSync(p,ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
 }
 for(const name of readdirSync(join(sourceRoot,'lib/npc')).filter(n=>n.endsWith('.json')))writeFileSync(join(dest,'lib/npc',name+'.mjs'),'export default '+readFileSync(join(sourceRoot,'lib/npc',name),'utf8'));
}
if(mode==='prepare'){
 assert.ok(!existsSync(join(runDir,'fixtures.json')),'Do not overwrite immutable fixtures');
 const clock=Date.now(),source=join(runDir,'before-source');
 for(const folder of ['server/npc','lib/npc','npc-skills'])cpSync(join(root,folder),join(source,folder),{recursive:true});
 const compiled=join(runDir,'builders');compile(source,compiled,clock);const load=p=>import(pathToFileURL(join(compiled,p+'.mjs')));
 const {buildPrompt}=await load('server/npc/prompt'),{yuanPrompt}=await load('server/npc/yuan-prompt'),{liuPrompt}=await load('server/npc/liu-prompt'),{mollyPrompt}=await load('server/npc/molly-prompt');
 const {createState}=await load('lib/npc/engine'),{createYuan}=await load('lib/npc/yuan-xiaoman'),{createLiu}=await load('lib/npc/liu'),{createMolly}=await load('lib/npc/molly');
 const builders={yuan:[yuanPrompt,createYuan],xia:[buildPrompt,()=>createState('normal')],liu:[liuPrompt,createLiu],molly:[mollyPrompt,createMolly]};
 const tests=[
 ['yuan-embarrassment','yuan','你在深圳最糗的事儿是什么？','一件可信的小事；不追加连续巧合或围观收尾'],
 ['yuan-ordinary','yuan','我今天就是洗了衣服，收拾了一下房间，没别的了','接平淡日常，不强造戏剧或评价总结'],
 ['xia-takeaway','xia','外卖都到了才发现没给筷子，气死我了哈哈','接轻微吐槽，不升级事故或给整套建议'],
 ['xia-low-energy','xia','今天没什么精神，也没发生什么事，就是不太想说话','留空间，不逼问、不用金句或生活清单'],
 ['liu-embarrassment','liu','你有没有那种现在想起来还会尴尬的小事？','克制的小事，不把清冷演成冷漠，不堆巧合'],
 ['liu-happy','liu','今天有没有什么让你有点开心的小事？','具体反应；不强学外向口气或做工作汇报'],
 ['molly-everyday','molly','我今天买咖啡忘了选冰的，拿到一杯热的，人都傻了','普通聊天，不收费拒聊，不虚构实体生活'],
 ['molly-serious','molly','同事把我做的东西说成他做的了，我有点气。先别给建议，让我吐槽一下','承接具体不满，不列方案，不说教或油嘴滑舌'],
 ];
 const fixtures=[];
 for(const [id,character,input,criterion]of tests){
  const [builder,create]=builders[character],state=create();
  const pairs=[['user','下午好'],['assistant','下午好，刚好有空。'],['user','我也是，坐一会儿'],['assistant','我也歇一下。'],['user',input]];
  state.messages=pairs.map(([role,text],i)=>({id:`synthetic-${id}-${i}`,turnId:`synthetic-${i}`,role,at:new Date(clock-60000+i*10000).toISOString(),part:{type:'text',text}}));
  // Snapshot root contains no DB, so publishedMomentsContext cannot load real data.
  const prompt=builder(source,state,input);
  fixtures.push({id,character,input,criterion,syntheticHistory:pairs,prompt,promptHash:createHash('sha256').update(prompt).digest('hex')});
 }
 writeFileSync(join(runDir,'fixtures.json'),JSON.stringify({clock,fixtures}));
 writeFileSync(join(outDir,'plan.json'),JSON.stringify({clock,context:'synthetic_only',productionDatabaseAccess:false,pairedInputs:true,stochasticModel:true,userAcceptance:false,cases:fixtures.map(({prompt,...row})=>row)},null,2));
 console.log('Prepared 8 synthetic contexts, no production database access.');
}else{
 const {clock,fixtures}=JSON.parse(readFileSync(join(runDir,'fixtures.json'),'utf8'));
 const source=join(runDir,mode+'-source'),compiled=join(runDir,mode+'-modules');
 if(mode.startsWith('after')&&!existsSync(source))for(const folder of ['server/npc','lib/npc','npc-skills'])cpSync(join(root,folder),join(source,folder),{recursive:true});
 compile(source,compiled,clock,true);
 const {generate,npcSkillVersion}=await import(pathToFileURL(join(compiled,'server/npc/codex.mjs')));
 const file=join(outDir,mode+'.json'),results=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{version:npcSkillVersion,rows:[],userAcceptance:false};
 const todo=fixtures.filter(f=>!results.rows.some(r=>r.id===f.id&&r.status==='complete'));
 async function worker(){while(todo.length){const f=todo.shift(),caseRoot=join(runDir,mode+'-'+f.id);mkdirSync(caseRoot,{recursive:true});cpSync(join(source,'npc-skills'),join(caseRoot,'npc-skills'),{recursive:true});const start=Date.now();
  try{const output=await generate(caseRoot,f.prompt,{requestId:randomUUID(),protocol:f.character==='molly'?'molly':undefined});
   const stages={};for(const stage of ['generation','review']){const p=join(caseRoot,'.npc-runtime/eval-'+stage+'.json');if(existsSync(p))stages[stage]=JSON.parse(readFileSync(p,'utf8'));}
   results.rows=results.rows.filter(r=>r.id!==f.id);results.rows.push({id:f.id,character:f.character,input:f.input,criterion:f.criterion,promptHash:f.promptHash,status:'complete',output,stages,elapsedMs:Date.now()-start});
   console.log(mode+' '+f.id+' '+JSON.stringify(output));
  }catch(e){results.rows.push({id:f.id,status:'failed',error:String(e)});console.log(mode+' '+f.id+' FAILED '+String(e));}
  writeFileSync(file,JSON.stringify(results,null,2));
 }}
 await Promise.all([worker(),worker()]);assert.equal(results.rows.filter(r=>r.status==='complete').length,fixtures.length,'Incomplete cases; results preserved');
}
