import type { ProfessionalProfile } from './data';
import chenCard from '../../npc-skills/skills/zhiyu-dialogue/npcs/chen-nian/profile.json';
import liuCard from '../../npc-skills/skills/zhiyu-dialogue/npcs/liu/profile.json';
import chefCard from '../../npc-skills/skills/zhiyu-dialogue/npcs/zhou-chef/profile.json';
import chefLegacyAssets from '../../npc-skills/data/zhou-chef-profile.json';

// Display-only character setting, completed under the user's 2026-10-10
// authorization, with current identity and role scope updated on 2026-10-21. These are fictional Zhiyu qualifications, not real-world
// licenses, verified certifications or additions to the runtime Skills.
type FictionalProfessionalProfile = ProfessionalProfile & {
  fictional: true;
  scope: 'zhiyu-fictional-world';
  authoredAt: '2026-10-10' | '2026-10-12' | '2026-10-21' | '2026-11-02';
  provenance: {
    kind: 'user_authorized_fictional_profile_completion';
    roleSources: string[];
    completionScope: string;
  };
};

export const liuNutritionProfile: FictionalProfessionalProfile = {
  "title": liuCard.title,
  "titles": [
    liuCard.title
  ],
  "summary": `${liuCard.identity.job}。${liuCard.identity.oneLine}。`,
  "issuer": "智域营养与健康饮食认证中心",
  "scopeLabel": "智域世界内资质",
  "fictional": true,
  "scope": "zhiyu-fictional-world",
  "authoredAt": "2026-11-02",
  "provenance": {
    "kind": "user_authorized_fictional_profile_completion",
    "roleSources": [
      "npc-skills/skills/zhiyu-dialogue/npcs/liu/profile.json",
      "npc-skills/skills/zhiyu-dialogue/modes/professional.md",
      "output/fitness-nutrition-role-split-20261012/user-requirement.json"
    ],
    "completionScope": "按用户本轮职业调整同步专业资料；资质为原创智域角色设定，不代表现实医学博士、营养认证、执业身份或已验收专业效果。"
  },
  "certificates": [
    {
      "id": "nutrition-balanced-diet",
      "name": "智域营养知识与膳食搭配证书",
      "category": "膳食基础",
      "level": "专家级／智域内部",
      "summary": "解释食物与营养素的基本关系，把知识落实为适合生活场景的均衡搭配。"
    },
    {
      "id": "nutrition-breakfast",
      "name": "智域早餐搭配与便捷饮食证书",
      "category": "早餐搭配",
      "level": "专项级／智域内部",
      "summary": "结合时间、口味与食物来源，安排方便、吃得饱的早餐及替换选择。"
    },
    {
      "id": "nutrition-fat-loss",
      "name": "智域减脂饮食安排证书",
      "category": "目标管理",
      "level": "专项级／智域内部",
      "summary": "按实际目标、吃饭习惯与反馈调整饮食，兼顾健康、饱足和长期执行。"
    },
    {
      "id": "nutrition-intake-review",
      "name": "智域营养摄入评价与份量表达证书",
      "category": "摄入评价",
      "level": "专项级／智域内部",
      "summary": "依据已知摄入与适用资料说明营养需要和份量，保留估算条件，不以自述做医学确诊。"
    },
    {
      "id": "nutrition-food-substitution",
      "name": "智域食物替换与饱足搭配证书",
      "category": "食物替换",
      "level": "专项级／智域内部",
      "summary": "围绕喜好、过敏和忌口提出合适替换，兼顾营养结构、口感与饱足。"
    },
    {
      "id": "nutrition-supplement",
      "name": "智域合理营养补充指导证书",
      "category": "营养补充",
      "level": "专项级／智域内部",
      "summary": "优先梳理食物摄入，说明补充剂的适用条件与限制，避免无依据的个体剂量。"
    },
    {
      "id": "nutrition-eating-habits",
      "name": "智域外食选择与饮食习惯复盘证书",
      "category": "日常饮食",
      "level": "专项级／智域内部",
      "summary": "帮助选择便利店、食堂或外卖餐食，依据真实执行反馈调整吃饭安排。"
    },
    {
      "id": "nutrition-risk-referral",
      "name": "智域营养风险识别与协作规范证书",
      "category": "专业边界",
      "level": "专项级／智域内部",
      "summary": "识别需要现实专业评估的问题，按用户意愿与教练、厨师协作，不代替诊断和处方。"
    }
  ]
};

export const chenFitnessProfile: FictionalProfessionalProfile = {
  title: chenCard.title,
  titles: [chenCard.title],
  summary: `${chenCard.identity.job}。${chenCard.identity.oneLine}。`,
  issuer: '智域健身训练认证中心',
  scopeLabel: '智域世界内资质',
  fictional: true,
  scope: 'zhiyu-fictional-world',
  authoredAt: '2026-11-02',
  provenance: {
    kind: 'user_authorized_fictional_profile_completion',
    roleSources: [
      'npc-skills/skills/zhiyu-dialogue/npcs/chen-nian/profile.json',
      'npc-skills/skills/zhiyu-dialogue/modes/professional.md',
      'output/fitness-nutrition-role-split-20261012/user-requirement.json',
    ],
    completionScope: '按用户本轮授权补齐专业资料展示；新增资质是原创智域角色设定，不增加现实学历、认证或执教履历，不扩展动作观察、实时带练与临床营养能力。',
  },
  certificates: [
    {
      id: 'fitness-coaching',
      name: '智域健身训练指导专家证书',
      category: '综合训练',
      level: '专家级／智域内部',
      summary: '按训练目标、经验、器械和可用时间选择合适安排，说明动作、强度与推进方式。',
    },
    {
      id: 'fitness-movement',
      name: '智域力量动作与热身指导证书',
      category: '动作教学',
      level: '专项级／智域内部',
      summary: '讲清起始姿势、运动方向、幅度与常见错误，区分一般热身和专项热身。',
    },
    {
      id: 'fitness-strength-hypertrophy',
      name: '智域力量与增肌训练方案证书',
      category: '目标训练',
      level: '专项级／智域内部',
      summary: '围绕动作选择、训练量、强度、休息和进阶，安排适合当前阶段的力量训练。',
    },
    {
      id: 'fitness-fat-loss',
      name: '智域减脂训练与日常活动指导证书',
      category: '目标管理',
      level: '专项级／智域内部',
      summary: '协调训练与日常活动，依据真实执行和恢复调整训练，饮食方案与柳智敏协作。',
    },
    {
      id: 'fitness-healthy-weight-gain',
      name: '智域增肌与健康增重训练证书',
      category: '目标管理',
      level: '专项级／智域内部',
      summary: '针对增肌与健康增重目标安排力量训练，按恢复循序进阶，营养安排由柳智敏协作。',
    },
    {
      id: 'fitness-daily-nutrition',
      name: '智域基础运动饮食与专业协作证书',
      category: '运动饮食基础',
      level: '专项级／智域内部',
      summary: '说明与训练直接相关的基础饮食和训练补剂知识，完整餐食、健身餐与日常营养搭配由柳智敏主导。',
    },
    {
      id: 'fitness-periodization-recovery',
      name: '智域训练分化与恢复安排证书',
      category: '训练计划',
      level: '专项级／智域内部',
      summary: '结合每周训练天数、经验与恢复状态安排分化，理清频率、休息和调整条件。',
    },
    {
      id: 'fitness-progress-review',
      name: '智域训练反馈与进度复盘证书',
      category: '方案管理',
      level: '专项级／智域内部',
      summary: '依据实际完成情况、训练感受与变化复盘计划，出现不适时调整或暂停相关动作。',
    },
  ],
};

/** Existing fictional certificate assets stay intact; current public identity
 * and responsibility follow the same new card as the dialogue. */
export const chefCookingProfile:ProfessionalProfile={
  ...chefLegacyAssets.professionalProfile,
  title:chefCard.title,
  titles:[chefCard.title],
  summary:`${chefCard.identity.job}。${chefCard.identity.oneLine}。`,
};
