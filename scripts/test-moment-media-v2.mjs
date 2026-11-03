import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, symlinkSync, renameSync, realpathSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

// All images, identities, processes and review decisions are fixture data.
// Exercise production adapter/prepare code without generating an image or opening a database.
const runtime = isolatedNpcRuntime();
const owner = randomUUID(), otherOwner = randomUUID();
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+sK0kAAAAASUVORK5CYII=', 'base64');
const folder = join(runtime.root, '.npc-runtime/uploads', owner);
const otherFolder = join(runtime.root, '.npc-runtime/uploads', otherOwner);
mkdirSync(folder, { recursive: true }); mkdirSync(otherFolder, { recursive: true });
const savePhoto = (directory = folder, extension = 'png', bytes = png) => {
  const name = randomUUID() + '.' + extension;
  writeFileSync(join(directory, name), bytes);
  return '/api/npc/media/' + name;
};
try {
  const { createMomentMediaAdapter, momentMediaPath, momentVisualRules, reviewMomentImages } = await runtime.load('server/npc/moment-media');
  const { momentActors, loadMomentRules, normalizeTrainedMoment } = await runtime.load('server/npc/moment-policy');
  const { publicGroupDirectory } = await runtime.load('lib/npc/character-directory');
  const {characterImageReferences}=await runtime.load('server/npc/image-generator');
  for(const person of publicGroupDirectory()) {
    const target=join(runtime.root,'public',person.avatar.slice(1));
    mkdirSync(dirname(target),{recursive:true});copyFileSync(join('public',person.avatar.slice(1)),target);
  }
  const xiaIdentity='public/desktop-npc/scenes/xia-xia-anime-sofa-final-20261021.png';
  mkdirSync(dirname(join(runtime.root,xiaIdentity)),{recursive:true});copyFileSync(xiaIdentity,join(runtime.root,xiaIdentity));
  const photoUrl = savePhoto();
  assert.equal(momentMediaPath(runtime.root, owner, photoUrl), join(realpathSync(runtime.root), '.npc-runtime/uploads', owner, photoUrl.split('/').at(-1)));
  for (const invalid of ['https://example.test/photo.png', '/etc/passwd', '../photo.png', photoUrl + '?x=1', photoUrl.replace('.png', '.svg'), '/api/npc/media/%2e%2e/photo.png', 'data:image/png;base64,AAAA']) {
    assert.equal(momentMediaPath(runtime.root, owner, invalid), null);
  }
  assert.equal(momentMediaPath(runtime.root, '../escape', photoUrl), null);
  assert.equal(momentMediaPath(runtime.root, otherOwner, photoUrl), null);
  assert.equal(momentMediaPath(runtime.root, owner, savePhoto(folder, 'png', Buffer.from('not an image'))), null);
  assert.equal(momentMediaPath(runtime.root, owner, savePhoto(folder, 'jpg')), null, 'file extension must match image bytes');
  const directoryName = randomUUID() + '.png'; mkdirSync(join(folder, directoryName));
  assert.equal(momentMediaPath(runtime.root, owner, '/api/npc/media/' + directoryName), null);
  const otherUrl = savePhoto(otherFolder), linkedName = randomUUID() + '.png';
  symlinkSync(join(otherFolder, otherUrl.split('/').at(-1)), join(folder, linkedName));
  assert.equal(momentMediaPath(runtime.root, owner, '/api/npc/media/' + linkedName), null);
  const linkedOwner = randomUUID();
  symlinkSync(otherFolder, join(runtime.root, '.npc-runtime/uploads', linkedOwner));
  assert.equal(momentMediaPath(runtime.root, linkedOwner, otherUrl), null, 'owner directory cannot redirect the trusted upload root');

  const calls = [], reviews = [];
  const generate = async (root, user, character, photo, signal) => {
    assert.equal(root, runtime.root); assert.equal(user, owner); assert.equal(character, 'chen-nian');
    assert.ok(!signal?.aborted);
    calls.push(structuredClone(photo));
    return savePhoto();
  };
  const review = async (root, prompt, attachments) => {
    reviews.push({ prompt, attachments });
    assert.equal(root, runtime.root);
    assert.match(prompt, /identity_reference/);
    assert.match(prompt, /不计图数/);
    assert.match(prompt, /descriptions仅按postImageIndex/);
    assert.ok(attachments[0].endsWith('assets/chen-nian/identity/reference.png'));
    for (const path of attachments) assert.ok(readFileSync(path).length > 0);
    return { accepted: true, descriptions: attachments.slice(1).map((_, index) => `第${index + 1}张现场可见内容`), failures: [] };
  };
  const task = { assetKind: 'generated_photo', count: 2, imageBriefs: ['陈年坐在器械上练背', '陈年走到窗边擦汗'], event: '本次背部训练收尾' };
  const adapter = createMomentMediaAdapter(generate, review);
  const receipt = await adapter(runtime.root, owner, 'chen-nian', task);
  assert.equal(calls.length, 2); assert.equal(reviews.length, 1);
  assert.equal(new Set(calls.map(photo => photo.jobId)).size, 2);
  assert.ok(calls.every(photo => photo.withCharacter === true), 'a full character description must retain identity reference even without selfie keywords');
  assert.ok(calls.every(photo => photo.prompt.includes('唯一身份参考')));
  assert.ok(calls.every(photo => photo.prompt.includes('不因附有参考图而增加')));
  assert.match(calls[0].prompt, /只制作第1\/2张独立图片/);
  assert.match(calls[1].prompt, /只制作第2\/2张独立图片/);
  assert.equal(reviews[0].attachments.length, 3, 'two products plus one reference');
  assert.equal(receipt.images.length, 2); assert.equal(receipt.descriptions.length, 2);
  assert.equal(receipt.generated, true); assert.equal(receipt.accepted, true);
  assert.ok(momentVisualRules(runtime.root, 'chen-nian').includes('少年感'));
  assert.ok(!momentVisualRules(runtime.root, 'liu').includes('# 陈年现行身份与身材'));

  const countBefore = calls.length;
  const nine = { ...task, count: 9, imageBriefs: Array.from({ length: 9 }, (_, index) => `陈年第${index + 1}个不同场景`) };
  assert.equal((await adapter(runtime.root, owner, 'chen-nian', nine)).images.length, 9);
  assert.equal(calls.length - countBefore, 9);
  assert.equal(reviews.at(-1).attachments.length, 10, 'reference is excluded from the nine-photo product cap');
  const beforeInvalid = calls.length;
  for (const invalid of [
    { ...task, count: 0 }, { ...task, count: 10, imageBriefs: Array(10).fill('图') },
    { ...task, imageBriefs: ['少一张'] }, { ...task, imageBriefs: ['', '图'] },
    { ...task, assetKind: 'chat_screenshot' }, { ...task, withCharacter: 'yes' },
  ]) await assert.rejects(adapter(runtime.root, owner, 'chen-nian', invalid));
  assert.equal(calls.length, beforeInvalid, 'invalid tasks fail before invoking generation');

  const food = { assetKind: 'generated_photo', count: 1, imageBriefs: ['练后饭，只有碗与桌面'], event: '一碗练后饭', withCharacter: false, faceVisibility: '不出现' };
  await adapter(runtime.root, owner, 'chen-nian', food);
  assert.equal(calls.at(-1).withCharacter, false);
  assert.match(calls.at(-1).prompt, /纯食物或物件保持无人构图/);
  const abort = new AbortController(); abort.abort();
  const beforeAborted = calls.length;
  await assert.rejects(adapter(runtime.root, owner, 'chen-nian', task, abort.signal));
  assert.equal(calls.length, beforeAborted);
  let reviewAfterAbort = 0;
  const duringAbort = new AbortController();
  await assert.rejects(createMomentMediaAdapter(async () => { duringAbort.abort(); return savePhoto(); }, async () => { reviewAfterAbort++; return { accepted: true, descriptions: ['图'], failures: [] }; })(runtime.root, owner, 'chen-nian', { ...task, count: 1, imageBriefs: [task.imageBriefs[0]] }, duringAbort.signal));
  assert.equal(reviewAfterAbort, 0);

  for (const result of [null, {}, { accepted: false, descriptions: ['图'], failures: [] },
    { accepted: true, descriptions: ['图'], failures: ['手部错误'] },
    { accepted: true, descriptions: [], failures: [] },
    { accepted: true, descriptions: ['图', '把参考图也描述了'], failures: [] },
    { accepted: true, descriptions: [''], failures: [] },
    { accepted: true, descriptions: ['图'] },
  ]) {
    const rejected = createMomentMediaAdapter(async () => savePhoto(), async () => result);
    await assert.rejects(rejected(runtime.root, owner, 'chen-nian', { ...task, count: 1, imageBriefs: [task.imageBriefs[0]] }));
  }
  await assert.rejects(createMomentMediaAdapter(async () => 'https://untrusted.test/a.png', review)(runtime.root, owner, 'chen-nian', task));
  await assert.rejects(createMomentMediaAdapter(async () => photoUrl, review)(runtime.root, owner, 'chen-nian', task), 'two tasks cannot reuse the same generated asset');
  const reused = await reviewMomentImages(runtime.root, owner, 'chen-nian', { ...task, count: 1, imageBriefs: [task.imageBriefs[0]] }, [photoUrl], review);
  assert.equal(reused.generated, false); assert.equal(reused.descriptions.length, 1);
  const identity = realpathSync(join(runtime.root, 'npc-skills/assets/chen-nian/identity/reference.png'));
  renameSync(identity, identity + '.test-backup');
  try { await assert.rejects(adapter(runtime.root, owner, 'chen-nian', task), /ENOENT|身份参考/); }
  finally { renameSync(identity + '.test-backup', identity); }

  // Execute generateScene's actual argv/reference/immutable-output path with a process stub.
  // The stub writes only a fixture PNG; it never launches a binary or calls image generation.
  const childPath = join(runtime.root, 'server/npc/fixture-image-child.mjs');
  writeFileSync(childPath, `import {EventEmitter} from 'node:events';
import {writeFileSync} from 'node:fs';import {join,dirname} from 'node:path';
export const calls=[];
export function spawn(command,args){const call={command,args:[...args],prompt:''};calls.push(call);
const child=new EventEmitter();child.stderr=new EventEmitter();child.stdout=new EventEmitter();child.stdin=new EventEmitter();
child.kill=()=>{queueMicrotask(()=>child.emit('close',1));return true;};
child.stdin.end=prompt=>{call.prompt=prompt;const out=args[args.indexOf('--output-last-message')+1];
const photo=join(dirname(out),'stub-image.png');writeFileSync(photo,Buffer.from(${JSON.stringify(png.toString('base64'))},'base64'));
writeFileSync(out,JSON.stringify({path:photo}));queueMicrotask(()=>child.emit('close',0));};return child;}
`);
  const generatorPath = join(runtime.root, 'server/npc/image-generator-lock-fixture.mjs');
  const generatorSource = readFileSync(join(runtime.root, 'server/npc/image-generator.mjs'), 'utf8')
    .replace("from 'node:child_process'", "from './fixture-image-child.mjs'");
  assert.ok(generatorSource.includes("from './fixture-image-child.mjs'"));
  writeFileSync(generatorPath, generatorSource);
  const { generateScene: actualGenerateScene } = await import(pathToFileURL(generatorPath));
  const generateScene=(root,user,character,photo,signal)=>actualGenerateScene(root,user,character,photo,signal,async()=>({accepted:true,failures:[]}));
  const processStub = await import(pathToFileURL(childPath));
  const output = await generateScene(runtime.root, owner, 'chen-nian', { ...calls[0], jobId: randomUUID(), withCharacter: true });
  assert.ok(momentMediaPath(runtime.root, owner, output));
  assert.equal(processStub.calls.length, 1);
  const argumentsWithReference = processStub.calls[0].args;
  assert.equal(argumentsWithReference[argumentsWithReference.indexOf('--image') + 1], identity);
  await generateScene(runtime.root, owner, 'chen-nian', { ...calls[0], jobId: randomUUID(), withCharacter: false });
  assert.equal(processStub.calls[1].args.includes('--image'), false, 'an explicit food-only task does not force a character reference');

  const groupIds=['chen-nian','he-jiawei','zhou-chef','liu'];
  const groupTask={...task,count:1,imageBriefs:['陈年、何嘉伟、赵一帆与柳智敏在同一活动后的合照'],referenceCharacters:groupIds};
  let groupReviewAttachments;
  const groupAdapter=createMomentMediaAdapter(generate,async (_root,prompt,attachments)=>{
    groupReviewAttachments=attachments;
    for(const id of groupIds)assert.ok(prompt.includes(`"characterId":"${id}"`));
    assert.equal(attachments.length,characterImageReferences(runtime.root,'chen-nian',true,groupIds).length+1,'all identity assets plus one finished image');
    assert.match(prompt,/不同人物不得串脸或合脸/);
    return {accepted:true,descriptions:['四位人物的同场合照'],failures:[]};
  });
  assert.equal((await groupAdapter(runtime.root,owner,'chen-nian',groupTask)).images.length,1);
  assert.deepEqual(calls.at(-1).referenceCharacters,groupIds,'adapter only forwards host-supplied stable participant IDs');
  const expectedGroupPaths=characterImageReferences(runtime.root,'chen-nian',true,groupIds).map(ref=>ref.path);
  assert.deepEqual(groupReviewAttachments.slice(0,expectedGroupPaths.length),expectedGroupPaths);
  const groupOutput=await generateScene(runtime.root,owner,'chen-nian',{...calls.at(-1),jobId:randomUUID(),withCharacter:true});
  const groupCall=processStub.calls.at(-1),groupPaths=[];
  for(let index=0;index<groupCall.args.length;index++)if(groupCall.args[index]==='--image')groupPaths.push(groupCall.args[index+1]);
  assert.deepEqual(groupPaths,expectedGroupPaths,'real generateScene argv binds all four current identities');
  const groupManifest=JSON.parse(readFileSync(join(folder,groupOutput.split('/').at(-1).replace(/\.png$/,'.json')),'utf8'));
  assert.deepEqual([...new Set(groupManifest.identityReferences.map(item=>item.characterId))],groupIds);
  assert.ok(groupCall.prompt.includes('never merge or exchange their faces'));
  const beforeUnknown=processStub.calls.length;
  await assert.rejects(generateScene(runtime.root,owner,'chen-nian',{...calls[0],jobId:randomUUID(),referenceCharacters:['unknown']}),/身份参考列表无效/);
  await assert.rejects(generateScene(runtime.root,owner,'chen-nian',{...calls[0],jobId:randomUUID(),referenceCharacters:['liu','liu']}),/身份参考列表无效/);
  assert.equal(processStub.calls.length,beforeUnknown,'invalid identities fail before a process is invoked');
  const heReference=expectedGroupPaths[1];renameSync(heReference,heReference+'.test-backup');
  try{await assert.rejects(groupAdapter(runtime.root,owner,'chen-nian',groupTask),/ENOENT|身份参考/);}
  finally{renameSync(heReference+'.test-backup',heReference);}
  await generateScene(runtime.root,owner,'chen-nian',{...calls[0],jobId:randomUUID(),referenceCharacters:['molly']});
  assert.match(processStub.calls.at(-1).prompt,/Molly is a robot\/system avatar, never a human body/);
  assert.ok(processStub.calls.at(-1).prompt.includes('"characterId":"molly"'));
  const allIds=momentActors.map(actor=>actor.id);
  await generateScene(runtime.root,owner,'chen-nian',{...calls[0],jobId:randomUUID(),referenceCharacters:allIds});
  assert.equal(processStub.calls.at(-1).args.filter(arg=>arg==='--image').length,characterImageReferences(runtime.root,'chen-nian',true,allIds).length);
  await generateScene(runtime.root,owner,'xia-xia',{...calls[0],jobId:randomUUID(),withCharacter:true,referenceCharacters:[]});
  const animeCall=processStub.calls.at(-1);
  assert.equal(animeCall.args[animeCall.args.indexOf('--image')+1],characterImageReferences(runtime.root,'xia-xia',true)[0].path);
  assert.match(animeCall.prompt,/Japanese anime illustration style/);
  assert.match(animeCall.prompt,/"kind":"anime"/);
  assert.equal(animeCall.prompt.includes('Use natural casual phone photography'),false);
  assert.equal(animeCall.prompt.includes('is 唐佳怡'),false);

  // A DB-shaped read stub lets production prepare enforce its gate without constructing MomentsQueue or SQLite.
  const { MomentsQueue } = await runtime.load('server/npc/moments-plugin');
  const actor = momentActors.find(value => value.id === 'chen-nian');
  const raw = {
    decision: 'post', publicSafe: true, npc_id: 'chen-nian',
    post: { format: 'text_image', text: '今天练背。', media: [], image_task: { asset_kind: 'generated_photo', count: 1, image_briefs: ['陈年坐在器械上练背'], event: '本次训练' } },
    internal_context: { npc_type: 'professional', topic_kind: 'professional_daily', topic: '本次背部训练', event_summary: '本次背部训练结束', share_reason: '记录本次训练状态', format_reason: '训练照配一句短文', image_count_reason: '一张已经完整', evidence_refs: ['event:training'] },
  };
  let publicReviewCalls = 0, writes = 0;
  const fakeQueue = media => Object.assign(Object.create(MomentsQueue.prototype), {
    root: runtime.root, now: () => Date.parse('2026-10-20T12:00:00+08:00'), stopped: false, media,
    stage: () => {}, // Runtime diagnostics are exercised by the real SQLite chain test.
    state: () => ({ branch: 'fixture-branch' }),
    db: { prepare: sql => { assert.match(sql, /^SELECT /); return { all: () => [] }; }, exec: () => { writes++; throw Error('test forbids real publication'); } },
    run: async () => { publicReviewCalls++; return { accepted: true, privacy: true, sourceFaithful: true, voiceMatch: true }; },
  });
  const callPrepare = queue => queue.prepare(raw, actor, owner, 'event:training', ['event:training'], [], { summary: '可信训练事件' });
  for (const invalidReceipt of [
    { images: [photoUrl], accepted: false, generated: true, descriptions: ['图'], checkedAt: Date.now() },
    { images: [photoUrl], accepted: true, generated: true, descriptions: [], checkedAt: Date.now() },
    { images: ['https://untrusted.test/photo.png'], accepted: true, generated: true, descriptions: ['图'], checkedAt: Date.now() },
  ]) await assert.rejects(callPrepare(fakeQueue(async () => invalidReceipt)), error=>['MEDIA_RECEIPT_REJECTED','PUBLISH_CONTRACT_REJECTED'].includes(error.code));
  assert.equal(publicReviewCalls, 0, 'invalid media never advances to public post approval');
  await assert.rejects(callPrepare(fakeQueue(async () => { throw Error('visual acceptance failed'); })));
  const prepared = await callPrepare(fakeQueue(async () => ({ images: [photoUrl], accepted: true, generated: true, descriptions: ['训练现场'], checkedAt: Date.now() })));
  assert.ok(prepared && prepared.trained.images.length === 1);
  assert.equal(publicReviewCalls, 1);
  assert.equal(writes, 0, 'prepare is only a gate, not a publication or history write');
  const characterFlags = structuredClone(raw);
  characterFlags.post.image_task.with_character = false; characterFlags.post.image_task.face_visibility = '不出现';
  const normalized = normalizeTrainedMoment(characterFlags, { characterId: 'chen-nian', now: Date.now(), verifiedSourceIds: ['event:training'] });
  assert.equal(normalized.imageTask.withCharacter, false); assert.equal(normalized.imageTask.faceVisibility, '不出现');
  characterFlags.post.image_task.referenceCharacters=['unknown'];
  characterFlags.post.image_task.reference_characters=['molly'];
  assert.equal(Object.hasOwn(normalizeTrainedMoment(characterFlags,{characterId:'chen-nian',verifiedSourceIds:['event:training']}).imageTask,'referenceCharacters'),false,'model-injected participant lists are stripped before the host injects verified activity participants');

  // Actor-specific documents stay private to their own generation/reply request.
  const paths=new Map(momentActors.map(value=>[value.id,join(runtime.root,'npc-skills/skills/zhiyu-dialogue/npcs',value.id==='molly'?'molly':value.id,'style.md')]));
  for (const [id, path] of paths) {
    const source=readFileSync(path,'utf8'),marker=`\nPRIVATE_PROFILE_MARKER_${id}\n`;
    writeFileSync(path,source.includes('<!-- current-character-profile:end -->')
      ?source.replace('<!-- current-character-profile:end -->',marker+'<!-- current-character-profile:end -->'):source+marker);
  }
  for (const actor of momentActors) for (const section of ['post', 'interaction']) {
    const rules = loadMomentRules(runtime.root, actor.id, section);
    for (const other of momentActors) assert.equal(rules.includes('PRIVATE_PROFILE_MARKER_' + other.id), other.id === actor.id);
    assert.ok(rules.includes('示例与联动只解释方向'));
    assert.ok(rules.includes(actor.name));
  }
  console.log('PASS moments media v2: owned-file confinement, sequential 1–9 images, real generateScene argv/output manifests with all current identity-package references, Chen lock face, Molly robot identity, host pixel-review receipts, abort/rejection/duplicates, invalid media cannot pass prepare, stripped model participant injection, seven isolated personas; no real generation/model/database/publication');
} finally {
  runtime.cleanup();
}
