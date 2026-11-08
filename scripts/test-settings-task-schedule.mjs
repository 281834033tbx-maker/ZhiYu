import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

// Synthetic account/settings responses only. No live API, user storage, task
// persistence, timers or model calls are used by this regression.
const jsx=(type,props)=>({type,props:props||{}});
function load(path,dependencies={},globals={}) {
  const exports={};
  runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:name=>{assert.ok(name in dependencies,'Unexpected dependency '+name);return dependencies[name];},...globals},{filename:path});
  return exports;
}
const schedule=load('app/zhiyu/report-schedule-store.ts',{
  react:{useCallback:fn=>fn,useEffect:()=>{},useSyncExternalStore:()=>{}},'./npc-fetch':{npcFetch:()=>{throw Error('Unexpected live fetch');}},
});
const requests=[];
const store=schedule.createReportScheduleStore((_url,init)=>new Promise((resolve,reject)=>requests.push({init,resolve,reject})));
const label=id=>schedule.weeklyReviewScheduleLabel(store.get(id));
const settings={enabled:true,time:'07:00',weeklyEnabled:true,weeklyDay:0,weeklyTime:'21:30',city:{name:'合成城市',source:'manual'}};
let noticesA=0,noticesB=0;
const offA=store.subscribe('account-a',()=>noticesA++),offB=store.subscribe('account-b',()=>noticesB++);
assert.equal(label('account-a'),'时间同步中…');
const first=store.refresh('account-a'),duplicate=store.refresh('account-a');assert.equal(first,duplicate,'simultaneous readers share one GET');await Promise.resolve();
assert.equal(requests.length,1);assert.equal(requests[0].init.headers['X-Zhiyu-Account'],'account-a');assert.equal(requests[0].init.method,undefined,'task display reads settings without changing the server');
requests.shift().resolve({ok:true,json:async()=>({settings})});await first;assert.equal(label('account-a'),'今晚 21:30');assert.equal(noticesA,1);assert.equal(noticesB,0);
store.publish('account-a',{...settings,weeklyTime:'22:00'});assert.equal(label('account-a'),'今晚 22:00','confirmed settings changes update an already-mounted task view synchronously');assert.equal(label('account-b'),'时间同步中…','account A settings are never used for B');
const stale=store.refresh('account-a');await Promise.resolve();store.publish('account-a',{...settings,weeklyTime:'23:15'});requests.shift().resolve({ok:true,json:async()=>({settings})});await stale;assert.equal(label('account-a'),'今晚 23:15','an older GET cannot overwrite a newly saved schedule');
const failed=store.refresh('account-b');await Promise.resolve();requests.shift().reject(Error('synthetic offline'));await failed;assert.equal(label('account-b'),'周报时间暂未同步');assert.equal(label('account-a'),'今晚 23:15');
const retried=store.refresh('account-b');await Promise.resolve();requests.shift().resolve({ok:true,json:async()=>({settings:{...settings,weeklyTime:'20:45'}})});await retried;assert.equal(label('account-b'),'今晚 20:45','a failed read remains retryable');
store.publish('account-a',{...settings,weeklyEnabled:false});assert.equal(label('account-a'),'周报已关闭');
store.publish('account-a',{enabled:true,time:'07:00'});assert.equal(label('account-a'),'今晚 21:30','legacy settings use the exact same defaults as the settings controls');
store.publish('account-a',{...settings,weeklyTime:'77:99'});assert.equal(label('account-a'),'周报时间未设置','an invalid weekly clock is never displayed as a valid schedule');
store.publish('account-a',{...settings,weeklyTime:'22:00'});const beforeInvalid=noticesA;store.publish('account-a',{...settings,time:'bad',weeklyTime:'18:00'});assert.equal(noticesA,beforeInvalid);assert.equal(label('account-a'),'今晚 22:00');
const mutable={...settings,city:{...settings.city}};store.publish('account-a',mutable);mutable.city.name='后续外部变更';assert.equal(store.get('account-a').settings.city.name,'合成城市','confirmed snapshots do not alias mutable input cities');
offA();offB();const finalNotices=noticesA;store.publish('account-a',{...settings,weeklyTime:'19:00'});assert.equal(noticesA,finalNotices,'unmounted task views unsubscribe cleanly');
let attempts=0;const synchronousFailure=schedule.createReportScheduleStore(()=>{attempts++;throw Error('synthetic failure');});await synchronousFailure.refresh('a');await synchronousFailure.refresh('a');assert.equal(attempts,2,'even a synchronous transport failure cannot pin a completed pending request');

const config=load('app/zhiyu/task-board/config.ts');
const directoryPath='lib/npc/character-directory.ts';
const dependencies={};for(const match of readFileSync(directoryPath,'utf8').matchAll(/from '([^']+\.json)'/g))dependencies[match[1]]={default:JSON.parse(readFileSync(resolve(dirname(directoryPath),match[1]),'utf8'))};
const directory=load(directoryPath,dependencies).publicGroupDirectory();
const componentsPath='app/zhiyu/task-board/task-components.tsx',componentSource=readFileSync(componentsPath,'utf8');
const parsed=ts.createSourceFile(componentsPath,componentSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let avatarFunction;function find(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='NpcAvatar')avatarFunction=node.getText(parsed);ts.forEachChild(node,find);}find(parsed);assert.ok(avatarFunction);
const avatars={exports:{},require:name=>{assert.equal(name,'react/jsx-runtime');return {jsx,jsxs:jsx};}};
runInNewContext(ts.transpileModule(avatarFunction+'\nexports.Avatar=NpcAvatar;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,avatars);
for(const npc of config.npcs){
  assert.equal(npc.avatar,directory.find(person=>person.id===npc.id)?.avatar,npc.id+' uses the existing chat/directory portrait');assert.ok(existsSync('public'+npc.avatar));assert.ok(!npc.avatar.startsWith('data:'));
  const face=avatars.exports.Avatar({npc,size:npc.id==='molly'?28:18});
  assert.equal(face.props.children.type,'img');assert.equal(face.props.children.props.src,npc.avatar);assert.equal(face.props['aria-label'],npc.name);
  assert.equal(face.props.style.width,npc.id==='molly'?28:18,'the original per-surface avatar size is retained');
}
const avatarCss=readFileSync('app/zhiyu/task-board/task-components.css','utf8');assert.match(avatarCss,/\.tb-npc-avatar\s*\{[^}]*border-radius:50%/);assert.match(avatarCss,/\.tb-npc-avatar>img\s*\{[^}]*object-fit:cover/);
const board=readFileSync('app/zhiyu/task-board/task-board.tsx','utf8');assert.match(board,/useReportSchedule\(account.id\)/);assert.match(board,/weeklyReviewScheduleLabel\(weeklySchedule\)/);assert.ok(!board.includes('model.page.weeklyReview.time'),'the old stored demonstration clock is no longer the display authority');
const css=readFileSync('app/zhiyu/app-settings.css','utf8'),reportsCss=readFileSync('app/zhiyu/morning-reminder-settings.css','utf8');
assert.match(css,/\.zy-settings-button\s*\{[^}]*border:1px solid var\(--zy-glass-line\);border-radius:10px/);assert.match(css,/\.zy-settings-font-select>select\s*\{[^}]*border:1px solid var\(--zy-glass-line\);border-radius:10px/);
for(const focusRule of [...css.split('\n'),...reportsCss.split('\n')].filter(line=>line.includes(':focus-visible')))assert.ok(focusRule.includes('var(--zy-interaction-ink)'),'settings retain a visible theme-blue focus treatment');

// Exercise actual settings close callbacks, including a theme transition and a
// nested logout confirmation. No logout, browser window or native call occurs.
let cursor=0,closed=0,finishedTransition=0;const hookValues=[];
const theme={transitioning:true,theme:'dark',setTheme:value=>{assert.equal(value,'dark');finishedTransition++;theme.transitioning=false;},toggleTheme:()=>{}};
const Settings=load('app/zhiyu/app-settings.tsx',{
  react:{useCallback:fn=>fn,useEffect:()=>{},useRef:initial=>{const index=cursor++;return hookValues[index]??(hookValues[index]={current:initial});},useState:initial=>{const index=cursor++;if(!(index in hookValues))hookValues[index]=typeof initial==='function'?initial():initial;return [hookValues[index],next=>{hookValues[index]=typeof next==='function'?next(hookValues[index]):next;}];}},
  'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{ChevronDown:()=>null,X:()=>null},'../../desktop/package.json':{default:{version:'fixture'}},'./theme':{useTheme:()=>theme},'./font-size':{useFontSize:()=>({fontSize:'medium',setFontSize:()=>{}})},'./morning-reminder-settings':{ReportScheduleSettings:()=>null},'./app-settings.css':{},
}).default;
const allNodes=value=>Array.isArray(value)?value.flatMap(allNodes):value&&typeof value==='object'&&'props' in value?[value,...allNodes(value.props.children)]:[];
const settingsProps={person:{name:'合成账号'},username:'synthetic',onClose:()=>closed++,onLogout:()=>{throw Error('Do not log out from a presentation test');}};
const render=()=>{cursor=0;return Settings(settingsProps);};
let tree=render();const dialog={open:true,getBoundingClientRect:()=>({left:20,top:20,right:400,bottom:600})};tree.props.ref.current=dialog;
const closeButton=allNodes(tree).find(node=>node.props['aria-label']==='关闭设置');assert.notEqual(closeButton.props.disabled,true,'X stays clickable while a theme transition is running');closeButton.props.onClick();assert.equal(finishedTransition,1);assert.equal(closed,1,'closing explicitly ends the active theme transition once');
hookValues.length=0;tree=render();tree.props.ref.current=dialog;allNodes(tree).find(node=>node.type==='button'&&node.props.children==='退出登录').props.onClick();tree=render();
allNodes(tree).find(node=>node.props['aria-label']==='关闭设置').props.onClick();assert.equal(closed,1,'the settings X cannot dismiss a nested logout confirmation');
const confirmation=allNodes(tree).find(node=>typeof node.type==='function'&&node.type.name==='LogoutConfirmation');assert.ok(confirmation);confirmation.props.onCancel();tree=render();
const pointer=(x,y,id=1)=>({isPrimary:true,button:0,pointerId:id,clientX:x,clientY:y,target:dialog,currentTarget:dialog});
tree.props.onPointerDown(pointer(40,40));tree.props.onPointerUp(pointer(0,0));assert.equal(closed,1,'an inside gesture ending outside does not dismiss settings');
tree.props.onPointerDown(pointer(0,0));tree.props.onPointerCancel();tree.props.onPointerUp(pointer(0,0));assert.equal(closed,1,'a cancelled backdrop pointer cannot dismiss settings');
tree.props.onPointerDown(pointer(0,0));tree.props.onPointerUp(pointer(0,0));assert.equal(closed,2,'a genuine outside click still dismisses settings once');
hookValues.length=0;tree=render();tree.props.ref.current=dialog;tree.props.onCancel({preventDefault:()=>{},target:{},currentTarget:dialog});assert.equal(closed,2,'a bubbled inner dialog cancel does not close the outer settings');
tree.props.onCancel({preventDefault:()=>{},target:dialog,currentTarget:dialog});assert.equal(closed,3,'Escape on the current settings still closes it');
assert.match(css,/\.zy-settings-dialog,\.zy-logout-dialog,\.zy-settings-dialog>header\s*\{\s*-webkit-app-region:no-drag/);assert.match(css,/\.zy-settings-dialog>header>button\s*\{[^}]*pointer-events:auto;[^}]*-webkit-app-region:no-drag/,'the native close hit region excludes underlying window drag areas');

// Native ViewTransition may retarget a visible X press to html/body, dropping
// its click handler. Dispatch the real document-capture fallback by geometry.
const transitionSlots=[],effectQueue=[],listeners=new Map();let transitionCursor=0,transitionClosed=0,transitionFinished=0;
const changed=(a,b)=>!a||b.some((value,index)=>value!==a[index]);
const transitionReact={
  useRef:initial=>{const index=transitionCursor++;return transitionSlots[index]??(transitionSlots[index]={current:initial});},
  useState:initial=>{const index=transitionCursor++;if(!(index in transitionSlots))transitionSlots[index]=typeof initial==='function'?initial():initial;return [transitionSlots[index],value=>{transitionSlots[index]=typeof value==='function'?value(transitionSlots[index]):value;}];},
  useCallback:(fn,deps)=>{const index=transitionCursor++,old=transitionSlots[index];if(changed(old?.deps,deps))transitionSlots[index]={fn,deps};return transitionSlots[index].fn;},
  useEffect:(effect,deps)=>{const index=transitionCursor++,old=transitionSlots[index];if(changed(old?.deps,deps)){transitionSlots[index]={deps};effectQueue.push(()=>{old?.cleanup?.();transitionSlots[index].cleanup=effect();});}},
};
const transitionDocument={addEventListener:(type,fn)=>{const set=listeners.get(type)||new Set();set.add(fn);listeners.set(type,set);},removeEventListener:(type,fn)=>listeners.get(type)?.delete(fn)};
const transitionTheme={transitioning:true,theme:'light',setTheme:()=>transitionFinished++,toggleTheme:()=>{}};
const TransitionSettings=load('app/zhiyu/app-settings.tsx',{
  react:transitionReact,'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{ChevronDown:()=>null,X:()=>null},'../../desktop/package.json':{default:{version:'fixture'}},'./theme':{useTheme:()=>transitionTheme},'./font-size':{useFontSize:()=>({fontSize:'medium',setFontSize:()=>{}})},'./morning-reminder-settings':{ReportScheduleSettings:()=>null},'./app-settings.css':{},
},{document:transitionDocument}).default;
const transitionDialog={open:true,getBoundingClientRect:()=>({left:20,top:20,right:400,bottom:600}),showModal(){this.open=true;},close(){this.open=false;}};
const transitionButton={disabled:false,getBoundingClientRect:()=>({left:350,top:30,right:378,bottom:58})};
const transitionRender=()=>{transitionCursor=0;const result=TransitionSettings({...settingsProps,onClose:()=>transitionClosed++});result.props.ref.current=transitionDialog;allNodes(result).find(node=>node.props['aria-label']==='关闭设置').props.ref.current=transitionButton;while(effectQueue.length)effectQueue.shift()();return result;};
const remountTransition=()=>{for(const slot of transitionSlots)slot?.cleanup?.();transitionSlots.length=0;effectQueue.length=0;listeners.clear();return transitionRender();};
const emit=(type,x,y,extra={})=>{for(const fn of listeners.get(type)||[])fn({isPrimary:true,button:0,pointerId:1,clientX:x,clientY:y,target:transitionDocument,...extra});};
let transitionTree=remountTransition();emit('pointerdown',362,42);emit('pointerup',363,43);assert.equal(transitionClosed,1);assert.equal(transitionFinished,1,'a body-retargeted X press completes the active theme motion before closing');allNodes(transitionTree).find(node=>node.props['aria-label']==='关闭设置').props.onClick();assert.equal(transitionClosed,1,'a subsequent ordinary click does not request a second close');
remountTransition();emit('pointerdown',351,31);emit('pointerup',377,57);assert.equal(transitionClosed,1,'dragging across the X area does not count as a click');
remountTransition();emit('pointerdown',100,100);emit('pointerup',362,42);assert.equal(transitionClosed,1,'moving into the X does not close');
remountTransition();emit('pointerdown',362,42);emit('pointerup',100,100);assert.equal(transitionClosed,1,'moving out of the X does not close');
remountTransition();emit('pointerdown',362,42);emit('pointerup',362,42,{pointerId:2});assert.equal(transitionClosed,1,'a different pointer cannot finish the close gesture');
remountTransition();emit('pointerdown',362,42,{button:2});emit('pointerup',362,42,{button:2});assert.equal(transitionClosed,1,'right click does not dismiss settings');
remountTransition();emit('pointerdown',362,42);emit('pointercancel',362,42);emit('pointerup',362,42);assert.equal(transitionClosed,1,'cancelled pointers do not dismiss settings');
transitionTree=remountTransition();allNodes(transitionTree).find(node=>node.type==='button'&&node.props.children==='退出登录').props.onClick();transitionTree=transitionRender();emit('pointerdown',362,42);emit('pointerup',362,42);allNodes(transitionTree).find(node=>node.props['aria-label']==='关闭设置').props.onClick();assert.equal(transitionClosed,1,'nested logout confirmation retains priority over the transition fallback');
remountTransition();emit('pointerdown',0,0);emit('pointerup',0,0);assert.equal(transitionClosed,2,'the original outside-click fallback still closes once');
for(const slot of transitionSlots)slot?.cleanup?.();
console.log('PASS: same-account weekly time and read/save races, canonical avatars/settings focus, transition-retargeted X with click/drag/cancel boundaries, nested confirmations and Escape/backdrop dismissal.');
