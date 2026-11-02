import type {Step,Task,TaskBoardModel} from './types';
import {DEMO_METRICS} from './config';

export const DEMO_TODAY = '2026-11-01';
export function shiftMockDate(date:string,offset:number) {
  const value=new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate()+offset);
  return value.toISOString().slice(0,10);
}
const at=(date:string,time='08:00')=>`${date}T${time}:00+08:00`;
const step=(id:string,name:string,detail:string,extra:Partial<Step>={}):Step=>({id,name,detail,done:false,...extra});
const numbered=(prefix:string,names:string[],details:string[]=[]):Step[]=>names.map((name,index)=>step(`${prefix}-${index+1}`,name,details[index]||'1 项'));
const lunchSteps=()=>[
  step('lunch-rice','杂粮饭下锅','40分钟',{durationText:'40分钟',timerSeconds:2400,done:true}),
  step('lunch-prep','番茄切块、鸡蛋打散','5分钟',{durationText:'5分钟',timerSeconds:300,done:true}),
  step('lunch-eggs','炒蛋，盛出备用','1分钟',{durationText:'1分钟',timerSeconds:60,done:true}),
  step('lunch-tomato','番茄下锅炒出沙','3分钟',{durationText:'3分钟',timerSeconds:180,tips:['锅里留底油，中火，番茄块下锅','用铲子压一压，炒到出红汤、看不见整块','番茄太酸就加小半勺糖']}),
  step('lunch-finish','鸡蛋回锅，调味出锅','1分钟',{durationText:'1分钟',timerSeconds:60}),
];
const dinnerSteps=()=>[
  step('dinner-blanch','牛腩切块，冷水下锅焯水','10分钟',{durationText:'10分钟',timerSeconds:600}),
  step('dinner-stew','番茄炒出汁，加牛腩小火炖','90分钟',{durationText:'90分钟',timerSeconds:5400}),
  step('dinner-mushroom','香菇泡发，切片','20分钟',{durationText:'20分钟',timerSeconds:1200}),
  step('dinner-broccoli','西兰花焯水 1 分钟','1分钟',{durationText:'1分钟',timerSeconds:60}),
  step('dinner-vegetables','香菇西兰花快炒','3分钟',{durationText:'3分钟',timerSeconds:180}),
  step('dinner-finish','牛腩收汁，出锅','5分钟',{durationText:'5分钟',timerSeconds:300}),
];
const shoppingSteps=()=>numbered('shop',['牛腩','西兰花','鸡蛋','番茄','香菇','杂粮米']);
const stretchSteps=(back=false)=>numbered('stretch',back?['背阔肌拉伸','上背部放松','腰背轻柔活动','呼吸放松']:['胸肌拉伸','肩后侧拉伸','背阔肌放松','呼吸放松'],['3分钟','3分钟','2分钟','2分钟']).map(s=>({...s,durationText:s.detail}));
const chestSteps=()=>[
  step('chest-warm','上斜哑铃卧推热身','2 × 15',{sets:{total:2,done:2},restSeconds:60,done:true}),
  step('chest-incline','上斜哑铃卧推','4 × 10',{sets:{total:4,done:4},restSeconds:150,done:true}),
  step('chest-bench','平板杠铃卧推','4 × 8 · 50kg',{sets:{total:4,done:2,weight:'50kg'},restSeconds:180,tips:['肩胛骨夹紧下沉，背微微拱起','杠铃落到乳头连线附近，不弹胸','最后 2 个做不动就降到 45kg']}),
  step('chest-machine','坐姿器械夹胸','3 × 12',{sets:{total:3,done:0},restSeconds:90}),
  step('chest-cable','龙门架高位夹胸','3 × 15',{sets:{total:3,done:0},restSeconds:90}),
];
const backSteps=()=>[
  step('back-warm','热身：弹力带划船','2 × 15',{sets:{total:2,done:0},restSeconds:60}),
  step('back-deadlift','硬拉','4 × 8 · 60kg',{sets:{total:4,done:0,weight:'60kg'},restSeconds:150}),
  step('back-pulldown','高位下拉','4 × 10',{sets:{total:4,done:0},restSeconds:90}),
  step('back-row','坐姿划船','3 × 12',{sets:{total:3,done:0},restSeconds:90}),
  step('back-facepull','面拉','3 × 15',{sets:{total:3,done:0},restSeconds:60}),
];
const lowerSteps=()=>[
  step('lower-warm','热身 5 分钟','5分钟',{done:true,actual:'完成',durationText:'5分钟'}),
  step('lower-squat','杠铃深蹲','4 × 10 · 42.5kg',{sets:{total:4,done:4,weight:'42.5kg'},done:true,actual:'4 × 10 · 42.5kg'}),
  step('lower-rdl','罗马尼亚硬拉','3 × 10 · 30kg',{sets:{total:3,done:3,weight:'30kg'},done:true,actual:'3 × 10 · 30kg'}),
  step('lower-lunge','箭步蹲','3 × 12 · 徒手',{sets:{total:3,done:3,weight:'徒手'},done:true,actual:'3 × 12 · 徒手'}),
  step('lower-plank','平板支撑','3 × 45 秒',{sets:{total:3,done:3},done:true,actual:'3 × 45 秒'}),
];
type Draft=Omit<Task,'id'|'date'|'order'|'status'> & Partial<Pick<Task,'status'|'order'>>;
function task(date:string,suffix:string,order:number,draft:Draft):Task {
  return {id:`${date}:${suffix}`,date,order,status:'todo',...draft};
}
const single=(title:string,categoryId:string,npcId:string,amount:string,tip?:string,note?:string):Draft=>({title,type:'single',categoryId,npcId,amount,tip,note});
const water=(current=0):Draft=>({title:'喝水 2000ml',type:'count',categoryId:'nutrition',npcId:'liu',amount:'每次 250ml',tip:'练完多喝一点',count:{current,target:2000,perTime:250,unit:'ml'}});
const protein=():Draft=>single('练后蛋白','nutrition','chen-nian','乳清 30g','练完 30 分钟内','1 勺乳清兑 300ml 水或牛奶，摇匀喝掉。今天练胸，练完半小时内喝最好，晚了也比不喝强。');
const creatine=():Draft=>single('肌酸 5g','nutrition','liu','1 勺','兑水喝','用水冲开，按今天安排的分量喝完。');
const sleep=(actual?:string):Draft=>single('上床睡觉','sleep','molly','23:00 前',actual?`实际 ${actual}`:'明早 7:00 起','收好手机，按计划上床休息。');
const breakfast=(sandwich=false):Draft=>single(sandwich?'早餐：全麦三明治 + 酸奶':'早餐：燕麦 + 鸡蛋 + 牛奶','nutrition','liu',sandwich?'5 分钟':'10 分钟',sandwich?undefined:'鸡蛋 2 个');
const warmWater=():Draft=>single('晨起温水 300ml','nutrition','liu','','起床后空腹喝');
const vitamin=():Draft=>single('维生素 D','nutrition','liu','1 粒','随早餐吃');
const lunch=():Draft=>({title:'午饭：番茄炒蛋 + 杂粮饭',type:'steps',categoryId:'cooking',npcId:'zhou-chef',amount:'25 分钟',tip:'约 520 千卡',steps:lunchSteps(),planId:'cuisine'});
const dinner=(garlic=false):Draft=>({title:`晚饭：番茄牛腩 + ${garlic?'蒜蓉':'香菇'}西兰花`,type:'steps',categoryId:'cooking',npcId:'zhou-chef',amount:'2 小时',tip:'牛腩要提前炖上',steps:dinnerSteps(),planId:'cuisine'});
const shopping=():Draft=>({title:'采购明天的食材',type:'steps',categoryId:'shopping',npcId:'molly',amount:'牛腩、西兰花、鸡蛋…',tip:'可以交给我下单',steps:shoppingSteps()});
const stretch=(back=false):Draft=>({title:'训练后拉伸',type:'steps',categoryId:'recovery',npcId:'chen-nian',amount:'10 分钟',tip:back?'重点放松背和腰':'重点放松胸和肩',steps:stretchSteps(back)});
const walking=():Draft=>({title:'散步 8000 步',type:'count',categoryId:'fitness',npcId:'chen-nian',amount:'休息日',tip:'慢走就行',count:{current:0,target:8000,perTime:1000,unit:'步'}});
const kungpao=():Draft=>({title:'午饭：宫保鸡丁 + 糙米饭',type:'steps',categoryId:'cooking',npcId:'zhou-chef',amount:'25 分钟',tip:'花生最后放',steps:numbered('kungpao',['准备鸡丁和配菜','调好碗汁','炒熟鸡丁','加花生翻匀出锅'],['5分钟','3分钟','12分钟','5分钟'])});
const fish=():Draft=>({title:'晚饭：清蒸鲈鱼 + 炒时蔬',type:'steps',categoryId:'cooking',npcId:'zhou-chef',amount:'30 分钟',tip:'鱼蒸 8 分钟就关火',steps:numbered('fish',['处理鲈鱼','准备葱姜','清蒸鲈鱼','炒时蔬','淋汁上桌'],['5分钟','3分钟','8分钟','8分钟','6分钟'])});
function finished(date:string,suffix:string,order:number,draft:Draft,time='08:00'):Task {
  return task(date,suffix,order,{...draft,status:'done',completedAt:at(date,time),steps:draft.steps?.map(s=>({...s,done:true,sets:s.sets?{...s.sets,done:s.sets.total}:undefined})),count:draft.count?{...draft.count,current:draft.count.target}:undefined});
}

export function createTodayTasks():Task[] {
  const date=DEMO_TODAY;
  return [
    task(date,'chest',0,{title:'胸部训练',type:'steps',categoryId:'fitness',npcId:'chen-nian',amount:'50 分钟',tip:'第三组可以降重',status:'in_progress',steps:chestSteps(),planId:'muscle'}),
    task(date,'lunch',1,{...lunch(),status:'paused',pinned:true}),
    task(date,'water',2,water(1000)),task(date,'protein',3,protein()),task(date,'creatine',4,creatine()),
    task(date,'shopping',5,shopping()),task(date,'dinner',6,dinner()),task(date,'stretch',7,stretch()),task(date,'sleep',8,sleep()),
    finished(date,'warm-water',9,warmWater(),'08:20'),finished(date,'breakfast',10,breakfast(),'08:10'),finished(date,'vitamin',11,vitamin(),'08:00'),
  ];
}

/** Extra days/unnamed steps below are local demonstration records, not live
 * professional prescriptions. Explicitly supplied examples retain their text. */
export function createFutureDay(date:string):Task[] {
  const offset=Math.round((Date.parse(`${date}T00:00:00Z`)-Date.parse(`${DEMO_TODAY}T00:00:00Z`))/86400000);
  const daily=[task(date,'daily-water',90,{...water(),repeat:'daily'}),task(date,'daily-creatine',91,{...creatine(),repeat:'daily'}),task(date,'daily-sleep',92,{...sleep(),tip:'第二天 7:00 起',repeat:'daily'})];
  let drafts:Draft[];
  if(offset===1) drafts=[breakfast(),{title:'背部训练',type:'steps',categoryId:'fitness',npcId:'chen-nian',amount:'50 分钟',tip:'硬拉注意护腰',steps:backSteps(),planId:'muscle'},kungpao(),fish(),stretch(true)];
  else if(offset===2) drafts=[breakfast(true),walking(),{...single('午饭：番茄牛腩剩菜 + 炒青菜','cooking','zhou-chef','10 分钟','热透再吃'),type:'single'}];
  else {
    const dayCounts:Record<number,number>={3:4,4:4,5:5,6:3,7:3};
    const count=dayCounts[offset]||3;
    const pool:Draft[]=[breakfast(offset%2===0),offset%2?lunch():kungpao(),offset%2?dinner():fish(),offset%2?stretch(true):shopping(),walking()];
    drafts=pool.slice(0,count).map(d=>({...d,steps:d.steps?.map(s=>({...s,done:false,sets:s.sets?{...s.sets,done:0}:undefined}))}));
  }
  return [...drafts.map((draft,index)=>task(date,`future-${index+1}`,index,draft)),...daily];
}

export function createHistoryDay(date:string):Task[] {
  if(date==='2026-10-31') return [
    finished(date,'warm-water',0,warmWater()),finished(date,'breakfast',1,breakfast()),finished(date,'vitamin',2,vitamin()),
    finished(date,'lower',3,{title:'下肢训练',type:'steps',categoryId:'fitness',npcId:'chen-nian',amount:'55 分钟',tip:'深蹲比上周多 2.5kg',steps:lowerSteps(),planId:'muscle'}),
    finished(date,'protein',4,protein()),finished(date,'lunch',5,lunch()),finished(date,'shopping',6,{...shopping(),tip:'交给我下单了'}),finished(date,'dinner',7,dinner(true)),
    task(date,'water',8,{...water(1500),status:'missed',missText:'喝了 1500ml'}),
    task(date,'stretch',9,{...stretch(),title:'拉伸放松',tip:'腿日后放松大腿后侧',status:'missed',missReason:'太累了'}),
    finished(date,'sleep',10,sleep('23:20'),'23:20'),
  ];
  if(date==='2026-10-30') return [
    finished(date,'warm-water',0,warmWater()),finished(date,'breakfast',1,breakfast(true)),finished(date,'vitamin',2,vitamin()),finished(date,'water',3,{...water(),tip:undefined}),
    finished(date,'lunch',4,kungpao()),finished(date,'walking',5,walking()),finished(date,'dinner',6,fish()),finished(date,'creatine',7,creatine()),
    finished(date,'footbath',8,single('泡脚 15 分钟','recovery','molly','40℃ 左右的水')),finished(date,'sleep',9,sleep('22:50'),'22:50'),
  ];
  if(date==='2026-10-29') {
    // The document's 7/9 heading conflicts with "其余7项为完成" (8/9).
    // Preserve the prominent 7/9 example using one further missed water record.
    const common=createHistoryDay('2026-10-30').slice(0,7).map((t,index)=>({...t,id:`${date}:common-${index}`,date,order:index+2,completedAt:at(date),...(t.count?.unit==='ml'?{status:'missed' as const,count:{...t.count,current:1500},completedAt:undefined,missText:'喝了 1500ml'}:{})}));
    return [finished(date,'full-body',0,{title:'全身训练',type:'steps',categoryId:'fitness',npcId:'chen-nian',amount:'60 分钟',tip:'动作慢一点',steps:numbered('full',['热身','深蹲','推举','划船','臀桥','核心练习'],['5分钟','3 × 10','3 × 10','3 × 12','3 × 12','3 × 30 秒'])}),task(date,'chicken',1,{title:'晚饭：土豆炖鸡',type:'steps',categoryId:'cooking',npcId:'zhou-chef',amount:'45 分钟',tip:'鸡腿肉更嫩',steps:numbered('chicken',['准备鸡腿肉和土豆','鸡肉焯水','炒香调味','加入土豆炖煮','收汁出锅']),status:'missed',missReason:'在外面吃'}),...common];
  }
  const day=Number(date.slice(8,10));
  if(date.startsWith('2026-10-')&&(day<=7||day===11)) return [];
  const completeDays=new Set([9,12,14,15,17,19,20,22,23,25,26,27,30]);
  const drafts=[warmWater(),breakfast(day%2===0),water(),day%2?lunch():kungpao(),day%2?dinner():fish(),sleep()];
  return drafts.map((draft,index)=>completeDays.has(day)||index<4?finished(date,`history-${index}`,index,draft):task(date,`history-${index}`,index,{...draft,status:'missed',...(draft.count?{count:{...draft.count,current:1500},missText:'喝了 1500ml'}:{missReason:'当天没有完成'})}));
}

export function historyTaskBaseline(taskValue:Task):Task|undefined {
  return createHistoryDay(taskValue.date).find(item=>item.id===taskValue.id);
}
export function createMockTaskBoard(now=Date.now()):TaskBoardModel {
  const tasks=[...createTodayTasks(),...Array.from({length:30},(_,index)=>createFutureDay(shiftMockDate(DEMO_TODAY,index+1))).flat(),...Array.from({length:3},(_,index)=>createHistoryDay(shiftMockDate(DEMO_TODAY,-index-1))).flat()];
  return {version:1,today:DEMO_TODAY,tasks,demoOverview:DEMO_METRICS,historyLoadedDays:3,page:{view:'today',futureRange:7,historyFilter:'all',activeTaskId:`${DEMO_TODAY}:chest`,activeExpanded:false,expandedTaskIds:['2026-11-02:future-2','2026-10-31:lower'],weeklyReview:{time:'今晚 21:00'}},rest:{taskId:`${DEMO_TODAY}:chest`,stepId:'chest-bench',endsAt:now+89000},timers:{}};
}
