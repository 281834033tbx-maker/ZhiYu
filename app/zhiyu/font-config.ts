export const FONT_SIZE_STORAGE_KEY = 'zhiyu-font-size-v1';
export type FontSize = 'small' | 'medium' | 'large';
export const FONT_SIZE_BOOTSTRAP = `(function(){try{var s=localStorage.getItem('${FONT_SIZE_STORAGE_KEY}');document.documentElement.dataset.zyFontSize=s==='small'||s==='large'?s:'medium';}catch(e){document.documentElement.dataset.zyFontSize='medium';}})();`;
