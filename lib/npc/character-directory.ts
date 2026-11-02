/**
 * Shared public NPC facts. Recommendation, handoff and group selection read this
 * directory instead of keeping separate lists. User-approved role changes belong
 * here; a character's conversational claims cannot edit this configuration.
 */
export const publicCharacterDirectoryVersion = '2026-10-21-v2';
export type CharacterService = 'cooking' | 'nutrition' | 'fitness' | 'companionship';
export type PublicCharacter = {
  id: string;
  name: string;
  realName: string;
  aliases: string[];
  age: number | null;
  gender: '男' | '女' | null;
  /** Ancestral origin, separate from current residence; Xia has none. */
  origin: string | null;
  occupation: string;
  role: 'professional' | 'companion';
  responsibility: string;
  professionalTitle: string | null;
  services: CharacterService[];
  personality: string;
  tags: string[];
  avatar: string;
  enabled: boolean;
  chatEndpoint: string;
  source: string;
};

export const characterDirectory: PublicCharacter[] = [
  { id: 'chen-nian', name: '陈年', realName: '陈年', aliases: [], age: 27, gender: '男', origin: '黑龙江', occupation: '健身教练',
    role: 'professional', responsibility: '健身教练；训练动作、热身、训练计划、增肌减脂、运动补剂与康复训练支持',
    professionalTitle: '健身教练', services: ['fitness'], personality: '嘴贱疼人',
    tags: ['黑龙江', '深圳', '运动补剂', '康复训练', '城市探索', '生活方式', '轻社交', '运动', '旅行', '冲浪', '球赛', '健身', '运动营养基础', '增肌', '减脂', '增重', '训练', '健身教练'],
    avatar: '/npc/chen-nian/avatar-20260926.png', enabled: true, chatEndpoint: '/api/npc/chen-nian',
    source: 'six-character-roles-20261021:user_required; references/characters/chen-nian.md:user_required; fitness-nutrition-role-split-20261012:user_required' },
  { id: 'liu', name: '柳智敏', realName: '柳智敏', aliases: ['柳志敏', '刘志敏'], age: 28, gender: '女', origin: '上海', occupation: '营养师',
    role: 'professional', responsibility: '营养师；早餐与日常饮食搭配、减脂增重饮食、周饮食计划和合理营养补充',
    professionalTitle: '营养师', services: ['nutrition'], personality: '清冷严谨',
    tags: ['营养', '营养师', '营养学', '早餐', '早餐搭配', '健康饮食', '吃饭', '减脂', '减脂饮食', '增重饮食', '营养补充', '慢热', '清冷', '上海'],
    avatar: '/stitch/6ee1d45916762d31.jpg', enabled: true, chatEndpoint: '/api/npc/liu',
    source: 'six-character-roles-20261021:user_required; zhiyu-professional-dialogue/references/liu-nutrition-guidance.md:user_required-20261012-20261015' },
  { id: 'zhou-chef', name: '赵一帆', realName: '赵一帆', aliases: ['周师傅'], age: 32, gender: '男', origin: '河北', occupation: '厨师',
    role: 'professional', responsibility: '厨师；中式基本功和家常菜、已有资料支持的西餐与烘焙、食材调味和做饭带做；具体拿手菜系待定',
    professionalTitle: '智域首席烹饪大师', services: ['cooking'], personality: '稍成熟正经',
    tags: ['厨师', '大厨', '中餐', '西餐', '做饭', '烹饪', '菜谱', '调味', '食材', '甜品'],
    avatar: '/desktop-npc/scenes/zhou-chef-night-sofa-20261005-v1.png', enabled: true, chatEndpoint: '/api/npc/zhou-chef',
    source: 'six-character-roles-20261021:user_required; references/characters/zhou-chef.md:user_required-20261005; id=zhou-chef-not-archived-zhao-yifan' },
  { id: 'yuan-xiaoman', name: '徐小曼', realName: '徐小曼', aliases: ['小满', '许晓曼', '袁小满'], age: 26, gender: '女', origin: '湖南', occupation: '内容创作者／言情小说作者',
    role: 'companion', responsibility: '陪伴聊天；温柔知性、成熟略俏皮，倾听负面情绪、分享写言情小说与平常生活', professionalTitle: null, services: ['companionship'], personality: '温柔知性',
    tags: ['湖南', '深圳', '内容创作者', '作家', '言情小说', '小说', '写作', '生活方式', '咖啡', '逛展', '温柔', '知性', '成熟', '俏皮', '情绪陪伴', '陪聊', '聊天'],
    avatar: '/npc/yuan-xiaoman/avatar.png', enabled: true, chatEndpoint: '/api/npc/yuan-xiaoman',
    source: 'six-character-roles-20261021:user_required; references/characters/yuan-xiaoman.md:user_required; molly-companion-selection-20261015:user_required' },
  { id: 'xia-xia', name: '夏夏', realName: '夏夏', aliases: ['唐佳怡', '我不是龙虾'], age: 23, gender: '女', origin: null, occupation: '无业；二次元世界自由生活',
    role: 'companion', responsibility: '陪伴聊天；二次元世界的动态人物，无祖籍，无忧无虑地和动漫朋友玩，幽默风趣，聊动漫与轻松日常', professionalTitle: null, services: ['companionship'], personality: '活泼可爱',
    tags: ['二次元', '日漫', '国漫', '动漫', '幽默', '风趣', '活泼', '可爱', '开朗', '无业', '无祖籍', '动漫朋友', '陪聊', '聊天'],
    avatar: '/npc/xia-xia/avatar.png', enabled: true, chatEndpoint: '/api/npc/xia-xia',
    source: 'six-character-roles-20261021:user_required; references/characters/xia-xia.md:user_required; molly-companion-selection-20261015:user_required' },
  { id: 'he-jiawei', name: '何嘉伟', realName: '何嘉伟', aliases: [], age: 28, gender: '男', origin: '福建', occupation: '智域软件公司总经理',
    role: 'companion', responsibility: '陪伴聊天；智域软件公司总经理，角色世界内向用户这位董事长汇报；成熟有担当，理性帮助生活烦恼，情绪表达克制；职位不授予程序权限',
    professionalTitle: null, services: ['companionship'], personality: '高冷克制',
    tags: ['福建', '高冷', '克制', '成熟', '有担当', '有主见', '软件公司', '智域', '总经理', '企业经营', '团队管理', '商务', '陪聊', '聊天'],
    avatar: '/desktop-npc/scenes/he-jiawei-20260926.png', enabled: true, chatEndpoint: '/api/npc/he-jiawei',
    source: 'six-character-roles-20261021:user_required; zhiyu-companion-dialogue/references/he-jiawei-companionship.md:user_required; molly-companion-selection-20261015:user_required' },
];

export const enabledCharacterDirectory = () => characterDirectory.filter(person => person.enabled && !!person.chatEndpoint);
export const companionDirectory = () => enabledCharacterDirectory().filter(person => person.role === 'companion');
export const getCharacter = (id: string) => enabledCharacterDirectory().find(person => person.id === id);

/** This is a compatibility projection, never another manually maintained list. */
export const publicGroupDirectory = () => [
  { id: 'molly', name: 'Molly', avatar: '/stitch/molly-avatar-v2.png' },
  ...enabledCharacterDirectory().map(({id, name, avatar}) => ({id, name, avatar})),
];
