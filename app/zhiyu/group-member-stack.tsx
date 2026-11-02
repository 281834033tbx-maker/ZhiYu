'use client';

import {useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import type {GroupMember} from '../../lib/npc/group-chat';
import './group-member-stack.css';

type Props = {
  members: GroupMember[];
  displayNames: Map<string, string>;
  renderFace: (member: GroupMember) => ReactNode;
  addAction: ReactNode;
};

const faceSize = 46;
const rowStep = 78;
const minimumCellWidth = 40;
const minimumGap = 4;

export default function GroupMemberStack({members, displayNames, renderFace, addAction}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [reserved, setReserved] = useState(false);
  const [width, setWidth] = useState(276);
  const container = useRef<HTMLDivElement>(null);
  const listId = useId();
  const extra = Math.max(0, members.length - 4);
  const compactCount = Math.min(members.length, 4) + (extra ? 1 : 0);
  // Keep four circular faces as the drawer changes width.
  // Keep four columns with slightly smaller faces even when a scrollbar takes room.
  const columns = Math.max(1, Math.min(4, Math.floor((width + minimumGap) / (minimumCellWidth + minimumGap))));
  const columnGap = Math.max(minimumGap, Math.min(10, (width - columns * faceSize) / Math.max(1, columns - 1)));
  const cellWidth = Math.max(1, (width - (columns - 1) * columnGap) / columns);
  const circleSize = Math.max(1, Math.min(faceSize, cellWidth, width / (1 + Math.max(0, compactCount - 1) * 2 / 3)));
  const overlapStep = circleSize * 2 / 3;
  const compactWidth = Math.max(0, compactCount - 1) * overlapStep + circleSize;
  const collapsedHeight = rowStep + 74;
  const memberRows = Math.ceil(members.length / columns);
  const expandedHeight = (memberRows + 1) * rowStep - 4;
  const lastDelay = Math.min(members.length, 8) * 35;

  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(entries => {
      const next = entries[0]?.contentRect.width;
      if (next) setWidth(next);
    });
    setWidth(node.clientWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Keep room for the returning faces until their transform finishes. A quick
  // second click cancels this cleanup, so reversed animations never queue up.
  useEffect(() => {
    if (expanded || !reserved) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => setReserved(false), reduced ? 0 : 280 + lastDelay);
    return () => window.clearTimeout(timer);
  }, [expanded, reserved, lastDelay]);

  function position(index: number, isAdd = false): CSSProperties {
    const collapsedIndex = Math.min(index, 4);
    const x = (expanded ? (isAdd ? 0 : index % columns * (cellWidth + columnGap)) : (isAdd ? 0 : collapsedIndex * overlapStep)) - (cellWidth - circleSize) / 2;
    const y = isAdd ? (expanded ? memberRows : 1) * rowStep : expanded ? Math.floor(index / columns) * rowStep : 0;
    return {
      width: cellWidth,
      transform: `translate3d(${x}px, ${y}px, 0)`,
      zIndex: isAdd ? members.length + 2 : index + 1,
      '--member-delay': `${Math.min(index, 8) * 35}ms`,
    } as CSSProperties;
  }

  return <div ref={container} className={`zy-group-member-stack ${expanded ? 'is-expanded' : ''}`} style={{height: reserved ? Math.max(expandedHeight, collapsedHeight) : collapsedHeight, '--stack-face-size': `${circleSize}px`} as CSSProperties}>
    <button type="button" className="zy-group-member-stack-toggle" style={{width: expanded ? '100%' : compactWidth, height: expanded ? memberRows * rowStep - 4 : circleSize}} aria-expanded={expanded} aria-controls={listId} aria-label={`${expanded ? '收起' : '展开'}群成员，共${members.length}人${expanded ? `：${members.map(member => displayNames.get(member.id) || member.name).join('、')}` : ''}`} title={expanded ? '点击收起群成员' : '点击展开群成员'} onClick={() => {if (!expanded) setReserved(true); setExpanded(value => !value);}}>
      <span id={listId} className="zy-group-member-stack-list">
        {members.map((member, index) => {
          const name = displayNames.get(member.id) || member.name;
          return <span key={member.id} className={`zy-group-member-stack-item ${index > 3 ? 'is-overflow' : ''}`} style={position(index)} aria-hidden={!expanded && index > 3}>
            <span className="zy-group-drawer-member-face">{renderFace(member)}</span>
            <span className="zy-group-member-stack-name" title={name} aria-hidden={!expanded}>{name}</span>
          </span>;
        })}
        {extra > 0 && <span className="zy-group-member-stack-item zy-group-member-stack-count" style={{...position(4), zIndex: members.length + 1}} aria-hidden={expanded}><span className="zy-group-drawer-member-face">+{extra}</span></span>}
      </span>
    </button>
    <div className="zy-group-member-stack-add" style={position(members.length, true)}>{addAction}</div>
  </div>;
}
