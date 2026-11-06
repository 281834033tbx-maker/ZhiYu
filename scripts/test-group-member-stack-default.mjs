import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

// The real component runs with a deterministic hook host. No DOM, account,
// browser storage or network is accessed by this presentation regression.
let cursor=0;
const states=[];
const jsx=(type,props)=>({type,props:props||{}});
const dependencies={
  react:{useState:initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef:initial=>({current:initial}),useId:()=> 'members-test',useEffect:()=>{},useLayoutEffect:()=>{}},
  'react/jsx-runtime':{jsx,jsxs:jsx},
  './group-member-stack.css':{},
};
const file='app/zhiyu/group-member-stack.tsx';
const compiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const exports={};
runInNewContext(compiled,{exports,require:name=>{assert.ok(name in dependencies,'Unknown dependency '+name);return dependencies[name];}},{filename:file});
const members=Array.from({length:6},(_,index)=>({id:'m'+index,name:'成员'+index,role:'npc',joinedAt:'2026-11-07T10:00:00+08:00',order:index}));
const props={members,displayNames:new Map(),renderFace:member=>jsx('img',{alt:member.name}),addAction:jsx('button',{'aria-label':'添加成员'})};
const render=()=>{cursor=0;return exports.default(props);};
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'&&'props' in value?[value,...nodes(value.props.children)]:[];
let tree=render(),toggle=nodes(tree).find(node=>node.props.className==='zy-group-member-stack-toggle');
assert.equal(toggle.props['aria-expanded'],true,'members are expanded whenever the drawer mounts');
assert.match(toggle.props['aria-label'],/^收起群成员，共6人/);
assert.ok(tree.props.style.height>=230,'the initial expanded rows reserve room instead of overlapping the following fields');
const overflow=nodes(tree).filter(node=>node.props.className?.includes('is-overflow'));
assert.equal(overflow.length,2);assert.ok(overflow.every(node=>node.props['aria-hidden']===false),'members beyond four are initially exposed');
toggle.props.onClick();tree=render();toggle=nodes(tree).find(node=>node.props.className==='zy-group-member-stack-toggle');
assert.equal(toggle.props['aria-expanded'],false,'clicking the expanded member area still collapses it');
assert.match(toggle.props['aria-label'],/^展开群成员，共6人/);
toggle.props.onClick();tree=render();toggle=nodes(tree).find(node=>node.props.className==='zy-group-member-stack-toggle');
assert.equal(toggle.props['aria-expanded'],true,'the same control expands it again');
const css=readFileSync('app/zhiyu/group-member-stack.css','utf8');
assert.match(css,/\.zy-group-member-stack \.zy-group-drawer-member-face\s*\{[^}]*border:0;/,'the outside white avatar border is gone');
assert.match(css,/\.zy-group-member-stack-add[^}]*border:1px dashed/,'the add-member affordance retains its dashed edge');
const groupCss=readFileSync('app/zhiyu/group-chat.css','utf8');
assert.match(groupCss,/\.zy-group-drawer-member\.is-selected[^}]*background:linear-gradient/,'member-picker selection remains distinct');
console.log('PASS: members start expanded with reserved rows, still collapse/reopen, and only the outer avatar ring is removed.');
