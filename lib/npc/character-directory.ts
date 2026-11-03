import chenCard from '../../npc-skills/skills/zhiyu-dialogue/npcs/chen-nian/profile.json';
import liuCard from '../../npc-skills/skills/zhiyu-dialogue/npcs/liu/profile.json';
import chefCard from '../../npc-skills/skills/zhiyu-dialogue/npcs/zhou-chef/profile.json';
import yuanCard from '../../npc-skills/skills/zhiyu-dialogue/npcs/yuan-xiaoman/profile.json';
import xiaCard from '../../npc-skills/skills/zhiyu-dialogue/npcs/xia-xia/profile.json';
import heCard from '../../npc-skills/skills/zhiyu-dialogue/npcs/he-jiawei/profile.json';

/** Public persona facts are projected from the same user-authored cards as the
 * dialogue loader. Application IDs, existing assets and service bindings stay
 * separate, so dialogue claims cannot change routes or media. */
export const publicCharacterDirectoryVersion='2026-11-02-v3';
export type CharacterService='cooking'|'nutrition'|'fitness'|'companionship';
export type PublicCharacter={
  id:string;name:string;realName:string;aliases:string[];age:number|null;
  gender:'男'|'女'|null;origin:string|null;occupation:string;
  role:'professional'|'companion';responsibility:string;professionalTitle:string|null;
  services:CharacterService[];personality:string;tags:string[];avatar:string;
  enabled:boolean;chatEndpoint:string;source:string;internalSource:string;typingSpeed:number;
};
type PublicCard={
  id:string;name:string;realName?:string;aliases?:string[];mode:string;traits:string[];title?:string;
  identity:{job:string;oneLine:string;age?:number;hometown?:string};
  knowledgeScope?:{decide?:string[]};typingSpeed?:number;
};
type ExistingBinding=Pick<PublicCharacter,'age'|'gender'|'origin'|'avatar'|'services'|'enabled'|'chatEndpoint'>;
const bindings:Record<string,ExistingBinding>={
  'chen-nian':{age:27,gender:'男',origin:'黑龙江',avatar:'/npc/chen-nian/avatar-20260926.png',services:['fitness'],enabled:true,chatEndpoint:'/api/npc/chen-nian'},
  liu:{age:28,gender:'女',origin:'上海',avatar:'/stitch/6ee1d45916762d31.jpg',services:['nutrition'],enabled:true,chatEndpoint:'/api/npc/liu'},
  'zhou-chef':{age:32,gender:'男',origin:'河北',avatar:'/desktop-npc/scenes/zhou-chef-night-sofa-20261005-v1.png',services:['cooking'],enabled:true,chatEndpoint:'/api/npc/zhou-chef'},
  'yuan-xiaoman':{age:26,gender:'女',origin:'湖南',avatar:'/npc/yuan-xiaoman/avatar.png',services:['companionship'],enabled:true,chatEndpoint:'/api/npc/yuan-xiaoman'},
  'xia-xia':{age:23,gender:'女',origin:null,avatar:'/npc/xia-xia/avatar.png',services:['companionship'],enabled:true,chatEndpoint:'/api/npc/xia-xia'},
  'he-jiawei':{age:28,gender:'男',origin:'福建',avatar:'/desktop-npc/scenes/he-jiawei-20260926.png',services:['companionship'],enabled:true,chatEndpoint:'/api/npc/he-jiawei'},
};

const cards:PublicCard[]=[chenCard,liuCard,chefCard,yuanCard,xiaCard,heCard];
export const characterDirectory:PublicCharacter[]=cards.map(card=>{
  const binding=bindings[card.id];
  if(!binding||!['companion','professional'].includes(card.mode))throw new Error('公共人物卡与应用绑定不一致：'+card.id);
  const responsibility=card.knowledgeScope?.decide?.length?card.knowledgeScope.decide.join('、'):card.identity.job;
  return {
    ...binding,id:card.id,name:card.name,realName:card.realName||card.name,
    aliases:[...new Set(card.aliases||[])],
    age:typeof card.identity.age==='number'?card.identity.age:binding.age,
    origin:card.identity.hometown||binding.origin,
    occupation:card.identity.job,role:card.mode as PublicCharacter['role'],responsibility,
    professionalTitle:card.mode==='professional'?card.title||null:null,
    personality:card.traits.join('、'),
    tags:[...new Set([...card.traits,...(card.knowledgeScope?.decide||[]),card.title||'',card.identity.oneLine].filter(Boolean))],
    source:'molly_intro',typingSpeed:card.typingSpeed||1,
    internalSource:`npc-skills/skills/zhiyu-dialogue/npcs/${card.id}/profile.json:user_required-20261102`,
  };
});

export const enabledCharacterDirectory=()=>characterDirectory.filter(person=>person.enabled&&!!person.chatEndpoint);
export const companionDirectory=()=>enabledCharacterDirectory().filter(person=>person.role==='companion');
export const getCharacter=(id:string)=>enabledCharacterDirectory().find(person=>person.id===id);

/** Compatibility projection; no second manually maintained NPC roster. */
export const publicGroupDirectory=()=>[
  {id:'molly',name:'Molly',avatar:'/stitch/molly-avatar-v2.png'},
  ...enabledCharacterDirectory().map(({id,name,avatar})=>({id,name,avatar})),
];
