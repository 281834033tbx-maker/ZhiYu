import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

// Exercise the real presentation components and interaction handler with only
// synthetic posts. This harness has no browser, storage or network connection.
const jsx=(type,props)=>({type,props:props||{}});
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'&&'props' in value?[value,...nodes(value.props.children)]:[];
function load(file,dependencies,extra={}) {
  const exports={};
  const compiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  runInNewContext(compiled,{exports,require:name=>{assert.ok(name in dependencies,'Unexpected dependency: '+name);return dependencies[name];},...extra},{filename:file});
  return exports;
}
const icons=new Proxy({},{get:(_,name)=>name});
const presentation=load('app/zhiyu/moment-post-interactions.tsx',{
  react:{useId:()=> 'fixture'},'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':icons,
  './phosphor-action-icon':{__esModule:true,default:props=>jsx('synthetic-phosphor-icon',props)},
});
const post={id:'fixture-post',personId:'fixture-npc',source:'npc-moment',liked:false,likeCount:3,likes:[{actorId:'friend',name:'朋友'}],comments:[{id:'friend-comment',actorId:'friend',name:'朋友',text:'原有评论',time:'10:00'}]};
assert.equal(presentation.hasOwnMomentComment(post),false,'another person’s comment must not activate my comment icon');
assert.equal(presentation.hasOwnMomentComment({...post,comments:[...post.comments,{actorId:'self'}]}),true);
assert.equal(presentation.hasOwnMomentComment({...post,comments:[{name:'与我同名的旧评论'}]}),false,'a legacy name without an actor id is not a read or identity receipt');
assert.equal(presentation.momentLikers({...post,liked:true},'我').filter(like=>like.actorId==='self').length,1);
assert.equal(presentation.momentLikers({...post,liked:true,likes:[...post.likes,{actorId:'self',name:'旧名字'}]},'我').filter(like=>like.actorId==='self').length,1,'a confirmed self like is not duplicated');
assert.equal(presentation.momentLikers({...post,liked:false,likes:[{actorId:'self',name:'我'}]},'我').length,0,'unliking removes a stale self row');
let likes=0,comments=0,reply;
const editor=jsx('synthetic-editor',{});
const tree=presentation.default({post,authorName:'作者',selfName:'我',actorName:(_,fallback)=>fallback,busy:false,onLike:()=>likes++,onComment:()=>comments++,onReply:value=>{reply=value;},editor});
const all=nodes(tree),box=all.find(node=>node.props.className==='zy-moment-interaction-box');
assert.ok(box);assert.equal(box.props.children.at(-1),editor,'the editor stays below existing likes and comments in the same box');
all.find(node=>node.props['aria-label']==='点赞作者的动态').props.onClick();
all.find(node=>node.props['aria-label']==='评论作者的动态').props.onClick();
all.find(node=>node.props.className==='zy-inline-comment').props.children.props.onClick();
assert.equal(likes,1);assert.equal(comments,1);assert.equal(reply.id,'friend-comment');
assert.equal(all.find(node=>node.props['aria-label']==='评论作者的动态').props['aria-pressed'],false);
const disabled=presentation.default({post,authorName:'作者',selfName:'我',actorName:(_,fallback)=>fallback,busy:true,onLike:()=>{},onComment:()=>{},onReply:()=>{}});
assert.equal(nodes(disabled).find(node=>node.props['aria-label']==='点赞作者的动态').props.disabled,true);

let cursor=0;const hooks=[];
const react={
  useRef:initial=>{const index=cursor++;return hooks[index]??(hooks[index]={current:initial});},
  useState:initial=>{const index=cursor++;if(!(index in hooks))hooks[index]=initial;return [hooks[index],value=>{hooks[index]=typeof value==='function'?value(hooks[index]):value;}];},
  useEffect:()=>{},
};
const catalog=JSON.parse(readFileSync('app/zhiyu/emoji-data/catalog.json','utf8'));
const commentEditor=load('app/zhiyu/moment-comment-editor.tsx',{
  react,'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':icons,'./emoji-data/catalog.json':catalog,
},{requestAnimationFrame:callback=>callback()});
let value='前后',submitted=0,cancelled=0,cancelReply=0,resolveSubmit;
const props={onChange:next=>{value=next;},onSubmit:()=>{submitted++;return new Promise(resolve=>{resolveSubmit=resolve;});},onCancel:()=>cancelled++,onCancelReply:()=>cancelReply++,replyName:'朋友'};
const render=(overrides={})=>{cursor=0;return commentEditor.default({...props,value,...overrides});};
let form=render(),textarea=nodes(form).find(node=>node.type==='textarea');
const input={selectionStart:1,selectionEnd:1,focus:()=>{},setSelectionRange:(start,end)=>{input.selectionStart=start;input.selectionEnd=end;}};
textarea.props.ref.current=input;
nodes(form).find(node=>node.props['aria-label']==='选择评论表情').props.onClick();
form=render();
assert.equal(nodes(form).some(node=>node.type==='img'||node.type==='input'&&node.props.type==='file'),false,'the emoji editor exposes text only');
const emoji=nodes(form).find(node=>node.type==='button'&&node.props.title);
emoji.props.onClick();assert.equal(value,'前'+emoji.props.children+'后','emoji text inserts at the caret');
form=render();textarea=nodes(form).find(node=>node.type==='textarea');
let prevented=0;
textarea.props.onPaste({clipboardData:{files:[{type:'image/png'}],getData:()=> '纯文字'},preventDefault:()=>prevented++});
assert.equal(prevented,1);assert.match(value,/纯文字/,'an image paste may keep its plain text, never its file');
textarea.props.onDrop({dataTransfer:{files:[{type:'image/png'}]},preventDefault:()=>prevented++});assert.equal(prevented,2);
value='x'.repeat(1000);form=render();nodes(form).find(node=>node.type==='textarea').props.ref.current={...input,selectionStart:1000,selectionEnd:1000};
nodes(form).find(node=>node.type==='button'&&node.props.title).props.onClick();assert.equal(value.length,1000,'emoji insertion respects the same text limit');
value='可发送';form=render();textarea=nodes(form).find(node=>node.type==='textarea');
const key=(key,extra={})=>({key,shiftKey:false,nativeEvent:{isComposing:false},preventDefault:()=>{},stopPropagation:()=>{},...extra});
textarea.props.onKeyDown(key('Enter',{shiftKey:true}));textarea.props.onKeyDown(key('Enter',{nativeEvent:{isComposing:true}}));assert.equal(submitted,0);
form.props.onSubmit({preventDefault:()=>{}});form.props.onSubmit({preventDefault:()=>{}});assert.equal(submitted,1,'a rapid double submit reuses the in-flight operation');
resolveSubmit();await new Promise(resolve=>setImmediate(resolve));
form=render();textarea=nodes(form).find(node=>node.type==='textarea');textarea.props.onKeyDown(key('Escape'));assert.equal(cancelled,1,'Escape closes the inline editor after the emoji panel is closed');
form=render({disabled:true});form.props.onSubmit({preventDefault:()=>{}});assert.equal(submitted,1,'a busy editor cannot submit');
nodes(form).find(node=>node.props['aria-label']==='取消回复').props.onClick();assert.equal(cancelReply,1);

// Run the actual account-scoped API handler, including its failure path.
const app=readFileSync('app/zhiyu/app.tsx','utf8');
const parsed=ts.createSourceFile('app.tsx',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let handler;function find(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='interactWithPost')handler=node.getText(parsed);ts.forEachChild(node,find);}find(parsed);assert.ok(handler);
const scope={id:'account-a'},received=[],notices=[],patches=[];
const context={exports:{},interactionBusy:'',groupAccountScope:{current:scope},self:{name:'我'},commentReply:{id:'friend-comment',name:'朋友'},commentRequest:{current:null},uid:()=> 'fixture-request',now:()=> '10:00',
  patchPost:(...args)=>patches.push(args),receiveNpcPosts:items=>received.push(items),notify:message=>notices.push(message),reportUserFacingError:()=> '明确失败',window:{dispatchEvent:()=>{}},Event:class{},
};
context.setInteractionBusy=value=>{context.interactionBusy=value;};
let fail=true,finishRequest;context.npcFetch=()=>fail?Promise.resolve({ok:false,json:async()=>({error:'拒绝互动'})}):new Promise(resolve=>{finishRequest=resolve;});
runInNewContext(ts.transpileModule(handler+'\nexports.interactWithPost=interactWithPost;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
assert.equal(await context.exports.interactWithPost(post,'comment','草稿'),false);assert.equal(notices.length,1);assert.equal(received.length,0);assert.equal(context.interactionBusy,'');assert.equal(context.commentRequest.current.id,'fixture-request','a failed comment retains the deduplication id for retry');
fail=false;const pending=context.exports.interactWithPost(post,'comment','草稿');context.groupAccountScope.current={id:'account-b'};context.interactionBusy='new-account-operation';
finishRequest({ok:true,json:async()=>({items:[{...post,createdAt:1794016800000,status:'published'}]})});assert.equal(await pending,false);assert.equal(received.length,0);assert.equal(context.interactionBusy,'new-account-operation','a stale reply cannot clear the new account’s busy state');
context.interactionBusy='';const fresh=context.exports.interactWithPost(post,'comment','草稿');finishRequest({ok:true,json:async()=>({items:[{...post,createdAt:1794016800000,status:'published'},{...post,id:'draft',status:'draft'}]})});assert.equal(await fresh,true);assert.equal(received.at(-1).length,1);assert.equal(context.commentRequest.current,null);
assert.equal(await context.exports.interactWithPost({...post,source:undefined},'comment','本地回复'),true);assert.equal(patches.at(-1)[1].comments.at(-1).replyTo,'friend-comment');assert.equal(patches.at(-1)[1].comments.at(-1).actorId,'self');
assert.ok(!app.includes("modal?.kind === 'comments'"),'comments no longer open an unrelated modal');
assert.match(app,/momentCommentTargetRef\.current\?\.id===target\.id/,'a reply from an older editor cannot erase a newer draft');
assert.match(app,/className="zy-character-status zy-moment-status">\{statusFor\(author.id\)\}/,'post status reuses the existing character status source');
assert.ok(!app.includes('zy-moments-identity'),'the old centered name/signature block is absent');
console.log('PASS: cover/feed identity, own interaction state, shared inline area, text emoji editor, duplicate-submit guard, reply preservation, API failure and account-switch isolation.');
