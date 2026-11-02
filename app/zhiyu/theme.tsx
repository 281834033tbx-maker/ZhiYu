'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Check, Moon, Sun } from 'lucide-react';
import { THEME_STORAGE_KEY, type Theme } from './theme-config';
import './theme-motion.css';

export type ThemeOrigin = { x: number; y: number };
type ThemeValue = {
  theme: Theme;
  setTheme: (theme: Theme, origin?: ThemeOrigin) => void;
  toggleTheme: (origin?: ThemeOrigin) => void;
  transitioning: boolean;
};
type ThemeMotion = { transition: ViewTransition; animation?: Animation; timeout?: number };

const ThemeContext = createContext<ThemeValue | null>(null);

function readPreference(): Theme | null | undefined {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch { return undefined; }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState<Theme>('light');
  const [transitioning, updateTransitioning] = useState(false);
  const themeRef = useRef<Theme>('light');
  const intentRef = useRef<Theme>('light');
  const localPreferenceRef = useRef<Theme | null>(null);
  const lastChoiceRef = useRef<Theme | null>(null);
  const motionRef = useRef<ThemeMotion | null>(null);
  const sequenceRef = useRef(0);

  const apply = useCallback((value: Theme) => {
    document.documentElement.dataset.zyTheme = value;
    themeRef.current = value;
    intentRef.current = value;
    updateTheme(value);
  }, []);

  const stopMotion = useCallback(() => {
    sequenceRef.current += 1;
    const motion = motionRef.current;
    motionRef.current = null;
    if (motion?.timeout) window.clearTimeout(motion.timeout);
    motion?.animation?.cancel();
    motion?.transition.skipTransition();
    delete document.documentElement.dataset.zyThemeMotion;
  }, []);

  useEffect(() => {
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncValue = (value: Theme) => {
      stopMotion();
      updateTransitioning(false);
      apply(value);
    };
    const sync = () => {
      const stored = readPreference();
      syncValue(localPreferenceRef.current ?? stored ?? (stored === undefined ? lastChoiceRef.current : null)
        ?? (system.matches ? 'dark' : 'light'));
    };
    const storage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      localPreferenceRef.current = null;
      const incoming = event.key === THEME_STORAGE_KEY ? event.newValue : null;
      lastChoiceRef.current = incoming === 'light' || incoming === 'dark' ? incoming : null;
      syncValue(lastChoiceRef.current ?? (system.matches ? 'dark' : 'light'));
    };
    const visibility = () => { if (document.hidden) sync(); };
    sync();
    window.addEventListener('storage', storage);
    window.addEventListener('resize', sync);
    document.addEventListener('visibilitychange', visibility);
    system.addEventListener('change', sync);
    reducedMotion.addEventListener('change', sync);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener('resize', sync);
      document.removeEventListener('visibilitychange', visibility);
      system.removeEventListener('change', sync);
      reducedMotion.removeEventListener('change', sync);
      stopMotion();
    };
  }, [apply, stopMotion]);

  const setTheme = (value: Theme, origin?: ThemeOrigin) => {
    lastChoiceRef.current = value;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, value);
      localPreferenceRef.current = null;
    } catch { localPreferenceRef.current = value; }
    stopMotion();
    intentRef.current = value;
    // Reflect the click immediately; the root colors still change inside native capture.
    flushSync(() => updateTheme(value));
    if (value === themeRef.current || !origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)
      || document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches
      || typeof document.startViewTransition !== 'function' || typeof document.documentElement.animate !== 'function') {
      updateTransitioning(false);
      apply(value);
      return;
    }

    const sequence = sequenceRef.current;
    const root = document.documentElement;
    const x = Math.max(0, Math.min(window.innerWidth, origin.x));
    const y = Math.max(0, Math.min(window.innerHeight, origin.y));
    const radius = Math.ceil(Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))) + 1;
    const collapsed = `circle(0px at ${x}px ${y}px)`;
    const expanded = `circle(${radius}px at ${x}px ${y}px)`;
    root.dataset.zyThemeMotion = value;
    updateTransitioning(true);

    let transition: ViewTransition;
    try {
      transition = document.startViewTransition(() => {
        // A skipped older capture must never overwrite a newer click or storage event.
        if (sequenceRef.current === sequence) flushSync(() => apply(value));
      });
    } catch {
      delete root.dataset.zyThemeMotion;
      updateTransitioning(false);
      apply(value);
      return;
    }

    const motion: ThemeMotion = { transition };
    motionRef.current = motion;
    // Attach rejection handling immediately; skipped native transitions reject ready.
    const completed = transition.finished.catch(() => undefined);
    const finish = () => {
      if (sequenceRef.current !== sequence) return;
      if (motion.timeout) window.clearTimeout(motion.timeout);
      motion.animation?.cancel();
      motionRef.current = null;
      delete root.dataset.zyThemeMotion;
      updateTransitioning(false);
    };
    motion.timeout = window.setTimeout(() => {
      if (sequenceRef.current !== sequence) return;
      motion.animation?.cancel();
      transition.skipTransition();
      apply(value);
      void completed.then(finish);
    }, 1500);

    void (async () => {
      try {
        await transition.ready;
        if (sequenceRef.current !== sequence) return;
        motion.animation = root.animate({ clipPath: value === 'dark' ? [collapsed, expanded] : [expanded, collapsed] }, {
          duration: 460,
          easing: 'cubic-bezier(.4, 0, .2, 1)',
          fill: 'both',
          pseudoElement: value === 'dark' ? '::view-transition-new(root)' : '::view-transition-old(root)',
        });
        await motion.animation.finished;
      } catch {
        if (sequenceRef.current === sequence) {
          transition.skipTransition();
          apply(value);
        }
      } finally {
        await completed;
        finish();
      }
    })();
  };
  const toggleTheme = (origin?: ThemeOrigin) => setTheme(intentRef.current === 'dark' ? 'light' : 'dark', origin);
  return <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, transitioning }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used within ThemeProvider');
  return value;
}

export function ThemeSettings({ onSelect }: { onSelect?: () => void }) {
  const value = useContext(ThemeContext);
  if (!value) return null;
  return <fieldset className="zy-theme-settings">
    <legend>外观</legend>
    <p>切换聊天界面的浅色与深色配色。</p>
    <div className="zy-theme-options">
      {(['light', 'dark'] as const).map(theme => <button className="zy-theme-option" type="button" key={theme}
        aria-pressed={value.theme === theme}
        onClick={() => { value.setTheme(theme); onSelect?.(); }}>
        <span className={'zy-theme-preview ' + theme} aria-hidden="true"><i/><span><b/><em/><b/></span></span>
        <span className="zy-theme-option-label">{theme === 'light' ? <Sun size={16}/> : <Moon size={16}/>}<strong>{theme === 'light' ? '浅色模式' : '深色模式'}</strong>{value.theme === theme && <Check size={16} aria-hidden="true"/>}</span>
      </button>)}
    </div>
  </fieldset>;
}
