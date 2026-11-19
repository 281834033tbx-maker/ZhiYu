'use client';

import ChatImage from './chat-image';
import {TEAM_CARD_IMAGE,TEAM_CARD_LABEL} from '../../lib/npc/team-card';
import './team-card.css';

/** Temporary bundled artwork; it does not claim to be the finished poster. */
export default function TeamCard({messageId}:{messageId?:string}) {
  return <figure className="xx-media team-card" data-team-card="temporary" data-team-card-message={messageId}>
    <ChatImage messageId={messageId} src={TEAM_CARD_IMAGE} alt={TEAM_CARD_LABEL}/>
    <figcaption className="xx-bubble xx-media-caption">{TEAM_CARD_LABEL}</figcaption>
  </figure>;
}
