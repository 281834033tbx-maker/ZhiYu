import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source = readFileSync('app/zhiyu/group-intent.ts', 'utf8');
const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {detectGroupRequest} = await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const contacts = [{id:'zhou-chef',name:'赵一帆'},{id:'chen-nian',name:'陈年'},{id:'liu',name:'柳智敏'},{id:'yuan-xiaoman',name:'许晓曼'}];
for (const input of [
  '今天吃什么', '我要吃早餐', '我想好好吃饭', '西兰花有什么营养', '请问把赵一帆拉群是什么意思？',
  '我想了解营养计划有什么区别', '请不要给我做营养计划，我只是问问相关概念',
  '不要帮我建群', '我不想建群', '你能不能建群', '什么是营养规划',
  '他说帮我把赵一帆和陈年拉进一个群，我该怎么回',
  '请解释一下营养计划', '麻烦介绍一下饮食规划', '我想打开赵一帆的群聊记录',
  '我想查看我的营养规划', '请帮我查询上周的减脂计划',
  '我要减脂训练计划', '请给我健身课表',
]) assert.equal(detectGroupRequest(input,'molly',contacts),null,input);
for(const sourceId of ['molly','zhou-chef','chen-nian','yuan-xiaoman','xia-xia','liu','he-jiawei']) {
  const result=detectGroupRequest('我现在要做一个营养规划',sourceId,contacts);
  assert.ok(result,sourceId);
  assert.ok(result.memberIds.includes('molly'));
  assert.ok(result.memberIds.includes('zhou-chef'));
  assert.ok(result.memberIds.includes('liu'));
  assert.equal(result.memberIds.includes('chen-nian'),sourceId==='chen-nian','Diet planning adds Chen only when he is the source or explicitly requested');
  if(sourceId!=='molly')assert.ok(result.memberIds.includes(sourceId));
}
assert.deepEqual(detectGroupRequest('帮我把赵一帆和陈年拉进一个群','molly',contacts).memberIds,['molly','zhou-chef','chen-nian']);
assert.deepEqual(detectGroupRequest('我想和小满建个群','molly',contacts).memberIds,['molly','yuan-xiaoman']);
assert.deepEqual(detectGroupRequest('帮我制定减脂饮食计划','molly',contacts).memberIds,['molly','liu','zhou-chef']);
assert.deepEqual(detectGroupRequest('我要健身，也想自己做饭','molly',contacts).memberIds,['molly','liu','zhou-chef','chen-nian']);
assert.deepEqual(detectGroupRequest('帮我和柳智敏建个群','molly',contacts).memberIds,['molly','liu']);
assert.deepEqual(detectGroupRequest('帮我建个群安排减脂训练计划','molly',contacts).memberIds,['molly','chen-nian']);
assert.deepEqual(detectGroupRequest('帮我建群安排减脂训练计划和饮食计划','molly',contacts).memberIds,['molly','liu','zhou-chef','chen-nian']);
assert.deepEqual(detectGroupRequest('我要安排增肌训练计划和饮食计划','molly',contacts).memberIds,['molly','liu','zhou-chef','chen-nian']);
assert.deepEqual(detectGroupRequest('帮我开个群，让陈年一起做营养规划','molly',contacts).memberIds,['molly','chen-nian','liu','zhou-chef']);
assert.ok(detectGroupRequest('帮我开个群，让赵一帆和陈年一起做营养规划','molly',contacts));
const long=detectGroupRequest('帮我建群，一起做营养规划。'+'详细情况'.repeat(300),'molly',contacts);
assert.ok(long?.error,'long group requests must be held instead of entering private generation');
assert.ok(readFileSync('app/zhiyu/xia-xia.tsx','utf8').includes('useChatView(`${account.id}:${character}`)'));
console.log(JSON.stringify({passed:true,checks:'explicit routing; nutrition cooperation across all NPCs; questions/negation/quoted requests stay private; long drafts retained; account-scoped chat cache'}));
