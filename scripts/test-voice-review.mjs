import assert from 'node:assert/strict';import ts from 'typescript';import{readFileSync,writeFileSync,mkdtempSync,rmSync,cpSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{pathToFileURL}from'node:url';
const dir=mkdtempSync(join(tmpdir(),'voice-review-'));
try{
cpSync('npc-skills',join(dir,'npc-skills'),{recursive:true});
const file=join(dir,'codex.mjs');writeFileSync(file,ts.transpileModule(readFileSync('server/npc/codex.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
const {applyVoiceEdits,reviewVoice,plainChatTypography}=await import(pathToFileURL(file));
const draft={action:'reply',messages:[{type:'text',text:'我不知道这个。',replyTo:'m1'},{type:'photo',assetId:'cake'}],event:{deltas:{trust:2}},memories:[{text:'test'}]};
const out=applyVoiceEdits(draft,{verdict:'revise',edits:[{index:0,text:'这个不知道。'}],event:{deltas:{trust:99}}});
assert.equal(out.messages[0].replyTo,'m1');assert.deepEqual(out.event,draft.event);assert.deepEqual(out.memories,draft.memories);assert.deepEqual(out.messages[1],draft.messages[1]);assert.equal(draft.messages[0].text,'我不知道这个。');
for(const review of [{verdict:'keep',edits:[{index:0,text:'changed'}]},{verdict:'revise',edits:[{index:1,text:'fake photo'}]},{verdict:'revise',edits:[{index:0,text:'a'},{index:0,text:'b'}]},{verdict:'revise',edits:[{index:5,text:'a'}]}])assert.throws(()=>applyVoiceEdits(draft,review));
assert.throws(()=>applyVoiceEdits({messages:[{type:'text',text:'23岁'}]},{verdict:'revise',edits:[{index:0,text:'22岁'}]}));
let calls=0;await reviewVoice(process.cwd(),'ctx',{intent:'search',messages:['查找候选']},async()=>{calls++;});assert.equal(calls,0);
const edited=await reviewVoice(dir,'ctx',draft,async p=>{calls++;assert.match(p,/近期|最近几轮/);return {verdict:'revise',edits:[{index:0,text:'不懂诶'}]};});assert.equal(edited.messages[0].text,'不懂诶');assert.equal(calls,1);
const mollyChat={intent:'chat',messages:['有点烦','你说']};
await reviewVoice(dir,'ctx',mollyChat,async p=>{assert.match(p,/Molly的chat也遵守此约束/);return {verdict:'keep',edits:[]};});
assert.throws(()=>applyVoiceEdits(mollyChat,{verdict:'revise',edits:[],remove:[1]}));
const redundant={action:'reply',messages:[{type:'text',text:'喜欢烧烤'},{type:'text',text:'烤鱼麻辣烫也喜欢'}],event:{kind:'ordinary'},memories:[]};
assert.deepEqual(applyVoiceEdits(redundant,{verdict:'revise',edits:[],remove:[1]}),{...redundant,messages:[redundant.messages[0]]});
for(const review of [{verdict:'keep',edits:[],remove:[1]},{verdict:'revise',edits:[],remove:[0,1]},{verdict:'revise',edits:[],remove:[1,1]},{verdict:'revise',edits:[{index:1,text:'a'}],remove:[1]}])assert.throws(()=>applyVoiceEdits(redundant,review));
for(const part of [{type:'photo',assetId:'cake'},{type:'voice',text:'你好'},{type:'text',text:'晚上8点'},{type:'text',text:'回复',replyTo:'m1'}])assert.throws(()=>applyVoiceEdits({messages:[{type:'text',text:'保留'},part]},{verdict:'revise',edits:[],remove:[1]}));
assert.throws(()=>applyVoiceEdits({...redundant,intent:'clarify'},{verdict:'revise',edits:[],remove:[1]}));
const quoted={action:'reply',messages:[{type:'text',text:'想吃“麻辣烫”，刚看完《电影》',replyTo:'m1'},{type:'photo',assetId:'a'}],memories:[{text:'原文“引用”'}]};
const plain=plainChatTypography(quoted);assert.equal(plain.messages[0].text,'想吃麻辣烫，刚看完电影');assert.equal(plain.messages[0].replyTo,'m1');assert.deepEqual(plain.memories,quoted.memories);assert.deepEqual(plain.messages[1],quoted.messages[1]);assert.equal(quoted.messages[0].text,'想吃“麻辣烫”，刚看完《电影》');
assert.equal(plainChatTypography({messages:[{type:'text',text:'```“literal”```'}]}).messages[0].text,'```“literal”```');
console.log('PASS independent editor; only valid text edits; metadata/media/references immutable; numerical changes rejected; program-selected Molly output bypassed');
}finally{rmSync(dir,{recursive:true,force:true});}
