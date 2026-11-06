import type {Category,CategoryGroup,DemoOverview,Npc,Plan} from './types';

export const categoryGroups:CategoryGroup[] = [
  {id:'movement',name:'运动',order:0},{id:'food',name:'饮食',order:1},
  {id:'life',name:'生活',order:2},{id:'appearance',name:'形象',order:3},
];
// Semantic colours intentionally use the existing App palette. The latest
// human instruction overrides the document's illustrative red/orange palette.
export const categories:Category[] = [
  {id:'fitness',name:'健身',groupId:'movement',color:'var(--zy-interaction-ink, #527b98)',icon:'Dumbbell',verb:'训练'},
  {id:'recovery',name:'恢复',groupId:'movement',color:'var(--zy-nav-active, #2e6252)',icon:'PersonStanding',verb:'拉伸'},
  {id:'nutrition',name:'营养',groupId:'food',color:'var(--zy-nav-active, #2e6252)',icon:'Utensils'},
  {id:'cooking',name:'做饭',groupId:'food',color:'var(--zy-chat-control-accent, #e66562)',icon:'CookingPot',verb:'做饭'},
  {id:'shopping',name:'采购',groupId:'life',color:'var(--zy-interaction-ink, #527b98)',icon:'ShoppingBag',verb:'采购'},
  {id:'sleep',name:'睡眠',groupId:'life',color:'var(--zy-secondary, #626469)',icon:'Moon'},
  {id:'skin',name:'皮肤管理',groupId:'appearance',color:'var(--zy-chat-control-accent, #e66562)',icon:'Droplet',verb:'护肤'},
];
function placeholder(initial:string,background:string,color:string) {
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="${background}"/><text x="32" y="33" fill="${color}" font-family="system-ui,PingFang SC,sans-serif" font-size="28" text-anchor="middle" dominant-baseline="middle">${initial}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
export const npcs:Npc[] = [
  {id:'chen-nian',name:'陈年',initial:'陈',background:'#FCE3CF',color:'#8A4310',avatar:placeholder('陈','#FCE3CF','#8A4310')},
  {id:'liu',name:'柳智敏',initial:'柳',background:'#D9F0E1',color:'#1F6B3E',avatar:placeholder('柳','#D9F0E1','#1F6B3E')},
  {id:'zhou-chef',name:'赵一帆',initial:'赵',background:'#FBEBC8',color:'#7A4E05',avatar:placeholder('赵','#FBEBC8','#7A4E05')},
  {id:'molly',name:'Molly',initial:'M',background:'#2C2C2E',color:'#FFFFFF',avatar:placeholder('M','#2C2C2E','#FFFFFF')},
];
export const plans:Plan[] = [
  {id:'muscle',name:'3 个月增肌',color:categories[0].color,progress:.33,progressText:'第 4/12 周'},
  {id:'cuisine',name:'学会 10 道家常菜',color:categories[3].color,progress:.6,progressText:'6/10 道'},
  {id:'sleep-plan',name:'21 天早睡',color:categories[5].color,progress:.43,progressText:'第 9/21 天'},
  {id:'walking',name:'每天 8000 步',color:categories[1].color,progress:.4,progressText:'第 12/30 天'},
];
// The supplied mock overview (58 future tasks) does not equal the fully listed
// seven-day examples (48). Keep its requested overview separate from examples;
// a real data source will supply matching complete aggregates and task lists.
export const DEMO_METRICS:DemoOverview = {
  today:'2026-11-01', futureCount7:58, historyDone:126,
  categoryCounts:{
    today:{fitness:1,recovery:1,nutrition:6,cooking:2,shopping:1,sleep:1,skin:0},
    future:{fitness:4,recovery:4,nutrition:27,cooking:14,shopping:2,sleep:7,skin:0},
    history:{fitness:14,recovery:12,nutrition:58,cooking:31,shopping:6,sleep:5,skin:0},
  } as Record<'today'|'future'|'history',Record<string,number>>,
  calendar:{month:'2026-10',complete:[9,12,14,15,17,19,20,22,23,25,26,27,30],partial:[8,10,13,16,18,21,24,28,29,31],selected:31,completionRate:84,longestStreak:11,trainingCount:14},
};
