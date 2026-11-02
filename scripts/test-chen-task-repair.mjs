import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

// Disposable SQLite and synthetic owners; injected model, no formal API/provider.
const runtime = isolatedNpcRuntime();
process.on('exit', () => runtime.cleanup());
await runtime.load('server/npc/chen-task-repair.test');
