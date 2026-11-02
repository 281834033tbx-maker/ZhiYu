'use client';

import { useEffect } from 'react';

// 旧版独立人物窗的历史入口；桌面人物现已并入智域主窗口。
export default function CompanionClient() {
  useEffect(() => { window.location.replace('/'); }, []);
  return <main className="zy-companion" aria-label="返回智域主窗口" />;
}
