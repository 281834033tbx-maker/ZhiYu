// Real model samples with fully synthetic histories. Never opens production SQLite.
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';
const rt=isolatedNpcRuntime(), out=join(process.cwd(),'output/living-contact-20260920');
mkdirSync(out,{recursive:true});
const file=join(out,'samples-'+Date.now()+'.json');
const rows=[];
try {
 const {createYuan}=await rt.load('lib/npc/yuan-xiaoman');
 const {createLiu}=await rt.load('lib/npc/liu');
 const {createState}=await rt.load('lib/npc/engine');
 const {yuanPrompt}=await rt.load('server/npc/yuan-prompt');
 const {liuPrompt}=await rt.load('server/npc/liu-prompt');
 const {buildPrompt}=await rt.load('server/npc/prompt');
 const {generate,npcSkillVersion}=await rt.load('server/npc/codex');
 const C=await rt.load('lib/npc/contact-life');
 const H=3600000, now=Date.now();
 const configs=[
  {id:'yuan-new-life',role:'yuan',kind:'share',history:[['user','刚才的花挺好看'],['assistant','嗯，放窗边了']],topic:'shopping',cue:'考虑周末逛小店挑春秋外套，先说计划或兴趣；不重复插花'},
  {id:'yuan-busy-share',role:'yuan',kind:'evening',history:[['user','我今天要开会，连着开24小时'],['assistant','那你先忙']],busy:true,topic:'food',cue:'新学一道家常菜，按时刻决定已经试过还是准备试'},
  {id:'yuan-conflict-followup',role:'yuan',kind:'conflict_followup',history:[['user','你每次都这样，真烦'],['assistant','你这么说我也有点难受']],conflict:true},
  {id:'yuan-explained-return',role:'yuan',kind:null,history:[['user','晚点聊'],['assistant','那件外套我试了'],['assistant','人呢，等你帮我看看']],input:'刚才家里有事，没来得及看手机',returning:true},
  {id:'xia-friend-event',role:'xia',kind:'share',history:[['user','你和朋友那件事怎么样了'],['assistant','她临时取消约饭，我白等了半小时，刚才没忍住说了她两句']],major:true,topic:'friend_conflict',cue:'继续已发生的朋友取消约饭分歧，朋友刚解释原因，考虑沟通，不新增另一件矛盾'},
  {id:'yuan-friend-event',role:'yuan',kind:'share',history:[['user','你和朋友那件事怎么样了'],['assistant','她临时取消约饭，我白等了半小时，刚才没忍住说了她两句']],major:true,topic:'friend_conflict',cue:'继续已发生的朋友取消约饭分歧，朋友刚解释原因，考虑沟通，不新增另一件矛盾'},
  {id:'liu-daily-life',role:'liu',kind:'share',history:[['user','最近有空就歇歇'],['assistant','嗯，这两天没排那么满']],topic:'walk',cue:'想去附近散散步，按时间选择近期计划，符合内敛性格'},
 ];
 const todo=configs.filter(f=>!process.argv[2]||f.id===process.argv[2]);
 async function worker(){while(todo.length){const f=todo.shift();const s=f.role==='yuan'?createYuan():f.role==='liu'?createLiu():createState('normal');
   s.values.affection=s.values.familiarity=100;
   s.messages=f.history.map(([role,text],i)=>({id:f.id+i,turnId:f.id+i,role,at:new Date(now-2*H+i*10000).toISOString(),part:{type:'text',text}}));
   const c=C.ensureContact(s,now);c.nextAt=now;c.conflict=!!f.conflict;
   if(f.busy)c.busyUntil=now+22*H;
   if(f.returning){C.contactUserActivity(s,f.input,now);s.messages.push({id:f.id+'input',turnId:'input',role:'user',at:new Date(now).toISOString(),part:{type:'text',text:f.input}});}
   if(f.topic)c.scene={id:'synthetic-scene-'+f.id,topic:f.topic,cue:f.cue,major:!!f.major,step:f.major?2:1,createdAt:now-H};
   if(f.major)c.episode={...c.scene,step:1,lastAt:now-15*H,spoken:f.history.at(-1)[1]};
   const prompt=f.role==='yuan'?yuanPrompt(rt.root,s,f.input||'',f.kind?'proactive':'chat',f.kind):f.role==='liu'?liuPrompt(rt.root,s,'',f.kind):buildPrompt(rt.root,s,'','proactive',f.kind);
   try{const result=await generate(rt.root,prompt,{requestId:'synthetic-'+f.id});rows.push({id:f.id,history:f.history,input:f.input||'',kind:f.kind,output:result,status:'complete'});console.log(f.id+' '+JSON.stringify(result));}
   catch(e){rows.push({id:f.id,status:'failed',error:String(e)});console.log(f.id+' FAILED '+String(e));}
   writeFileSync(file,JSON.stringify({version:npcSkillVersion,syntheticOnly:true,productionDatabaseAccess:false,userAcceptance:false,rows},null,2));
 }}
 await Promise.all([worker(),worker()]);
 if(existsSync(join(rt.root,'.npc-runtime/state.sqlite')))throw Error('Unexpected database in synthetic runtime');
 console.log('SAVED '+file);
 if(rows.some(r=>r.status==='failed'))process.exitCode=1;
} finally {rt.cleanup();}
