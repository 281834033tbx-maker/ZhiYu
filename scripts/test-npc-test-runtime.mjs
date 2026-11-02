import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

const project=mkdtempSync(join(tmpdir(),'zhiyu-json-runtime-fixture-'));
const write=(path,text)=>{const full=join(project,path);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,text);};
try {
  write('server/npc/reader.ts',"import card from '../../npc-skills/skills/zhiyu-dialogue/npcs/xia-xia/profile.json'; export const person=card;");
  write('lib/npc/example.ts',"import config from './fixture.json'; export const value=config;");
  write('npc-skills/skills/zhiyu-dialogue/npcs/xia-xia/profile.json','{"id":"xia-xia","name":"合成人物"}');
  write('lib/npc/fixture.json','{"count":7,"__proto__":{"safe":true}}');
  write('lib/npc/not-imported.json','{ deliberately malformed and unused');
  const runtime=isolatedNpcRuntime({projectRoot:project});
  try {
    assert.equal((await runtime.load('server/npc/reader')).person.name,'合成人物');
    const config=(await runtime.load('lib/npc/example')).value;
    assert.equal(config.count,7);assert.equal(Object.getPrototypeOf(config),Object.prototype);
    assert.ok(Object.hasOwn(config,'__proto__'),'JSON semantics do not become JavaScript prototype initialisation');
    assert.ok(existsSync(join(runtime.root,'npc-skills/skills/zhiyu-dialogue/npcs/xia-xia/profile.json.mjs')));
    assert.equal(existsSync(join(runtime.root,'lib/npc/not-imported.json.mjs')),false,'unused JSON is not read or converted');
    assert.equal(readFileSync(join(project,'lib/npc/fixture.json'),'utf8'),'{"count":7,"__proto__":{"safe":true}}','source JSON is untouched');
  } finally {runtime.cleanup();}
  write('lib/npc/fixture.json','{ malformed required JSON');
  assert.throws(()=>isolatedNpcRuntime({projectRoot:project}),/JSON解析失败：lib\/npc\/fixture\.json/,'required malformed JSON must fail, never silently drop a card or library');
  write('lib/npc/fixture.json','{}');
  write('private.json','{"synthetic":"not a permitted import root"}');
  write('lib/npc/example.ts',"import secret from '../../private.json'; export const value=secret;");
  assert.throws(()=>isolatedNpcRuntime({projectRoot:project}),/不读取此JSON路径/,'imports outside source/data allowlist are not read');
  write('lib/npc/example.ts',"import config from './linked.json'; export const value=config;");
  symlinkSync(join(project,'private.json'),join(project,'lib/npc/linked.json'));
  assert.throws(()=>isolatedNpcRuntime({projectRoot:project}),/不读取此JSON路径/,'a symlink cannot widen the allowed JSON roots');
  console.log('PASS: source-shaped JSON imports, no unused conversion, JSON semantics, source preservation, malformed required JSON failure and path boundaries.');
} finally {rmSync(project,{recursive:true,force:true});}
