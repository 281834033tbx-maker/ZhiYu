import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { npcSkillVersion, mollySkillVersion, timeRules } from './codex';
import { loadDialogueSkill } from './dialogue-skill';
import { isProfessionalTaskMutation } from './professional-task-mutation';
import { PROFESSIONAL_TASK_SESSION_COMPLETE_VERSION, PROFESSIONAL_TASK_SESSION_VERSION } from '../../lib/npc/professional-task-session';
import { groupParticipationVersion } from './group-routing';
import { PROFESSIONAL_TASK_EXPIRY_VERSION } from '../../lib/npc/professional-task-expiry';
import { allowsCharacterChoice } from '../../lib/npc/character-output-policy';
import { loadMomentRules } from './moment-policy';
import { imageGenerationRuntime } from './image-generator';

// Read-only operational evidence from the same running server modules. No
// model invocation, session creation, DB access or message delivery occurs.
export function dialogueHealth(): Plugin {
  return {
    name: 'zhiyu-dialogue-health',
    configureServer(server) {
      const root = server.config.root;
      server.middlewares.use('/api/npc/dialogue-health', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'GET') { res.statusCode = 405; res.end('{}'); return; }
        const names = {
          'he-jiawei':'何嘉伟', 'yuan-xiaoman':'徐小曼', liu:'柳智敏',
          'chen-nian':'陈年', 'xia-xia':'夏夏', 'zhou-chef':'赵一帆',
        } as const;
        const requested = new URL(req.url || '/', 'http://127.0.0.1').searchParams.getAll('characterId');
        if (requested.length && (requested.length !== 1 || !Object.hasOwn(names, requested[0]))) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok:false, pid:process.pid, version:npcSkillVersion, error:'IDENTITY_UNKNOWN' }));
          return;
        }
        try {
          const temporal = timeRules(root);
          if (!temporal.trim()) throw Error('通用时间规则为空');
          const groupSources = ['SKILL.md', 'references/current-feedback-20261007.md'].map(path => ({
            path: 'npc-skills/skills/zhiyu-group-dialogue/' + path,
            sha256: createHash('sha256').update(readFileSync(join(root, 'npc-skills/skills/zhiyu-group-dialogue', path))).digest('hex'),
          }));
          const connected = new Set(['xia-xia', 'yuan-xiaoman', 'liu', 'chen-nian', 'he-jiawei', 'zhou-chef']);
          const characters = Object.entries(names).filter(([id]) => !requested.length || id === requested[0]).map(([id, name]) => {
            const loaded = loadDialogueSkill(root, '你是' + name)!;
            return {
              characterId:id, backendConnected:connected.has(id),
              skillVersion:loaded.metadata.skillVersion, rulesHash:loaded.metadata.rulesHash,
              outputPolicy:{companionNaturalDialogueOnly:!allowsCharacterChoice(id),choiceMessages:allowsCharacterChoice(id)},
              momentRulesHash:createHash('sha256').update(loadMomentRules(root,id)).digest('hex'),
              momentInteractionRulesHash:createHash('sha256').update(loadMomentRules(root,id,'interaction')).digest('hex'),
              sources:loaded.metadata.sources.map(({path,sha256,selectedHash}) => ({path,sha256,selectedHash})),
            };
          });
          res.end(JSON.stringify({ok:true, pid:process.pid, version:npcSkillVersion,imageGeneration:imageGenerationRuntime(),
            mollyVersion:mollySkillVersion, checkedAt:new Date().toISOString(),
            groupDialogue:{participationVersion:groupParticipationVersion,sources:groupSources},
            taskExpiry:{version:PROFESSIONAL_TASK_EXPIRY_VERSION,timeZone:'Asia/Shanghai',rule:'day-ended-skips-unfinished; history-and-future-retained'},
            professionalTaskSession:{version:PROFESSIONAL_TASK_SESSION_VERSION,startAction:'task_session_start',startSupported:isProfessionalTaskMutation('task_session_start'),
              completeVersion:PROFESSIONAL_TASK_SESSION_COMPLETE_VERSION,completeAction:'task_session_complete',completeSupported:isProfessionalTaskMutation('task_session_complete')},
            timeRulesHash:createHash('sha256').update(temporal).digest('hex'), characters}));
        } catch (error) {
          res.statusCode = 503;
          res.end(JSON.stringify({ok:false, pid:process.pid, version:npcSkillVersion,
            error:(error as Error).message}));
        }
      });
    },
  };
}
