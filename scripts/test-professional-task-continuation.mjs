import { isolatedNpcRuntime } from './npc-test-runtime.mjs';
// Disposable state + injected proposals only; no production API or real model calls.
const runtime = isolatedNpcRuntime();
process.on('exit', () => runtime.cleanup());
await runtime.load('server/npc/professional-task-continuation.test');
