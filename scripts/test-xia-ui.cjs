const {
  chromium,
} = require('/Users/jayden/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({
    executablePath:
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1100 },
    });
    await context.addInitScript(() => {
      if (!localStorage.getItem('cleanup-fixture')) {
        localStorage.setItem('cleanup-fixture', '1');
        localStorage.setItem(
          'zhiyu-stitch-desktop-v2',
          JSON.stringify({
            version: 2,
            messages: { shen: [], yun: [], group: [] },
            posts: [
              {
                id: 'old-shen',
                personId: 'shen',
                text: '旧动态',
                images: [],
                comments: [],
              },
            ],
            chatIds: ['liu', 'shen', 'yun', 'group'],
            unread: { shen: 3, yun: 2, group: 1 },
          }),
        );
      }
    });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const origin = process.env.ZHIYU_URL || 'http://localhost:3100';
    await page.goto(origin + '/npc/xia-xia/test', { waitUntil: 'networkidle' });
    await page.waitForURL('**/?npc=xia-xia');
    await page.getByRole('textbox', { name: '给夏夏的消息' }).waitFor();
    assert.equal(await page.locator('.xx-debug,.xx-test-link').count(), 0);
    for (const name of ['沈默远', '云曦', '智域设计体系协同群'])
      assert.equal(await page.getByText(name, { exact: true }).count(), 0);
    assert.ok(
      (await page.locator('.zy-conversation').first().innerText()).includes(
        'Molly',
      ),
    );
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('img[src="/npc/xia-xia/avatar.png"]')]
          .length >= 2 &&
        [
          ...document.querySelectorAll('img[src="/npc/xia-xia/avatar.png"]'),
        ].every((img) => img.complete && img.naturalWidth > 0),
    );
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('zhiyu-stitch-desktop-v2')),
    );
    assert.ok(
      !saved.chatIds.some((id) => ['shen', 'yun', 'group'].includes(id)),
    );
    assert.equal(saved.posts.length, 0);
    assert.equal(saved.messages.shen, undefined);
    await page.getByRole('button', { name: '语音通话', exact: true }).waitFor();
    await page.getByRole('button', { name: '视频通话', exact: true }).waitFor();
    for (const f of [
      'cow-thinking.jpg',
      'cow-magic.jpg',
      'cat-help.jpg',
      'cat-not-ok.jpg',
    ]) {
      const res = await context.request.get(origin + '/npc/xia-xia/' + f);
      assert.equal(res.status(), 200);
      assert.match(res.headers()['content-type'], /image/);
    }
    fs.mkdirSync('output', { recursive: true });
    await page.screenshot({ path: 'output/xia-xia-integrated.png' });
    assert.deepEqual(errors, []);
    console.log(
      'PASS UI: integrated main app, test URL redirects, hidden debug, avatar, deleted saved NPCs/group/posts, call buttons, 4 stickers, no runtime errors',
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
