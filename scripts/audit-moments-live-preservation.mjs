import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Read-only production audit. Do not read authentication credentials or emit chat bodies.
const root = resolve(import.meta.dirname, '..');
const evidenceRoot = resolve(root, 'output/moments-live-repair-20261021');
const baselineOnly = process.argv.includes('--baseline');
const original = JSON.parse(readFileSync(resolve(evidenceRoot, 'original-state-aggregate.json'), 'utf8'));
const backup = new DatabaseSync(resolve(evidenceRoot, 'before/state.sqlite'), { readOnly: true });
const current = new DatabaseSync(resolve(root, baselineOnly ? 'output/moments-live-repair-20261021/before/state.sqlite' : '.npc-runtime/state.sqlite'), { readOnly: true });
const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
  return value;
}
const sha = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
const equal = (left, right) => canonical(left) === canonical(right);
const fingerprint = owner => sha(owner).slice(0, 16);
const actors = [
  ['xia-xia', 'sessions', 'xia-xia:normal'],
  ['yuan-xiaoman', 'yuan_sessions', 'yuan-xiaoman'],
  ['liu', 'liu_sessions', 'liu'],
  ['chen-nian', 'chen_sessions', 'chen-nian'],
  ['he-jiawei', 'he_sessions', 'he-jiawei'],
  ['zhou-chef', 'zhou_chef_sessions', 'zhou-chef'],
];
const tableExists = (db, name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const countRows = (db, name) => tableExists(db, name) ? db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get().count : 0;
const getState = (db, table, id) => {
  const row = db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);
  return row ? JSON.parse(row.data) : undefined;
};

try {
  backup.exec('BEGIN');
  current.exec('BEGIN');
  // Intentionally select owner_id only, without account handles or credential columns.
  const owners = backup.prepare('SELECT DISTINCT owner_id FROM zhiyu_accounts ORDER BY owner_id').all().map(row => row.owner_id);
  const currentOwners = current.prepare('SELECT DISTINCT owner_id FROM zhiyu_accounts ORDER BY owner_id').all().map(row => row.owner_id);
  const checks = [];
  const expectedOwners = new Map(original.owners.map(owner => [owner.ownerFingerprint, owner]));
  const backupFileSha256 = createHash('sha256').update(readFileSync(resolve(evidenceRoot, 'before/state.sqlite'))).digest('hex');
  let aggregateMatchesBackup = owners.length === original.registeredOwnersCount && backupFileSha256 === original.backup.sha256;
  for (const owner of owners) {
    const ownerFingerprint = fingerprint(owner);
    const expectedOwner = expectedOwners.get(ownerFingerprint);
    if (!expectedOwner) aggregateMatchesBackup = false;
    for (const [characterId, table, suffix] of actors) {
      const id = `${String(owner)}:${suffix}`;
      const before = getState(backup, table, id);
      const after = getState(current, table, id);
      const expected = expectedOwner?.characters.find(character => character.characterId === characterId);
      if (!expected || !!before !== expected.sessionExists || (before?.messages?.length ?? 0) !== expected.messagesCount) aggregateMatchesBackup = false;
      const beforeMessages = before?.messages ?? [];
      const afterMessages = after?.messages ?? [];
      const byId = new Map(afterMessages.filter(message => typeof message.id === 'string').map(message => [message.id, message]));
      const missingOrChanged = beforeMessages.filter((message, index) => !equal(message, typeof message.id === 'string' ? byId.get(message.id) : afterMessages[index]));
      const changedStateFields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
        .filter(key => !equal(before?.[key], after?.[key]));
      checks.push({
        ownerFingerprint, characterId,
        sessionPresentBefore: !!before, sessionPresentAfter: !!after,
        oldMessagesCount: beforeMessages.length, currentMessagesCount: afterMessages.length,
        oldMessagesPreserved: missingOrChanged.length === 0,
        missingOrChangedOldMessagesCount: missingOrChanged.length,
        messagesExactlyUnchanged: equal(beforeMessages, afterMessages),
        branchUnchanged: equal(before?.branch, after?.branch),
        valuesUnchanged: equal(before?.values, after?.values),
        memoriesUnchanged: equal(before?.memories, after?.memories),
        professionalTasksUnchanged: equal(before?.professionalTasks, after?.professionalTasks),
        changedStateFields,
        beforeProtectedSha256: sha({ messages: beforeMessages, branch: before?.branch, values: before?.values }),
        currentProtectedSha256: sha({ messages: afterMessages, branch: after?.branch, values: after?.values }),
      });
    }
  }
  const published = [];
  for (const table of ['npc_moments', 'npc_scheduled_moments']) {
    const previous = tableExists(backup, table) ? backup.prepare(`SELECT * FROM ${table} WHERE status='published' ORDER BY id`).all() : [];
    const expected = original.publishedRecords.records.filter(record => record.table === table);
    if (previous.length !== expected.length || previous.some(row => !expected.some(record => record.recordIdSha256 === sha(row.id)))) aggregateMatchesBackup = false;
    for (const row of previous) {
      const now = tableExists(current, table) ? current.prepare(`SELECT * FROM ${table} WHERE id=?`).get(row.id) : undefined;
      published.push({
        table, characterId: row.character, recordIdSha256: sha(row.id),
        retained: !!now, unchanged: equal(row, now),
        beforeRecordSha256: sha(row), currentRecordSha256: now ? sha(now) : null,
      });
    }
  }
  const operationalChanges = {};
  for (const table of ['npc_life_events', 'npc_moments', 'npc_moment_publication_receipts', 'npc_moment_likes', 'npc_moment_comments', 'npc_moment_social_jobs', 'npc_moment_runtime_state', 'npc_moment_immediate_requests']) {
    operationalChanges[table] = { beforeRows: countRows(backup, table), currentRows: countRows(current, table) };
  }
  const protectedStatePreserved = checks.every(check => check.sessionPresentAfter && check.oldMessagesPreserved && check.branchUnchanged && check.valuesUnchanged && check.professionalTasksUnchanged);
  const oldPublishedPreserved = published.every(record => record.retained && record.unchanged);
  const report = {
    schemaVersion: 1, checkedAt: new Date().toISOString(), baselineOnly,
    readBoundary: 'Both SQLite connections readOnly; SELECT of account owner_id only. No credential/session-token columns, conversation bodies, raw owner IDs or private state serialized. Only this JSON evidence file written.',
    source: { backup: 'before/state.sqlite', current: baselineOnly ? 'before/state.sqlite' : '.npc-runtime/state.sqlite', aggregateSnapshotAt: original.snapshotAt },
    aggregateMatchesBackup, backupFileSha256, registeredOwnersUnchanged: equal(owners, currentOwners), registeredOwnerCount: owners.length,
    protectedStatePreserved, oldPublishedPreserved,
    allProtectedChecksPassed: aggregateMatchesBackup && equal(owners, currentOwners) && protectedStatePreserved && oldPublishedPreserved,
    stateChecks: checks, oldPublishedCount: published.length, publishedRecords: published,
    operationalChanges,
    interpretation: 'New Moments, life events, queue/check state, media jobs and social interactions are permitted operational changes. Top-level session differences are listed for review and are not automatically treated as data loss. Existing messages, branch, values and professional tasks plus original published rows are protected.',
  };
  const target = resolve(evidenceRoot, baselineOnly ? 'preservation-baseline-selfcheck.json' : 'preservation-after.json');
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  chmodSync(target, 0o600);
  console.log(JSON.stringify({ report: target.replace(`${root}/`, ''), allProtectedChecksPassed: report.allProtectedChecksPassed, aggregateMatchesBackup, oldPublishedCount: published.length, changedSessions: checks.filter(check => check.changedStateFields.length).map(check => ({ characterId: check.characterId, fields: check.changedStateFields })), operationalChanges }));
  if (!report.allProtectedChecksPassed) process.exitCode = 2;
} finally {
  backup.close();
  current.close();
}
