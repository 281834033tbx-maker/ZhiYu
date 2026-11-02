import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

// Compiled modules and copied Skill/library fixtures only; no model, network or database.
const runtime = isolatedNpcRuntime();
try {
  const { momentActors, momentFrequencyPolicy, loadMomentRules, normalizeTrainedMoment, momentProfessionalEvidence } = await runtime.load('server/npc/moment-policy');
  assert.deepEqual(momentActors.map(actor => actor.id), ['xia-xia', 'yuan-xiaoman', 'liu', 'chen-nian', 'he-jiawei', 'zhou-chef', 'molly']);
  assert.equal(momentActors.find(actor => actor.id === 'he-jiawei').table, 'he_sessions');
  assert.equal(momentActors.find(actor => actor.id === 'zhou-chef').table, 'zhou_chef_sessions');
  assert.equal(momentActors.find(actor => actor.id === 'molly').kind, 'functional');
  assert.equal(momentFrequencyPolicy.maxDaily, 2);
  assert.equal(momentFrequencyPolicy.minGapMs, 7_200_000);
  assert.equal(momentFrequencyPolicy.maxImages, 9);
  assert.deepEqual(momentFrequencyPolicy.roundupTypicalDays, [4, 5]);
  for (const actor of momentActors) {
    const rules = loadMomentRules(runtime.root, actor.id, 'interaction');
    assert.ok(rules.includes(actor.name));
    assert.ok(rules.includes('references/life-simulation.md'));
    assert.ok(rules.includes('references/interactions.md'));
    assert.ok(rules.includes('references/contract.md'));
    assert.ok(rules.includes('不是已发生事实'));
    assert.ok(!rules.includes('undefined'));
  }
  assert.throws(() => loadMomentRules(runtime.root, '../unknown'));
  const mirrored = join(runtime.root, 'npc-skills/skills/zhiyu-moments/SKILL.md');
  writeFileSync(mirrored, readFileSync(mirrored, 'utf8') + '\nPOLICY_HOT_RELOAD_FIXTURE\n');
  assert.ok(loadMomentRules(runtime.root, 'liu').includes('POLICY_HOT_RELOAD_FIXTURE'));
  const companionRules = loadMomentRules(runtime.root, 'he-jiawei');
  assert.ok(companionRules.includes('已确认生活与表达边界'));
  assert.ok(!companionRules.includes('## 夏夏：活泼可爱'));
  assert.ok(loadMomentRules(runtime.root, 'molly').includes('机器人与系统秘书身份'));

  const now = Date.parse('2026-10-20T12:00:00+08:00');
  const context = { characterId: 'chen-nian', now, verifiedSourceIds: ['event:training'], requiredSourceId: 'event:training' };
  const base = () => ({
    decision: 'post', publicSafe: true, npc_id: 'chen-nian',
    post: { format: 'text_only', text: '今天这几组稳了。', media: [], image_task: null },
    internal_context: {
      npc_type: 'professional', topic_kind: 'professional_daily', topic: '今天背部训练',
      event_summary: '本次训练后两组执行更稳定', share_reason: '想记下今天实际的动作进步',
      format_reason: '一句话足够表达', image_count_reason: '不需要图片',
      evidence_refs: ['event:training'], private_raw_chat: 'PRIVATE_FIXTURE_NEVER_PUBLIC',
    },
    reason: 'PRIVATE_REASON_NEVER_PUBLIC', publish_request: { private: 'NEVER_COPY_REQUEST' },
  });
  const normalize = (value, extra = {}) => normalizeTrainedMoment(value, { ...context, ...extra });
  const normalized = normalize(base());
  assert.equal(normalized.format, 'text_only');
  assert.equal(normalized.text, '今天这几组稳了。');
  assert.deepEqual(Object.keys(normalized).sort(), ['format', 'text', 'images', 'imageTask', 'mediaResult', 'internalContext'].sort());
  assert.ok(!JSON.stringify(normalized).includes('PRIVATE_FIXTURE_NEVER_PUBLIC'));
  assert.ok(!JSON.stringify(normalized).includes('PRIVATE_REASON_NEVER_PUBLIC'));
  assert.ok(!JSON.stringify(normalized).includes('NEVER_COPY_REQUEST'));
  assert.ok(normalized.internalContext.shareReason);
  const legacy = base(); legacy.post.format = 'text';
  assert.equal(normalize(JSON.stringify(legacy)).format, 'text_only');
  assert.equal(normalize('not json'), null);
  assert.equal(normalize({ ...base(), decision: 'no_post' }), null);
  assert.equal(normalize(base(), { characterId: 'molly' }), null);
  assert.equal(normalize(base(), { verifiedSourceIds: ['invented-by-model'] }), null);
  assert.equal(normalize(base(), { requiredSourceId: 'other-event' }), null);
  const unknownRef = base(); unknownRef.internal_context.evidence_refs.push('model:canon=true');
  assert.equal(normalize(unknownRef), null);
  const missingReason = base(); delete missingReason.internal_context.image_count_reason;
  assert.equal(normalize(missingReason), null);
  const privacyBlocked = base(); privacyBlocked.checks = { privacy: 'block' };
  assert.equal(normalize(privacyBlocked), null);
  const tooLong = base(); tooLong.post.text = '长'.repeat(301);
  assert.equal(normalize(tooLong), null);

  const image = () => {
    const raw = base();
    raw.post = { format: 'image_only', text: '', media: [], image_task: { asset_kind: 'generated_photo', count: 1, event: '本次背部训练', image_briefs: ['一张普通手机训练现场随拍'] } };
    raw.internal_context.format_reason = '照片已经表达训练状态';
    raw.internal_context.image_count_reason = '单张现场已经完整，不重复角度';
    return raw;
  };
  assert.ok(normalize(image()));
  assert.equal(normalize(image()).text, '');
  assert.equal(normalize(image(), { mode: 'publish' }), null);
  const hiddenCaption = image(); hiddenCaption.post.text = '不能偷加正文';
  assert.equal(normalize(hiddenCaption), null);
  const tooMany = image(); tooMany.post.image_task.count = 10; tooMany.post.image_task.image_briefs = Array(10).fill('图');
  assert.equal(normalize(tooMany), null);
  const missingBrief = image(); missingBrief.post.image_task.image_briefs = [];
  assert.equal(normalize(missingBrief), null);
  const done = image(); done.post.media = [{ url: '/media/training.jpg' }]; done.post.media_result = { accepted: true, modelSaysPassed: true };
  assert.equal(normalize(done, { mode: 'publish' }), null);
  assert.equal(normalize(done, { mode: 'publish', mediaVerifier: () => false }), null);
  assert.equal(normalize(done, { mode: 'publish', mediaVerifier: () => { throw Error('not verified'); } }), null);
  assert.deepEqual(normalize(done, { mode: 'publish', mediaVerifier: url => url === '/media/training.jpg' }).mediaResult, { accepted: true, verifiedBy: 'host' });
  const mismatch = structuredClone(done); mismatch.post.image_task.count = 2; mismatch.post.image_task.image_briefs.push('另一张');
  assert.equal(normalize(mismatch), null);
  const duplicate = structuredClone(mismatch); duplicate.post.media.push('/media/training.jpg');
  assert.equal(normalize(duplicate), null);
  const textImage = image(); textImage.post.format = 'text_image'; textImage.post.text = '稳了。';
  assert.ok(normalize(textImage));
  const textWithImage = base(); textWithImage.post.media = ['/image'];
  assert.equal(normalize(textWithImage), null);

  const returned = image(); returned.internal_context.topic_kind = 'learner_feedback';
  assert.equal(normalize(returned), null);
  returned.internal_context.return_photo_source_ids = ['event:training'];
  assert.equal(normalize(returned), null);
  assert.equal(normalize(returned, { returnPhotoPermissions: [{ sourceId: 'event:training', allowed: true, deidentified: false }] }), null);
  assert.ok(normalize(returned, { returnPhotoPermissions: [{ sourceId: 'event:training', allowed: true, deidentified: true }] }));
  const disguised = image();
  assert.equal(normalize(disguised, { returnPhotoPermissions: [{ sourceId: 'event:training', allowed: false, deidentified: true }] }), null);

  const food = base(); food.npc_id = 'liu'; food.post.text = '今天这份午饭，约500 kcal。';
  food.internal_context.calorie_evidence_id = 'calories:meal';
  const nutrition = { characterId: 'liu', calorieEvidence: [{ id: 'calories:meal', items: [{ ingredient: '完整餐食配方', edibleGrams: 250, state: 'as_eaten', kcalPer100g: 200, sourceRef: 'event:training' }], oilSauceIncluded: true, totalKcal: 500 }] };
  assert.equal(normalize(food, { characterId: 'liu' }), null);
  assert.ok(normalize(food, nutrition));
  const precise = structuredClone(food); precise.post.text = '今天这份午饭，500 kcal。';
  assert.equal(normalize(precise, nutrition), null);
  const wrongCalories = structuredClone(food); wrongCalories.post.text = '约900 kcal。';
  assert.equal(normalize(wrongCalories, nutrition), null);
  const omitOil = structuredClone(nutrition); omitOil.calorieEvidence[0].oilSauceIncluded = false;
  assert.equal(normalize(food, omitOil), null);

  const shared = base(); shared.internal_context.topic_kind = 'collaboration';
  const event = { eventId: 'event:training', participants: ['chen-nian', 'he-jiawei'], roles: { 'chen-nian': '带练', 'he-jiawei': '训练' }, occurredAt: '2026-10-20T10:00:00+08:00', location: '健身房' };
  shared.internal_context.collaboration = { event_id: event.eventId, participants: event.participants, roles: event.roles, occurred_at: event.occurredAt, location: event.location };
  assert.equal(normalize(shared), null);
  assert.ok(normalize(shared, { collaborationEvents: [event] }));
  const wrongRole = structuredClone(shared); wrongRole.internal_context.collaboration.roles['he-jiawei'] = '教练';
  assert.equal(normalize(wrongRole, { collaborationEvents: [event] }), null);
  const futureEvent = structuredClone(event); futureEvent.occurredAt = '2026-10-21T10:00:00+08:00';
  const futureShared = structuredClone(shared); futureShared.internal_context.collaboration.occurred_at = futureEvent.occurredAt;
  assert.equal(normalize(futureShared, { collaborationEvents: [futureEvent] }), null);

  const roundup = image(); roundup.internal_context.topic_kind = 'roundup';
  assert.equal(normalize(roundup), null);
  roundup.internal_context.roundup = { covered_from: '2026-10-16T10:00:00+08:00', covered_to: '2026-10-20T10:00:00+08:00', source_event_ids: ['event:training'], new_content_reason: '这几天不同活动的新照片' };
  assert.ok(normalize(roundup));
  const futureRoundup = structuredClone(roundup); futureRoundup.internal_context.roundup.covered_to = '2026-10-21T10:00:00+08:00';
  assert.equal(normalize(futureRoundup), null);
  // The typical 4–5 day interval remains judgement guidance, never a blanket ban on a new single event.
  assert.ok(normalize(image()));

  for (const [id, topic] of [['chen-nian', '肌酸'], ['zhou-chef', '巴斯克芝士蛋糕'], ['liu', '减脂']]) {
    const evidence = JSON.parse(momentProfessionalEvidence(runtime.root, id, topic));
    assert.ok(!evidence.error, `${id}: existing library parses`);
    assert.ok(evidence.entries.length > 0 && evidence.entries.length <= 6, `${id}: bounded topic retrieval`);
    for (const entry of evidence.entries) {
      assert.ok(Array.isArray(entry.conditions) && Array.isArray(entry.limitations));
      assert.ok(entry.sources.length > 0);
    }
  }
  assert.deepEqual(JSON.parse(momentProfessionalEvidence(runtime.root, 'molly', '肌酸')).entries, []);
  assert.equal(JSON.parse(momentProfessionalEvidence('/missing-fixture-root', 'liu', '减脂')).error, 'LOCAL_KNOWLEDGE_UNAVAILABLE');
  console.log('PASS moment policy v2: seven identities, live mirrored Skill/persona loading, trusted source binding, three formats, internal/public field separation, host media acceptance, return-photo consent, calorie basis, shared collaboration, roundup times, bounded local professional evidence; no model/DB calls');
} finally {
  runtime.cleanup();
}
