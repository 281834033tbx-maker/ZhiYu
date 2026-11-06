import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

// Actual UI functions, synthetic records and no effects, APIs or storage.
const root=resolve(import.meta.dirname,'..');
let id=0;
const hooks={useId:()=>`fixture-${++id}`,useEffect:()=>{},useLayoutEffect:()=>{},useRef:value=>({current:value}),
  useState:value=>[typeof value==='function'?value():value,()=>{}],useCallback:value=>value,useMemo:fn=>fn(),useSyncExternalStore:(_subscribe,snapshot)=>snapshot()};
function element(type,props,...children){return typeof type==='function'?type({...props,children}):{type,props:props||{},children};}
function load(name,dependencies={},append='') {
  const code=ts.transpileModule(readFileSync(resolve(root,name),'utf8')+append,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,jsxFactory:'fixtureElement',jsxFragmentFactory:'fixtureFragment'}}).outputText;
  const exports={};
  runInNewContext(code,{exports,fixtureElement:element,fixtureFragment:'fragment',require:key=>{
    if(key==='react')return hooks;
    if(key==='lucide-react')return new Proxy({},{get:()=>props=>element('svg',props)});
    if(key.endsWith('.css'))return {};
    if(Object.hasOwn(dependencies,key))return dependencies[key];
    throw Error(`Unexpected dependency: ${key}`);
  },Date,Set,Map,Intl,window:{innerWidth:1280,innerHeight:720}}, {filename:name});
  return exports;
}
const presentation=load('lib/npc/training-task-presentation.ts');
assert.deepEqual(JSON.parse(JSON.stringify(presentation.trainingTitlePresentation('上斜哑铃卧推（中立握）'))),{title:'上斜哑铃卧推（中立握）',cues:[]});
assert.equal(presentation.trainingTitlePresentation('热身：弹力带划船').title,'热身：弹力带划船');
assert.equal(presentation.trainingTitlePresentation('深蹲 · 动作要点：膝盖与脚尖同向').title,'深蹲');
assert.equal(presentation.trainingTitlePresentation('硬拉（动作要点：背部保持中立）').cues[0],'背部保持中立');
assert.equal(presentation.trainingTitlePresentation('红烧肉 · 要点：收汁',false).title,'红烧肉 · 要点：收汁');
assert.equal(presentation.trainingTitlePresentation('深蹲 · 动作要点：').title,'深蹲 · 动作要点：');

const board=load('app/zhiyu/task-board/task-components.tsx',{
  'react-dom':{createPortal:node=>node},
  '../pressable-icon-button':{default:props=>element('button',props,...props.children)},
  '../anchored-popup-motion':{useAnchoredPopupPresence:()=>false},
  '../../../lib/npc/training-task-presentation':presentation,
});
function nodes(value){if(Array.isArray(value))return value.flatMap(nodes);if(!value||typeof value!=='object')return [];return [value,...nodes(value.children)];}
function text(value,hidden=false){if(Array.isArray(value))return value.map(child=>text(child,hidden)).join('');if(value==null||typeof value==='boolean')return '';if(typeof value!=='object')return hidden?'':String(value);return text(value.children,hidden||value.props?.['aria-hidden']===true);}
const step={id:'bench',name:'平板杠铃卧推（中等握距） · 动作要点：肩胛稳定，不弹胸',detail:'4 × 8 · 50kg',tips:['手腕保持稳定'],sets:{total:4,done:2},restSeconds:180,done:false};
const task={id:'training',title:'胸部训练',categoryId:'fitness',npcId:'chen-nian',type:'steps',amount:'50 分钟',tip:'第三组可以降重',date:'2026-11-06',order:0,status:'in_progress',steps:[step]};
const original=JSON.stringify(task),calls=[];
const actions={onToggleStatus:()=>{},onStart:()=>{},onFinish:()=>{},onTalk:()=>{},onStepToggle:(...args)=>calls.push(args),onSetClick:()=>{},onTimerStart:()=>{},onExpandTask:()=>{},onExpandStep:()=>{}};
const props={task,category:{id:'fitness',name:'健身',icon:'Dumbbell',color:'currentColor'},npc:{id:'chen-nian',name:'陈年',avatar:''},mode:'today',expanded:false,now:Date.parse('2026-11-06T00:00:00Z'),actions};
const closed=board.TaskRow(props);
assert.ok(!text(closed).includes(task.tip),'collapsed task metadata contains no training cue');
const taskOpen=board.TaskRow({...props,expanded:true});
assert.ok(text(taskOpen).includes(task.tip),'the task cue remains in the expanded task');
assert.ok(text(taskOpen).includes('平板杠铃卧推（中等握距）'),'exercise qualifiers remain in the name');
assert.ok(!text(taskOpen).includes('肩胛稳定，不弹胸'),'step cue stays out of collapsed step labels');
const stepOpen=board.TaskRow({...props,expanded:true,expandedStepId:step.id});
for(const expected of ['肩胛稳定，不弹胸','手腕保持稳定','4 × 8 · 50kg'])assert.ok(text(stepOpen).includes(expected),expected);
assert.ok(nodes(stepOpen).filter(node=>node.type==='button'&&node.props.className?.includes('tb-step-name')).every(node=>!text(node).includes('动作要点')));
const complete=nodes(stepOpen).find(node=>node.type==='button'&&node.props['aria-label']?.startsWith('完成步骤：'));
complete.props.onClick();assert.equal(calls[0][0],task);assert.equal(calls[0][1],step,'actions retain the original step identity');
const activeClosed=board.ActiveTaskCard({...props,active:true});
assert.ok(!text(activeClosed).includes(task.tip));assert.ok(!text(activeClosed).includes('肩胛稳定，不弹胸'));
const future=board.TaskRow({...props,mode:'future',expanded:true,expandedStepId:step.id});
assert.ok(text(future).includes('肩胛稳定，不弹胸'),'future training instructions can be read without starting');
assert.ok(nodes(future).filter(node=>node.type==='button'&&node.props.className?.includes('tb-set')).every(node=>node.props.disabled),'future sets remain read-only');
const history=board.TaskRow({...props,mode:'history',expanded:true,expandedStepId:step.id});
assert.ok(text(history).includes('4 × 8 · 50kg'));assert.ok(text(history).includes('肩胛稳定，不弹胸'));
const cooking=board.TaskRow({...props,task:{...task,categoryId:'cooking',npcId:'zhou-chef',tip:'花生最后放'},expanded:false});
assert.ok(text(cooking).includes('花生最后放'),'non-training metadata is unchanged');
assert.equal(JSON.stringify(task),original,'rendering never rewrites source tasks or progress');

const timer=load('lib/npc/professional-task-timer.ts',{'./professional-task':{ProfessionalTaskError:class extends Error{}},'./professional-task-expiry':{reconcileProfessionalTaskExpiry:()=>false}});
const professional=load('app/zhiyu/professional-task.tsx',{
  '../../lib/user-facing-errors':{reportUserFacingError:()=>''},
  '../../lib/npc/professional-task':{nextProfessionalTaskStep:task=>task.steps.find(step=>!step.completedAt),professionalTaskProgress:()=>({completed:0,total:1,percent:0})},
  '../../lib/npc/professional-task-timer':timer,
  '../../lib/npc/training-task-presentation':presentation,
  '../../lib/npc/professional-task-session':{professionalTaskSessionView:()=>null},
  './professional-task-store':{},
  './task-items':{shanghaiToday:()=> '2026-11-06',taskScheduleOptions:()=>[],taskDateLabel:date=>date,professionalTaskCharacterName:()=> '陈年'},
  './fitness-demonstration':{FitnessDemonstrationButton:()=>null},
},'\nexport {TaskSteps};\n');
const professionalStep={id:'old-bench',title:'哑铃卧推（动作要点：手腕保持中立）',details:[],instructions:['下放时控制速度'],notes:['肩部刺痛时停止'],hints:[],training:{target:'胸',sets:3,reps:'8–12次',restSeconds:90}};
const professionalTask={id:'professional',title:'胸部训练',characterId:'chen-nian',status:'active',steps:[professionalStep]};
const professionalProps={task:professionalTask,steps:[professionalStep],expanded:'',onExpand:()=>{},onComplete:()=>{},onTimer:()=>{},onSchedule:()=>{},pending:new Set(),now:Date.now()};
const professionalClosed=professional.TaskSteps(professionalProps);
assert.ok(!text(professionalClosed).includes('手腕保持中立'));
assert.ok(text(professionalClosed).includes('哑铃卧推'));
const professionalOpen=professional.TaskSteps({...professionalProps,expanded:professionalStep.id});
for(const expected of ['动作要点','手腕保持中立','下放时控制速度','肩部刺痛时停止','3组 · 8–12次'])assert.ok(text(professionalOpen).includes(expected),expected);
console.log('PASS: training cues appear only in opened task/step bodies; names retain variants, parameters and safety survive, future/history remain readable and source identities/progress stay unchanged.');
