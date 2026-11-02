'use client';

import type { CSSProperties, ReactNode } from 'react';
import './rail-navigation.css';

export default function RailNavigation({ activeIndex, children }: { activeIndex: number; children: ReactNode }) {
  return <div className="zy-nav-items zy-sliding-navigation" style={{ '--zy-nav-index': activeIndex } as CSSProperties}>
    <span className="zy-nav-highlight" aria-hidden="true"/>
    {children}
  </div>;
}
