import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const cache=new Map();
const context=vm.createContext({crypto,console});
function load(file) {
  const path=resolve(file);
  if(cache.has(path))return cache.get(path);
  const source=readFileSync(path,'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const sandboxModule={exports:{}};
  cache.set(path,sandboxModule.exports);
  const localRequire=(specifier)=>{
    if(!specifier.startsWith('.'))throw Error('unexpected '+specifier);
    const next=resolve(dirname(path),specifier);
    return load(next.endsWith('.ts')?next:next+'.ts');
  };
  const runner=vm.runInContext(`(function(module,exports,require){\n${js}\n})`,context,{filename:path});
  runner(sandboxModule,sandboxModule.exports,localRequire);
  return sandboxModule.exports;
}

const {buildSendTaskRecord,arrangementConversationTask}=load('app/zhiyu/task-board/send-task.ts');
const sent=buildSendTaskRecord({id:'manual-task-fixture',title:' 周末收拾客厅 ',note:' 先收茶几 ',date:'2026-11-26',npcId:'molly',categoryId:'chores',order:2});
assert.equal(sent.task.id,'manual-task-fixture');
assert.equal(sent.task.title,'周末收拾客厅');
assert.equal(sent.task.note,'先收茶几');
assert.equal(sent.task.npcId,'molly');
assert.equal(sent.task.status,'todo');
assert.equal(sent.record.name,'发出的任务');
assert.equal(sent.record.tasks.length,1);
assert.throws(()=>buildSendTaskRecord({title:'  ',date:'2026-11-26',npcId:'molly',categoryId:'chores',order:0}),/文字为空/);
assert.throws(()=>buildSendTaskRecord({title:'买菜',date:'2026-11-26',npcId:'not-a-person',categoryId:'shopping',order:0}),/智友/);

const purchase=arrangementConversationTask({
  id:'11111111-2222-4333-8444-555555555555',section:'purchase',title:'周末买菜',
  time:{valid:true,date:'2026-11-28',deadline:null,time:null,display:'周六'},
  sourceText:'帮我买土豆、鸡蛋',sourceId:'src',sourceNpcId:'zhou-chef',createdAt:1,updatedAt:1,status:'active',
  details:{items:['土豆','鸡蛋']},preferenceKey:'grocery',
},'2026-11-26');
assert.equal(purchase.npcId,'zhou-chef');
assert.equal(purchase.categoryId,'shopping');
assert.equal(purchase.amount,'土豆、鸡蛋');
assert.equal(purchase.date,'2026-11-28');
assert.match(purchase.id,/^arrangement-/);

const unknown=arrangementConversationTask({
  id:'abc',section:'todo',title:'记一下',time:{valid:true,date:null,deadline:null,time:null,display:''},
  sourceText:'',sourceId:'src',sourceNpcId:'stranger',createdAt:1,updatedAt:1,status:'completed',details:{},preferenceKey:'all',
},'2026-11-26');
assert.equal(unknown.npcId,'molly');
assert.equal(unknown.date,'2026-11-26');
assert.equal(unknown.status,'done');
console.log('PASS: send-task record and arrangement conversation context');
