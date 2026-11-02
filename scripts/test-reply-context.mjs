import assert from 'node:assert/strict';
import ts from 'typescript';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'npc-reply-context-'));
try {
  for (const [name, source] of [['delivery', 'lib/npc/delivery.ts'], ['reply-context', 'server/npc/reply-context.ts']]) {
    const code = readFileSync(source, 'utf8').replace('../../lib/npc/delivery', './delivery.mjs');
    writeFileSync(join(dir, `${name}.mjs`), ts.transpileModule(code, {compilerOptions: {module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022}}).outputText);
  }
  const { replyContext } = await import(pathToFileURL(join(dir, 'reply-context.mjs')));
  const message = (id, role, text, at) => ({id, role, at: new Date(at).toISOString(), part: {type:'text',text}});
  const history = [message('old-user','user','旧问题',1),message('old-reply','assistant','已经回答',2),
    message('u1','user','你今天吃饭了吗？',3),message('u2','user','你今天做什么了？',4),message('u3','user','你今天晚上下班之后要去干嘛？',5),
    {...message('future','assistant','未送达',Date.now()+60000),deliverAt:Date.now()+60000}];
  const prompt = replyContext(history);
  const batch = JSON.parse(prompt.split('本轮尚未回答的连续用户消息：')[1].split('\n')[0]);
  assert.deepEqual(batch.map(m=>m.id),['u1','u2','u3']);
  assert.match(prompt,/必须引用那条消息的真实id/);
  assert.match(replyContext(history,'strings'),/顶层replyTo数组与messages逐条对应/);
  assert.match(replyContext([]),/连续用户消息：\[\]/);
  for (const file of ['prompt.ts','yuan-prompt.ts','molly-prompt.ts']) assert.match(readFileSync(`server/npc/${file}`,'utf8'),/\$\{replyContext\(/);
  console.log('PASS: all three NPC planners share topic quoting; pending targets exclude answered and undelivered messages; Molly protocol preserved.');
} finally {rmSync(dir,{recursive:true,force:true});}
