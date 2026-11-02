/* oxlint-disable typescript/no-require-imports -- Electron main-process helpers and Node tests use CommonJS. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// The identity belongs to this project, not a previous developer's account.
// An explicit override supports separately managed migrations without changing
// the project's saved identity. Storage failures stop startup instead of
// silently changing the identity and making existing records look lost.
function resolveLocalIdentity({ projectRoot, override, io = fs, createUUID = randomUUID }) {
  if (typeof override === 'string' && override.trim()) return override;
  if (typeof projectRoot !== 'string' || !projectRoot.trim()) {
    throw new Error('无法确定智域项目目录，未创建桌面身份。');
  }
  const directory = path.join(projectRoot, '.npc-runtime');
  const filename = path.join(directory, 'desktop-identity.json');
  function readIdentity() {
    const value = JSON.parse(io.readFileSync(filename, 'utf8'));
    if (value.schemaVersion !== 1 || !UUID.test(value.id)) {
      throw new Error('智域桌面身份文件无效；请检查备份，不要重置现有数据。');
    }
    return value.id;
  }
  try {
    return readIdentity();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  io.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const id = createUUID();
  if (!UUID.test(id)) throw new Error('无法生成有效的智域桌面身份。');
  const temporary = path.join(directory, `.desktop-identity-${process.pid}-${randomUUID()}.tmp`);
  let temporaryCreated = false;
  try {
    io.writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, id })}\n`, {
      flag: 'wx', mode: 0o600,
    });
    temporaryCreated = true;
    try {
      // Publish the completed file without overwriting a concurrent launcher.
      io.linkSync(temporary, filename);
      return id;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      return readIdentity();
    }
  } finally {
    if (temporaryCreated) io.unlinkSync(temporary);
  }
}

module.exports = { resolveLocalIdentity };
