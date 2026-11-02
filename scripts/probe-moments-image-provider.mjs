import {mkdirSync, readFileSync, writeFileSync, copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// A real image, through the application generator, isolated from all accounts,
// timelines and publication. Never output process environments or credentials.
const root=process.cwd(), output=join(root,'output/moments-image-connection-20261021');
const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
mkdirSync(output,{recursive:true});
const runtime=isolatedNpcRuntime(), started=Date.now(), cli={};
const originalSpawn=childProcess.spawn;
childProcess.spawn=function(binary,args,options){
  cli.binary=binary;
  const child=originalSpawn.call(this,binary,args.includes('--json')?args:[...args.slice(0,-1),'--json',args.at(-1)],{...options,stdio:['pipe','pipe','pipe']});
  let events='', stderr='';
  child.stdout?.on('data',data=>{events=(events+data.toString()).slice(-100000);});
  child.stderr?.on('data',data=>{stderr=(stderr+data.toString()).slice(-12000);});
  child.on('close',code=>{
    cli.exitCode=code;
    const file=args[args.indexOf('--output-last-message')+1];
    try {
      const value=JSON.parse(readFileSync(file,'utf8').trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
      cli.returnedImagePath=typeof value.path==='string';
      cli.returnedError=typeof value.error==='string'?value.error.slice(0,500):null;
    } catch { cli.finalResponseNotJson=true; }
    cli.imageToolEvent=/image_generation|imagegen|image_gen/.test(events);
    const safe=value=>String(value).replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/\b(?:sk-|sess-)[a-zA-Z0-9_-]+/g,'[redacted]').replace(/\/Users\/[^\s"']+/g,'[local-path]');
    cli.errors=stderr.split('\n').filter(line=>/error|failed|unavailable|unauthorized/i.test(line)).map(safe).slice(-6);
    cli.errorEvents=events.split('\n').flatMap(line=>{try{const e=JSON.parse(line);return /error|failed/.test(e.type)?[safe(e.message||e.error||e.type)]:[];}catch{return[];}}).slice(-6);
  });
  return child;
};
syncBuiltinESMExports();
let result;
try {
  const {generateScene}=await runtime.load('server/npc/image-generator');
  const imageUrl=await generateScene(runtime.root,randomUUID(),'yuan-xiaoman',{
    type:'generated_photo',jobId:randomUUID(),withCharacter:false,caption:'',status:'pending',attempts:0,
    prompt:'用于朋友圈图片接入验收的虚构场景：言情小说作者徐小曼写作休息时的桌角，一只普通白瓷茶杯、合上的米色无字笔记本、一支黑笔，柔和窗光。近距离普通手机随拍，构图略偏，无人、无脸、没有可读文字、品牌、屏幕或水印。只制作这一张图片。'
  });
  const file=join(runtime.root,'.npc-runtime/uploads');
  const {readdirSync}=await import('node:fs');
  const owner=readdirSync(file)[0];
  const image=join(file,owner,imageUrl.split('/').at(-1));
  const saved=join(output,'native-provider-probe-'+runId+'.'+image.split('.').at(-1));
  copyFileSync(image,saved);
  result={status:'ready',image:saved,bytes:readFileSync(saved).length};
} catch(error) { result={status:'failed',error:String(error.message||error).slice(0,500)}; }
finally {childProcess.spawn=originalSpawn;syncBuiltinESMExports();runtime.cleanup();}
const report={checkedAt:new Date().toISOString(),elapsedMs:Date.now()-started,
  configuration:{binary:cli.binary||'not started',model:process.env.NPC_CODEX_MODEL||'application default',accountDirectory:'inherited'},
  scope:'isolated real image; no publication or account database access',...result,cli};
writeFileSync(join(output,'native-provider-probe-'+runId+'.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
