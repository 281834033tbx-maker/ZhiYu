import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Render the real component into JSX objects with a tiny deterministic hook
// host. No browser, production account, HTTP request or real service is used.
const source=readFileSync('app/zhiyu/secretary-report.tsx','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let cursor=0;
const states=[];
const useState=initial=>{
 const index=cursor++;
 if(!(index in states))states[index]=typeof initial==='function'?initial():initial;
 return [states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;}];
};
const jsx=(type,props)=>({type,props:props||{}});
const sandboxModule={exports:{}};
const dependencies={
 react:{useState},
 'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:Symbol.for('fixture-fragment')},
 'next/image':()=>null,
 'lucide-react':{Cloud:()=>null,CloudRain:()=>null,CloudSnow:()=>null,Sun:()=>null},
 './auth-gate':{useAccount:()=>({account:{id:'isolated-presentation-owner'}})},
 './npc-fetch':{npcFetch:()=>{throw Error('Presentation regression must not request any API');}},
 './secretary-report.css':{},
};
const load=name=>{if(!(name in dependencies))throw Error('Unexpected dependency '+name);return dependencies[name];};
vm.runInNewContext(compiled,{module:sandboxModule,exports:sandboxModule.exports,require:load,console,Date,Map,Math,crypto:{randomUUID:()=> 'fixture-id'}},{filename:'secretary-report.tsx'});
const Card=sandboxModule.exports.default;
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'&&'props'in value?[value,...nodes(value.props.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'&&'props'in value?text(value.props.children):typeof value==='string'||typeof value==='number'?String(value):'';
const metric={completed:1,planned:2,missedDates:[]};
const report={id:'isolated-morning',kind:'morning',title:'11月4日',createdAt:'2026-11-04T07:00:00+08:00',startDate:'2026-11-04',endDate:'2026-11-04',city:{name:'深圳',source:'manual'},weather:{min:22,max:28,text:'晴',summary:'深圳原始天气',attribution:'固定测试数据'},agenda:[],decisions:[],completionPercent:50,training:metric,nutrition:metric,cooking:metric,packedMeals:null,weightKg:72,previousWeightKg:73,waistCm:80,previousWaistCm:81,weeklyWeights:[],feelings:{sleep:null,energy:null,soreness:null},adjustments:[],milestones:[],nextFocus:[],team:[],partial:false};
const original=JSON.stringify(report);
const render=value=>{cursor=0;return Card({report:value});};
const header=tree=>nodes(tree).find(node=>node.type==='header');
const weather=tree=>nodes(tree).find(node=>node.props.className==='zy-report-weather');
let tree=render(report);
assert.match(text(header(tree)),/深圳/);
assert.match(text(weather(tree)),/22–28°.*深圳原始天气/);
nodes(header(tree)).find(node=>node.type==='button').props.onClick();
tree=render(report);
const picker=nodes(tree).find(node=>node.type===sandboxModule.exports.CityPicker);
assert.ok(picker,'Changing city must expose the real CityPicker');
// This is the child receipt delivered after the city preference is saved.
picker.props.onSaved({name:'北京',source:'manual'});
picker.props.onClose();
tree=render(report);
assert.match(text(header(tree)),/深圳/,'Saved preferences must not relabel historical weather');
assert.doesNotMatch(text(header(tree)),/北京/);
assert.match(text(weather(tree)),/22–28°.*深圳原始天气/);
assert.match(text(tree),/之后的早报使用北京/);
assert.equal(JSON.stringify(report),original,'A historical report is immutable');

states.length=0;
tree=render({...report,id:'isolated-monthly',kind:'monthly',startDate:'2026-10-01',endDate:'2026-10-31'});
assert.match(text(tree),/比上月 -1 kg/);
assert.match(text(tree),/比上月 -1 cm/);
assert.doesNotMatch(text(tree),/上周/);
states.length=0;
tree=render({...report,id:'isolated-weekly',kind:'weekly'});
assert.match(text(tree),/比上周 -1 kg/);
assert.match(text(tree),/比上周 -1 cm/);
states.length=0;
tree=render({...report,id:'isolated-monthly-no-previous',kind:'monthly',previousWeightKg:null,previousWaistCm:null});
assert.match(text(tree),/上月没记录/);
assert.doesNotMatch(text(tree),/上周/);
console.log('PASS: changing city preserves historical weather identity; saved preference feedback is distinct; monthly and weekly comparison periods match their actual data.');
