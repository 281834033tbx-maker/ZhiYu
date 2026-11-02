'use client';
/* eslint-disable next/no-img-element */

import type {ChatMessage} from '../../lib/npc/contracts';
import {allPeople} from './data';
import NpcTypeBadge from './npc-type-badge';
import './npc-contact-card.css';

type Recommendation = NonNullable<ChatMessage['recommendations']>[number];

export default function NpcContactCard({candidate, onOpen}: {candidate: Recommendation; onOpen?: (id: string) => void}) {
  const person = allPeople.find(person => person.id === candidate.id);
  const signature = person?.bio || '';
  return <button type="button" className="zy-npc-contact-card" onClick={() => onOpen?.(candidate.id)} aria-label={`个人名片：${candidate.name}${signature?`，${signature}`:''}，点击聊天`}>
    <span className="zy-npc-contact-card-top">
      <img src={candidate.avatar} alt="" />
      <span className="zy-npc-contact-card-copy"><strong><span>{candidate.name}</span><NpcTypeBadge purpose={person?.dialoguePurpose} professionalTitle={person?.professionalProfile?.title||person?.professionalTitle}/></strong>{signature&&<span>{signature}</span>}</span>
    </span>
    <span className="zy-npc-contact-card-footer">个人名片</span>
  </button>;
}
