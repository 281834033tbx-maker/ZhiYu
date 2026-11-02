import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

// The test module creates disposable SQLite/Skill fixtures and injects every
// model response; no production state, socket, service or model is used.
const runtime = isolatedNpcRuntime();
process.on('exit', () => runtime.cleanup());
await runtime.load('server/npc/zhou-chef.test');
await runtime.load('server/npc/zhou-chef-auth.test');
