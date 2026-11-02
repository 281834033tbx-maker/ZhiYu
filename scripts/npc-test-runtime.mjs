import ts from 'typescript';
import {cpSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
export function isolatedNpcRuntime() {
  const root=mkdtempSync(join(tmpdir(),'npc-contact-life-'));
  for(const folder of ['server/npc','lib/npc']) for(const name of readdirSync(folder).filter(n=>n.endsWith('.ts'))) {
    const file=join(root,folder,name.replace('.ts','.mjs'));mkdirSync(dirname(file),{recursive:true});
    const source=readFileSync(join(folder,name),'utf8').replace(/(from\s+['"])(\.[^'"]+)(['"])/g,'$1$2.mjs$3');
    writeFileSync(file,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
  }
  for(const name of readdirSync('lib/npc').filter(n=>n.endsWith('.json')))writeFileSync(join(root,'lib/npc',name+'.mjs'),'export default '+readFileSync(join('lib/npc',name),'utf8'));
  cpSync('npc-skills',join(root,'npc-skills'),{recursive:true});
  return {root,load:p=>import(pathToFileURL(join(root,p+'.mjs'))),cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
