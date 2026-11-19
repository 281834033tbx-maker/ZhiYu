'use client';

import {useEffect, useState, type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import {BatteryFull, Signal, Wifi} from 'lucide-react';
import AuthGate from './auth-gate';
import {installContinuousCorners} from './continuous-corners';
import BetaActivityTracker from './beta-activity';
import SpringScroll from './spring-scroll';
import MagneticEntry from './magnetic-entry';
import ScrollReveal from './scroll-reveal';
import './scroll-reveal.css';
import './beta-mobile-viewport.css';

function PhoneFrame({children}: {children: ReactNode}) {
  const [clock, setClock] = useState('--:--');
  useEffect(() => {
    const update = () => setClock(new Intl.DateTimeFormat('zh-CN', {hour:'2-digit', minute:'2-digit', hour12:false}).format(new Date()));
    update();
    const timer = setInterval(update, 15_000);
    return () => clearInterval(timer);
  }, []);
  return <div className="zy-phone-preview zy-phone-mobile">
    <div className="zy-phone-shell">
      <div className="zy-phone-screen">
      <div className="zy-phone-status" aria-hidden="true">
        <time>{clock}</time>
        <div className="zy-phone-status-icons"><Signal/><Wifi/><BatteryFull/></div>
      </div>
      <div className="zy-phone-island" aria-hidden="true"/>
      <div className="zy-phone-content">{children}</div>
      <div className="zy-phone-home-indicator" aria-hidden="true"/>
      </div>
    </div>
  </div>;
}

export default function ApplicationShell({children}: {children: ReactNode}) {
  useEffect(()=>installContinuousCorners(document),[]);
  const pathname=usePathname();
  const mobile = pathname === '/mobile';
  if(pathname==='/admin'||pathname?.startsWith('/admin/')||pathname==='/survey-preview')return children;
  const protectedContent = <AuthGate><BetaActivityTracker/><ScrollReveal/>{children}</AuthGate>;
  return <><SpringScroll/><MagneticEntry/>{mobile ? <PhoneFrame>{protectedContent}</PhoneFrame> : protectedContent}</>;
}
