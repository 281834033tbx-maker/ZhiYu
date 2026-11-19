import {readFile,writeFile,mkdir,readdir,stat,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const digest=text=>createHash('sha256').update(text).digest('hex');
const manifestNames=['server/__vite_rsc_assets_manifest.js','server/ssr/__vite_rsc_assets_manifest.js'];
const allowedMergedPreload=/^\/_next\/static\/chunks\/user-facing-ui-[A-Za-z0-9_-]+\.js$/;
const mergedStylesheet=/^_next\/static\/css\/user-facing-ui\.[^/]+\.css$/;
const componentMarkers=['zy-ai-disclosure','zy-retry-bubble-row'];
const fail=message=>{throw Error('[client-assets] '+message);};
async function existsFile(file){try{return (await stat(file)).isFile();}catch{return false;}}
function localAsset(client,url){if(typeof url!=='string'||!url.startsWith('/')||url.includes('?')||url.includes('#'))fail('Expected a local build asset URL: '+url);const relative=url.slice(1),file=path.resolve(client,relative);if(!file.startsWith(client+path.sep))fail('Asset escapes build directory');return {relative,file};}
function moduleTarget(file,specifier){if(specifier.startsWith('.'))return path.posix.normalize(path.posix.join(path.posix.dirname(file),specifier));if(specifier.startsWith('/_next/'))return specifier.slice(1);return null;}
function parseAssetsModule(text,name){const match=text.match(/^\s*export\s+default\s+([\s\S]*?)\s*;?\s*$/);if(!match)fail('Unsupported generated manifest format: '+name);let data;try{data=JSON.parse(match[1]);}catch{fail('Generated manifest must remain a plain data object: '+name);}if(!data?.clientReferenceDeps||typeof data.bootstrapScriptContent!=='string'||!data.serverResources)fail('Unsupported generated manifest schema: '+name);return data;}
async function walkJS(folder,base=folder){const result=[];for(const item of await readdir(folder,{withFileTypes:true})){const file=path.join(folder,item.name);if(item.isDirectory())result.push(...await walkJS(file,base));else if(item.isFile()&&item.name.endsWith('.js'))result.push(path.relative(base,file).split(path.sep).join('/'));}return result;}
function containsString(node,marker){let found=false;const visit=child=>{if(found)return;if(ts.isStringLiteralLike(child)&&child.text===marker){found=true;return;}ts.forEachChild(child,visit);};visit(node);return found;}

/** Vite 8 / @vitejs/plugin-rsc can retain a CSS-only module's pre-merge JS
 * name in transitive preload hints. This pinned workaround never manufactures
 * JS, drops an entry chunk or edits the actual client-reference import map. */
export async function validateClientAssets(outDir='dist'){
 const out=path.resolve(outDir),client=path.join(out,'client');
 const vite=JSON.parse(await readFile(path.join(client,'.vite/manifest.json'),'utf8'));
 const viteFiles=new Set(Object.values(vite).map(value=>value.file));
 let viteAssetsChecked=0;
 for(const [key,entry]of Object.entries(vite)){
  for(const file of [entry.file,...(entry.css||[]),...(entry.assets||[])]){if(typeof file!=='string'||!await existsFile(path.join(client,file)))fail('Missing final Vite manifest file: '+file);viteAssetsChecked++;}
  for(const keyRef of [...(entry.imports||[]),...(entry.dynamicImports||[])])if(!Object.hasOwn(vite,keyRef))fail('Missing final Vite manifest import key: '+key+' -> '+keyRef);
 }
 const modules=new Map();let importFilesChecked=0;
 for(const relative of await walkJS(path.join(client,'_next'))){
  const file='_next/'+relative,text=await readFile(path.join(client,file),'utf8'),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),imports=[],exports=new Map();
  const moduleImport=(specifier,names=[])=>{const target=moduleTarget(file,specifier);if(target)imports.push({target,names});};
  for(const statement of ast.statements){
   if(ts.isImportDeclaration(statement)&&ts.isStringLiteralLike(statement.moduleSpecifier)){
    const named=statement.importClause?.namedBindings;moduleImport(statement.moduleSpecifier.text,named&&ts.isNamedImports(named)?named.elements.map(item=>item.propertyName?.text||item.name.text):[]);
   }
   if(ts.isExportDeclaration(statement)){
    if(statement.moduleSpecifier&&ts.isStringLiteralLike(statement.moduleSpecifier))moduleImport(statement.moduleSpecifier.text);
    if(statement.exportClause&&ts.isNamedExports(statement.exportClause))for(const item of statement.exportClause.elements)exports.set(item.propertyName?.text||item.name.text,item.name.text);
   }
  }
  const dynamic=node=>{if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0]))moduleImport(node.arguments[0].text);ts.forEachChild(node,dynamic);};dynamic(ast);
  for(const reference of imports){if(reference.target.startsWith('../')||!await existsFile(path.join(client,reference.target)))fail('Missing emitted JS import: '+file+' -> '+reference.target);importFilesChecked++;}
  const components=[];
  for(const node of ast.statements)if(ts.isFunctionDeclaration(node)&&node.name&&node.body&&exports.has(node.name.text))for(const marker of componentMarkers)if(containsString(node.body,marker))components.push({marker,local:node.name.text,exported:exports.get(node.name.text)});
  modules.set(file,{text,imports,components});
 }
 const assetModules=[];const missing=[];let formalReferencesChecked=0,preloadFilesChecked=0;
 for(const name of manifestNames){
  const file=path.join(out,name),text=await readFile(file,'utf8'),data=parseAssetsModule(text,name);assetModules.push({name,file,text,data,removed:[]});
  for(const bootstrap of data.bootstrapScriptContent.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g))if(!await existsFile(localAsset(client,bootstrap[1]).file))fail('Missing bootstrap module: '+bootstrap[1]);
  for(const [id,deps]of Object.entries(data.clientReferenceDeps)){
   if(!Array.isArray(deps.js)||!deps.js.length||!Array.isArray(deps.css))fail('Invalid formal client reference: '+id);
   const first=localAsset(client,deps.js[0]);if(!await existsFile(first.file)||!viteFiles.has(first.relative))fail('Missing formal client reference entry: '+deps.js[0]);formalReferencesChecked++;
   for(const [index,url]of deps.js.entries()){const asset=localAsset(client,url);if(await existsFile(asset.file)){preloadFilesChecked++;continue;}if(index===0)fail('Cannot discard a formal client entry: '+url);missing.push({manifest:name,id,index,url,relative:asset.relative});}
   for(const url of deps.css){if(!await existsFile(localAsset(client,url).file))fail('Missing client reference stylesheet: '+url);preloadFilesChecked++;}
  }
  for(const deps of Object.values(data.serverResources))for(const url of [...(deps.js||[]),...(deps.css||[])])if(!await existsFile(localAsset(client,url).file))fail('Missing server resource: '+url);
 }
 const mergedProof=[];
 for(const url of new Set(missing.map(item=>item.url))){
  if(!allowedMergedPreload.test(url))fail('Unknown missing preload; refusing to filter: '+url);
  const relative=url.slice(1);if(viteFiles.has(relative))fail('Missing real Vite output must not be filtered: '+url);
  for(const [file,module]of modules)if(module.imports.some(reference=>reference.target===relative))fail('Missing preload is an actual JS import: '+file+' -> '+url);
  const styles=[...viteFiles].filter(file=>mergedStylesheet.test(file));if(styles.length!==1)fail('Cannot prove the merged CSS-only module stylesheet: '+url);
  const stylesheet=styles[0];if(!(await stat(path.join(client,stylesheet))).size)fail('Merged stylesheet is empty');
  const owners=[];
  for(const [file,module]of modules){
   const entry=Object.values(vite).find(value=>value.file===file);if(!entry?.css?.includes(stylesheet))continue;
   const retained=module.components.filter(item=>componentMarkers.includes(item.marker));if(!componentMarkers.every(marker=>retained.some(item=>item.marker===marker)))continue;
   if(!module.text.includes('智友由 AI 驱动，可能会出错，重要的事请自己再确认'))continue;
   const exports=retained.map(item=>({...item,importedBy:[...modules].filter(([other,m])=>other!==file&&m.imports.some(reference=>reference.target===file&&reference.names.includes(item.exported))).map(([other])=>other)}));
   if(exports.some(item=>!item.importedBy.length))continue;owners.push({file,exports});
  }
  if(!owners.length)fail('Cannot prove real merged component exports and consumers: '+url);
  mergedProof.push({filteredPreload:url,stylesheet,owners});
 }
 for(const entry of assetModules){
  const before=JSON.stringify(entry.data),firstFiles=Object.fromEntries(Object.entries(entry.data.clientReferenceDeps).map(([id,deps])=>[id,deps.js[0]]));
  const candidates=missing.filter(item=>item.manifest===entry.name);
  for(const item of candidates){const deps=entry.data.clientReferenceDeps[item.id];deps.js=deps.js.filter(url=>url!==item.url);entry.removed.push({id:item.id,index:item.index,url:item.url});}
  for(const [id,first]of Object.entries(firstFiles))if(entry.data.clientReferenceDeps[id].js[0]!==first)fail('Formal client entry changed unexpectedly');
  if(candidates.length){const temporary=entry.file+'.validated';await writeFile(temporary,'export default '+JSON.stringify(entry.data,null,2)+';\n');await rename(temporary,entry.file);}
  entry.beforeSha256=digest(entry.text);entry.afterSha256=digest(await readFile(entry.file,'utf8'));entry.dataUnchanged=before===JSON.stringify(entry.data);
 }
 const report={format:1,passed:true,formalReferencesChecked,finalViteEntries:Object.keys(vite).length,viteAssetsChecked,emittedJavaScriptModules:modules.size,importFilesChecked,preloadFilesChecked,removedPreloads:missing.length,mergedProof,manifests:assetModules.map(({name,beforeSha256,afterSha256,removed})=>({path:name,beforeSha256,afterSha256,removed})),clientReferenceImportMapChanged:false,emittedJavaScriptChanged:false,placeholderJavaScriptCreated:false};
 await mkdir(path.join(out,'beta'),{recursive:true});await writeFile(path.join(out,'beta/client-assets-validation.json'),JSON.stringify(report,null,2)+'\n');
 console.log(`[client-assets] validated ${formalReferencesChecked} formal client entries and ${importFilesChecked} emitted imports; removed ${missing.length} verified merged-module preload hints`);
 return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await validateClientAssets(process.argv[2]||'dist');
