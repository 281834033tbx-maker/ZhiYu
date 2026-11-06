import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the real whole-card hook and cards without API, DOM, account data,
// or browser. Visibility follows the same aria-hidden/inert boundary as the UI.
const jsx=(type,props)=>({type,props:props||{}}),fragment=Symbol('fragment');
const compile=file=>ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function load(file,deps,globals={}){
 const sandboxModule={exports:{}};
 vm.runInNewContext(compile(file),{module:sandboxModule,exports:sandboxModule.exports,require:name=>{if(!(name in deps))throw Error('Unexpected test dependency '+name);return deps[name];},console,Date,Map,Set,JSON,...globals},{filename:file});
 return sandboxModule.exports;
}
function foldRuntime(storage=new Map(),{deny=false,server=false}={}){
 const events=new Map(),cleanups=[];
 const window={localStorage:{getItem:key=>{if(deny)throw Error('storage denied');return storage.get(key)||null;},setItem:(key,value)=>{if(deny)throw Error('storage denied');storage.set(key,value);}},addEventListener:(name,fn)=>{if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},removeEventListener:(name,fn)=>events.get(name)?.delete(fn)};
 const react={useCallback:value=>value,useSyncExternalStore:(subscribe,snapshot,ssr)=>{cleanups.push(subscribe(()=>{}));return server?ssr():snapshot();}};
 const exports=load('app/zhiyu/report-fold.tsx',{react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:fragment},'lucide-react':{ChevronDown:props=>jsx('svg',{'data-icon':'chevron',...props})}},{window});
 return {...exports,storage,clear:()=>cleanups.splice(0).forEach(cleanup=>cleanup()),event:key=>events.get('storage')?.forEach(fn=>fn({key}))};
}
const storage=new Map([['zhiyu:report-folds:owner-a:daily-1',JSON.stringify({messageId:'daily-1',collapsedBlockIds:[]})]]);
let fold=foldRuntime(storage);
assert.equal(fold.useReportExpansion('owner-a','daily-1').expanded,false,'old per-block preferences must not open the whole report');
fold.useReportExpansion('owner-a','daily-1').toggle();
assert.equal(fold.useReportExpansion('owner-a','daily-1').expanded,true);
assert.equal(fold.useReportExpansion('owner-a','weekly-1').expanded,false,'different message starts collapsed');
assert.equal(fold.useReportExpansion('owner-b','daily-1').expanded,false,'another account does not inherit the preference');
fold.clear();fold=foldRuntime(storage);
assert.equal(fold.useReportExpansion('owner-a','daily-1').expanded,true,'reopening preserves whole-card expansion');
fold.useReportExpansion('owner-a','daily-1').toggle();
assert.equal(fold.useReportExpansion('owner-a','daily-1').expanded,false);
storage.set('zhiyu:report-expanded-v1:owner-a:daily-1',JSON.stringify({messageId:'daily-1',expanded:true}));fold.event('zhiyu:report-expanded-v1:owner-a:daily-1');
assert.equal(fold.useReportExpansion('owner-a','daily-1').expanded,true,'another window synchronizes the preference');
storage.delete('zhiyu:report-expanded-v1:owner-a:daily-1');fold.event(null);
assert.equal(fold.useReportExpansion('owner-a','daily-1').expanded,false,'clearing stored preferences returns to collapsed');
for(const raw of ['bad-json',JSON.stringify({messageId:'wrong',expanded:true}),JSON.stringify({messageId:'bad',expanded:'yes'})]){
 const test=foldRuntime(new Map([['zhiyu:report-expanded-v1:owner-a:bad',raw]]));assert.equal(test.useReportExpansion('owner-a','bad').expanded,false);test.clear();
}
const denied=foldRuntime(new Map(),{deny:true});denied.useReportExpansion('owner','daily').toggle();assert.equal(denied.useReportExpansion('owner','daily').expanded,true,'denied storage still allows toggling');denied.clear();
const ssr=foldRuntime(storage,{server:true});assert.equal(ssr.useReportExpansion('owner-a','daily-1').expanded,false);ssr.clear();fold.clear();
console.log('PASS: whole-card state defaults collapsed, ignores retired block state, persists by owner/message, syncs across windows and tolerates missing storage.');

const data=load('lib/npc/molly-reports.ts',{}),configs={dailyTemplates:JSON.parse(readFileSync('lib/npc/report-config/daily-templates.json','utf8')),weeklyBlocks:JSON.parse(readFileSync('lib/npc/report-config/weekly-blocks.json','utf8'))};
const daily=JSON.parse(readFileSync('lib/npc/report-config/daily-demo.json','utf8')),weekly=JSON.parse(readFileSync('lib/npc/report-config/weekly-demo.json','utf8'));
let currentAccount='view-owner',slots=[],cursor=0,apiCalls=0;
const cardFold=foldRuntime();
const hooks={useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},useRef:initial=>{const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useId:()=>`content-${cursor++}`,useCallback:value=>value,useEffect:()=>{},useLayoutEffect:()=>{}};
const cards=load('app/zhiyu/molly-report-cards.tsx',{
 react:hooks,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:fragment},'react-dom':{createPortal:value=>value},'next/image':props=>jsx('img',props),'lucide-react':{Copy:props=>jsx('svg',props),X:props=>jsx('svg',props)},
 '../../lib/npc/molly-reports':data,'../../lib/npc/molly-report-config':configs,'./auth-gate':{useAccount:()=>({account:{id:currentAccount}})},'./data':{people:[]},'./npc-fetch':{npcFetch:async()=>{apiCalls++;return {ok:true,json:async()=>({brief:{...daily,pending:daily.pending.slice(1)}})};}},'./report-fold':cardFold,'./molly-report-cards.css':{},
});
function expand(value){if(Array.isArray(value))return value.map(expand);if(!value||typeof value!=='object'||!('props'in value))return value;if(typeof value.type==='function')return expand(value.type(value.props));return {...value,props:{...value.props,children:expand(value.props.children)}};}
function nodes(value,{visible=false}={}){if(Array.isArray(value))return value.flatMap(item=>nodes(item,{visible}));if(!value||typeof value!=='object'||!('props'in value))return [];if(visible&&value.props['aria-hidden']===true)return [];return [value,...nodes(value.props.children,{visible})];}
const copy=value=>Array.isArray(value)?value.map(copy).join(''):value&&typeof value==='object'&&'props'in value?copy(value.props.children):typeof value==='string'||typeof value==='number'?String(value):'';
const render=(Card,props)=>{cursor=0;return expand(Card(props));};
const toggles=tree=>nodes(tree).filter(node=>node.type==='button'&&typeof node.props['aria-expanded']==='boolean');
for(const [Card,payload,property,id,expected] of [[cards.DailyBriefCard,daily,'brief','new-daily',['城市天气','待定','日程','采购','缴费','进度','近期','关注']],[cards.WeeklyReportCard,weekly,'report','new-weekly',['本周概览','要紧','身体','训练','饮食','做菜','护肤','账本','追踪','评语']]]){
 slots=[];const props={[property]:payload,messageId:id,onOpenNpc:()=>{}};
 let tree=render(Card,props);const toggle=toggles(tree);
 assert.equal(toggle.length,1,'exactly one disclosure button per report');assert.equal(toggle[0].props['aria-expanded'],false);
 assert.equal(nodes(tree,{visible:true}).filter(node=>node.props['data-report-block']).length,0,'initial accessible view is summary only');
 const title=property==='brief'?'今日简报':'本周汇报';
 assert.equal(copy(toggle[0]),title+'展开','the compact disclosure contains only its four-character title and expand action');
 const article=nodes(tree).find(node=>node.type==='article');
 assert.ok(article.props.className.split(' ').includes('xx-bubble'),'reports share the actual normal-message bubble class');
 const content=nodes(tree).find(node=>node.props.className?.startsWith('zy-molly-report-body'));
 assert.equal(toggle[0].props['aria-controls'],content.props.id);assert.equal(content.props.inert,true);
 toggle[0].props.onClick();tree=render(Card,props);
 assert.equal(toggles(tree)[0].props['aria-expanded'],true);
 assert.equal(copy(toggles(tree)[0]),title+'收起','expanded cards keep the title and offer an explicit collapse action');
 assert.deepEqual(nodes(tree,{visible:true}).filter(node=>node.type==='h4').map(copy),expected,'opening exposes every section directly');
 for(const block of nodes(tree).filter(node=>node.props['data-report-block']))assert.equal(nodes(block).filter(node=>node.type==='button'&&node.props['aria-expanded']!==undefined).length,0,'no per-section toggles');
 assert.equal(nodes(tree).filter(node=>node.type==='svg'&&node.props['data-icon']==='chevron').length,0,'disclosures use visible expand/collapse words, without section arrows');
 if(property==='brief'){
   const weather=nodes(tree,{visible:true}).find(node=>node.props['data-report-block']==='weather');
   assert.ok(copy(weather).includes(daily.header.city));
   assert.ok(copy(weather).includes(`${daily.header.weather.low}–${daily.header.weather.high}° ${daily.header.weather.text}`));
   assert.ok(copy(weather).includes(daily.header.traffic));
   assert.ok(copy(weather).includes(daily.header.weather.tip));
   const confirm=nodes(tree).find(node=>node.type==='button'&&copy(node)==='确认');
   await confirm.props.onClick({stopPropagation(){}});await new Promise(resolve=>setTimeout(resolve,0));
   tree=render(Card,props);assert.equal(toggles(tree)[0].props['aria-expanded'],true,'an action receipt cannot collapse the report');
   assert.equal(nodes(tree).filter(node=>node.props.className==='zy-molly-report-pending').length,1,'the action still updates its original card');
 }
 toggles(tree)[0].props.onClick();tree=render(Card,props);assert.equal(toggles(tree)[0].props['aria-expanded'],false);
}
slots=[];
const noWeather={...daily,header:{...daily.header,weather:undefined}};
let fallback=render(cards.DailyBriefCard,{brief:noWeather,messageId:'weather-missing'});
toggles(fallback)[0].props.onClick();fallback=render(cards.DailyBriefCard,{brief:noWeather,messageId:'weather-missing'});
const fallbackWeather=nodes(fallback,{visible:true}).find(node=>node.props['data-report-block']==='weather');
assert.ok(copy(fallbackWeather).includes(daily.header.traffic),'traffic remains available independently of a weather reading');
assert.ok(!copy(fallbackWeather).includes('undefined'),'a missing weather record never invents temperatures');
assert.equal(apiCalls,1,'folding never invokes report APIs');
currentAccount='second-view-owner';slots=[];assert.equal(toggles(render(cards.DailyBriefCard,{brief:daily,messageId:'new-daily'}))[0].props['aria-expanded'],false);
cardFold.clear();
console.log('PASS: daily and weekly summaries each have one accessible toggle; weather/overview lead all sections, compact titles toggle expand/collapse with no section arrows, and action receipts preserve expansion.');
