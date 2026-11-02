import { isolatedNpcRuntime } from './npc-test-runtime.mjs';
// Parser-only fixtures: no application API, database or provider calls.
const runtime = isolatedNpcRuntime();
process.on('exit', () => runtime.cleanup());
await runtime.load('lib/npc/professional-task-parser.test');
