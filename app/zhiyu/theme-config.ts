export const THEME_STORAGE_KEY = 'zhiyu-appearance-v1';
export type Theme = 'light' | 'dark';

// Run before first paint so reopening the desktop app does not flash the other theme.
export const THEME_BOOTSTRAP = `(function(){try{if(window.zhiyuDesktop?.platform==='darwin'&&window.zhiyuDesktop.nativeMaterial)document.documentElement.dataset.zyNativeMaterial='macos';var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.zyTheme=t;}catch(e){document.documentElement.dataset.zyTheme='light';}})();`;
