import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
const baseline=JSON.parse(fs.readFileSync('docs/redesign/style-baseline.json','utf8'));
const themeFiles=new Set(['theme.css','theme-glass.css','theme-surfaces.css','theme-frosted.css']);
const failures=[];
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):e.name.endsWith('.css')?[path.join(dir,e.name)]:[]);
const collectColors=value=>value.match(/#[\da-f]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)/gi)||[];
const baselineFiles=baseline.files||baseline;
const ownership=JSON.parse(fs.readFileSync('docs/redesign/style-ownership.json','utf8'));
function oldColors(file){const entry=Array.isArray(baselineFiles)?baselineFiles.find(e=>e.path===file):baselineFiles[file];return new Set(entry?.colors||[]);}
for(const file of walk('app')){
 const tree=postcss.parse(fs.readFileSync(file,'utf8'),{from:file});
 const allowedColors=new Set((ownership[file]||[file]).flatMap(source=>[...oldColors(source)]));
 tree.walkDecls(d=>{
  const fail=reason=>failures.push(`${file}:${d.source.start.line} ${reason}: ${d.prop}:${d.value}`);
  if(d.important)fail('禁止 important');
  if(!themeFiles.has(path.basename(file)))for(const color of collectColors(d.value))if(!allowedColors.has(color))fail('新增颜色 '+color);
  if(d.prop==='font'&&/\dpx/.test(d.value)&&!/^.*calc\((?:11|12|13|14|16|20|28)px \+ var\(--zy-font-adjust,\s*0px\)\)/.test(d.value))fail('font简写字号也必须跟随设置');
  if(d.prop==='font-size'&&!/^(?:inherit|calc\((?:11|12|13|14|16|20|28)px \+ var\(--zy-font-adjust,\s*0px\)\))$/.test(d.value))fail('字号必须使用七档和字号设置');
  if(d.prop==='font-weight'&&!/^(?:400|600|inherit|normal)$/.test(d.value))fail('字重只允许400或600');
  if(d.prop==='border-radius'){
   const selector=d.parent.selector||'';
   const geometry=/(?:bubble|message-photo|message-image|generated-photo|chat-image|phone-shell|phone-screen)/.test(selector);
   if(!geometry&&!/^(?:inherit|(?:0(?:px)?|6px|10px|12px|50%|999px)(?:\s+(?:0(?:px)?|6px|10px|12px|50%|999px))*)$/.test(d.value))fail('圆角不在规范档位');
  }
 });
}
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log('style: PASS (palette whitelist, typography, radii, no important)');
