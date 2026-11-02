import type {DialoguePurpose} from '../../lib/npc/dialogue-purpose';
import './npc-type-badge.css';

export default function NpcTypeBadge({purpose,professionalTitle}:{purpose?:DialoguePurpose;professionalTitle?:string}) {
 if(!purpose)return null;
 const professional=purpose==='professional';
 const label=professional?'专业型 NPC':'智友';
 const tooltip=professional?(professionalTitle||label):label;
 // A letter enclosed by a ring is one graphical identity mark.
 // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
 return <span className={`zy-npc-type-badge is-${purpose}`} role="img" aria-label={professional&&professionalTitle?`${label}，${professionalTitle}`:label} title="" data-tooltip={tooltip}>
  <span aria-hidden="true">{professional?'P':'A'}</span>
 </span>;
}
