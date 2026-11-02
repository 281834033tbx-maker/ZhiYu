import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'output/vidu-shy-sample-20260930');
const plan = JSON.parse(fs.readFileSync(path.join(out, 'sample-plan.json'), 'utf8'));
const env = parseEnv(fs.readFileSync(path.join(root, '.env.local'), 'utf8'));
const key = env.VIDU_API_KEY?.trim();
if (!key || /你的|your|example/i.test(key)) throw new Error('Vidu key is missing or a placeholder');
const api = 'https://api.vidu.cn';
const mode = process.argv[2] || 'prepare';
const taskFile = path.join(out, 'task.json');
const attemptFile = path.join(out, 'submission-attempt.json');
const save = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
const safeMessage = value => String(value ?? '').split(key).join('[REDACTED]').slice(0, 1500);

async function request(endpoint, options = {}) {
  const response = await fetch(api + endpoint, {
    ...options,
    redirect: 'error',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(180000),
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = { message: safeMessage(raw) }; }
  if (!response.ok) {
    const safe = { http_status: response.status, reason: data.reason, code: data.code, message: safeMessage(data.message || data.err_msg || data.error || raw) };
    save('last-api-error.json', safe);
    throw new Error(JSON.stringify(safe));
  }
  return data;
}

try {
  if (mode === 'prepare') {
    console.log(JSON.stringify({ key_configured: true, reference_exists: fs.existsSync(plan.reference_image), text: plan.spoken_text, voice: plan.voice_candidate.voice, endpoint: api + '/ent/s_avatar/offline', model: 'vidu-s1 (documented offline model)' }));
  } else if (mode === 'submit') {
    if (fs.existsSync(taskFile)) throw new Error('An existing task is saved; use status instead of submitting twice');
    if (fs.existsSync(attemptFile)) throw new Error('A prior submission attempt exists; review it before any retry');
    const bytes = fs.readFileSync(plan.reference_image);
    const body = {
      ...plan.prepared_api_fields_without_image,
      model: 'vidu-s1',
      image: 'data:image/png;base64,' + bytes.toString('base64'),
      payload: 'zhiyu-shy-sample-20260930',
    };
    save('submitted-settings.json', { ...body, image: `[local PNG: ${bytes.length} bytes]`, target_duration_seconds: 5, duration_is_target_not_api_parameter: true });
    save('submission-attempt.json', { started_at: new Date().toISOString(), status: 'sending' });
    const result = await request('/ent/s_avatar/offline', { method: 'POST', body: JSON.stringify(body) });
    if (!result.task_id) {
      save('unexpected-create-response.json', result);
      throw new Error('Creation response did not include a task ID; inspect saved response without resubmitting');
    }
    save('task.json', result);
    save('submission-attempt.json', { completed_at: new Date().toISOString(), status: 'accepted', task_id: String(result.task_id) });
    console.log(JSON.stringify({ task_id: String(result.task_id), state: result.state, model: result.model, resolution: result.resolution }));
  } else if (mode === 'status') {
    const task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
    const result = await request('/ent/v2/tasks/' + encodeURIComponent(String(task.task_id)) + '/creations');
    save('latest-status.json', result);
    console.log(JSON.stringify({ task_id: String(task.task_id), state: result.state, progress: result.progress, model: result.model, duration: result.duration, credits: result.credits, err_code: result.err_code, err_msg: safeMessage(result.err_msg), creation_count: result.creations?.length || 0 }));
  } else if (mode === 'download') {
    const result = JSON.parse(fs.readFileSync(path.join(out, 'latest-status.json'), 'utf8'));
    if (result.state !== 'success') throw new Error('Task has not succeeded');
    const url = result.creations?.[0]?.url;
    if (!url || new URL(url).protocol !== 'https:') throw new Error('No HTTPS result video');
    const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`Video download failed: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const target = path.join(out, 'Vidu-original.mp4');
    if (fs.existsSync(target)) throw new Error('Output already exists');
    fs.writeFileSync(target, bytes, { mode: 0o600 });
    console.log(JSON.stringify({ output: target, bytes: bytes.length, model: result.model, billed_duration_seconds: result.duration }));
  } else {
    throw new Error('Use prepare, submit, status or download');
  }
} catch (error) {
  console.error(safeMessage(error.message));
  process.exitCode = 1;
}
