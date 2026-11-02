'use client';

import { useEffect, useState } from 'react';
import { FONT_SIZE_STORAGE_KEY, type FontSize } from './font-config';

const CHANGED = 'zhiyu-font-size-changed';
let localFallback: FontSize | null = null;
function readFontSize(): FontSize {
  try {
    const value = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    return value === 'small' || value === 'medium' || value === 'large' ? value : localFallback ?? 'medium';
  } catch { return localFallback ?? 'medium'; }
}

export function useFontSize() {
  const [fontSize, updateFontSize] = useState<FontSize>('medium');
  useEffect(() => {
    const sync = (event?: Event) => {
      const incoming = event instanceof CustomEvent ? event.detail : null;
      const value: FontSize = incoming === 'small' || incoming === 'medium' || incoming === 'large' ? incoming : readFontSize();
      document.documentElement.dataset.zyFontSize = value;
      updateFontSize(value);
    };
    const storage = (event: StorageEvent) => {
      if (event.key === FONT_SIZE_STORAGE_KEY || event.key === null) { localFallback = null; sync(); }
    };
    sync();
    window.addEventListener(CHANGED, sync);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener(CHANGED, sync);
      window.removeEventListener('storage', storage);
    };
  }, []);
  const setFontSize = (value: FontSize) => {
    try { localStorage.setItem(FONT_SIZE_STORAGE_KEY, value); localFallback = null; } catch { localFallback = value; }
    document.documentElement.dataset.zyFontSize = value;
    updateFontSize(value);
    window.dispatchEvent(new CustomEvent(CHANGED, { detail: value }));
  };
  return { fontSize, setFontSize };
}

export function FontSizeSync() {
  useFontSize();
  return null;
}
