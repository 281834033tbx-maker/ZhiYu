import type { ContactLife } from './contact-life';
import type { CoreRelationshipValues } from './relationship-values';
import type { ProfessionalTask } from './professional-task';
import type { ChoicePart } from './choice-chat';
import type { TaskPageContext } from './task-page-context';
import type {SecretaryReport,CharacterStatus} from './experience';
export const labels = {
  familiarity: '熟悉',
  affection: '好感',
  trust: '信任',
  comfort: '舒适',
  understood: '被理解',
  cooperation: '合作',
  attraction: '恋爱吸引',
  love: '爱意',
  openness: '恋爱开放',
  recognition: '认可',
  safety: '关系安全',
  mood: '心情',
  energy: '精力',
  sharing: '分享欲',
  exclusivity: '排他倾向',
  jealousy: '嫉妒',
  dissatisfaction: '不满',
  stress: '压力',
  busy: '忙碌',
} as const;
export type ValueKey = keyof typeof labels;
export const assets = {
  cow: {
    url: '/npc/xia-xia/cow-user-reference.png',
    kind: 'sticker',
    label: '草地奶牛 · 静态表情',
    provenance: 'user_provided_style_reference',
    description: '绿色草地，黑白奶牛，夸张眉眼、粉红腮红和拟人嘴部',
    animated: false,
  },
  cake: {
    url: '/npc/xia-xia/cake-night-v1.png',
    kind: 'photo',
    label: '虚构场景素材 · AI 生成',
    provenance: 'assistant_proposed',
    description: '暖光夜晚，吃了一部分的草莓奶油蛋糕、外卖纸盒、叉子和碎屑',
    animated: false,
  },
  cowThinking: {
    url: '/npc/xia-xia/cow-thinking.jpg',
    kind: 'sticker',
    label: '奶牛思考 · 静态表情',
    provenance: 'assistant_selected_candidate',
    description:
      '草地奶牛皱眉抬眼，手指放在下巴上，适合疑惑、思考、轻微无语；不是蛋糕或生活照片',
    animated: false,
  },
  cowMagic: {
    url: '/npc/xia-xia/cow-magic.jpg',
    kind: 'sticker',
    label: '奶牛施法 · 静态表情',
    provenance: 'assistant_selected_candidate',
    description:
      '草地奶牛手放额头，配字阿玛特拉哞！；熟人轻松玩梗时用，不用于认真倾诉或受伤安慰',
    animated: false,
  },
  catHelp: {
    url: '/npc/xia-xia/cat-help.jpg',
    kind: 'sticker',
    label: 'help咪 · 静态表情',
    provenance: 'assistant_selected_candidate',
    description:
      '橘白猫睁大眼睛，配字help咪；用于轻松吐槽游戏翻车、小小犯难，不替代真实求助或严肃安慰',
    animated: false,
  },
  catNotOk: {
    url: '/npc/xia-xia/cat-not-ok.jpg',
    kind: 'sticker',
    label: '这很不OK · 静态表情',
    provenance: 'assistant_selected_candidate',
    description:
      '白猫垮脸，配字这很不ok；熟人间小小不满或无语，不在严重争执时玩梗',
    animated: false,
  },
  chenWorkdesk: {
    url: '/npc/chen-nian/share-workdesk-v1.png',
    kind: 'photo',
    label: '陈年工作室随手拍',
    provenance: 'assistant_proposed_for_user_required_sharing_rule',
    description:
      '工作室乱桌、电脑、外卖与冰咖啡；构图歪、前景遮挡、局部失焦的半失败手机随手拍',
    animated: false,
  },
  chenRainySelfie: {
    url: '/npc/chen-nian/share-rainy-selfie-v2.png',
    kind: 'photo',
    label: '陈年雨夜直男自拍',
    provenance: 'assistant_proposed_for_user_required_sharing_rule',
    description:
      '深圳雨夜路边摊的直男视角自拍；陈年保持硬朗骨相与强少年感，手指遮角、主体偏斜、背景运动模糊且灯光过曝',
    animated: false,
  },
} as const;
export type GeneratedPhoto = {type:'generated_photo'; jobId:string; prompt:string; caption:string; withCharacter:boolean;
  /** Host-confirmed stable participant IDs; never accepted from a model's scene request. */
  referenceCharacters?:string[];
  status:'pending'|'generating'|'ready'|'failed'; url?:string; error?:string; attempts:number; startedAt?:number};
export type Part = (
  | {type:'secretary_report';report:SecretaryReport;text:string}
  | {type:'city_request';text:string}
  | ChoicePart
  | { type: 'professional_task'; taskId: string }
  | {type: 'voice'; text:string; url?:string; status:'pending'|'ready'|'failed'; synthetic:boolean; error?:string; durationSeconds?:number}
  | GeneratedPhoto
  | { type: 'text' | 'emoji'; text: string }
  | { type: 'upload'; url: string; text: string }
  | { type: 'sticker' | 'photo'; assetId: keyof typeof assets; caption?: string }) & {replyTo?: string};
export type ChatMessage = {
  /** Imported local messages retain their original clock and attachments. */
  legacyTime?: string;
  chronologyUnknown?: boolean;
  legacyContent?: { image?: string; audio?: string; audioDurationSeconds?: number; file?: string };
  id: string;
  turnId: string;
  role: 'user' | 'assistant';
  at: string;
  part: Part;
  /** Optional user-selected demo snapshot; never a task-store mutation. */
  taskPageContext?: TaskPageContext;
  origin?: 'chat' | 'call' | 'proactive';
  readAt?: string;
  deliverAt?: number;
  typingAt?:number;
  replyTo?: string;
  recommendations?: {id:string;name:string;avatar:string;detail:string}[];
  /** Application-owned navigation to the existing task view, never model URLs. */
  taskLinks?: {scope:'today'|'all';label:string}[];
  secretaryEvent?: {id:string;kind:'handoff'|'morning'|'task-reminder'|'group'|'opening'|'city-request'|'weekly'|'monthly'|'usage';sourceMessageId?:string;targetId?:string;groupId?:string};
  /** Structured progress events retain their own source; they are never user utterances. */
  professionalTaskHint?: {taskId:string;stepId:string;eventId:string};
};
export type LifeState = {
  queue: string[];
  recentIncoming: number[];
  wakeUntil: number;
  nextWorkReplyAt: number;
  lastUserAt: number;
  nextProactiveAt: number;
  proactiveDay: string;
  proactiveAttempts: number;
  proactiveEnabled: boolean;
  quietUntil: number;
  playerSleepingUntil?: number;
  proactivePolicyVersion?: number;
  retryAt: number;
  lastError: string;
  wakeReason: string;
  typingClients?: Record<string, { until: number; sequence: number }>;
  inputRevision?: number;
};
export type ExpressionPreference = {
  category: 'wording' | 'sticker';
  target: string;
  action: 'avoid' | 'allow';
};
export type Memory = {
  id: string;
  text: string;
  kind: 'user_claim' | 'hypothesis' | 'character_inference';
  evidence: string;
  messageId: string;
  status: 'model_proposed';
  preference?: ExpressionPreference;
};
export type EventProposal = {
  kind: 'ordinary' | 'betrayal' | 'harm' | 'repair' | 'fatigue';
  basis: 'user_claim' | 'hypothesis';
  evidence: string;
  reason: string;
  deltas: Partial<Record<ValueKey, number>>;
  relationship?: 'crisis' | 'repairing' | 'broken_up';
  impression?: string;
  interaction?: 'ready' | 'cooldown';
};
export type Audit = {
  id: string;
  at: string;
  reason: string;
  before: Record<ValueKey, number>;
  after: Record<ValueKey, number>;
  source: string;
  proposal?: EventProposal;
  review?: 'pending' | 'applied' | 'rejected';
};
export type NpcState = {
  contactLife?: ContactLife;
  characterId: 'xia-xia';
  mode: 'test' | 'normal';
  branch: string;
  revision: number;
  values: Record<ValueKey, number>;
  wealth: null;
  relationship: 'lovers' | 'strangers' | 'crisis' | 'repairing' | 'broken_up';
  paused: boolean;
  cooldownUntil: number;
  interaction: 'ready' | 'cooldown';
  config: {
    scoring: 'review' | 'draft-a' | 'draft-b';
    cooldownHours: number;
    provenance: 'assistant_proposed';
  };
  messages: ChatMessage[];
  memories: Memory[];
  audits: Audit[];
  impressions: {
    text: string;
    evidence: string;
    confidence: 'model_proposed';
    at: string;
  }[];
  completed: string[];
  pending: { id: string; since: number } | null;
  life?: LifeState;
};
export type PublicSession = {
  professionalTasks?: ProfessionalTask[];
  revision?: number;
  conversationId?: string;
  messages: ChatMessage[];
  available: boolean;
  pending: boolean;
  debugAllowed: boolean;
  typingAfter?: number;
  typingUntil?:number;
  characterStatus?:CharacterStatus;
  debug?: NpcState;
  deliveryError?: string;
  presence?: 'online' | 'offline' | 'busy';
  moodLabel?: string;
  relationship?: 'lovers' | 'strangers' | 'crisis' | 'repairing' | 'broken_up';
  sharingEligible?: boolean;
  positiveGrowth?: Record<string, number>;
  relationshipValues?: CoreRelationshipValues;
};
