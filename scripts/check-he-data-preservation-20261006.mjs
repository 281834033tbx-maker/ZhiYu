import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';

// Read-only comparison; never emits account IDs, message bodies or credentials.
const before = JSON.parse(readFileSync('output/he-data-before-reload-20261006.json', 'utf8'));
const oldDb = new DatabaseSync(before.backup, { readOnly: true });
const current = new DatabaseSync('.npc-runtime/state.sqlite', { readOnly: true });
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const report = { at: new Date().toISOString(), backup: before.backup, readOnly: true, tables: {}, he: [], passed: false };
try {
  report.integrity = current.prepare('PRAGMA quick_check').get();
  assert.equal(report.integrity.quick_check, 'ok');
  const tables = oldDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  for (const { name } of tables) {
    const columns = oldDb.prepare(`PRAGMA table_info(${quote(name)})`).all();
    const primary = columns.filter(column => column.pk > 0).sort((a, b) => a.pk - b.pk).map(column => column.name);
    const oldRows = oldDb.prepare(`SELECT * FROM ${quote(name)}`).all();
    const newRows = current.prepare(`SELECT * FROM ${quote(name)}`).all();
    const result = { beforeCount: oldRows.length, afterCount: newRows.length, oldPrimaryKeysRetained: true, oldMessageIdsRetained: true };
    if (primary.length) {
      const key = row => JSON.stringify(primary.map(column => row[column]));
      const newMap = new Map(newRows.map(row => [key(row), row]));
      for (const oldRow of oldRows) {
        const newRow = newMap.get(key(oldRow));
        if (!newRow) { result.oldPrimaryKeysRetained = false; continue; }
        if (typeof oldRow.data === 'string' && typeof newRow.data === 'string') {
          try {
            const oldState = JSON.parse(oldRow.data), newState = JSON.parse(newRow.data);
            if (Array.isArray(oldState.messages) && Array.isArray(newState.messages)) {
              const ids = new Set(newState.messages.map(message => message.id));
              if (oldState.messages.some(message => !ids.has(message.id))) result.oldMessageIdsRetained = false;
            }
          } catch { /* Non-session JSON is outside message checks. */ }
        }
      }
    } else result.oldPrimaryKeysRetained = null;
    report.tables[name] = result;
    assert.notEqual(result.oldPrimaryKeysRetained, false, `${name}: original keys missing`);
    assert.equal(result.oldMessageIdsRetained, true, `${name}: original messages missing`);
  }
  report.he = current.prepare('SELECT data FROM he_sessions').all().map(row => {
    const state = JSON.parse(row.data);
    return { messages: state.messages.length, imported: state.messages.filter(message => message.turnId.startsWith('legacy:')).length, assistants: state.messages.filter(message => message.role === 'assistant').length, queued: state.queue.length, pending: !!state.pending, hasError: !!state.error, values: state.values, relationship: state.relationship };
  });
  report.passed = true;
} finally {
  oldDb.close(); current.close();
  writeFileSync('output/he-data-final-preservation-20261006.json', JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ passed: report.passed, integrity: report.integrity, originalTables: Object.keys(report.tables).length, he: report.he }));
