import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// OFFLINE ONLY: the real generator is exercised with a fake child process.
// No executable, model, image provider, account database, or network is used.
const runtime = isolatedNpcRuntime();
const envKeys = ['NPC_IMAGE_CODEX_BIN', 'NPC_CODEX_BIN', 'NPC_CODEX_MODEL'];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
const originalTimeout = globalThis.setTimeout;
const originalCodexHome = process.env.CODEX_HOME;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFqkAAAAASUVORK5CYII=', 'base64');
const owner = randomUUID();
const privateFixture = 'fixture-private-prompt-do-not-log';
const fakeSecret = 'sk-fixture-token-do-not-log';
const nativeCandidates = [
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
  '/Applications/ChatGPT.app/Contents/Resources/codex',
];

try {
  const fsPath = join(runtime.root, 'server/npc/fixture-provider-fs.mjs');
  writeFileSync(fsPath, `export * from 'node:fs';
import {existsSync as realExistsSync} from 'node:fs';
const nativeCandidates = ${JSON.stringify(nativeCandidates)};
let nativeAvailability = [true, true];
export function setNativeAvailability(values) { nativeAvailability = values; }
export function existsSync(path) {
  const index = nativeCandidates.indexOf(String(path));
  return index >= 0 ? !!nativeAvailability[index] : realExistsSync(path);
}
`);
  const childPath = join(runtime.root, 'server/npc/fixture-provider-child.mjs');
  writeFileSync(childPath, `import {EventEmitter} from 'node:events';
import {writeFileSync, utimesSync} from 'node:fs';
import {dirname, join} from 'node:path';
export const state = {mode: 'success', outsidePath: null};
export const calls = [];
export function spawn(command, args, options) {
  const call = {command, args: [...args], env: {...options.env}, prompt: '', killed: false};
  calls.push(call);
  const child = new EventEmitter();
  child.stdin = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  let closed = false;
  const close = (code, signal = null) => { if (!closed) { closed = true; child.emit('close', code, signal); } };
  child.kill = () => { call.killed = true; queueMicrotask(() => close(null, 'SIGKILL')); return true; };
  child.stdin.end = prompt => {
    call.prompt = prompt;
    queueMicrotask(() => {
      if (closed || state.mode === 'hang') return;
      const out = args[args.indexOf('--output-last-message') + 1];
      if (state.mode === 'spawn_error') { const error = new Error('offline spawn error'); error.code = 'ENOENT'; child.emit('error', error); return; }
      if (state.mode === 'exit_error') { child.stderr.emit('data', Buffer.from('image generation tool unavailable ${fakeSecret}')); close(1); return; }
      if (state.mode === 'quota') { child.stderr.emit('data', Buffer.from('quota usage limit ${fakeSecret}')); close(1); return; }
      if (state.mode === 'error_json') { writeFileSync(out, JSON.stringify({error: 'image generation tool unavailable ${fakeSecret}'})); close(0); return; }
      const providerErrors = {auth: 'authentication required', network: 'network connection refused', generic: 'unexpected provider failure'};
      if (providerErrors[state.mode]) { writeFileSync(out, JSON.stringify({error: providerErrors[state.mode] + ' ${fakeSecret}'})); close(0); return; }
      if (state.mode === 'invalid_json') { writeFileSync(out, '{broken'); close(0); return; }
      if (state.mode === 'no_result') { close(0); return; }
      const image = state.mode === 'outside' ? state.outsidePath : join(dirname(out), 'fixture-image.png');
      writeFileSync(image, state.mode === 'invalid_bytes' ? Buffer.from('not an image') : Buffer.from('${png.toString('base64')}', 'base64'));
      if (state.mode === 'stale') utimesSync(image, new Date('2000-01-01'), new Date('2000-01-01'));
      writeFileSync(out, JSON.stringify({path: image}));
      // Success must be validated from bytes/path even when no image-tool event is supplied.
      child.stdout.emit('data', Buffer.from(JSON.stringify({type: 'turn.completed', usage: {input_tokens: 1}}) + '\\n'));
      close(0);
    });
  };
  return child;
}
`);
  const source = readFileSync(join(runtime.root, 'server/npc/image-generator.mjs'), 'utf8')
    .replace(/from (['"])node:fs\1/g, "from './fixture-provider-fs.mjs'")
    .replace(/from (['"])node:child_process\1/g, "from './fixture-provider-child.mjs'");
  assert.ok(source.includes("from './fixture-provider-fs.mjs'"));
  assert.ok(source.includes("from './fixture-provider-child.mjs'"));
  const generatorPath = join(runtime.root, 'server/npc/image-generator-provider-fixture.mjs');
  writeFileSync(generatorPath, source);
  const {imageCodexBinary, generateScene, ImageGenerationError} = await import(pathToFileURL(generatorPath));
  const {codexBinary} = await runtime.load('server/npc/codex');
  const providerFs = await import(pathToFileURL(fsPath));
  const provider = await import(pathToFileURL(childPath));
  assert.equal(typeof imageCodexBinary, 'function');
  assert.equal(typeof ImageGenerationError, 'function');

  process.env.NPC_CODEX_BIN = '/offline-fixture/shared-old-codex';
  process.env.NPC_CODEX_MODEL = 'offline-fixture-preserved-model';
  process.env.NPC_IMAGE_CODEX_BIN = '/offline-fixture/explicit-image-codex';
  assert.equal(imageCodexBinary(), process.env.NPC_IMAGE_CODEX_BIN);
  assert.equal(codexBinary(), process.env.NPC_CODEX_BIN, 'image override does not change the text binary');
  delete process.env.NPC_IMAGE_CODEX_BIN;
  assert.equal(imageCodexBinary(), nativeCandidates[0]);
  providerFs.setNativeAvailability([false, true]);
  assert.equal(imageCodexBinary(), nativeCandidates[1]);
  providerFs.setNativeAvailability([false, false]);
  assert.equal(imageCodexBinary(), process.env.NPC_CODEX_BIN);
  assert.equal(codexBinary(), process.env.NPC_CODEX_BIN);
  providerFs.setNativeAvailability([true, true]);
  console.log('PASS OFFLINE image binary precedence; shared text binary remains unchanged');

  const photo = () => ({type: 'generated_photo', jobId: randomUUID(), prompt: 'A bowl on a table. ' + privateFixture,
    caption: '', withCharacter: false, status: 'pending', attempts: 0});
  const diagnostic = jobId => JSON.parse(readFileSync(join(runtime.root, '.npc-runtime/image-diagnostics', owner, jobId + '.json'), 'utf8'));
  const expectSafeDiagnostic = jobId => {
    const record = diagnostic(jobId);
    const serialized = JSON.stringify(record);
    assert.ok(!serialized.includes(privateFixture), 'diagnostic never stores a scene prompt');
    assert.ok(!serialized.includes(fakeSecret), 'diagnostic never stores raw stderr or provider error text');
    assert.equal(Object.hasOwn(record, 'stderr'), false);
    assert.equal(record.character, 'yuan-xiaoman');
    assert.equal(typeof record.code, 'string');
    assert.equal(typeof record.elapsedMs, 'number');
    assert.equal(typeof record.at, 'string');
    return record;
  };
  const preAborted = photo(), preAbortController = new AbortController();
  preAbortController.abort();
  await assert.rejects(generateScene(runtime.root, owner, 'yuan-xiaoman', preAborted, preAbortController.signal),
    error => error instanceof ImageGenerationError && error.code === 'IMAGE_GENERATION_ABORTED');
  assert.equal(provider.calls.length, 0, 'a pre-aborted job never starts a provider process');
  assert.equal(existsSync(join(runtime.root, '.npc-runtime/uploads', owner, preAborted.jobId + '.json')), false);
  const fresh = photo();
  const url = await generateScene(runtime.root, owner, 'yuan-xiaoman', fresh);
  assert.match(url, /^\/api\/npc\/media\/[a-f0-9-]{36}\.png$/);
  assert.deepEqual(readFileSync(join(runtime.root, '.npc-runtime/uploads', owner, url.split('/').at(-1))), png);
  assert.equal(provider.calls.length, 1);
  const call = provider.calls[0];
  assert.equal(call.command, nativeCandidates[0]);
  assert.equal(call.args[call.args.indexOf('--model') + 1], process.env.NPC_CODEX_MODEL);
  assert.equal(call.env.CODEX_HOME, originalCodexHome, 'image provider preserves the existing account directory');
  assert.equal(call.env.NPC_CODEX_MODEL, process.env.NPC_CODEX_MODEL);
  assert.ok(call.args.includes('features.image_generation=true'));
  assert.equal(await generateScene(runtime.root, owner, 'yuan-xiaoman', fresh), url);
  assert.equal(provider.calls.length, 1, 'same completed job replays without a second provider call');
  assert.equal(expectSafeDiagnostic(fresh.jobId).status, 'ready');
  assert.equal(expectSafeDiagnostic(fresh.jobId).exitCode, 0);
  assert.equal(expectSafeDiagnostic(fresh.jobId).binarySource, 'native');
  console.log('PASS OFFLINE actual image bytes, provider argv/env, immutable upload and cache replay');

  const failures = [
    ['error_json', 'IMAGE_TOOL_UNAVAILABLE'],
    ['exit_error', 'IMAGE_TOOL_UNAVAILABLE'],
    ['quota', 'IMAGE_QUOTA_UNAVAILABLE'],
    ['auth', 'IMAGE_AUTHENTICATION_REQUIRED'],
    ['network', 'IMAGE_NETWORK_FAILURE'],
    ['generic', 'IMAGE_GENERATION_FAILED'],
    ['spawn_error', 'IMAGE_SERVICE_START_FAILED'],
    ['invalid_json', 'IMAGE_RESULT_INVALID'],
    ['no_result', 'IMAGE_RESULT_INVALID'],
    ['invalid_bytes', 'IMAGE_OUTPUT_INVALID'],
    ['outside', 'IMAGE_OUTPUT_INVALID'],
    ['stale', 'IMAGE_OUTPUT_INVALID'],
  ];
  provider.state.outsidePath = join(runtime.root, 'outside-generated-root.png');
  for (const [mode, code] of failures) {
    provider.state.mode = mode;
    const request = photo();
    await assert.rejects(generateScene(runtime.root, owner, 'yuan-xiaoman', request), error => {
      assert.ok(error instanceof ImageGenerationError, mode + ': typed provider error');
      assert.equal(error.code, code, mode + ': actionable safe failure code');
      assert.ok(!String(error.message).includes(fakeSecret), mode + ': no raw provider text in user message');
      return true;
    });
    const record = expectSafeDiagnostic(request.jobId);
    assert.equal(record.code, code, mode + ': diagnostic matches thrown error');
    assert.equal(record.status, 'failed');
    assert.equal(existsSync(join(runtime.root, '.npc-runtime/uploads', owner, request.jobId + '.json')), false);
  }
  console.log('PASS OFFLINE exit-zero error, quota/start failures, invalid JSON and untrusted/stale/non-image output rejected');

  provider.state.mode = 'hang';
  const expired = photo();
  globalThis.setTimeout = (callback, ms, ...args) => originalTimeout(callback, ms === 300000 ? 20 : ms, ...args);
  try {
    await assert.rejects(generateScene(runtime.root, owner, 'yuan-xiaoman', expired), error => error.code === 'IMAGE_GENERATION_TIMEOUT');
  } finally { globalThis.setTimeout = originalTimeout; }
  assert.equal(expectSafeDiagnostic(expired.jobId).code, 'IMAGE_GENERATION_TIMEOUT');
  assert.equal(provider.calls.at(-1).killed, true);
  const aborted = photo(), controller = new AbortController();
  const pending = generateScene(runtime.root, owner, 'yuan-xiaoman', aborted, controller.signal);
  queueMicrotask(() => controller.abort());
  await assert.rejects(pending, error => error.code === 'IMAGE_GENERATION_ABORTED');
  assert.equal(expectSafeDiagnostic(aborted.jobId).code, 'IMAGE_GENERATION_ABORTED');
  assert.equal(provider.calls.at(-1).killed, true);
  console.log('PASS OFFLINE timeout/abort distinguish failures and stop the child process');
  console.log('PASS all image-provider connection regressions (offline fixtures only; no live image acceptance claimed)');
} finally {
  globalThis.setTimeout = originalTimeout;
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  runtime.cleanup();
}
