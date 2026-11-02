import {readFileSync} from 'node:fs';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Offline fail-fast validation only. No App/API/model or production state access.
const input = process.argv[2] || 'npc-skills/knowledge/professional/chen-acsm-foundation-20261017.json';
const raw = readFileSync(input, 'utf8');
const runtime = isolatedNpcRuntime();
try {
  const api = await runtime.load('server/npc/chen-acsm-foundation');
  const library = api.parseChenAcsmFoundation(raw);
  console.log(JSON.stringify({valid: true, version: library.version, entryCount: library.entries.length,
    sourceCount: library.sources.length, primaryTrialSources: library.sources.filter(source => source.sourceType === 'primary_trial').length,
    claimEvidenceLinks: library.entries.reduce((sum, entry) => sum + entry.claimEvidence.length, 0),
    maxResolvedEntryBytes: Math.max(...library.entries.map(entry => Buffer.byteLength(JSON.stringify([entry])))),
    selectionByteLimit: api.chenAcsmFoundationContextByteLimit}, null, 2));
} finally { runtime.cleanup(); }
