import { isolatedNpcRuntime } from './npc-test-runtime.mjs';
// Disposable middleware, SQLite and injected model proposals only.
const runtime = isolatedNpcRuntime();
process.on('exit', () => runtime.cleanup());
await runtime.load('server/npc/task-resend-api.test');
