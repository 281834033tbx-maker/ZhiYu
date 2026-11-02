import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Plugin } from 'vite';

const SETTINGS_PATH = '/api/npc/realtime-speech/settings';
const CONFIG_FILENAME = 'realtime-speech-config.json';
const MAX_BODY_BYTES = 16 * 1024;
const VOICE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const API_KEY_PATTERN = /^[\x21-\x7e]{1,4096}$/;
export const DEFAULT_REALTIME_VOICE = 'zh_female_vv_jupiter_bigtts';

export type RealtimeSpeechConfig = {
  apiKey: string;
  voice: string;
  updatedAt: string;
};

export type RealtimeSpeechSettings = {
  apiKeyConfigured: boolean;
  configured: boolean;
  voice: string;
  updatedAt?: string;
};

class SettingsRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// This server-only reader is for the realtime gateway. Its result must
// never be included in an HTTP response, client bundle, or diagnostic log.
export function readRealtimeSpeechConfig(root: string): RealtimeSpeechConfig | null {
  const path = join(root, '.npc-runtime', CONFIG_FILENAME);
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > MAX_BODY_BYTES) throw new Error('Invalid realtime speech configuration');
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid realtime speech configuration');
    const config = value as Record<string, unknown>;
    if (typeof config.apiKey !== 'string' || !API_KEY_PATTERN.test(config.apiKey)
      || typeof config.voice !== 'string' || !VOICE_PATTERN.test(config.voice)
      || typeof config.updatedAt !== 'string' || config.updatedAt.length > 64 || !Number.isFinite(Date.parse(config.updatedAt))) {
      throw new Error('Invalid realtime speech configuration');
    }
    return { apiKey: config.apiKey, voice: config.voice, updatedAt: config.updatedAt };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    // Even callers that accidentally display errors cannot reveal file contents.
    throw new Error('Realtime speech configuration unavailable');
  }
}

function publicSettings(config: RealtimeSpeechConfig | null): RealtimeSpeechSettings {
  return {
    apiKeyConfigured: !!config?.apiKey,
    configured: !!config?.apiKey,
    voice: config?.voice ?? DEFAULT_REALTIME_VOICE,
    ...(config ? { updatedAt: config.updatedAt } : {}),
  };
}

function saveConfig(root: string, config: RealtimeSpeechConfig) {
  const directory = join(root, '.npc-runtime');
  mkdirSync(directory, { recursive: true });
  const temporary = join(directory, `.${CONFIG_FILENAME}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    fchmodSync(fd, 0o600);
    writeFileSync(fd, JSON.stringify(config) + '\n', 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    // Atomic replacement preserves the temporary file's owner-only permissions.
    renameSync(temporary, join(directory, CONFIG_FILENAME));
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch { /* Renamed successfully or not created. */ }
  }
}

function send(res: ServerResponse, status: number, data: unknown) {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(data));
}

function localOrigin(req: IncomingMessage): string | null {
  const host = req.headers.host ?? '';
  if (!/^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(host)) return null;
  try { return new URL(`http://${host}`).origin; } catch { return null; }
}

function loggedIn(req: IncomingMessage, db: DatabaseSync): boolean {
  const token = req.headers.cookie?.split(';').map(part => part.trim())
    .find(part => part.startsWith('zhiyu_auth='))?.slice('zhiyu_auth='.length);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
  const digest = createHash('sha256').update(token).digest('hex');
  const session = db.prepare(`SELECT s.expires_at FROM zhiyu_auth_sessions s
    JOIN zhiyu_accounts a ON a.id = s.account_id WHERE s.token_digest = ?`)
    .get(digest) as { expires_at: number } | undefined;
  return !!session && session.expires_at > Date.now();
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new SettingsRequestError(415, '请使用 JSON 格式保存配置');
  }
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) throw new SettingsRequestError(413, '配置内容过长');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new SettingsRequestError(413, '配置内容过长');
    chunks.push(bytes);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new SettingsRequestError(400, '配置内容无效'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['apiKey', 'voice'].includes(key))) {
    throw new SettingsRequestError(400, '配置内容无效');
  }
  return value as Record<string, unknown>;
}

export function npcRealtimeSpeechSettings(): Plugin {
  return {
    name: 'zhiyu-realtime-speech-settings',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      // authLocal() runs first and creates these tables. This read-only handle
      // also verifies real sessions independently of the legacy owner cookie.
      const db = new DatabaseSync(join(root, '.npc-runtime/state.sqlite'), { readOnly: true });
      server.httpServer?.once('close', () => db.close());
      server.middlewares.use((req, res, next) => {
        if ((req.url || '').split('?')[0] !== SETTINGS_PATH) return next();
        void (async () => {
          const origin = localOrigin(req);
          if (!origin) return send(res, 403, { error: '仅允许本机访问' });
          if (!loggedIn(req, db)) return send(res, 401, { error: '请先登录智域' });
          if (req.method === 'GET') return send(res, 200, publicSettings(readRealtimeSpeechConfig(root)));
          if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            return send(res, 405, { error: '不支持的方法' });
          }
          if (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') {
            return send(res, 403, { error: '请求来源无效，请从智域设置页保存' });
          }
          const body = await readBody(req);
          if (body.apiKey !== undefined && (typeof body.apiKey !== 'string'
            || body.apiKey.length > 4096 || /[\r\n]/.test(body.apiKey))) {
            throw new SettingsRequestError(400, '请填写有效的 API Key');
          }
          const suppliedKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
          if (suppliedKey && !API_KEY_PATTERN.test(suppliedKey)) {
            throw new SettingsRequestError(400, '请填写有效的 API Key');
          }
          if (body.voice !== undefined && (typeof body.voice !== 'string' || body.voice.length > 256
            || /[\r\n]/.test(body.voice) || !VOICE_PATTERN.test(body.voice.trim()))) {
            throw new SettingsRequestError(400, '请填写有效的音色名称');
          }
          const previous = suppliedKey && body.voice !== undefined ? null : readRealtimeSpeechConfig(root);
          const apiKey = suppliedKey || previous?.apiKey;
          if (!apiKey) throw new SettingsRequestError(400, '首次配置需要填写 API Key');
          const config: RealtimeSpeechConfig = {
            apiKey,
            voice: typeof body.voice === 'string' ? body.voice.trim() : previous?.voice ?? DEFAULT_REALTIME_VOICE,
            updatedAt: new Date().toISOString(),
          };
          saveConfig(root, config);
          // This response confirms a local save only, never service validation.
          return send(res, 200, publicSettings(config));
        })().catch(error => {
          if (error instanceof SettingsRequestError) return send(res, error.status, { error: error.message });
          return send(res, 500, { error: '实时语音配置未能读取或保存，请稍后重试' });
        });
      });
    },
  };
}
