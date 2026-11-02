// User-supplied excerpts + synthetic fixtures only; no production database access.
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';
const rt=isolatedNpcRuntime(),out=join(process.cwd(),'output/yuan-banter-20260920');
mkdirSync(out,{recursive:true});
const rows=[],file=join(out,'samples-'+Date.now()+'.json');
try {
 const {createYuan}=await rt.load('lib/npc/yuan-xiaoman');
 const {yuanPrompt}=await rt.load('server/npc/yuan-prompt');
 const {generate}=await rt.load('server/npc/codex');
 const tests=[
  {id:'ten-children-joke',history:[['user','今天跟你聊得挺开心'],['assistant','我也是哈哈']],input:'我怎么感觉过了一万年了，觉得咱们像老夫老妻一样了。唯一不像的是，要是老夫老妻你要给我生10个孩子，哈哈。'},
  {id:'exaggerated-cats',history:[['user','刚刷到好多小猫'],['assistant','毛茸茸的看着就想摸']],input:'以后家里养一百只猫好了哈哈哈，每天换一只抱'},
  {id:'playful-retort',history:[['user','今天上班啥也没干，但装忙装得好累。'],['assistant','装忙有时候比真忙还累，真忙至少不用一直琢磨下一秒该点开哪个窗口😂\n是不是还得时不时皱个眉，假装事情很棘手？']],input:'哈哈哈哈你有病吧。'},
  {id:'invitation-to-share',history:[['user','今天试衣怎么样'],['assistant','有件外套袖子长了一点，我还在犹豫']],input:'我现在是嫌你话少，我愿意成为你的生活向导、生活导师、情绪垃圾桶，反正和你相关的我都愿意成为。'},
  {id:'genuine-objection',history:[['user','我不想被拿工作开玩笑'],['assistant','知道了']],input:'你刚才那样说我真的不舒服，别再开这种玩笑了。'},
 ];
 const todo=tests.filter(f=>!process.argv[2]||f.id===process.argv[2]);
 async function worker(){while(todo.length){const f=todo.shift(),s=createYuan(),now=Date.now();s.values.affection=s.values.familiarity=100;
   s.messages=[...f.history,['user',f.input]].map(([role,text],i)=>({id:f.id+i,turnId:f.id+i,role,at:new Date(now-(10-i)*10000).toISOString(),part:{type:'text',text}}));
   try {const result=await generate(rt.root,yuanPrompt(rt.root,s,f.input),{requestId:'synthetic-'+f.id});rows.push({...f,status:'complete',output:result});console.log(f.id+' '+JSON.stringify(result));}
   catch(e){rows.push({...f,status:'failed',error:String(e)});console.log(f.id+' '+String(e));}
   writeFileSync(file,JSON.stringify({productionDatabaseAccess:false,userAcceptance:false,rows},null,2));
 }}
 await Promise.all([worker(),worker()]);
 console.log('SAVED '+file);if(rows.some(r=>r.status==='failed'))process.exitCode=1;
} finally {rt.cleanup();}
