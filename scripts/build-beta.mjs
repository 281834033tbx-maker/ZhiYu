import {spawn} from 'node:child_process';
import {validateClientAssets} from './validate-client-assets.mjs';
import {build} from 'rolldown';
import {builtinModules} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';

const frontend=spawn(process.execPath,['node_modules/vinext/dist/cli.js','build'],{stdio:'inherit',env:{...process.env,ZHIYU_NODE_SERVER:'1'}});
const code=await new Promise((done,reject)=>{frontend.once('error',reject);frontend.once('exit',done);});
if(code!==0)process.exit(typeof code==='number'?code:1);
await validateClientAssets('dist');
await build({input:'server/beta/server.ts',platform:'node',external:[...builtinModules,...builtinModules.map(name=>'node:'+name),'ws','vinext/server/prod-server'],output:{file:'dist/beta/server.mjs',format:'esm',sourcemap:false}});
mkdirSync('dist/beta',{recursive:true});
writeFileSync('dist/beta/release.json',JSON.stringify({format:1,builtAt:new Date().toISOString(),runtime:'node >=22.13',entry:'dist/beta/server.mjs',seededData:false},null,2));
console.log('内测生产构建完成。启动：npm run beta:start；部署说明：docs/内测部署与验收.md');
