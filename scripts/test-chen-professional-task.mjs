import { isolatedNpcRuntime } from './npc-test-runtime.mjs';
// Disposable SQLite, synthetic accounts, simulated model. No live app/provider.
const runtime=isolatedNpcRuntime();
process.on('exit',()=>runtime.cleanup());
await runtime.load('server/npc/chen-professional-task.test');
