import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {dirname, extname, join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// This is deliberately opt-in: one real image generation, one real pixel review,
// and one real public-post semantic review can incur provider usage. It never
// opens the application's account database or publishes to an existing account.
if (process.env.LIVE_MOMENT_IMAGE_TEST !== '1') {
  console.error('REFUSED: set LIVE_MOMENT_IMAGE_TEST=1 explicitly to run the isolated real-image acceptance test.');
  process.exit(2);
}

const project = process.cwd();
const output = join(project, 'output/moments-image-connection-20261021');
const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
const reportPath = join(output, 'image-chain-' + runId + '.json');
mkdirSync(output, {recursive:true});
const runtime = isolatedNpcRuntime();
const owner = randomUUID();
const otherOwner = randomUUID();
const character = 'yuan-xiaoman';
const started = Date.now();
const now = started;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let db, queue, server;
let failure;
const report = {
  schemaVersion:1, checkedAt:new Date(started).toISOString(),
  status:'running', scope:'isolated fictional test account; no production account/database/timeline access',
  boundary:{
    sharingDecision:'deterministic synthetic test candidate; not a model decision or character-behavior acceptance',
    generation:'production createMomentMediaAdapter() with its default real generator; no generation or process stub',
    pixelReview:'production adapter default generateRaw with real image attachments; no review stub',
    semanticReview:'production generateRaw with actual completed image attachment; no review stub',
    persistence:'production MomentsQueue in a temporary SQLite database, including publication receipt and restart projection',
    transport:'production npcMoments/npcMedia middleware on an isolated local HTTP server',
    ui:'not tested by this script; saved actual image and projected post are available for a separate UI check',
  },
  calls:{fixtureSharingDecisions:0, realSemanticReviews:0},
  checks:{}, artifacts:[],
};

try {
  // isolatedNpcRuntime copies current code and Skills, but intentionally no
  // public assets or production runtime. Copy only registered avatar references.
  const {publicGroupDirectory} = await runtime.load('lib/npc/character-directory');
  for (const person of publicGroupDirectory()) {
    assert.match(person.avatar, /^\/[a-zA-Z0-9_/-]+\.(png|jpg|jpeg|webp|gif)$/);
    const target = join(runtime.root, 'public', person.avatar.slice(1));
    mkdirSync(dirname(target), {recursive:true});
    copyFileSync(join(project, 'public', person.avatar.slice(1)), target);
  }
  // Imported approved posts are separately tested historical fixtures. Exclude
  // them here so the isolated receipt/list can only contain this one test post.
  writeFileSync(join(runtime.root, 'npc-skills/data/moments-approved-20260919.json'),
    JSON.stringify({version:1, timezone:'Asia/Shanghai', items:[]}));

  const {MomentsQueue, momentCharacters, npcMoments} = await runtime.load('server/npc/moments-plugin');
  const {createMomentMediaAdapter, momentMediaPath} = await runtime.load('server/npc/moment-media');
  const {generateRaw} = await runtime.load('server/npc/codex');
  const {npcMedia, imageExtension} = await runtime.load('server/npc/media');
  const actor = momentCharacters.find(person => person.id === character);
  assert.ok(actor);
  mkdirSync(join(runtime.root, '.npc-runtime'), {recursive:true});
  const databasePath = join(runtime.root, '.npc-runtime/state.sqlite');
  db = new DatabaseSync(databasePath);
  db.exec(`CREATE TABLE ${actor.table}(id TEXT PRIMARY KEY,data TEXT NOT NULL)`);
  db.prepare(`INSERT INTO ${actor.table} VALUES(?,?)`).run(owner + ':' + actor.suffix,
    JSON.stringify({branch:'isolated-image-chain-' + runId, messages:[], queue:[], pending:null}));

  const run = async (root, prompt, attachments) => {
    if (prompt.startsWith('你为虚构NPC生成并判断此刻适合分享的独立生活候选')) {
      report.calls.fixtureSharingDecisions++;
      assert.equal(report.calls.fixtureSharingDecisions, 1, 'the test never retries sharing decisions');
      const sourceId = /本轮可信来源ID：([^。]+)。/.exec(prompt)?.[1];
      assert.ok(sourceId, 'the candidate must use the actual host-created source ID');
      return {
        schema_version:'1.2', decision:'post', publicSafe:true, npc_id:character,
        post:{format:'text_image', text:'写到这里，先让脑袋歇一会儿。', media:[],
          image_task:{asset_kind:'generated_photo', count:1, with_character:false, face_visibility:'不出现',
            event:'徐小曼在普通写作间隙短暂休息，桌角留着茶杯、合上的无字笔记本与黑笔。',
            image_briefs:['言情小说作者徐小曼写作休息时的桌角：一只普通白瓷茶杯、合上的米色无字笔记本、一支黑笔，柔和窗光。近距离普通手机随拍，构图略偏，无人、无脸、没有可读文字、品牌、屏幕、水印或社交界面。只制作这一张独立图片。']}},
        internal_context:{npc_type:'companion', topic_kind:'daily_life', topic:'写作间隙的桌角',
          event_summary:'徐小曼在普通写作间隙短暂休息，桌角留着茶杯、合上的无字笔记本与黑笔。',
          share_reason:'记录自己写作间隙一个安静的小片刻', format_reason:'一张桌角随拍与一句短话共同表达短暂休息',
          image_count_reason:'一个桌角场景，一张图片已完整，不凑组图', evidence_refs:[sourceId]},
        nextHours:6,
      };
    }
    assert.ok(prompt.startsWith('复核一条虚构NPC朋友圈候选'), 'unexpected model request refused to bound provider usage');
    assert.equal(attachments?.length, 1, 'semantic review must receive the actual completed image');
    report.calls.realSemanticReviews++;
    assert.equal(report.calls.realSemanticReviews, 1, 'the test never retries semantic reviews');
    return generateRaw(root, prompt, attachments);
  };

  // Do not replace either default argument here: both image generation and
  // image-pixel acceptance must use the actual application/provider settings.
  const realMedia = createMomentMediaAdapter();
  const recordMediaFailure = async (...args) => {
    try { return await realMedia(...args); }
    catch (error) {
      report.mediaError = {code:typeof error?.code === 'string' ? error.code : null,
        message:String(error?.message || error).slice(0, 1000)};
      throw error;
    }
  };
  queue = new MomentsQueue(db, runtime.root, run, () => now, recordMediaFailure);
  const request = queue.requestImmediateCheck(owner, [character], {intent:'share_now', requestId:randomUUID()});
  assert.deepEqual(request.queued, [character]);
  await queue.tick(owner, [character]);
  report.runtimeStatus = queue.status(owner).actors.find(value => value.character === character);
  const posts = queue.list(owner).filter(post => post.personId === character);
  assert.equal(posts.length, 1, 'one real image post must be published in the isolated database');
  assert.equal(posts[0].images.length, 1);
  assert.equal(report.calls.fixtureSharingDecisions, 1);
  assert.equal(report.calls.realSemanticReviews, 1);
  const post = posts[0];
  const row = db.prepare('SELECT status,data FROM npc_moments WHERE id=?').get(post.id);
  const payload = JSON.parse(row.data);
  assert.equal(row.status, 'published');
  assert.equal(payload.mediaReceipt.accepted, true);
  assert.equal(payload.mediaReceipt.generated, true);
  assert.deepEqual(payload.mediaReceipt.images, post.images);
  assert.equal(payload.mediaReceipt.descriptions.length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM npc_moment_publication_receipts WHERE id=?').get(post.id).total, 1);
  const imagePath = momentMediaPath(runtime.root, owner, post.images[0]);
  assert.ok(imagePath);
  const bytes = readFileSync(imagePath);
  assert.ok(imageExtension(bytes));
  assert.ok(bytes.length > 1024, 'a real scene image must not be a tiny placeholder');
  const assetManifest = JSON.parse(readFileSync(imagePath.replace(/\.[^.]+$/, '.json'), 'utf8'));
  assert.equal(assetManifest.generated, true);
  assert.equal(assetManifest.url, post.images[0]);
  assert.ok(Date.parse(assetManifest.at) >= started - 5000, 'fresh job manifest prevents old-cache acceptance');
  report.checks.realMediaReceipt = true;
  report.checks.publicationReceipt = true;
  report.checks.ownerProjection = queue.list(otherOwner).length === 0;
  assert.ok(report.checks.ownerProjection);
  report.post = {id:post.id, character, text:post.text, imageCount:post.images.length, imageDescriptions:post.imageDescriptions};
  report.image = {url:post.images[0], bytes:bytes.length, sha256:hash(bytes)};
  const projectionArtifact = join(output, 'image-chain-' + runId + '-post.json');
  writeFileSync(projectionArtifact, JSON.stringify({items:posts, errors:[]}, null, 2) + '\n');
  report.artifacts.push({kind:'projected-post', path:projectionArtifact});

  queue.stop();
  db.close(); db = undefined;
  const restarted = new DatabaseSync(databasePath, {readOnly:true});
  try {
    assert.equal(restarted.prepare('SELECT status FROM npc_moments WHERE id=?').get(post.id).status, 'published');
    assert.equal(restarted.prepare('SELECT COUNT(*) AS total FROM npc_moment_publication_receipts WHERE id=?').get(post.id).total, 1);
  } finally { restarted.close(); }
  report.checks.sqliteCloseReopen = true;

  // Real plugin middleware and real HTTP bytes. A new MomentsQueue inside the
  // plugin reopens the same isolated DB; automatic generation/social jobs stay off.
  const handlers = [];
  server = createServer((req, res) => {
    const entry = handlers.find(([prefix]) => (req.url || '').startsWith(prefix));
    if (!entry) { res.statusCode = 404; res.end(); return; }
    req.url = req.url.slice(entry[0].length) || '/';
    entry[1](req, res);
  });
  const host = {config:{root:runtime.root}, middlewares:{use:(...args) => handlers.push(args)}, httpServer:server};
  npcMoments({automatic:false, available:() => false, now:() => now, generate:async () => { throw Error('HTTP acceptance forbids additional model calls'); }}).configureServer(host);
  npcMedia().configureServer(host);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const response = await fetch(origin + '/api/npc/moments', {headers:{Cookie:'zhiyu_npc=' + owner}});
  assert.equal(response.status, 200);
  const projected = await response.json();
  assert.deepEqual(projected.items.find(item => item.id === post.id).images, post.images);
  report.checks.httpPostProjectionAfterRestart = true;
  const mediaResponse = await fetch(origin + post.images[0], {headers:{Cookie:'zhiyu_npc=' + owner}});
  assert.equal(mediaResponse.status, 200);
  const served = Buffer.from(await mediaResponse.arrayBuffer());
  assert.deepEqual(served, bytes);
  assert.match(mediaResponse.headers.get('content-type'), /^image\//);
  assert.equal(mediaResponse.headers.get('cache-control'), 'private, no-store');
  assert.equal((await fetch(origin + post.images[0], {headers:{Cookie:'zhiyu_npc=' + otherOwner}})).status, 404);
  assert.equal((await fetch(origin + post.images[0])).status, 401);
  report.checks.httpImageBytesIdentical = true;
  report.checks.httpImageOwnerIsolation = true;
  report.status = 'passed';
} catch (error) {
  failure = error;
  report.status = 'failed';
  report.error = String(error?.message || error).slice(0, 1000);
  try { report.runtimeStatus = queue?.status(owner).actors.find(value => value.character === character); } catch {}
} finally {
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  queue?.stop();
  try { db?.close(); } catch {}
  // Preserve actual generated bytes and their manifests even if later reviews
  // rejected the image. Failed artifacts are evidence, never accepted posts.
  const folder = join(runtime.root, '.npc-runtime/uploads', owner);
  if (existsSync(folder)) for (const name of readdirSync(folder).filter(name => /\.(png|jpg|webp|gif|json)$/.test(name))) {
    const target = join(output, 'image-chain-' + runId + '-' + name);
    copyFileSync(join(folder, name), target);
    report.artifacts.push({kind:extname(name) === '.json' ? 'generator-manifest' : 'actual-generated-image',
      acceptance:report.status === 'passed' ? 'accepted' : 'unaccepted-test-artifact', path:target});
  }
  const diagnostics = join(runtime.root, '.npc-runtime/image-diagnostics', owner);
  if (existsSync(diagnostics)) for (const name of readdirSync(diagnostics).filter(name => /^[a-f0-9-]{36}\.json$/.test(name))) {
    const target = join(output, 'image-chain-' + runId + '-diagnostic-' + name);
    copyFileSync(join(diagnostics, name), target);
    report.artifacts.push({kind:'provider-diagnostic', path:target});
  }
  report.elapsedMs = Date.now() - started;
  report.productionDataTouched = false;
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  runtime.cleanup();
}
console.log(JSON.stringify({status:report.status, report:reportPath, elapsedMs:report.elapsedMs, artifacts:report.artifacts}));
if (failure) process.exitCode = 1;
