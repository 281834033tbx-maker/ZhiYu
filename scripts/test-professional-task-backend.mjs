import { isolatedNpcRuntime } from './npc-test-runtime.mjs';
// Disposable SQLite + simulated model only; never contacts the running app or provider.
const runtime=isolatedNpcRuntime();
process.on('exit',()=>runtime.cleanup());
await runtime.load('server/npc/professional-task.test');
