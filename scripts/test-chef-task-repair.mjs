import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

// Disposable database + injected model only. No formal account, socket or provider.
const runtime = isolatedNpcRuntime();
process.on('exit', () => runtime.cleanup());
await runtime.load('server/npc/zhou-chef-task-repair.test');
