import assert from 'node:assert/strict';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';
const runtime=isolatedNpcRuntime();
try {
  const {fitnessDemonstrations:catalog,fitnessDemonstrationForStep:resolve,interpolateFitnessPose}=await runtime.load('lib/npc/fitness-demonstrations');
  const {parseProfessionalTaskOperation:parse}=await runtime.load('lib/npc/professional-task');
  assert.equal(catalog.length,12);assert.equal(new Set(catalog.map(item=>item.id)).size,12);
  for(const item of catalog){
    assert.ok(item.conditions&&item.preparation&&item.movement&&item.mistake);
    for(const title of item.aliases){assert.equal(resolve({title})?.id,item.id);assert.equal(resolve({title,training:{exerciseId:item.id}})?.id,item.id);}
    for(const amount of [0,.25,.5,.75,1]){
      const pose=interpolateFitnessPose(item.start,item.finish,amount);
      for(const key of ['head','shoulder','hip','elbow','hand','knee','ankle'])assert.ok(pose[key].every(value=>Number.isFinite(value)&&value>=0&&value<=300));
      const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
      assert.ok(Math.abs(distance(pose.shoulder,pose.elbow)-distance(item.start.shoulder,item.start.elbow))<1e-7,'upper arm stays rigid');
      assert.ok(Math.abs(distance(pose.elbow,pose.hand)-distance(item.start.elbow,item.start.hand))<1e-7,`forearm stays rigid: ${item.id} ${amount}`);
      if(item.start.hand[0]===item.finish.hand[0]&&item.start.hand[1]===item.finish.hand[1])assert.deepEqual(pose.hand,item.start.hand,'support contact stays fixed');
    }
  }
  for(const title of ['上斜杠铃卧推','单臂绳索下拉','哑铃单腿硬拉','坐姿屈膝提踵','卧推','胸部热身','高位绳索夹胸','墙面五指撑','扶稳/杯式箱式深蹲（高箱起步）','上斜哑铃卧推＋绳索夹胸','上斜哑铃卧推热身','水平器械推胸','高支撑俯卧撑','扶稳直膝提踵','扶稳双脚提踵','地面双脚提踵','扶稳站姿提踵'])assert.equal(resolve({title}),undefined,title);
  assert.equal(resolve({title:'上斜哑铃卧推',training:{exerciseId:'db_rdl'}}),undefined,'a known wrong ID never overrides the title');
  assert.equal(resolve({title:'上斜哑铃卧推',training:{exerciseId:'unknown_variant'}}),undefined,'an explicitly unknown version never inherits a fallback animation');
  assert.equal(resolve({title:'1. 上斜哑铃卧推'})?.id,'incline_db_press');
  const request={decision:'create',basis:'explicit_request',confidence:.99,scope:'current_user',polarity:'affirmed',readiness:'ready',sourceMessageId:'synthetic',evidence:'给我胸部任务',title:'胸部训练',goalKey:'胸部训练',steps:[{title:'上斜哑铃卧推',instructions:['按个人适配执行。'],training:{target:'上胸',sets:3,reps:'8次',restSeconds:120,exerciseId:'incline_db_press'}}]};
  const snapshot=JSON.stringify(request);assert.equal(parse(request).steps[0].training.exerciseId,'incline_db_press');assert.equal(JSON.stringify(request),snapshot);
  const legacy=structuredClone(request);delete legacy.steps[0].training.exerciseId;assert.equal(parse(legacy).steps[0].training.exerciseId,undefined);
  const unknown=structuredClone(request);unknown.steps[0].training.exerciseId='unknown_variant';assert.equal(parse(unknown).steps[0].training.exerciseId,'unknown_variant');assert.equal(resolve(parse(unknown).steps[0]),undefined);
  for(const invalid of ['',null,4,'<svg>','../db_rdl','A'.repeat(81)]){const broken=structuredClone(request);broken.steps[0].training.exerciseId=invalid;assert.throws(()=>parse(broken),/训练动作标识无效/);}
  assert.match(catalog.find(item=>item.id==='supported_bodyweight_hip_hinge').conditions,/不能等效负重RDL增肌/);
  assert.match(catalog.find(item=>item.id==='seated_neutral_db_shoulder_press').conditions,/最低负荷试推.*无痛/);
  console.log('PASS fitness demonstrations: 12 explicit schematic versions; all exact aliases and finite poses; unsafe/version/combined title mismatches fall back; explicit wrong or unknown IDs never inherit; optional parser identity is backward compatible and rejects malformed values; no APIs, media or production writes.');
} finally {runtime.cleanup();}
