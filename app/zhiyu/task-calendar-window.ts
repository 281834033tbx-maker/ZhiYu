'use client';

import {allPeople} from './data';

// A new stable target avoids reusing an already-open window with the previous native title bar.
const calendarWindowName = 'zhiyu-task-calendar-compact';
// A material change needs a fresh native child instead of reusing the old opaque window.
const calendarMacWindowName = 'zhiyu-task-calendar-frosted';
const calendarPeople = () => new Set(allPeople.filter(person => person.dialoguePurpose === 'professional' && person.id !== 'molly').map(person => person.id));
let calendarWindow: Window | null = null;
let calendarTarget = '';
let lifecycleAccount = '';
const lifecycleOwners = new Set<symbol>();
let lifecycleCleanup: ReturnType<typeof setTimeout> | null = null;
let lifecycleGeneration = 0;
let lifecyclePageEnd: (() => void) | null = null;

/** React refresh may clean up and reattach the same account in one commit. */
export function bindTaskCalendarWindowLifecycle(accountId: string): () => void {
  if (typeof window === 'undefined') return () => {};
  const account = accountId.trim();
  if (!account) return () => {};
  if (lifecycleCleanup !== null) {clearTimeout(lifecycleCleanup); lifecycleCleanup = null;}
  if (lifecycleAccount && lifecycleAccount !== account) {
    closeTaskCalendarWindow();
    lifecycleOwners.clear();
  }
  lifecycleAccount = account;
  lifecycleGeneration++;
  const owner = Symbol(account);
  lifecycleOwners.add(owner);
  if (!lifecyclePageEnd) {
    lifecyclePageEnd = () => closeTaskCalendarWindow();
    window.addEventListener('pagehide', lifecyclePageEnd);
  }
  return () => {
    if (!lifecycleOwners.delete(owner) || lifecycleOwners.size) return;
    const generation = lifecycleGeneration;
    lifecycleCleanup = setTimeout(() => {
      lifecycleCleanup = null;
      if (generation !== lifecycleGeneration || lifecycleOwners.size) return;
      closeTaskCalendarWindow();
      lifecycleAccount = '';
      if (lifecyclePageEnd) window.removeEventListener('pagehide', lifecyclePageEnd);
      lifecyclePageEnd = null;
    }, 0);
  };
}

function revealCalendarWindow(popup: Window, expectedURL: string): boolean | Promise<boolean> {
  const desktop = window.zhiyuDesktop;
  if (desktop?.taskCalendarWindowControl === 'reveal-v1' && desktop.revealTaskCalendarWindow) {
    // WindowProxy.focus() cannot show a hidden Electron BrowserWindow.
    return (async () => {
      const deadline = Date.now() + 2500;
      try {
        if (await desktop.revealTaskCalendarWindow!(expectedURL)) return !popup.closed;
        // Reusing the named child starts a navigation. The main process must wait
        // for its exact new scope instead of showing a still-loaded previous NPC.
        while (!popup.closed && calendarTarget === expectedURL && Date.now() < deadline) {
          await new Promise<void>(resolve => window.setTimeout(resolve, 50));
          if (popup.closed || calendarTarget !== expectedURL) return false;
          if (popup.location.href !== expectedURL) continue;
          if (await desktop.revealTaskCalendarWindow!(expectedURL)) return !popup.closed;
        }
      } catch {return false;}
      return false;
    })();
  }
  popup.focus();
  return !popup.closed;
}

/** Fit only a script-created calendar child to its natural layout height. */
export function fitTaskCalendarWindowToContent(contentHeight: number): boolean {
  if (typeof window === 'undefined' || !Number.isFinite(contentHeight) || contentHeight <= 0) return false;
  try {
    const url = new URL(window.location.href);
    if (url.pathname !== '/task-calendar' || !calendarPeople().has(url.searchParams.get('npc') ?? '') || !url.searchParams.get('account')?.trim()) return false;
    if (!window.opener || window.opener === window || window.opener.closed || window.opener.location.origin !== url.origin || window.top !== window) return false;
    const screen = window.screen as Screen & {availLeft?: number; availTop?: number};
    const workHeight = Number.isFinite(screen.availHeight) && screen.availHeight > 0
      ? screen.availHeight
      : Number.isFinite(screen.height) && screen.height > 0 ? screen.height : 0;
    const workWidth = Number.isFinite(screen.availWidth) && screen.availWidth > 0 ? screen.availWidth : 0;
    const width = window.outerWidth;
    const previousHeight = window.outerHeight;
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(previousHeight) || previousHeight <= 0) return false;
    // Preserve a user's full-screen/maximized view instead of fighting its resize events.
    if (document.fullscreenElement || (workHeight && workWidth && width >= workWidth - 1 && previousHeight >= workHeight - 1)) return false;
    const chromeHeight = Number.isFinite(window.innerHeight) && window.innerHeight > 0 ? Math.max(0, previousHeight - window.innerHeight) : 0;
    const maximumHeight = workHeight ? Math.min(workHeight, Math.max(360, workHeight - 48)) : 1000;
    const height = Math.min(maximumHeight, Math.max(360, Math.ceil(contentHeight + chromeHeight)));
    if (Math.abs(previousHeight - height) <= 1) return true;
    const oldX = Number.isFinite(window.screenX) ? window.screenX : 0;
    const oldY = Number.isFinite(window.screenY) ? window.screenY : 0;
    const left = Number.isFinite(screen.availLeft) && workWidth
      ? Math.max(screen.availLeft!, Math.min(oldX, screen.availLeft! + Math.max(0, workWidth - width)))
      : oldX;
    const centeredTop = oldY + (previousHeight - height) / 2;
    const top = Number.isFinite(screen.availTop) && workHeight
      ? Math.max(screen.availTop!, Math.min(centeredTop, screen.availTop! + Math.max(0, workHeight - height)))
      : centeredTop;
    window.resizeTo(width, height);
    window.moveTo(Math.round(left), Math.round(top));
    return true;
  } catch { return false; }
}

/** The desktop restores its native child; ordinary browsers keep their named window. */
export function openTaskCalendarWindow({personId, accountId}: {personId: string; accountId: string}): boolean | Promise<boolean> {
  if (typeof window === 'undefined' || !calendarPeople().has(personId) || !accountId.trim()) return false;
  if (lifecycleAccount && lifecycleAccount !== accountId.trim()) return false;
  const url = new URL('/task-calendar', window.location.origin);
  url.searchParams.set('npc', personId);
  // This is an expected account scope; the page must still authenticate its cookie.
  url.searchParams.set('account', accountId);
  const compactChrome = /\bElectron\/\d/i.test(window.navigator.userAgent);
  const macChrome = compactChrome && /Macintosh|Mac OS X/i.test(window.navigator.userAgent);
  if (compactChrome) url.searchParams.set('chrome', 'compact');
  try {
    if (calendarWindow && !calendarWindow.closed && calendarTarget === url.href && calendarWindow.location.href === url.href) {
      return revealCalendarWindow(calendarWindow, url.href);
    }
  } catch { /* A navigated window is replaced by the fixed same-origin route below. */ }
  try {
    const width = 560;
    // Chromium exposes the current display's work-area origin in logical points, including negative secondary-display coordinates.
    const screen = window.screen as Screen & {availLeft?: number; availTop?: number};
    const validWorkAreaHeight = Number.isFinite(screen.availHeight) && screen.availHeight > 0;
    const height = validWorkAreaHeight ? Math.min(screen.availHeight, Math.max(360, Math.min(1000, screen.availHeight - 48))) : 600;
    const left = Math.round(Number.isFinite(screen.availLeft)
      ? screen.availLeft! + Math.max(0, (screen.availWidth - width) / 2)
      : window.screenX + Math.max(0, (window.outerWidth - width) / 2));
    const top = Math.round(Number.isFinite(screen.availTop) && validWorkAreaHeight
      ? screen.availTop! + Math.max(0, (screen.availHeight - height) / 2)
      : window.screenY + Math.max(0, (window.outerHeight - height) / 2));
    const features = `popup,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes${compactChrome ? ',titleBarStyle=hidden,frame=yes' : ''}${macChrome ? ',backgroundColor=#00000000,vibrancy=under-window,visualEffectState=active' : ''}`;
    const popup = window.open(url.href, macChrome ? calendarMacWindowName : calendarWindowName, features);
    if (!popup || popup.closed) return false;
    calendarWindow = popup;
    calendarTarget = url.href;
    return revealCalendarWindow(popup, url.href);
  } catch { return false; }
}

/** Close the account-scoped child when its parent account or chat client ends. */
export function closeTaskCalendarWindow(): void {
  try {if (calendarWindow && !calendarWindow.closed) calendarWindow.close();}
  catch { /* A window already closed by the operating system needs no cleanup. */ }
  calendarWindow = null;
  calendarTarget = '';
}
