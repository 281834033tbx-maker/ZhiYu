import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute real settings event handlers and effects with deferred HTTP receipts.
// There is no browser, actual account, network request or production write.
const source=readFileSync('app/zhiyu/morning-reminder-settings.tsx','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const hooks=[],effects=[],posts=[],requests=[];
let cursor=0,serverSettings={enabled:true,time:'07:00',weeklyEnabled:true,weeklyDay:0,weeklyTime:'21:30',city:{name:'合成城市',source:'manual'}};
const jsx=(type,props)=>({type,props:props||{}});
const react={
  useState(initial){const index=cursor++;if(!(index in hooks))hooks[index]=typeof initial==='function'?initial():initial;return [hooks[index],value=>{hooks[index]=typeof value==='function'?value(hooks[index]):value;}];},
  useRef(initial){const index=cursor++;return hooks[index]??=( {current:initial} );},
  useId(){const index=cursor++;return hooks[index]??=`settings-fixture-${index}`;},
  useEffect(effect,deps){const index=cursor++,old=hooks[index];if(!old||deps.some((value,i)=>value!==old.deps[i])){hooks[index]={deps};effects.push(()=>{old?.cleanup?.();hooks[index].cleanup=effect();});}},
};
const sandboxModule={exports:{}},dependencies={
  react,
  'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:Symbol.for('fragment')},
  'lucide-react':{X:()=>null},
  './auth-gate':{useAccount:()=>({account:{id:'isolated-settings-owner'}})},
  './npc-fetch':{npcFetch:(_url,init)=>{
    if(!init?.method||init.method==='GET')return Promise.resolve({ok:true,json:async()=>({settings:structuredClone(serverSettings)})});
    const body=JSON.parse(init.body);requests.push(body);let resolve;
    const receipt=new Promise(done=>{resolve=done;});posts.push({body,resolve});return receipt;
  }},
  '../../lib/user-facing-errors':{reportUserFacingError:(_reason,_kind,label)=>`${label}失败，请重试`},
  './morning-reminder-settings.css':{},
};
vm.runInNewContext(compiled,{module:sandboxModule,exports:sandboxModule.exports,require:name=>{assert.ok(name in dependencies,'Unexpected settings dependency '+name);return dependencies[name];},console,AbortController},{filename:'morning-reminder-settings.tsx'});
const root=sandboxModule.exports.default({onClose(){}}),Dialog=root.type;
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'&&'props'in value?[value,...nodes(value.props.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'&&'props'in value?text(value.props.children):typeof value==='string'||typeof value==='number'?String(value):'';
const render=()=>{cursor=0;const tree=Dialog(root.props);while(effects.length)effects.shift()();return tree;};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const timeSelect=(tree,kind,part)=>nodes(tree).find(node=>node.type==='select'&&node.props['aria-label']===`${kind==='daily'?'简报':'周报'}时间${part==='hour'?'小时':'分钟'}`);
const changeTime=(tree,kind,part,value)=>timeSelect(tree,kind,part).props.onChange({currentTarget:{value}});
const valueTime=(tree,kind)=>timeSelect(tree,kind,'hour').props.value+':'+timeSelect(tree,kind,'minute').props.value;
const weeklyDay=tree=>nodes(tree).find(node=>node.type==='select'&&node.props['aria-label']==='周报星期');
const switchFor=(tree,label)=>nodes(tree).find(node=>node.type==='button'&&node.props.role==='switch'&&node.props['aria-label']===label);
async function finishPost(success=true){const pending=posts.shift();assert.ok(pending,'Expected an in-flight request');if(success&&pending.body.action==='settings'){const {action:_action,...next}=pending.body;serverSettings=next;}pending.resolve({ok:success,json:async()=>success?{settings:structuredClone(serverSettings)}:{error:'synthetic save failure'}});await settle();return pending;}
try {
  render();await settle();let tree=render();
  assert.equal(valueTime(tree,'daily'),'07:00');assert.equal(valueTime(tree,'weekly'),'21:30');
  assert.equal(weeklyDay(tree).props.value,0);
  assert.equal(nodes(tree).filter(node=>node.type==='input'&&node.props.type==='time').length,0,'native AM/PM segments are not used');
  assert.equal(nodes(tree).filter(node=>node.type==='select').length,5,'two explicit 24-hour times and one weekday');
  assert.doesNotMatch(text(tree),/演示|重新生成|城市|AM|PM/,'product settings expose only switches and schedule controls');
  assert.equal(nodes(timeSelect(tree,'daily','hour').props.children).filter(node=>node.type==='option').length,24);
  changeTime(tree,'daily','hour','22');tree=render();
  assert.equal(posts.length,1);assert.equal(timeSelect(tree,'daily','minute').props.disabled,false,'hour/minute controls stay editable while saving');
  changeTime(tree,'daily','minute','15');tree=render();
  weeklyDay(tree).props.onChange({currentTarget:{value:'3'}});tree=render();
  changeTime(tree,'weekly','minute','45');tree=render();
  assert.equal(posts.length,1,'settings requests are serial');
  assert.equal(valueTime(tree,'daily'),'22:15');assert.equal(weeklyDay(tree).props.value,3);
  await finishPost();tree=render();
  assert.equal(posts.length,1,'newest edits are sent after the older receipt');
  assert.equal(posts[0].body.time,'22:15');assert.equal(posts[0].body.weeklyDay,3);assert.equal(posts[0].body.weeklyTime,'21:45');
  assert.equal(valueTime(tree,'daily'),'22:15','a stale receipt cannot overwrite a newer input');
  await finishPost();tree=render();assert.match(text(tree),/已保存/);
  assert.equal(serverSettings.time,'22:15');assert.equal(serverSettings.weeklyDay,3);assert.equal(serverSettings.weeklyTime,'21:45');assert.equal(serverSettings.city.name,'合成城市','hidden existing city is not erased by schedule edits');
  console.log('PASS: explicit 24-hour controls serialize complete daily/weekly snapshots and keep newer edits.');

  changeTime(tree,'daily','hour','06');tree=render();
  changeTime(tree,'weekly','minute','50');tree=render();
  await finishPost(false);tree=render();
  assert.match(text(tree),/保存简报设置失败/);assert.doesNotMatch(text(tree),/已保存/);
  assert.equal(valueTime(tree,'daily'),'22:15');assert.equal(valueTime(tree,'weekly'),'21:45');
  assert.equal(posts.length,0,'failed writes do not continue from an unconfirmed state');
  console.log('PASS: failed receipts restore confirmed values without a false saved message.');

  switchFor(tree,'今日简报').props.onClick();tree=render();
  assert.equal(timeSelect(tree,'daily','hour').props.disabled,true);
  assert.equal(timeSelect(tree,'weekly','hour').props.disabled,false);
  await finishPost();tree=render();assert.equal(serverSettings.enabled,false);
  switchFor(tree,'今日简报').props.onClick();tree=render();await finishPost();tree=render();
  switchFor(tree,'周报').props.onClick();tree=render();
  assert.equal(timeSelect(tree,'weekly','hour').props.disabled,true);assert.equal(weeklyDay(tree).props.disabled,true);assert.equal(timeSelect(tree,'daily','hour').props.disabled,false);
  await finishPost();tree=render();assert.equal(serverSettings.weeklyEnabled,false);
  switchFor(tree,'周报').props.onClick();tree=render();await finishPost();tree=render();
  changeTime(tree,'daily','minute','20');tree=render();
  changeTime(tree,'weekly','hour','23');tree=render();
  for(const hook of hooks)hook?.cleanup?.();
  await finishPost();
  assert.equal(posts.length,1,'closing settings does not discard a requested queued change');
  assert.equal(posts[0].body.weeklyTime,'23:45');assert.equal(posts[0].body.time,'22:20');
  await finishPost();assert.equal(serverSettings.weeklyTime,'23:45');assert.equal(serverSettings.time,'22:20');
  assert.ok(requests.length>0&&requests.every(body=>body.action==='settings'),'UI sends no demo regeneration requests');
  console.log('PASS: switches disable their time fields, and queued changes persist after close.');
} finally {
  for(const hook of hooks)hook?.cleanup?.();
}
