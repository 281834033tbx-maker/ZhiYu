// Same user-supplied draft, identical synthetic context, old/new editor comparison.
import ts from 'typescript';
import {readFileSync,writeFileSync,mkdirSync,cpSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const runDir=join(process.cwd(),'.npc-runtime/naturalness-synthetic-20260919');
const {clock,fixtures}=JSON.parse(readFileSync(join(runDir,'fixtures.json'),'utf8'));
const context=fixtures.find(f=>f.id==='yuan-embarrassment').prompt;
const draft={action:'reply',messages:[
 {type:'text',text:'刚来深圳那阵，有次赶试镜走错摄影棚。进去以后我特别熟练地递了模卡，还站到灯下面摆了两个姿势。'},
 {type:'text',text:'摄影师憋了半天，说：妹妹，我们这边在拍公司员工证件照，你是不是走错了😂'},
 {type:'text',text:'我当时还穿着高跟鞋，硬装镇定地说了句不好意思，然后一出门就开始狂跑。最要命的是，真正的摄影棚就在隔壁，他们全听见了。'}],event:null,memories:[]};
const results={scope:'user_supplied_draft_synthetic_context',userAcceptance:false,draft,rows:[]};
await Promise.all(['before','after'].map(async phase=>{
 const source=join(runDir,phase+'-source');const root=join(runDir,'review-'+phase);mkdirSync(root,{recursive:true});cpSync(join(source,'npc-skills'),join(root,'npc-skills'),{recursive:true});
 const src=readFileSync(join(source,'server/npc/codex.ts'),'utf8').replace(/^(?:export )?async function generateRaw\(/m, 'export async function generateRaw(').replaceAll('Date.now()',String(clock)).replaceAll('new Date()',`new Date(${clock})`);
 const path=join(root,'codex.mjs');writeFileSync(path,ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
 const {reviewVoice,generateRaw}=await import(pathToFileURL(path));let edits;
 const output=await reviewVoice(root,context,draft,async prompt=>{edits=await generateRaw(root,prompt);return edits;});
 results.rows.push({phase,edits,output});writeFileSync('output/naturalness-20260919/story-review.json',JSON.stringify(results,null,2));console.log(phase+' '+JSON.stringify({edits,output}));
}));
