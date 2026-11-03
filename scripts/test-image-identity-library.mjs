import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,symlinkSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';
const runtime=isolatedNpcRuntime(),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+sK0kAAAAASUVORK5CYII=','base64');
function chunks(bytes){const out=[];for(let offset=8;offset+12<=bytes.length;){const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);out.push({type,data:bytes.subarray(offset+8,offset+8+length)});offset+=12+length;}return out;}
try{
 const {addImageAigcMetadata}=await runtime.load('server/npc/image-aigc-metadata');
 const {readImageIdentity,findReviewedLibraryImage,privateReviewedImage,imageSceneKey}=await runtime.load('server/npc/image-asset-library');
 const {characterImageReferences}=await runtime.load('server/npc/image-generator');
 for(const id of ['chen-nian','liu','zhou-chef','he-jiawei','xia-xia','yuan-xiaoman','molly']){const identity=readImageIdentity(runtime.root,id);assert.ok(identity.references.length);assert.ok(identity.references.every(r=>r.reviewed));assert.equal(characterImageReferences(runtime.root,id,true).length,identity.references.length);}
 const stamped=addImageAigcMetadata(png,'synthetic-test-id'),label=chunks(stamped).find(c=>c.type==='iTXt').data;
 assert.ok(label.toString().includes('AIGC'));assert.ok(label.toString().includes('"Label":"1"'));assert.ok(label.toString().includes('"ProduceID":"synthetic-test-id"'));
 assert.deepEqual(chunks(stamped).filter(c=>c.type==='IDAT').map(c=>c.data),chunks(png).filter(c=>c.type==='IDAT').map(c=>c.data),'metadata never alters compressed pixel payload');
 const jpeg=Buffer.from([255,216,255,217]),taggedJpeg=addImageAigcMetadata(jpeg,'jpeg-test');assert.equal(taggedJpeg.readUInt16BE(),0xffd8);assert.ok(taggedJpeg.includes(Buffer.from('AIGC')));assert.deepEqual(taggedJpeg.subarray(-2),Buffer.from([255,217]));
 const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64');assert.ok(addImageAigcMetadata(gif,'gif-test').includes(Buffer.from('AIGC=')));
 const vp8x=Buffer.alloc(30);vp8x.write('RIFF');vp8x.writeUInt32LE(22,4);vp8x.write('WEBPVP8X',8);vp8x.writeUInt32LE(10,16);const taggedWebp=addImageAigcMetadata(vp8x,'webp-test');assert.ok(taggedWebp[20]&4);assert.equal(taggedWebp.readUInt32LE(4),taggedWebp.length-8);
 assert.throws(()=>addImageAigcMetadata(Buffer.from('invalid'),'not-image'));assert.throws(()=>addImageAigcMetadata(png,'../unsafe'));
 assert.ok(findReviewedLibraryImage(runtime.root,'chen-nian','陈年 书桌 原图',false));assert.equal(findReviewedLibraryImage(runtime.root,'chen-nian','陈年 书桌 原图',true),null);assert.equal(findReviewedLibraryImage(runtime.root,'chen-nian','早上 陈年 书桌 原图',false),null);
 const owner=randomUUID(),secondOwner=randomUUID(),childPath=join(runtime.root,'server/npc/fixture-reviewed-image-child.mjs');
 writeFileSync(childPath,`import{EventEmitter}from'node:events';import{writeFileSync}from'node:fs';import{join,dirname}from'node:path';export let calls=0;export function spawn(_command,args){calls++;const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.kill=()=>true;child.stdin.end=()=>{const out=args[args.indexOf('--output-last-message')+1],image=join(dirname(out),'actual-fixture.png');writeFileSync(image,Buffer.from('${png.toString('base64')}','base64'));writeFileSync(out,JSON.stringify({path:image}));queueMicrotask(()=>child.emit('close',0));};return child;}`);
 const fixturePath=join(runtime.root,'server/npc/reviewed-image-generator.mjs');writeFileSync(fixturePath,readFileSync(join(runtime.root,'server/npc/image-generator.mjs'),'utf8').replace("from 'node:child_process'","from './fixture-reviewed-image-child.mjs'"));
 const {generateScene}=await import(pathToFileURL(fixturePath)),child=await import(pathToFileURL(childPath));
 const scene={type:'generated_photo',jobId:randomUUID(),prompt:'合成测试白杯子',withCharacter:false,caption:'',status:'pending',attempts:0};
 await assert.rejects(generateScene(runtime.root,owner,'chen-nian',scene,undefined,async()=>({accepted:false,failures:['synthetic reject']})),error=>error.code==='IMAGE_REVIEW_FAILED');
 const key=imageSceneKey(scene.prompt,false);assert.equal(privateReviewedImage(runtime.root,owner,'chen-nian',key),null);
 const url=await generateScene(runtime.root,owner,'chen-nian',{...scene,jobId:randomUUID()},undefined,async()=>({accepted:true,failures:[]}));const bytes=readFileSync(join(runtime.root,'.npc-runtime/uploads',owner,url.split('/').at(-1)));assert.ok(bytes.includes(Buffer.from('AIGC')));assert.ok(privateReviewedImage(runtime.root,owner,'chen-nian',key));assert.equal(privateReviewedImage(runtime.root,secondOwner,'chen-nian',key),null);
 const callsBefore=child.calls;await generateScene(runtime.root,owner,'chen-nian',{...scene,jobId:randomUUID()},undefined,async()=>{throw Error('cached scene must not be reviewed twice');});assert.equal(child.calls,callsBefore,'exact already-reviewed scene reuses actual asset before generation');
 const identityDir=join(runtime.root,'npc-skills/assets/molly/identity'),external=join(runtime.root,'.npc-runtime/untrusted-identity');mkdirSync(external,{recursive:true});writeFileSync(join(external,'escape.png'),png);symlinkSync(join(external,'escape.png'),join(identityDir,'escape.png'));
 const manifest=JSON.parse(readFileSync(join(identityDir,'manifest.json'),'utf8'));manifest.references=[{file:'escape.png',view:'side',reviewed:true,source:'synthetic'}];writeFileSync(join(identityDir,'manifest.json'),JSON.stringify(manifest));assert.throws(()=>readImageIdentity(runtime.root,'molly'),/越界/);assert.ok(!existsSync(join(runtime.root,'state.sqlite')));
 console.log('PASS seven identity packages, reviewed-library matching, PNG/JPEG/WebP/GIF in-file provenance, unchanged pixels, actual generation/QC gate fixture, account confinement, private cache reuse and path escape rejection; no network/model/publication');
}finally{runtime.cleanup();}
