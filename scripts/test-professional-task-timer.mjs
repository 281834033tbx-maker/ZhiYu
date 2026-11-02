import { isolatedNpcRuntime } from './npc-test-runtime.mjs';
// Independent clocks, temporary SQLite and an injected offline provider only.
const runtime = isolatedNpcRuntime();
process.on('exit', () => runtime.cleanup());
await runtime.load('server/npc/professional-task-timer.test');
