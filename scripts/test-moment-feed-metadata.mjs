import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const times={exports:{},Date,Intl};runInNewContext(compile(readFileSync('lib/npc/moment-time.ts','utf8')),times);
const {formatMomentTime,momentTimestamp}=times.exports;
const now=Date.parse('2026-11-07T12:00:00+08:00');
for(const [elapsed,label] of [[0,'刚刚'],[1,'刚刚'],[59999,'刚刚'],[60000,'1分钟前'],[3599999,'59分钟前'],[3600000,'1小时前'],[2*3600000,'2小时前'],[86399999,'23小时前'],[86400000,'11月6日']])assert.equal(formatMomentTime(now-elapsed,now),label,'elapsed '+elapsed);
assert.equal(formatMomentTime('2026-11-06T23:30:00+08:00',Date.parse('2026-11-07T00:30:00+08:00')),'1小时前','crossing midnight does not turn one elapsed hour into a date');
assert.equal(formatMomentTime('2025-12-31T23:00:00+08:00',Date.parse('2026-01-02T00:00:00+08:00')),'12月31日','old dates omit the year and clock across New Year');
assert.equal(formatMomentTime('2026-11-05T16:30:00Z',now),'11月6日','calendar labels use Shanghai rather than UTC');
assert.equal(formatMomentTime(now+3600000,now),'11月7日','future timestamps do not become negative elapsed time or just now');
assert.equal(momentTimestamp(now),'2026-11-07T04:00:00.000Z');
assert.equal(momentTimestamp('2026-11-07T12:00:00+08:00'),'2026-11-07T04:00:00.000Z');
for(const invalid of [undefined,null,'','未知','11月7日','2026-11-07','2026-02-30T00:00:00Z','2026-13-01T00:00:00Z','2026-11-07T12:00:00',NaN,Infinity,8640000000000001]){
  assert.equal(momentTimestamp(invalid),undefined,'reject '+String(invalid));assert.equal(formatMomentTime(invalid,now),'','no fabricated timestamp for '+String(invalid));
}
assert.equal(formatMomentTime(now,new Date('bad')),'');

// Run the real feed adapter against a synthetic public response; no fetch,
// window, account, storage or production service is used by this regression.
const effects=[],posts=[];
const fixtures=[{id:'first',personId:'chen-nian',status:'published',createdAt:now-3600000,text:'训练',images:[],location:'深圳'},
  {id:'second',personId:'liu',status:'published',createdAt:now-86400000,text:'营养',images:[]},
  {id:'bad-time',personId:'liu',status:'published',createdAt:NaN,text:'未给有效时间',images:[]},
  {id:'draft',personId:'liu',status:'draft',createdAt:now,text:'未发布',images:[]}];
const dependencies={react:{useEffect:effect=>effects.push(effect)},'./npc-fetch':{npcFetch:async()=>({ok:true,json:async()=>({items:fixtures})})},'../../lib/npc/moment-time':{momentTimestamp}};
const adapter={exports:{},Date,document:{visibilityState:'visible',addEventListener:()=>{},removeEventListener:()=>{}},window:{addEventListener:()=>{},removeEventListener:()=>{}},setInterval:()=>1,clearInterval:()=>{},require:name=>{assert.ok(name in dependencies);return dependencies[name];}};
runInNewContext(compile(readFileSync('app/zhiyu/use-npc-moments.ts','utf8')),adapter);
adapter.exports.useNpcMoments(true,items=>posts.push(items));const cleanup=effects.shift()();await new Promise(resolve=>setImmediate(resolve));cleanup();
assert.equal(posts[0].length,3);assert.equal(posts[0][0].createdAt,momentTimestamp(fixtures[0].createdAt),'the real server instant survives the adapter');assert.equal(formatMomentTime(posts[0][0].createdAt,now),'1小时前');assert.equal(posts[0][0].location,'深圳');assert.equal(posts[0][1].location,'','missing locations are not fabricated');assert.equal(posts[0][2].createdAt,undefined);assert.equal(posts[0][2].time,'','bad server timestamps never turn into a fabricated fallback date');

// Verify actual JSX containment rather than comparing a second layout recipe.
const app=readFileSync('app/zhiyu/app.tsx','utf8'),parsed=ts.createSourceFile('app.tsx',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const attr=(node,name)=>node.attributes.properties.find(item=>ts.isJsxAttribute(item)&&item.name.getText(parsed)===name)?.initializer;
let article,submit;
function visit(node){
  if(ts.isJsxElement(node)&&node.openingElement.tagName.getText(parsed)==='article'&&attr(node.openingElement,'className')?.getText(parsed).includes('zy-post $'))article=node;
  if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(parsed)==='MomentCommentEditor')submit=attr(node,'onSubmit')?.expression?.getText(parsed);
  ts.forEachChild(node,visit);
}visit(parsed);assert.ok(article);assert.ok(submit);
const direct=article.children.filter(ts.isJsxElement),avatar=direct.find(node=>attr(node.openingElement,'className')?.text==='zy-post-avatar'),content=direct.find(node=>attr(node.openingElement,'className')?.text==='zy-post-content');
assert.ok(avatar);assert.ok(content);assert.match(avatar.getText(parsed),/size=\{42\}/);assert.equal(direct.length,2,'a round avatar and one shared content column are the only article columns');
const contentText=content.getText(parsed),header=content.children.find(node=>ts.isJsxElement(node)&&node.openingElement.tagName.getText(parsed)==='header');
assert.ok(header);assert.ok(!header.getText(parsed).includes('zy-post-published-time'),'time is not in the name header');
assert.ok(contentText.indexOf('zy-post-caption')<contentText.indexOf('<Media'));assert.ok(contentText.indexOf('<Media')<contentText.indexOf('zy-post-metadata'));assert.ok(contentText.indexOf('zy-post-metadata')<contentText.indexOf('<MomentPostInteractions'));
assert.match(contentText,/statusFor\(author.id\)/,'the status capsule keeps the current character source');
assert.match(app,/const publishedTime=post.createdAt\?formatMomentTime\(post.createdAt\):post.time/,'legacy posts retain their old label; new posts use the actual render clock rather than the previous 30-second status tick');
assert.match(app,/aria-label="动态地点"/);assert.match(app,/placeholder="添加地点（可选）"/);assert.match(app,/location:postLocation.trim\(\)/,'existing optional city/place input and published value remain connected');
const css=readFileSync('app/zhiyu/moments-refinement.css','utf8');assert.match(css,/grid-template-columns:42px minmax\(0,1fr\)/);assert.match(css,/\.zy-post-avatar\s*\{[^}]*border-radius:50%/);assert.match(css,/background:color-mix\(in srgb,var\(--zy-incoming\) 55%,var\(--zy-canvas\)\)/,'the lighter interaction box uses both theme tokens instead of hard-coded white');

let finished,closed=0,calls=0;const target={id:'editor-a',accountId:'synthetic',postId:'first'};
const context={exports:{},momentCommentTargetRef:{current:target},account:{id:'synthetic'},post:{id:'first'},comment:'草稿',interactionBusy:'',interactWithPost:()=>{calls++;return new Promise(resolve=>{finished=resolve;});},cancelMomentComment:()=>{closed++;context.momentCommentTargetRef.current=null;context.comment='';}};
runInNewContext(compile('exports.submit='+submit+';'),context);
let pending=context.exports.submit();finished(false);await pending;assert.equal(closed,0);assert.equal(context.comment,'草稿','API failure keeps the open editor and draft');
pending=context.exports.submit();finished(true);await pending;assert.equal(closed,1);assert.equal(context.comment,'','a successful current reply closes its editor');
context.momentCommentTargetRef.current=target;context.comment='旧草稿';pending=context.exports.submit();context.momentCommentTargetRef.current={...target,id:'editor-b'};context.comment='新草稿';finished(true);await pending;assert.equal(closed,1);assert.equal(context.comment,'新草稿','a late receipt cannot close a newer editor');
context.momentCommentTargetRef.current={...target,accountId:'other-account'};await context.exports.submit();assert.equal(calls,3,'an editor for a different account cannot send');
console.log('PASS: elapsed minute/hour/day and Shanghai date boundaries, invalid/future timestamps, real server timestamp/place mapping, aligned round-avatar/content columns, optional place publishing, theme-aware lighter gray and success-only current-editor close.');
