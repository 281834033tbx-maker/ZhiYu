import { publicGroupDirectory } from './character-directory';
import type { assets, Part } from './contracts';

/** IDs are requests; media URLs and transcripts are always derived by the server. */
export type GroupSendMedia = { imageId?: string; audioId?: string; assetId?: keyof typeof assets };
export type GroupMediaPart = Extract<Part, {type:'upload'|'voice'}>
  | (Omit<Extract<Part, {type:'photo'|'sticker'}>, 'type'> & {type:'sticker'});

/** Group conversations are separate from every member's private conversation. */
export type GroupMember = {
  id: string;
  name: string;
  avatar?: string;
  role: 'user' | 'admin' | 'npc';
  joinedAt: string;
  order: number;
};

export type GroupMessageQuote = {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  type: 'text' | 'image' | 'sticker' | 'voice' | 'event';
  mentionIds?: string[];
};

export type GroupMessage = {
  id: string;
  senderId: string;
  senderName: string;
  text?: string;
  caption?: string;
  type: 'text' | 'image' | 'sticker' | 'voice' | 'event';
  /** Canonical, owner-validated user media. Existing text-only history stays unchanged. */
  part?: GroupMediaPart;
  at: string;
  mentionIds?: string[];
  requestId?: string;
  replyTo?: string;
  /** Server-owned excerpt of a visible message in this group, never client-authored. */
  quote?: GroupMessageQuote;
  event?: {
    kind: 'plan-confirmed' | 'reminder-confirmed' | 'reminder-paused' | 'reminder-resumed' | 'reminder-cancelled';
    planId?: string;
    reminderId?: string;
  };
};

export type GroupPlanDay = { date: string; label: string; breakfast: string; lunch: string; dinner: string };
export type GroupShoppingItem = { name: string; required: string; available: string; toBuy: string };
export type GroupPlan = {
  id: string;
  status: 'draft' | 'confirmed';
  days: GroupPlanDay[];
  shopping: GroupShoppingItem[];
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  confirmationMessageId?: string;
};
export type GroupReminder = {
  id: string;
  meal: 'breakfast' | 'lunch' | 'dinner';
  time: string;
  timezone: 'Asia/Shanghai';
  startDate: string;
  endDate: string;
  status: 'proposed' | 'active' | 'paused' | 'cancelled';
  confirmationMessageId?: string;
  lastOccurrence?: string;
};

export type GroupChat = {
  id: string;
  name: string;
  goal: string;
  sourceCharacterId: string;
  createdAt: string;
  updatedAt: string;
  createdBy: 'molly';
  chatEnabled: boolean;
  members: GroupMember[];
  messages: GroupMessage[];
  namingSource: 'molly-model';
  pending?: boolean;
  error?: string;
  plan?: GroupPlan;
  reminders?: GroupReminder[];
  /** Display-only label; it does not change the task goal or dialogue Skills. */
  purpose?: string;
  pinned?: boolean;
  /** Retains historical identity and join order for former @ mentions. */
  formerMembers?: GroupMember[];
  announcement?: string;
  muted?: boolean;
  clearedAt?: string;
  leftAt?: string;
};

export type GroupCreateInput = {
  requestId: string;
  sourceCharacterId: string;
  goal: string;
  memberIds: string[];
  consent?: boolean;
  self: { name: string; avatar?: string };
};

export type GroupRenameInput = { groupId: string; name: string };
export type GroupSettingsInput = { groupId: string; purpose?: string; pinned?: boolean; announcement?: string; muted?: boolean; requestId: string };
export type GroupMembersInput = { groupId: string; addIds: string[]; removeIds: string[]; requestId: string };
export type GroupClearInput = { groupId: string; requestId: string };
export type GroupExitInput = { groupId: string; requestId: string };

/** Application-owned public identity directory. No private states or role Skills. */
export const groupNpcCatalog = publicGroupDirectory();

export function groupAvatarMembers(group: Pick<GroupChat, 'members'>): GroupMember[] {
  return [...group.members].sort((a, b) => a.order - b.order || a.joinedAt.localeCompare(b.joinedAt)).slice(0, 4);
}

export function groupChatPreview(group: Pick<GroupChat, 'messages'>): string {
  const message = group.messages.at(-1);
  if (!message) return '群聊已建立';
  const content = message.text?.trim() || ({ text: '', image: '[图片]', sticker: '[动画表情]', voice: '[语音]', event: '更新了群任务' }[message.type]);
  return `${message.senderName}：${content}`;
}
