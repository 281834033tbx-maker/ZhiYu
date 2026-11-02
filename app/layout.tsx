import type { Metadata } from 'next';
import './globals.css';
import ApplicationShell from './zhiyu/application-shell';
import { ThemeProvider } from './zhiyu/theme';
import { THEME_BOOTSTRAP } from './zhiyu/theme-config';
import { FONT_SIZE_BOOTSTRAP } from './zhiyu/font-config';
import { FontSizeSync } from './zhiyu/font-size';
import './zhiyu/theme.css';
import './zhiyu/font-size.css';
// Shared appearance layers preserve component geometry and photo profile cards.
import './zhiyu/theme-surfaces.css';
import './zhiyu/theme-glass.css';
import './zhiyu/theme-frosted.css';
import './zhiyu/mobile.css';

export const metadata: Metadata = {
  title: '智域 · AI 社交客户端',
  description: '智域桌面版：聊天、联系人与好友动态。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP + FONT_SIZE_BOOTSTRAP + ";if(location.pathname==='/mobile'&&window.zhiyuDesktop?.mobilePreview)document.documentElement.dataset.zyMobileNative='true';" }}/></head>
      <body><ThemeProvider><ApplicationShell>{children}</ApplicationShell><FontSizeSync/></ThemeProvider></body>
    </html>
  );
}
