'use client';

import {useEffect, useState, type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import {BatteryFull, Signal, Wifi} from 'lucide-react';
import AuthGate from './auth-gate';

function PhoneFrame({children}: {children: ReactNode}) {
  const [clock, setClock] = useState('--:--');
  useEffect(() => {
    const update = () => setClock(new Intl.DateTimeFormat('zh-CN', {hour:'2-digit', minute:'2-digit', hour12:false}).format(new Date()));
    update();
    const timer = setInterval(update, 15_000);
    return () => clearInterval(timer);
  }, []);
  return <div className="zy-phone-preview">
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
  const mobile = usePathname() === '/mobile';
  const protectedContent = <AuthGate>{children}</AuthGate>;
  return mobile ? <PhoneFrame>{protectedContent}</PhoneFrame> : protectedContent;
}
