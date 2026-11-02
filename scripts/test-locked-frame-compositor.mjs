import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const temporary = mkdtempSync(join(tmpdir(), 'zhiyu-frame-compositor-'));
try {
  const path = join(temporary, 'compositor.mjs');
  writeFileSync(path, ts.transpileModule(readFileSync('lib/npc/realtime/locked-frame-compositor.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  const { compositeMouthFrame } = await import(pathToFileURL(path));
  const frame = { assetRevision: 'xiaoman-v1', clipId: 'smile', frameIndex: 15, playbackEpoch: 2 };
  const rect = { x: 21, y: 8, width: 11, height: 7 };
  const base = { width: 64, height: 40, rgba: Uint8ClampedArray.from({ length: 64 * 40 * 4 }, (_, i) => (i * 73 + 19) % 256) };
  const before = base.rgba.slice();
  // A patch that changes every pixel if the local approved mask is ignored.
  const rgba = new Uint8ClampedArray(rect.width * rect.height * 4).fill(255);
  const approved = { frame, rect, alpha: Uint8Array.from({ length: rect.width * rect.height }, (_, i) => i % 3 === 0 ? 0 : i % 3 === 1 ? 128 : 255) };
  const patch = { frame, rect, rgba, turnId: 'turn-2' };
  const apply = (overrides = {}, turn = 'turn-2', mask = approved) =>
    compositeMouthFrame(base, frame, turn, mask, { ...patch, ...overrides });
  const result = apply();
  assert.equal(result.applied, true);
  let protectedPixels = 0, changedPixels = 0;
  for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width; x++) {
    const offset = (y * base.width + x) * 4;
    const inRect = x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
    const protectedPixel = !inRect || approved.alpha[(y - rect.y) * rect.width + x - rect.x] === 0;
    if (protectedPixel) {
      assert.deepEqual(result.rgba.slice(offset, offset + 4), before.slice(offset, offset + 4));
      protectedPixels++;
    } else if (result.rgba.slice(offset, offset + 3).some((v, i) => v !== before[offset + i])) changedPixels++;
    assert.equal(result.rgba[offset + 3], before[offset + 3]);
  }
  assert.ok(changedPixels > 0);
  assert.deepEqual(base.rgba, before, 'Base video frame must remain immutable');
  for (const [key, value] of Object.entries({ assetRevision: 'other', clipId: 'idle', frameIndex: 16, playbackEpoch: 3 })) {
    const stale = apply({ frame: { ...frame, [key]: value } });
    assert.equal(stale.reason, 'stale-frame');
    assert.deepEqual(stale.rgba, before);
  }
  assert.equal(apply({}, 'turn-3').reason, 'inactive');
  assert.equal(apply({}, null).reason, 'inactive');
  assert.equal(apply({}, 'turn-2', { ...approved, frame: { ...frame, clipId: 'idle' } }).reason, 'stale-frame');
  for (const invalid of [
    { rect: { x: 0, y: 0, width: 64, height: 40 } },
    { rect: { ...rect, x: -1 } },
    { rect: { ...rect, x: 21.5 } },
    { rgba: rgba.slice(4) },
  ]) {
    const rejected = apply(invalid);
    assert.equal(rejected.reason, 'invalid-region');
    assert.deepEqual(rejected.rgba, before);
  }
  assert.deepEqual(apply({}, 'turn-2', { ...approved, alpha: new Uint8Array(77) }).rgba, before);
  assert.deepEqual(apply({ rgba: new Uint8ClampedArray(rgba.length) }).rgba, before);
  assert.throws(() => compositeMouthFrame({ ...base, width: 0 }, frame, null, approved, null));
  console.log(JSON.stringify({ status: 'PASS', protectedPixels, changedPixels,
    verified: ['outside-mask byte equality', 'base immutability', 'alpha preservation', 'asset/clip/frame/epoch matching', 'cancelled turn rejection', 'region expansion rejection'],
    notVerified: ['model quality', 'live playback', 'latency', 'display or codec byte equality'] }, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
