import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute real settings event handlers and effects with deferred HTTP receipts.
// There is no browser, actual account, network request or production write.
const source=readFileSync('app/zhiyu/morning-reminder-settings.tsx','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const hooks=[],effects=[],posts=[];
let cursor=0,serverSettings={enabled:true,time:'07:00',weeklyEnabled:true,weeklyDay:0,weeklyTime:'21:30'};
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
    const body=JSON.parse(init.body);let resolve;
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
const timeInputs=tree=>nodes(tree).filter(node=>node.type==='input'&&node.props.type==='time');
const weeklyDay=tree=>nodes(tree).find(node=>node.type==='select');
const button=(tree,label)=>nodes(tree).find(node=>node.type==='button'&&text(node)===label);
async function finishPost(success=true){const pending=posts.shift();assert.ok(pending,'Expected an in-flight request');if(success&&pending.body.action==='settings'){const {action:_action,...next}=pending.body;serverSettings=next;}pending.resolve({ok:success,json:async()=>success?{settings:structuredClone(serverSettings)}:{error:'synthetic save failure'}});await settle();return pending;}
try {
  render();await settle();let tree=render();
  assert.equal(timeInputs(tree)[0].props.value,'07:00');assert.equal(timeInputs(tree)[1].props.value,'21:30');
  assert.equal(weeklyDay(tree).props.value,0);
  timeInputs(tree)[0].props.onInput({currentTarget:{value:'22:00'}});tree=render();
  assert.equal(posts.length,1);assert.equal(timeInputs(tree)[0].props.disabled,false,'native hour/minute editing must keep its input active during save');
  timeInputs(tree)[0].props.onInput({currentTarget:{value:'22:15'}});tree=render();
  weeklyDay(tree).props.onChange({currentTarget:{value:'3'}});tree=render();
  timeInputs(tree)[1].props.onInput({currentTarget:{value:'21:45'}});tree=render();
  assert.equal(posts.length,1,'settings requests are serial');
  assert.equal(timeInputs(tree)[0].props.value,'22:15');assert.equal(weeklyDay(tree).props.value,3);
  await finishPost();tree=render();
  assert.equal(posts.length,1,'newest edits are sent after the older receipt');
  assert.equal(posts[0].body.time,'22:15');assert.equal(posts[0].body.weeklyDay,3);assert.equal(posts[0].body.weeklyTime,'21:45');
  assert.equal(timeInputs(tree)[0].props.value,'22:15','a stale receipt cannot overwrite a newer native input');
  await finishPost();tree=render();assert.match(text(tree),/已保存/);
  assert.equal(serverSettings.time,'22:15');assert.equal(serverSettings.weeklyDay,3);assert.equal(serverSettings.weeklyTime,'21:45');
  console.log('PASS: deferred saves retain segmented hour/minute edits and combined weekday/time changes, with serial complete snapshots.');

  timeInputs(tree)[0].props.onInput({currentTarget:{value:'06:45'}});tree=render();
  timeInputs(tree)[1].props.onInput({currentTarget:{value:'20:50'}});tree=render();
  await finishPost(false);tree=render();
  assert.match(text(tree),/保存简报设置失败/);assert.doesNotMatch(text(tree),/已保存/);
  assert.equal(timeInputs(tree)[0].props.value,'22:15');assert.equal(timeInputs(tree)[1].props.value,'21:45');
  assert.equal(posts.length,0,'failed writes do not continue from an unconfirmed state');
  console.log('PASS: failed receipts show an error, restore the last confirmed settings and never claim the failed values were saved.');

  button(tree,'重新生成演示周报').props.onClick();tree=render();
  assert.equal(posts[0].body.action,'regenerate-report-demo');
  assert.equal(button(tree,'重新生成演示周报').props.disabled,true);
  assert.equal(timeInputs(tree)[1].props.disabled,false);
  timeInputs(tree)[1].props.onInput({currentTarget:{value:'23:10'}});tree=render();
  assert.equal(posts.length,1);
  await finishPost();tree=render();
  assert.equal(posts.length,1,'settings entered while regenerating are drained afterwards');
  assert.equal(posts[0].body.action,'settings');assert.equal(posts[0].body.weeklyTime,'23:10');
  await finishPost();tree=render();assert.equal(timeInputs(tree)[1].props.value,'23:10');assert.match(text(tree),/已保存/);
  console.log('PASS: regeneration remains guarded while editable settings are queued and subsequently persisted.');

  button(tree,'重新生成演示简报').props.onClick();tree=render();
  timeInputs(tree)[0].props.onInput({currentTarget:{value:'08:20'}});
  for(const hook of hooks)hook?.cleanup?.(); // Closing the dialog before regeneration completes.
  await finishPost();
  assert.equal(posts.length,1,'closing settings must not discard an already requested queued change');
  assert.equal(posts[0].body.time,'08:20');
  await finishPost();assert.equal(serverSettings.time,'08:20');
  console.log('PASS: closing a regenerating dialog still persists the settings change already queued by the user.');
} finally {
  for(const hook of hooks)hook?.cleanup?.();
}
