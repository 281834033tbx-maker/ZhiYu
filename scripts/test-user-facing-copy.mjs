import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {inspectApplication,inspectSource} from './user-facing-copy-check.mjs';

const harmless=`// NPC Codex user_required .json\nconst id='npc-id';console.log('Skill 模型');const ignored='npc-skills/card.json';export default()=> <div id={id} data-source={ignored} className="npc-layout">智友由 AI 驱动</div>;`;
assert.deepEqual(inspectSource(harmless),[],'comments, internal IDs, paths and logs are not rendered copy');
for(const fixture of [
  'export default()=> <p>NPC 演示</p>;',
  'export default()=> <img alt="许晓曼的图片"/>;',
  'const label=true?"智友":"专业型 NPC";export default()=> <span>{label}</span>;',
  'export default()=> <button title="读取 prompt.json">继续</button>;',
  'function notify(x){};notify("Codex 尚未就绪");',
  'function Page({error}){return <p>{error.message}</p>}',
])assert.ok(inspectSource(fixture).length,'render sinks and referenced expressions must be checked');
assert.deepEqual(inspectSource('function reportUserFacingError(x){return "稍后再试"};function Page({error}){return <p>{reportUserFacingError(error)}</p>}'),[]);

const findings=inspectApplication();
const reportIndex=process.argv.indexOf('--report');if(reportIndex>=0&&process.argv[reportIndex+1])writeFileSync(process.argv[reportIndex+1],JSON.stringify(findings,null,2));
if(findings.length){console.error(`用户可见文案检查发现 ${findings.length} 处：`);for(const finding of findings)console.error(`${finding.file}:${finding.line} ${finding.kind}: ${finding.text}`);if(!process.argv.includes('--inventory'))process.exitCode=1;}
else console.log('PASS: AST render-sink copy and error mapping checks; comments, IDs and logs are excluded.');
