import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const hash=value=>createHash('sha256').update(value).digest('hex');
const jsx=(type,props)=>({type,props:props||{}});
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'&&'props' in value?[value,...nodes(value.props.children)]:[];
function load(file,dependencies){const exports={};runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{exports,require:name=>{assert.ok(name in dependencies,'Unexpected dependency '+name);return dependencies[name];}},{filename:file});return exports;}
let id=0;
const react={useId:()=> 'fixture-'+(++id),useEffect:()=>{},useRef:initial=>({current:initial}),useState:initial=>[typeof initial==='function'?initial():initial,()=>{}]};
const runtime={'react/jsx-runtime':{jsx,jsxs:jsx},react};
const icons=load('app/zhiyu/phosphor-action-icon.tsx',runtime),Icon=icons.default;
// Digests of the exact <path d> strings in the four approved official
// phosphor-icons/core/assets/regular SVGs; no external files/network required.
const approved={
  like:'477b0532dbc83ddd4db0b21261d70cbffa50ad6d9105bfdb41a6586cf4c10d53',
  comment:'f316bdea48e97ede9dfac804ab7aa92cdf202f1130daf98d5487377cb1f0aea5',
  video:'0af443851fba038b1e6360e8d7bd3489235e5c191cc562be2f14e6329d5a7d1c',
  message:'751fbb66d6fce02fc0764036f6bafc8fa5d04fbd0860dd0215888e95f014dd9c',
};
for(const [name,digest] of Object.entries(approved)){
  const tree=Icon({name,size:20}),path=nodes(tree).find(node=>node.type==='path');
  assert.equal(hash(path.props.d),digest,name+' uses its approved official regular path');
  assert.equal(tree.props.viewBox,'0 0 256 256');assert.equal(tree.props.width,20);assert.equal(tree.props.height,20);
  assert.equal(tree.props['aria-hidden'],'true');assert.equal(tree.props.focusable,'false');
  assert.equal(path.props.fill,'currentColor');assert.equal(path.props.stroke,'none','a filled outline must not inherit a legacy SVG stroke or fill:none');
}
for(const [name,digest] of Object.entries({like:'778dced40f08dce990d7e65186d7e7f391c1d46acbc1d94e72ad9033ac102a8e',comment:'c95dac61f193d309575e83f7bfbf0d132ba81a804b0b7766fed16abcd7db430b'})){
 const solid=Icon({name,filled:true,gradient:true}),path=nodes(solid).find(node=>node.type==='path');
 assert.equal(hash(path.props.d),digest,'selected '+name+' uses the official solid geometry');
 assert.notEqual(hash(path.props.d),approved[name],'selected icons must be solid shapes, not recolored outlines');
 assert.equal(path.props.stroke,'none');
}
const first=Icon({name:'like',gradient:true}),second=Icon({name:'comment',gradient:true});
const gradient=tree=>nodes(tree).find(node=>node.type==='linearGradient'),paint=tree=>nodes(tree).find(node=>node.type==='path');
assert.notEqual(gradient(first).props.id,gradient(second).props.id,'different active icons do not share a paint-server id');
assert.equal(paint(first).props.fill,`url(#${gradient(first).props.id})`);
assert.deepEqual(nodes(first).filter(node=>node.type==='stop').map(node=>node.props.stopColor),['var(--zy-moment-accent-start)','var(--zy-moment-accent-end)']);
assert.equal(hash(readFileSync('docs/licenses/phosphor-icons-MIT.txt')),'b5b1f1da112d18ea2147decfd48ddc1bf2b5aeb6c265381579340e95b15a2bb2','the complete official MIT copyright/permission notice is preserved');

const phosphorModule={__esModule:true,default:Icon};
const presentation=load('app/zhiyu/moment-post-interactions.tsx',{...runtime,'./phosphor-action-icon':phosphorModule});
const post={id:'synthetic',personId:'synthetic-npc',liked:true,likes:[{actorId:'self',name:'我'}],likeCount:1,comments:[{id:'comment',actorId:'self',name:'我',text:'评论',time:'10:00'}]};
let liked=0,commented=0;
const tree=presentation.default({post,authorName:'作者',selfName:'我',actorName:(_,fallback)=>fallback,busy:false,onLike:()=>liked++,onComment:()=>commented++,onReply:()=>{}});
const actualIcons=nodes(tree).filter(node=>node.type===Icon);
assert.deepEqual(actualIcons.map(node=>[node.props.name,node.props.size,!!node.props.gradient]),[['like',23,true],['comment',22,true],['like',13,false]],'active actions and the small liker-list heart share the same official family at their existing sizes');
assert.deepEqual(actualIcons.map(node=>!!node.props.filled),[true,true,false],'own actions are solid while the liker-list marker remains an outline');
const neutralTree=presentation.default({post:{...post,liked:false,comments:[]},authorName:'作者',selfName:'我',actorName:(_,fallback)=>fallback,busy:false,onLike:()=>{},onComment:()=>{},onReply:()=>{}});
assert.ok(nodes(neutralTree).filter(node=>node.type===Icon).every(node=>!node.props.filled&&!node.props.gradient),'unliked and uncommented actions restore the regular outlines');
nodes(tree).find(node=>node.props['aria-label']==='取消点赞作者的动态').props.onClick();nodes(tree).find(node=>node.props['aria-label']==='评论作者的动态').props.onClick();assert.equal(liked,1);assert.equal(commented,1);
let opened=0;
const Header=load('app/zhiyu/chat-header.tsx',{...runtime,'./phosphor-action-icon':phosphorModule,'lucide-react':new Proxy({},{get:(_,name)=>name}),
  './pressable-icon-button':{__esModule:true,default:()=>{}},'./anchored-popup-motion':{useAnchoredPopupPresence:()=>false},'./npc-type-badge':{__esModule:true,default:()=>{}},'../../lib/user-facing-errors':{},'./private-chat-settings.css':{},'./user-facing-ui.css':{},
}).default;
const header=Header({name:'合成人物',onDesktop:()=>opened++,desktopOpen:true});
const typingHeader=Header({name:'陈年',avatar:'/synthetic.png',status:'研究进阶',typing:true,dialoguePurpose:'professional'});
const restoredHeader=Header({name:'陈年',avatar:'/synthetic.png',status:'研究进阶',typing:false,dialoguePurpose:'professional'});
assert.equal(nodes(typingHeader).find(node=>node.type==='strong').props.children[0],'对方正在输入中...');
assert.equal(nodes(restoredHeader).find(node=>node.type==='strong').props.children[0],'陈年','typing end restores the actual name');
for(const state of [typingHeader,restoredHeader]){
 const capsule=nodes(state).find(node=>node.type==='small'&&node.props.className==='zy-chat-header-status zy-character-status');
 assert.equal(capsule.props.children,'研究进阶','the presence capsule is independent of typing');
 assert.ok(nodes(state).some(node=>node.props['aria-label']==='陈年的资料'),'the profile retains the real NPC identity');
 assert.ok(nodes(state).some(node=>node.type==='img'&&node.props.alt==='陈年'));
}
assert.equal(nodes(Header({name:'陈年',typing:true})).filter(node=>node.type==='small').length,0,'typing must not create a presence capsule');
const video=nodes(header).find(node=>node.props['aria-label']==='打开桌面人物');
assert.equal(video.props['aria-pressed'],true);assert.equal(video.props.children.type,Icon);assert.equal(video.props.children.props.name,'video');assert.equal(video.props.children.props.size,20);video.props.onClick();assert.equal(opened,1,'the new video icon retains the existing call entrance callback');

const app=readFileSync('app/zhiyu/app.tsx','utf8'),appTree=ts.createSourceFile('app.tsx',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let profileMessages=0,profileVideos=0;
function visit(node){
  if((ts.isJsxSelfClosingElement(node)||ts.isJsxOpeningElement(node))&&node.tagName.getText(appTree)==='PhosphorActionIcon'){
    const name=node.attributes.properties.find(attribute=>ts.isJsxAttribute(attribute)&&attribute.name.getText(appTree)==='name')?.initializer?.text;
    let owner=node.parent;while(owner&&!owner.getText(appTree).startsWith('<div className="zy-contact-profile-actions"')&&!owner.getText(appTree).startsWith('<div className="zy-npc-profile-actions"'))owner=owner.parent;
    assert.ok(owner,'App icon replacements remain inside existing profile action sections');
    if(name==='message')profileMessages++;else if(name==='video')profileVideos++;else assert.fail('No other App icon scope is approved');
  }
  ts.forEachChild(node,visit);
}visit(appTree);assert.equal(profileMessages,3);assert.equal(profileVideos,2);
assert.match(app,/<MessageSquare fill=\{page === 'chat'/,'the main navigation chat symbol stays unchanged');
const composer=readFileSync('app/zhiyu/chat-composer.tsx','utf8');
assert.match(composer,/<svg className="chat-send-plane"[^>]*width="19" height="19"/);assert.match(composer,/<path d="m22 2-7 20-4-9-9-4Z"\/>/,'the existing ordinary input send plane stays unchanged');assert.ok(!composer.includes('PhosphorActionIcon'));
for(const file of ['app/zhiyu/moment-comment-editor.tsx','app/zhiyu/character-dock.tsx']){const text=readFileSync(file,'utf8');assert.match(text,/<Send size=\{17\}/);assert.ok(!text.includes('PhosphorActionIcon'),'existing text send controls are outside this replacement scope');}
console.log('PASS: four official Phosphor SVG paths/MIT, unique active gradients, original action sizes/aria/callbacks, precise profile/video/like/comment scope, and untouched input send/navigation symbols.');
