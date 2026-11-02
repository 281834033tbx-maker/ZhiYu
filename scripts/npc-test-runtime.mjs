import ts from 'typescript';
import {cpSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,realpathSync,rmSync} from 'node:fs';
import {join,dirname,relative,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
const jsonRoots=['lib/npc/','server/npc/','npc-skills/skills/zhiyu-dialogue/','npc-skills/data/'];
function safeJsonPath(project,path) {
  const key=relative(project,path).split(sep).join('/');
  if(!key.endsWith('.json')||!jsonRoots.some(prefix=>key.startsWith(prefix)))throw new Error('隔离测试不读取此JSON路径：'+key);
  return key;
}

export function isolatedNpcRuntime({projectRoot=process.cwd()}={}) {
  const project=realpathSync(resolve(projectRoot));
  const root=mkdtempSync(join(tmpdir(),'npc-contact-life-'));
  try {
    const jsonImports=new Map();
    for(const folder of ['server/npc','lib/npc'])for(const name of readdirSync(join(project,folder)).filter(n=>n.endsWith('.ts'))) {
      const sourcePath=join(project,folder,name),original=readFileSync(sourcePath,'utf8');
      for(const entry of ts.preProcessFile(original,true,false).importedFiles)if(entry.fileName.startsWith('.')&&entry.fileName.endsWith('.json')) {
        const path=resolve(dirname(sourcePath),entry.fileName),key=safeJsonPath(project,path);
        safeJsonPath(project,realpathSync(path));
        jsonImports.set(key,path);
      }
      const file=join(root,folder,name.replace(/\.ts$/,'.mjs'));mkdirSync(dirname(file),{recursive:true});
      const source=original.replace(/(from\s+['"])(\.[^'"]+)(['"])/g,'$1$2.mjs$3');
      writeFileSync(file,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
    }
    cpSync(join(project,'npc-skills'),join(root,'npc-skills'),{recursive:true});
    // Materialise only actual relative JSON imports, at their original directory
    // shape. Invalid required JSON fails here instead of becoming an empty card.
    for(const [key,path] of jsonImports) {
      const source=readFileSync(path,'utf8');
      try {JSON.parse(source);}catch(cause){throw new Error('隔离测试JSON解析失败：'+key,{cause});}
      const file=join(root,key+'.mjs');mkdirSync(dirname(file),{recursive:true});
      writeFileSync(file,'export default JSON.parse('+JSON.stringify(source)+');\n');
    }
    return {root,load:p=>import(pathToFileURL(join(root,p+'.mjs'))),cleanup:()=>rmSync(root,{recursive:true,force:true})};
  } catch(error) {
    rmSync(root,{recursive:true,force:true});
    throw error;
  }
}
