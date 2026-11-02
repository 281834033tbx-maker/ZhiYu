import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Actual selection handler + UI components, isolated source modules and state.
const runtime = isolatedNpcRuntime();
try {
  const {prepareChoiceReply, ChoiceReplyError} = await runtime.load('server/npc/choice-reply');
  const now = Date.UTC(2026, 9, 21, 10);
  const part = {type:'choice', text:'原问题', options:['原选项一', '原选项二']};
  const base = {characterId:'zhou-chef', completed:[], messages:[{
    id:'old-choice', turnId:crypto.randomUUID(), role:'assistant', at:new Date(now - 1000).toISOString(), part,
  }]};
  const body = () => ({action:'send', turnId:crypto.randomUUID(), choice:{messageId:'old-choice', index:1}});
  const companions = ['yuan-xiaoman', 'xia-xia', 'he-jiawei'];
  const enabled = ['chen-nian', 'zhou-chef', 'liu', 'molly-system-secretary'];
  for (const id of companions) {
    const state=structuredClone(base), input=body(), before=structuredClone(state);
    // Route-owned identity wins even if a stale state falsely names a professional.
    assert.throws(() => prepareChoiceReply(state,input,now,id), error => error instanceof ChoiceReplyError && error.status===403);
    assert.deepEqual(state,before); assert.equal(input.text,undefined);
    assert.equal(prepareChoiceReply({...state,characterId:id},{action:'send',text:'我想聊聊今天的事'},now,id),null);
  }
  for (const id of enabled) {
    const state={...structuredClone(base),characterId:id}, input=body();
    const prepared=prepareChoiceReply(state,input,now,id);
    assert.equal(prepared.duplicate,false); assert.equal(input.text,part.options[1]);
    prepared.commit(); assert.equal(state.messages[0].part.selection.index,1);
  }

  const jsxRuntime=import.meta.resolve('react/jsx-runtime');
  const compile = source => ts.transpileModule(source, {compilerOptions:{
    module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,
  }}).outputText.replaceAll('"react/jsx-runtime"',JSON.stringify(jsxRuntime));
  const path=join(runtime.root,'app/zhiyu'); mkdirSync(path,{recursive:true});
  const source=readFileSync('app/zhiyu/choice-chat.tsx','utf8').replace("import './choice-chat.css';",'')
    .replace(/(from\s+['"])(\.[^'"]+)(['"])/g,'$1$2.mjs$3');
  writeFileSync(join(path,'choice-chat.mjs'),compile(source));
  const {default:ChoiceChat}=await runtime.load('app/zhiyu/choice-chat');
  for (const id of [...companions,...enabled]) {
    const history=structuredClone(part), before=structuredClone(history);
    const html=renderToStaticMarkup(createElement(ChoiceChat,{part:history,characterId:id,onChoose:()=>{}}));
    assert.match(html,/原问题/); assert.match(html,/原选项一/); assert.match(html,/原选项二/);
    assert.equal((html.match(/<button/g)||[]).length,companions.includes(id)?0:2);
    assert.deepEqual(history,before,'Rendering does not rewrite history or mark a selection');
  }
  // Render the real shared NpcPart task branch; the task child is a sentinel,
  // avoiding unrelated account/store hooks while proving that it is not mounted.
  const parsed=ts.createSourceFile('xia-xia.tsx',readFileSync('app/zhiyu/xia-xia.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const node=parsed.statements.find(statement=>ts.isFunctionDeclaration(statement)&&statement.name?.text==='NpcPart');
  assert.ok(node);
  const snippet=`import {allowsCharacterChoice} from '../../lib/npc/character-output-policy.mjs';
import ChoiceChat from './choice-chat.mjs';
const TaskMessage=()=> <button data-task="true">任务</button>;
${node.getText(parsed)}`;
  writeFileSync(join(path,'npc-part-surface.mjs'),compile(snippet));
  const {NpcPart}=await runtime.load('app/zhiyu/npc-part-surface');
  for(const id of [...companions,'chen-nian','zhou-chef','liu']) {
    const html=renderToStaticMarkup(createElement(NpcPart,{characterId:id,part:{type:'professional_task',taskId:'old-task'}}));
    assert.equal(html.includes('data-task="true"'),!companions.includes(id));
  }
  console.log('PASS companion legacy choice submissions rejected without mutation; old choice/task history has no controls; professional/Molly selection and professional task surfaces retained. Model/network/database: 0.');
} finally {runtime.cleanup();}
