import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

// Execute the actual selection hook and send handler without mounting the App,
// reading accounts, touching persistence, or making a network request.
const source=readFileSync('app/zhiyu/xia-xia.tsx','utf8');
const parsed=ts.createSourceFile('xia-xia.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function functionText(name){let found;function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node.getText(parsed);ts.forEachChild(node,visit);}visit(parsed);assert.ok(found,name);return found;}
function compile(code,context){runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);}
let nextId=0,cursor=0,changed=false,effects=[];const values=[];
const hookContext={exports:{},crypto:{randomUUID:()=> 'generation-'+(++nextId)},
  useState:initial=>{const index=cursor++;if(!(index in values))values[index]=typeof initial==='function'?initial():initial;return [values[index],next=>{values[index]=typeof next==='function'?next(values[index]):next;changed=true;}];},
  useRef:initial=>{const index=cursor++;return values[index]??(values[index]={current:initial});},useLayoutEffect:effect=>effects.push(effect),
};
compile(functionText('useExclusiveChatReference')+'\nexports.hook=useExclusiveChatReference;',hookContext);
const message=id=>({id,role:'assistant',part:{type:'text',text:'消息 '+id}});
const task={source:'task-page-demo',id:'task-a',title:'训练',date:'2026-11-07',summary:'合成参数'};
const draft='输入到一半的草稿';
let props={messages:[],excerpt:item=>item.part.text};
props.onDismissTaskPageContext=()=>{props={...props,taskPageContext:undefined,taskPageContextKey:undefined};};
props.onReportQuoteConsumed=id=>{if(!id||props.reportQuote?.referenceId===id)props={...props,reportQuote:undefined};};
function render(patch={}){props={...props,...patch};for(let count=0;count<6;count++){changed=false;cursor=0;effects=[];const result=hookContext.exports.hook(props);if(!changed){effects.forEach(effect=>effect());return result;}}throw Error('Selection did not settle');}
let selection=render();selection.quoteMessage(message('old'));selection=render();assert.equal(selection.validQuoted.id,'old');
selection=render({taskPageContext:task,taskPageContextKey:'task-generation-1'});assert.equal(selection.validQuoted,null);assert.equal(selection.activeTaskPageContext.id,'task-a');
selection=render({taskPageContext:undefined,taskPageContextKey:undefined});assert.equal(selection.validQuoted,null,'cancelling a new task must not resurrect an older message quote');
selection.quoteMessage(message('old'));selection=render();
selection=render({reportQuote:{characterId:'chen-nian',messageId:'new-report',referenceId:'report-generation-1',text:'已确认的报告原文'}});
assert.equal(selection.validQuoted.id,'new-report','the server-confirmed report id wins before polling catches up');assert.equal(selection.validQuoted.preview,'已确认的报告原文');assert.equal(selection.activeTaskPageContext,undefined);
selection=render({messages:[message('new-report')]});assert.equal(selection.validQuoted.preview,'消息 new-report','polling enriches the preview without changing the selected id');
selection.dismissQuote();selection=render();assert.equal(selection.validQuoted,null,'dismissing the report does not reveal the old quote');
selection=render({reportQuote:{characterId:'chen-nian',messageId:'new-report',referenceId:'report-generation-2'},taskPageContext:task,taskPageContextKey:'task-generation-2'});
selection.quoteMessage(message('chosen'));selection=render();assert.equal(selection.validQuoted.id,'chosen');assert.equal(selection.activeTaskPageContext,undefined);assert.equal(props.reportQuote,undefined);assert.equal(props.taskPageContext,undefined,'an explicit message selection clears both external reference types');
const previousKey=selection.referenceKey;selection.quoteMessage(message('chosen'));selection=render();assert.notEqual(selection.referenceKey,previousKey,'explicitly replacing even the same quote has a fresh selection generation');
assert.equal(draft,'输入到一半的草稿','selection never rewrites the independent text draft');

const posted=[],deferred=[];let dismissed=0,failed=[];
const ctx={exports:{},crypto:{randomUUID:()=> 'turn-'+(++nextId)},sending:false,choiceLocks:{current:new Set()},taskScope:'synthetic:chen-nian',onBeforeSend:undefined,
  setError:()=>{},setSending:value=>{ctx.sending=value;},setOutgoing:()=>{},setDraft:()=>{},typingTimer:{current:null},signalTyping:()=>{},lastTyping:{current:0},retry:{current:null},
  referenceKey:'message-a',referenceKeyRef:{current:'message-a'},validQuoted:{id:'a'},activeTaskPageContext:undefined,
  post:body=>{posted.push(body);return new Promise((resolve,reject)=>deferred.push({resolve,reject}));},dismissQuote:()=>dismissed++,setFailedSends:update=>{failed=update(failed);},refreshSession:async()=>null,reportUserFacingError:()=>{},clearTimeout:()=>{},
};
compile(functionText('send')+'\nexports.send=send;',ctx);
let pending=ctx.exports.send({text:'同一句话'});assert.equal(posted.at(-1).replyTo,'a');assert.ok(!('taskPageContext' in posted.at(-1)));
ctx.referenceKey=ctx.referenceKeyRef.current='message-b';ctx.validQuoted={id:'b'};deferred.shift().resolve();await pending;assert.equal(dismissed,0,'a delayed send success cannot erase a newer selection');
pending=ctx.exports.send({text:'同一句话'});const failedTurn=posted.at(-1).turnId;deferred.shift().reject(Error('synthetic failure'));await pending;assert.equal(failed.at(-1).body.replyTo,'b');assert.equal(dismissed,0);
pending=ctx.exports.send({text:'同一句话'});assert.equal(posted.at(-1).turnId,failedTurn,'same text and unchanged reference reuse the failed send turn id');deferred.shift().reject(Error('synthetic failure'));await pending;
ctx.referenceKey=ctx.referenceKeyRef.current='task-generation-1';ctx.validQuoted=null;ctx.activeTaskPageContext=task;
pending=ctx.exports.send({text:'同一句话'});const taskTurn=posted.at(-1).turnId;assert.notEqual(taskTurn,failedTurn);assert.equal(posted.at(-1).taskPageContext.id,'task-a');assert.ok(!('replyTo' in posted.at(-1)));deferred.shift().reject(Error('synthetic failure'));await pending;
ctx.referenceKey=ctx.referenceKeyRef.current='task-generation-2';pending=ctx.exports.send({text:'同一句话'});assert.notEqual(posted.at(-1).turnId,taskTurn,'a newly selected task generation is not collapsed into an older failed request');deferred.shift().resolve();await pending;
ctx.referenceKey=ctx.referenceKeyRef.current='report-generation-1';ctx.validQuoted={id:'server-confirmed-report'};ctx.activeTaskPageContext=task;
pending=ctx.exports.send({text:'报告问题'});assert.equal(posted.at(-1).replyTo,'server-confirmed-report');assert.ok(!('taskPageContext' in posted.at(-1)),'the transport emits at most one reference even for inconsistent input props');deferred.shift().resolve();await pending;
assert.ok(posted.every(body=>!body.replyTo||!body.taskPageContext));

// Verify App-owned navigation callbacks perform the opposite clear atomically.
const app=readFileSync('app/zhiyu/app.tsx','utf8'),appTree=ts.createSourceFile('app.tsx',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const attributes=new Map();function visit(node){if(ts.isJsxAttribute(node)&&['onReportQuoteConsumed','onOpenNpc','onOpenConversation'].includes(node.name.getText(appTree))&&node.initializer&&ts.isJsxExpression(node.initializer)&&node.initializer.expression)attributes.set(node.name.getText(appTree),node.initializer.expression.getText(appTree));ts.forEachChild(node,visit);}visit(appTree);
let report={referenceId:'current-report'},conversation=null;
const appContext={exports:{},people:[{id:'chen-nian'}],molly:{id:'molly'},crypto:{randomUUID:()=> 'app-reference-'+(++nextId)},displayPerson:item=>item,openChat:()=>{},setTaskConversation:next=>{conversation=next;},setReportQuote:next=>{report=typeof next==='function'?next(report):next;}};
for(const name of attributes.keys())compile(`exports.${name}=${attributes.get(name)};`,appContext);
appContext.exports.onReportQuoteConsumed('older-report');assert.equal(report.referenceId,'current-report','a stale consume callback must not clear the new report');
appContext.exports.onOpenConversation('chen-nian',task);assert.equal(report,null);assert.equal(conversation.npcId,'chen-nian');assert.ok(conversation.referenceId);
appContext.exports.onOpenNpc('chen-nian','confirmed-report','报告预览');assert.equal(conversation,null);assert.equal(report.messageId,'confirmed-report');assert.ok(report.referenceId);
console.log('PASS: message/task/report replacement, unloaded report receipts, no quote resurrection, preserved draft, late-success protection, one-reference payload and stable failed-send retry identities.');
