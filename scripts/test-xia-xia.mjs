import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const temp = mkdtempSync(join(tmpdir(), 'xia-tests-'));
try {
  for (const file of ['contracts', 'engine', 'life']) {
    let text = readFileSync(`lib/npc/${file}.ts`, 'utf8').replaceAll(
      "'./contracts'",
      "'./contracts.mjs'",
    );
    text = text.replace(
      "import config from './life-config.json';",
      'const config = ' +
        readFileSync('lib/npc/life-config.json', 'utf8') +
        ';',
    );
    writeFileSync(
      join(temp, file + '.mjs'),
      ts.transpileModule(text, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ES2022,
        },
      }).outputText,
    );
  }
  const prompt = readFileSync('server/npc/prompt.ts', 'utf8')
    .replaceAll("'../../lib/npc/contracts'", "'./contracts.mjs'")
    .replaceAll("'../../lib/npc/life'", "'./life.mjs'");
  writeFileSync(
    join(temp, 'prompt.mjs'),
    ts.transpileModule(prompt, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    }).outputText,
  );
  const { createState, parseOutput, finishTurn, control } = await import(
    pathToFileURL(join(temp, 'engine.mjs'))
  );
  const { buildPrompt } = await import(pathToFileURL(join(temp, 'prompt.mjs')));
  let passed = 0;
  const check = (name, fn) => {
    fn();
    passed++;
    console.log('PASS', name);
  };
  check('独立恋人80配置与正常陌生开局', () => {
    const a = createState('test'),
      b = createState('normal');
    assert.equal(a.relationship, 'lovers');
    assert.equal(a.values.trust, 80);
    assert.equal(a.values.energy, 80);
    assert.equal(a.values.exclusivity, 10);
    assert.equal(b.relationship, 'strangers');
    assert.equal(b.values.trust, 10);
    assert.notEqual(a.branch, b.branch);
    assert.equal(a.memories.length, 0);
  });
  const payload = {
    action: 'reply',
    messages: [
      { type: 'text', text: '第一条' },
      { type: 'emoji', text: '🥺' },
      { type: 'sticker', assetId: 'cow' },
      { type: 'photo', assetId: 'cake' },
    ],
    event: null,
    memories: [],
  };
  check('多消息、emoji、静态表情、生活照片有序保留', () => {
    const s = createState('test');
    finishTurn(s, 'turn1', '测试', parseOutput(payload, '测试'));
    assert.deepEqual(
      s.messages.map((m) => m.part.type),
      ['text', 'text', 'emoji', 'sticker', 'photo'],
    );
  });
  check('拒绝绝对路径、外链及奶牛冒充蛋糕', () => {
    for (const m of [
      { type: 'photo', assetId: 'cow' },
      { type: 'sticker', assetId: 'https://bad.test/a.png' },
      { type: 'photo', assetId: '/Users/a.png' },
    ])
      assert.throws(() => parseOutput({ ...payload, messages: [m] }, '测试'));
  });
  check('同事件幂等，无十倍计分，默认人工审核', () => {
    const s = createState('test');
    const out = parseOutput(
      {
        ...payload,
        event: {
          kind: 'ordinary',
          basis: 'user_claim',
          evidence: '谢谢',
          reason: '表达感谢',
          deltas: { affection: 2 },
        },
      },
      '谢谢',
    );
    finishTurn(s, 't', '谢谢', out);
    finishTurn(s, 't', '谢谢', out);
    assert.equal(s.values.affection, 80);
    assert.equal(s.messages.length, 5);
    assert.equal(s.audits.length, 1);
    assert.equal(s.audits[0].review, 'pending');
    control(s, { action: 'review', id: s.audits[0].id, choice: 'draft-a' });
    assert.equal(s.values.affection, 82);
    assert.throws(() =>
      control(s, { action: 'review', id: s.audits[0].id, choice: 'draft-a' }),
    );
  });
  check('背叛可在信任80时进入危机，假设不扣分', () => {
    for (const basis of ['user_claim', 'hypothesis']) {
      const s = createState('test');
      const out = parseOutput(
        {
          ...payload,
          event: {
            kind: 'betrayal',
            basis,
            evidence: '出轨',
            reason: '当轮自述',
            deltas: { trust: -50 },
            relationship: 'crisis',
          },
        },
        '如果出轨',
      );
      finishTurn(s, 't', '如果出轨', out);
      assert.equal(
        s.relationship,
        basis === 'hypothesis' ? 'lovers' : 'crisis',
      );
      assert.equal(s.values.trust, 80);
    }
  });
  check('草案B上下界与按字段变化', () => {
    const s = createState('test');
    control(s, { action: 'config', scoring: 'draft-b', cooldownHours: 3 });
    finishTurn(
      s,
      't',
      '背叛',
      parseOutput(
        {
          ...payload,
          event: {
            kind: 'betrayal',
            basis: 'user_claim',
            evidence: '背叛',
            reason: '自述背叛',
            deltas: { trust: -90, stress: 90 },
          },
        },
        '背叛',
      ),
    );
    assert.equal(s.values.trust, 10);
    assert.equal(s.values.stress, 95);
    assert.equal(s.values.love, 80);
  });
  check('记忆证据校验、不同用户与分支隔离', () => {
    const a = createState('test'),
      b = createState('test');
    finishTurn(
      a,
      't',
      '我喜欢蓝色',
      parseOutput(
        {
          ...payload,
          memories: [
            { text: '喜欢蓝色', kind: 'user_claim', evidence: '喜欢蓝色' },
            { text: '警察', kind: 'user_claim', evidence: '我是警察' },
          ],
        },
        '我喜欢蓝色',
      ),
    );
    assert.equal(a.memories.length, 1);
    assert.equal(a.memories[0].status, 'model_proposed');
    assert.equal(b.memories.length, 0);
    const reset = control(a, { action: 'reset' });
    assert.equal(reset.memories.length, 0);
    assert.equal(reset.messages.length, 0);
    assert.notEqual(reset.branch, a.branch);
  });
  check('暂停恢复与数值校验', () => {
    const s = createState('test');
    control(s, { action: 'pause' });
    assert.equal(s.paused, true);
    control(s, { action: 'resume' });
    assert.equal(s.paused, false);
    assert.throws(() =>
      control(s, { action: 'values', values: { trust: 101 } }),
    );
    assert.throws(() =>
      control(s, { action: 'values', values: { wealth: 20 } }),
    );
  });
  check('真实冷却截止时间，无回复不造气泡', () => {
    const s = createState('test');
    finishTurn(
      s,
      't',
      '滚',
      parseOutput(
        {
          action: 'end_conversation',
          messages: [{ type: 'text', text: '先不聊了' }],
          event: {
            kind: 'harm',
            basis: 'user_claim',
            evidence: '滚',
            reason: '结束不适交流',
            deltas: {},
            interaction: 'cooldown',
          },
          memories: [],
        },
        '滚',
      ),
      1000,
    );
    assert.equal(s.cooldownUntil, 10801000);
    finishTurn(
      s,
      't2',
      '回来',
      { parts: [], memories: [], action: 'silent' },
      2000,
    );
    assert.equal(
      s.messages.filter((m) => m.turnId === 't2' && m.role === 'assistant')
        .length,
      0,
    );
  });
  check('真实文件内容组合，不导入旧测试开局或其他角色正例', () => {
    const p = buildPrompt(resolve('.'), createState('test'), '你好');
    assert.match(p, /162/);
    assert.match(p, /上帝那边先不用审批/);
    assert.doesNotMatch(p, /"id":"A02"/);
    assert.doesNotMatch(p, /S07-23/);
    assert.doesNotMatch(p, /Users\/jayden/);
    assert.match(p, /"memories"|记忆/);
  });
  check('NPC可引用有效原话，不能引用其他会话',()=>{
    const s=createState('normal');s.messages.push({id:'original',turnId:'one',role:'user',at:new Date().toISOString(),part:{type:'text',text:'周末想去哪'}});
    const out=parseOutput({action:'reply',messages:[{type:'text',text:'海边吧',replyTo:'original'},{type:'text',text:'第二条',replyTo:'other-session'}],event:null,memories:[]},'周末想去哪');
    finishTurn(s,'two','周末想去哪',out,Date.now(),false);
    assert.equal(s.messages.at(-2).replyTo,'original');assert.equal(s.messages.at(-1).replyTo,undefined);
  });
  console.log(`${passed} deterministic checks passed`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
