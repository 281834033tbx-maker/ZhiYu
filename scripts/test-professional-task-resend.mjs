import { isolatedNpcRuntime } from './npc-test-runtime.mjs';
// Disposable synthetic tasks and injected proposals only; no production/model calls.
const runtime = isolatedNpcRuntime();
process.on('exit', () => runtime.cleanup());
await runtime.load('server/npc/professional-task-resend.test');
