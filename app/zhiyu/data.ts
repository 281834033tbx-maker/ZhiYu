import assets from './assets.json';
import zhouChefProfile from '../../npc-skills/data/zhou-chef-profile.json';
import { chenFitnessProfile, liuNutritionProfile, chefCookingProfile } from './professional-profiles';
import type { DialoguePurpose } from '../../lib/npc/dialogue-purpose';
import { enabledCharacterDirectory, publicCharacterDirectoryVersion } from '../../lib/npc/character-directory';

export type ProfessionalProfile = {
  title: string;
  titles: string[];
  summary: string;
  issuer: string;
  scopeLabel: string;
  certificates: { id: string; name: string; category: string; level: string; summary: string }[];
};

export const asset = (page: keyof typeof assets, index: number) =>
  assets[page][index].src;
export type Page = 'chat' | 'contacts' | 'tasks' | 'moments' | 'pets';
export type Person = {
  id: string;
  name: string;
  nickname?: string;
  realName?: string;
  aliases?: string[];
  publicDirectoryVersion?: string;
  gender?: 'female' | 'male';
  age?: number | null;
  origin?: string | null;
  occupation?: string;
  source?: string;
  avatar?: string;
  desktopImage?: string;
  professionalProfile?: ProfessionalProfile;
  professionalTitle?: string;
  dialoguePurpose?: DialoguePurpose;
  profileBackground?: string;
  cover?: string;
  coverAlt?: string;
  initial?: string;
  color?: string;
  bio: string;
  account: string;
  region: string;
  added: string;
  online?: boolean;
  presence?: 'online' | 'offline' | 'busy';
  letter: string;
  group?: boolean;
};
export type Message = {
  at?: string;
  audio?: string;
  audioDurationSeconds?: number;
  replyTo?: string;
  id: string;
  mine: boolean;
  text: string;
  time: string;
  image?: string;
  file?: string;
  read?: boolean;
};
export type Comment = { id: string; name: string; text: string; time: string; actorId?:string; replyTo?:string|null; replyToName?:string };
export type Post = {
  createdAt?: string;
  source?: 'npc-moment';
  id: string;
  personId: string;
  time: string;
  text: string;
  location: string;
  images: string[];
  chatScreenshot?: {
    name: string;
    lines: { id: string; role: 'user' | 'assistant'; text: string; at: string }[];
  };
  carousel?: boolean;
  liked: boolean;
  likes?: {actorId:string;name:string}[];
  likeCount?: number;
  saved?: boolean;
  comments: Comment[];
};
export const self: Person = {
  id: 'self',
  name: 'Jayden',
  nickname: 'Jayden',
  avatar: asset('chat', 1),
  bio: '船停在岸边最安全，但这不是造船的目的。',
  account: 'creatorBoxuan',
  region: '上海市 · 上海市',
  added: '',
  online: true,
  letter: 'J',
};
export const molly: Person = {
  id: 'molly', name: 'Molly', nickname: 'Molly', avatar: '/stitch/molly-avatar-v2.png', bio: '您的智能机器人助手（闲聊200）',
  account: 'molly_system_0001', region: '杭州', added: '', letter: 'M',
};
// Public identity handles are separate from internal ids, nicknames and local remarks.
export const isValidAccount = (value: string) => /^[A-Za-z][A-Za-z0-9._-]{5,31}$/.test(value);
// System membership is derived, so old saved lists and newly added chats cannot unpin Molly.
export const withMolly = (ids: string[]) => ['molly', ...new Set(ids.filter(id => id !== 'molly'))];
const peoplePresentation: Person[] = [
  { id: 'chen-nian', name: '陈年', realName: '陈年', nickname: '陈年', gender: 'male',
    professionalProfile: chenFitnessProfile,
    avatar: '/npc/chen-nian/avatar-20260926.png',
    desktopImage: '/desktop-npc/scenes/chen-nian-red-suit-20260926.png',
    bio: '出发永远比向往有意义', account: 'chen-nian', region: '深圳', added: '2026-09-19', letter: 'C' },
  { id: 'he-jiawei', name: '何嘉伟', realName: '何嘉伟', nickname: '何嘉伟', gender: 'male',
    avatar: '/desktop-npc/scenes/he-jiawei-20260926.png', desktopImage: '/desktop-npc/scenes/he-jiawei-20260926.png',
    bio: '', account: 'he_jiawei', region: '成都', added: '2026-09-26', letter: 'H' },
  { id: 'zhou-chef', name: '赵一帆', realName: '赵一帆', nickname: '赵一帆', gender: 'male', color: '#8a745f',
    avatar: zhouChefProfile.visual.scene, desktopImage: zhouChefProfile.visual.scene,
    professionalProfile: chefCookingProfile,
    bio: '把饭做好，把日子过好。', account: 'zhou_chef', region: '广州', added: '2026-10-04', letter: 'Z' },
  { id: 'yuan-xiaoman', cover: '/npc/covers/yuan-xiaoman.png', coverAlt: '海风吹过咖啡馆的窗帘', name: '徐小曼', realName: '徐小曼', nickname: '徐小曼', gender: 'female', avatar: '/npc/yuan-xiaoman/avatar.png',
    desktopImage: '/desktop-npc/scenes/xu-xiaoman-20260926.png',
    bio: '写一点爱情，也认真过自己的日子。', account: 'kitty_0002', region: '深圳', added: '2026-09-17', letter: 'X' },
  {
    id: 'liu',
    cover: '/npc/covers/liu.png',
    coverAlt: '夜色街道与暖色窗光',
    name: '柳智敏',
    realName: '柳智敏',
    nickname: '柳智敏',
    gender: 'female',
    professionalProfile: liuNutritionProfile,
    avatar: asset('chat', 3),
    desktopImage: '/desktop-npc/scenes/liu-zhimin-20260926.png',
    bio: '吃得好，也吃得开心。',
    account: 'zhimin_0003',
    region: '上海',
    added: '2026-08-16',
    online: true,
    letter: 'L',
  },
  {
    id: 'xia-xia', cover: '/npc/covers/xia-xia.png', coverAlt: '阳光草地上的小猫', name: '夏夏', realName: '夏夏', nickname: '夏夏', gender: 'female', avatar: '/npc/xia-xia/avatar.png', desktopImage: '/desktop-npc/scenes/xia-xia-anime-sofa-final-20261021.png', color: '#f18a72',
    bio: '认真吃饭，偶尔发呆。', account: 'xiaxia_0004', region: '二次元世界', added: '2026-09-16', letter: 'T',
  },
];
// Public identity, current responsibility and purpose come from the same
// directory used by Molly, groups and the private dialogue Skill router.
// Visual biography/certificates remain authored presentation, not role routing.
export const people: Person[] = enabledCharacterDirectory().sort((a, b) =>
  peoplePresentation.findIndex(person => person.id === a.id) - peoplePresentation.findIndex(person => person.id === b.id),
).map(character => {
  const presentation = peoplePresentation.find(person => person.id === character.id);
  if (!presentation) throw new Error(`启用人物${character.id}缺少App展示资料`);
  return {
    ...presentation,
    name: character.name,
    realName: character.realName,
    age: character.age,
    origin: character.origin,
    occupation: character.occupation,
    nickname: character.name,
    aliases: [...character.aliases],
    avatar: character.avatar,
    gender: character.gender === '男' ? 'male' : character.gender === '女' ? 'female' : undefined,
    dialoguePurpose: character.role,
    professionalTitle: character.professionalTitle || undefined,
    professionalProfile: character.role === 'professional' && presentation.professionalProfile
      ? {...presentation.professionalProfile, title: character.professionalTitle || presentation.professionalProfile.title}
      : undefined,
    source: character.source,
    publicDirectoryVersion: publicCharacterDirectoryVersion,
  };
});

// Retired contacts keep their identity and historical lookups, separate from the active roster.
export const archivedPeople: Person[] = [
  { id: 'zhao-yifan', name: '赵一帆', realName: '赵一帆', nickname: '赵一帆', gender: 'male',
    avatar: '/desktop-npc/scenes/zhao-yifan-20260926.png', desktopImage: '/desktop-npc/scenes/zhao-yifan-20260926.png',
    bio: '有空就出去走走。', account: 'zhao_yifan', region: '北京', added: '2026-09-26', letter: 'Z' },
];
export const allPeople: Person[] = [...people, ...archivedPeople];
export const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const now = () =>
  '今天 ' +
  new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
export const initialMessages: Record<string, Message[]> = {
  liu: [],
};
export const initialPosts: Post[] = [
  {
    id: 'post-1',
    personId: 'lin',
    time: '今天 15:24',
    text: '今天，收集了一些光的形状。',
    location: '上海 · PRADA 荣宅',
    images: [asset('moments', 4), asset('moments', 5), asset('moments', 6)],
    liked: false,
    comments: [
      {
        id: 'c1',
        name: 'Jayden',
        text: '光束那张太有秩序感了，层次感很赞！',
        time: '10分钟前',
      },
    ],
  },
];
export const previewImages = [10, 11, 12, 13].map((i) => asset('contacts', i));
