import {isolatedNpcRuntime} from './npc-test-runtime.mjs';
// Disposable synthetic state and proposals only; no formal account, API or model.
const runtime=isolatedNpcRuntime();
process.on('exit',()=>runtime.cleanup());
await runtime.load('server/npc/professional-task-clarification.test');
