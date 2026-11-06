import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

function load(file,dependencies={}) {
  const compiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports={};
  runInNewContext(compiled,{exports,require:specifier=>{
    if(Object.hasOwn(dependencies,specifier))return dependencies[specifier];
    throw Error('Unexpected test dependency: '+specifier);
  },Date,Intl,Object,Number},{filename:file});
  return exports;
}

const {formatConversationTime}=load('lib/npc/conversation-time.ts');
let dateChecks=0;
function check(value,now,label,yesterday=false) {
  const result=formatConversationTime(value,new Date(now));
  assert.equal(result.label,label,`${value} at ${now}`);
  assert.equal(result.yesterday,yesterday);
  dateChecks++;
}
const sunday='2026-11-08T12:00:00+08:00';
check('2026-11-08T00:00:00+08:00',sunday,'00:00');
check('2026-11-08T11:25:00+08:00',sunday,'11:25');
check('2026-11-07T19:01:00+08:00',sunday,'昨天 19:01',true);
check('2026-11-02T08:00:00+08:00',sunday,'星期一');
check('2026-11-03T08:00:00+08:00',sunday,'星期二');
check('2026-11-01T23:59:59+08:00',sunday,'11月1日');
check('2026-10-26T08:00:00+08:00',sunday,'10月26日');
check('2025-10-26T08:00:00+08:00',sunday,'10月26日');
// A new natural week starts in Shanghai, not after a rolling 7*24 hours.
check('2026-11-08T23:59:00+08:00','2026-11-09T00:01:00+08:00','11月8日');
check('2026-11-09T00:00:00+08:00','2026-11-09T00:01:00+08:00','00:00');
check('2026-11-08T15:59:00Z','2026-11-08T16:01:00Z','11月8日');
check('2026-11-08T16:00:00Z','2026-11-08T16:01:00Z','00:00');
check('2026-12-28T08:00:00+08:00','2027-01-03T12:00:00+08:00','星期一');
check('2026-12-27T08:00:00+08:00','2027-01-03T12:00:00+08:00','12月27日');
check('2027-01-01T08:00:00+08:00','2027-01-03T12:00:00+08:00','星期五');
check('2027-01-03T08:00:00+08:00','2027-01-04T12:00:00+08:00','1月3日');
check('2028-02-28T08:00:00+08:00','2028-03-05T12:00:00+08:00','星期一');
check('2028-02-27T08:00:00+08:00','2028-03-05T12:00:00+08:00','2月27日');
check(undefined,sunday,'');
check('not-a-date',sunday,'');
check('2026-11-08T11:25:00+08:00','invalid-now','');

const Check=()=>null,CheckCheck=()=>null;
const {default:MessageReceipt,messagesHaveReadReceipt}=load('app/zhiyu/message-receipt.tsx',{
  'lucide-react':{Check,CheckCheck},
  'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
  './message-receipt.css':{},
});
const single=MessageReceipt({});
assert.equal(single.type,Check);
assert.equal(single.props['aria-label'],'已送达，未读');
assert.doesNotMatch(single.props.className,/\bis-read\b/);
const double=MessageReceipt({read:true});
assert.equal(double.type,CheckCheck);
assert.equal(double.props['aria-label'],'已读');
assert.match(double.props.className,/\bis-read\b/);
assert.equal(MessageReceipt({read:false,unreadLabel:'已保存至本机，未读'}).props['aria-label'],'已保存至本机，未读');
const at='2026-11-07T10:00:00+08:00';
assert.equal(messagesHaveReadReceipt([]),false);
assert.equal(messagesHaveReadReceipt([{}]),false);
assert.equal(messagesHaveReadReceipt([{readAt:at},{}]),false);
assert.equal(messagesHaveReadReceipt([{readAt:'invalid'}]),false);
assert.equal(messagesHaveReadReceipt([{readAt:at},{readAt:at}]),true);
// No display function may write receipts or turn a missing value into a read.
const source=readFileSync('app/zhiyu/xia-xia.tsx','utf8');
assert.match(source,/read = messagesHaveReadReceipt\(group\)/);
assert.match(source,/<MessageReceipt[\s\S]*?read=\{read\}/);
const app=readFileSync('app/zhiyu/app.tsx','utf8');
assert.doesNotMatch(app,/className="read" aria-label="已读"/);
assert.match(app,/read=\{!!m\.read\}/);
console.log(`PASS: ${dateChecks} Shanghai natural-week date boundaries; single delivery / confirmed double-read receipts; missing, partial and invalid receipts stay unread.`);
