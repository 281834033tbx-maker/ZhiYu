// Local integration smoke test. PLAYWRIGHT_MODULE and CHROME_PATH can override bundled tools.
// oxlint-disable-next-line typescript/no-require-imports -- Native Electron / .cjs harness requires CommonJS at this boundary.
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ||
    '/Users/jayden/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
// oxlint-disable-next-line typescript/no-require-imports -- Native Electron / .cjs harness requires CommonJS at this boundary.
const assert = require('node:assert/strict');
(async () => {
  const b = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const p = await b.newPage({ viewport: { width: 1440, height: 1024 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  try {
    await p.goto('http://localhost:3000');
    await p.waitForFunction(() =>
      localStorage.getItem('zhiyu-stitch-desktop-v2'),
    );
    await p.getByLabel('输入消息', { exact: true }).fill('测试消息：下午见');
    await p.getByLabel('输入消息', { exact: true }).press('Enter');
    await p
      .locator('.zy-bubble')
      .filter({ hasText: '测试消息：下午见' })
      .waitFor();
    await p.getByLabel('输入消息', { exact: true }).fill('第一行');
    await p.getByLabel('输入消息', { exact: true }).press('Shift+Enter');
    assert.equal(
      await p.getByLabel('输入消息', { exact: true }).inputValue(),
      '第一行\n',
    );
    await p.getByRole('button', { name: '联系人', exact: true }).click();
    await p.locator('.zy-contact-detail').waitFor();
    await p.locator('.zy-contact-row').filter({ hasText: '沈默远' }).click();
    assert.match(await p.locator('.zy-profile-inner h1').innerText(), /沈默远/);
    await p.getByLabel('发起视频通话', { exact: true }).click();
    await p.getByLabel('关闭摄像头预览').click();
    assert.match(await p.locator('.zy-call p').innerText(), /摄像头已关闭/);
    await p.keyboard.press('Escape');
    await p.getByLabel('发送即时消息').click();
    await p.locator('.zy-chat-person').filter({ hasText: '沈默远' }).waitFor();
    assert.equal(
      await p
        .locator('.zy-bubble')
        .filter({ hasText: '测试消息：下午见' })
        .count(),
      0,
    );
    await p.getByLabel('搜索联系人', { exact: true }).fill('不存在的人物');
    await p.getByText('没有找到相关会话').waitFor();
    await p
      .locator('.zy-rail')
      .getByRole('button', { name: '动态', exact: true })
      .click();
    await p.locator('.zy-moments-cover').waitFor();
    const first = p.locator('.zy-post').first();
    await first.scrollIntoViewIfNeeded();
    await first.locator('.zy-post-actions button').first().click();
    assert.equal(
      await first
        .locator('.zy-post-actions button')
        .first()
        .getAttribute('aria-pressed'),
      'true',
    );
    await first.locator('.zy-post-actions button').nth(1).click();
    await p.getByLabel('评论内容').fill('这个排版很舒服');
    await p.locator('.zy-comment-form button').click();
    await p
      .locator('.zy-comment p')
      .filter({ hasText: '这个排版很舒服' })
      .waitFor();
    await p.keyboard.press('Escape');
    const carousel = p.locator('.is-carousel');
    await carousel.scrollIntoViewIfNeeded();
    const original = await carousel.locator('img').getAttribute('src');
    await carousel.getByRole('button', { name: '切换至第 2 张图片' }).click();
    assert.notEqual(
      await carousel.locator('img').getAttribute('src'),
      original,
    );
    assert.equal(
      await carousel
        .getByRole('button', { name: '切换至第 2 张图片' })
        .getAttribute('aria-current'),
      'true',
    );
    await carousel.locator('.zy-image-hit').click();
    await p.locator('.zy-lightbox').waitFor();
    await p.keyboard.press('ArrowRight');
    assert.match(await p.locator('.zy-lightbox h2').innerText(), /3/);
    await p.keyboard.press('Escape');
    await p.getByLabel('发布动态', { exact: true }).click();
    await p.getByLabel('动态文案').fill('我的本地动态测试');
    await p.locator('.zy-publish-dialog footer button').click();
    await p
      .locator('.zy-post-caption')
      .filter({ hasText: '我的本地动态测试' })
      .waitFor();
    await p.reload();
    await p.waitForFunction(() =>
      document
        .querySelector('.zy-post-caption')
        ?.textContent.includes('我的本地动态测试'),
    );
    const stored = await p.evaluate(() =>
      JSON.parse(localStorage.getItem('zhiyu-stitch-desktop-v2')),
    );
    assert(stored.messages.liu.some((m) => m.text === '测试消息：下午见'));
    assert(
      stored.posts.some((x) =>
        x.comments.some((c) => c.text === '这个排版很舒服'),
      ),
    );
    await p.getByLabel('聊天', { exact: true }).click();
    await p.locator('.zy-chat').waitFor();
    await p.screenshot({ path: 'output/stitch-final/implemented-chat.png' });
    await p.getByRole('button', { name: '联系人', exact: true }).click();
    await p.locator('.zy-contact-detail').waitFor();
    await p.screenshot({
      path: 'output/stitch-final/implemented-contacts.png',
    });
    await p
      .locator('.zy-rail')
      .getByRole('button', { name: '动态', exact: true })
      .click();
    await p.locator('.zy-moments-cover').waitFor();
    await p.screenshot({ path: 'output/stitch-final/implemented-moments.png' });
    await p.setViewportSize({ width: 1100, height: 800 });
    assert(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.deepEqual(errors, []);
    assert.equal(
      await p
        .locator('img')
        .evaluateAll(
          (imgs) => imgs.filter((i) => !i.complete || !i.naturalWidth).length,
        ),
      0,
    );
    console.log(
      'PASS: navigation, chat isolation, Enter/Shift+Enter, search, profile, call controls, likes, comments, carousel, lightbox, publishing, persistence, desktop sizing, image loading, runtime errors',
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
