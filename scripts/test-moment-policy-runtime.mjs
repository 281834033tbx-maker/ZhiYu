import assert from 'node:assert/strict';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';
const runtime=isolatedNpcRuntime();
try{
 const {momentCanPublish,momentFrequencyPolicy,loadMomentRules,normalizeTrainedMoment}=await runtime.load('server/npc/moment-policy');
 const {scheduledPolicy}=await runtime.load('server/npc/scheduled-moments');
 assert.deepEqual(scheduledPolicy,momentFrequencyPolicy);
 const now=Date.parse('2026-11-03T13:00:00+08:00');assert.equal(momentCanPublish([],now),true);assert.equal(momentCanPublish([now-3600000],now),false);assert.equal(momentCanPublish([now-7200000],now),true);assert.equal(momentCanPublish([now-8*3600000,now-4*3600000],now),false);assert.equal(momentCanPublish([NaN],now),false);
 const midnight=Date.parse('2026-11-04T00:30:00+08:00');assert.equal(momentCanPublish([midnight-90*60000],midnight),false,'new local day does not erase minimum gap');assert.equal(momentCanPublish([midnight-3*3600000],midnight),true);
 for(const id of ['chen-nian','liu','zhou-chef','he-jiawei','xia-xia','yuan-xiaoman','molly']){const rules=loadMomentRules(runtime.root,id);assert.ok(rules.includes('当前人物对话规则'));assert.ok(!/最多\s*2\s*条|相隔\s*2\s*小时|至少间隔\s*120\s*分钟|1[—–-]9/u.test(rules),'numeric publication caps belong to code: '+id);}
 const raw={decision:'post',publicSafe:true,npc_id:'chen-nian',post:{format:'text_only',text:'桌上还剩半杯水',media:[]},internal_context:{npc_type:'professional',topic_kind:'professional_daily',topic:'桌上的水杯',event_summary:'整理训练记录时桌上有水杯',share_reason:'记录一刻生活',format_reason:'一句话足够',image_count_reason:'无需图片',evidence_refs:['synthetic:1']}};
 assert.ok(normalizeTrainedMoment(raw,{characterId:'chen-nian',verifiedSourceIds:['synthetic:1']}));assert.equal(normalizeTrainedMoment({...raw,post:{...raw.post,text:'这是模型生成的NPC动态'}},{characterId:'chen-nian',verifiedSourceIds:['synthetic:1']}),null);
 const {MomentsQueue}=await runtime.load('server/npc/moments-plugin');let calls=0;
 const queue=Object.assign(Object.create(MomentsQueue.prototype),{root:runtime.root,run:async()=>{calls++;return {...raw,post:{...raw.post,text:calls===1?'这是NPC动态':'窗边的一杯水'}};}});
 const candidate=await queue.generateCandidate('synthetic candidate');assert.equal(calls,2);assert.equal(candidate.post.text,'窗边的一杯水');
 queue.run=async()=>{calls++;return {...raw,post:{...raw.post,text:'这是NPC动态'}};};const before=calls;await assert.rejects(queue.generateCandidate('synthetic candidate'),error=>error.code==='DIALOGUE_PUBLIC_OUTPUT_REJECTED');assert.equal(calls-before,2,'only one regeneration, no infinite retry');
 console.log('PASS shared 2/day,2h quota across midnight; code-only caps, all-person layered moment rules, public text guard and one bounded retry; synthetic only, no database/network/publication');
}finally{runtime.cleanup();}
