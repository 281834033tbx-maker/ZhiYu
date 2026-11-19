export type DesktopRailPosition = { xRatio: number; yRatio: number };
export type DesktopRailPoint = { x: number; y: number };
export type DesktopRailSize = { width: number; height: number };
export type DesktopAppearanceLayout = 'floating' | 'classic';

export type DesktopAppearancePreference = {
  version: 1;
  position: DesktopRailPosition | null;
  /** Background transparency only: 0 is solid, 100 is fully transparent. */
  transparency: number;
};

export type DesktopAppearanceLoadResult = {
  preference: DesktopAppearancePreference;
  status: 'loaded' | 'default' | 'invalid' | 'unavailable';
};

export type DesktopAppearanceSaveResult =
  | { ok: true; preference: DesktopAppearancePreference }
  | { ok: false; reason: 'unavailable' | 'invalid-account' | 'write-failed' };

export const DEFAULT_DESKTOP_RAIL_SIZE: Readonly<DesktopRailSize> = { width: 40, height: 248 };
export const DESKTOP_RAIL_SAFE_INSET = 8;

export function defaultDesktopAppearancePreference(layout: DesktopAppearanceLayout = 'floating'): DesktopAppearancePreference {
  return { version: 1, position: null, transparency: layout === 'classic' ? 0 : 4 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizePosition(value: unknown): DesktopRailPosition | null {
  if (!isRecord(value) || !isFiniteNumber(value.xRatio) || !isFiniteNumber(value.yRatio)) return null;
  return { xRatio: clamp(value.xRatio, 0, 1), yRatio: clamp(value.yRatio, 0, 1) };
}

export function sanitizeDesktopAppearancePreference(value: unknown, layout: DesktopAppearanceLayout = 'floating'): DesktopAppearancePreference {
  if (!isRecord(value) || value.version !== 1) return defaultDesktopAppearancePreference(layout);
  return {
    version: 1,
    position: layout === 'classic' ? null : sanitizePosition(value.position),
    transparency: isFiniteNumber(value.transparency) ? Math.round(clamp(value.transparency, 0, 100)) : defaultDesktopAppearancePreference(layout).transparency,
  };
}

function isValidPreference(value: unknown, layout: DesktopAppearanceLayout): boolean {
  if (!isRecord(value) || value.version !== 1 || !isFiniteNumber(value.transparency)) return false;
  if (value.transparency < 0 || value.transparency > 100 || !Number.isInteger(value.transparency)) return false;
  if (value.position === null) return true;
  if (layout === 'classic') return false;
  return isRecord(value.position)
    && isFiniteNumber(value.position.xRatio) && value.position.xRatio >= 0 && value.position.xRatio <= 1
    && isFiniteNumber(value.position.yRatio) && value.position.yRatio >= 0 && value.position.yRatio <= 1;
}

/** Blank or unencodable accounts cannot fall back to a shared, unscoped key. */
export function desktopAppearanceStorageKey(accountId: string, layout: DesktopAppearanceLayout = 'floating'): string | null {
  if (typeof accountId !== 'string' || !accountId.trim()) return null;
  try {
    const prefix = layout === 'classic' ? 'zhiyu-desktop-classic-appearance-v1:' : 'zhiyu-desktop-appearance-v1:';
    return prefix + encodeURIComponent(accountId);
  } catch {
    return null;
  }
}

export function loadDesktopAppearancePreference(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  accountId: string,
  layout: DesktopAppearanceLayout = 'floating',
): DesktopAppearanceLoadResult {
  const key = desktopAppearanceStorageKey(accountId, layout);
  if (!storage || key === null) return { preference: defaultDesktopAppearancePreference(layout), status: 'unavailable' };
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { preference: defaultDesktopAppearancePreference(layout), status: 'unavailable' };
  }
  if (raw === null) return { preference: defaultDesktopAppearancePreference(layout), status: 'default' };
  try {
    const parsed: unknown = JSON.parse(raw);
    return {
      preference: sanitizeDesktopAppearancePreference(parsed, layout),
      status: isValidPreference(parsed, layout) ? 'loaded' : 'invalid',
    };
  } catch {
    return { preference: defaultDesktopAppearancePreference(layout), status: 'invalid' };
  }
}

export function saveDesktopAppearancePreference(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  accountId: string,
  value: unknown,
  layout: DesktopAppearanceLayout = 'floating',
): DesktopAppearanceSaveResult {
  const key = desktopAppearanceStorageKey(accountId, layout);
  if (key === null) return { ok: false, reason: 'invalid-account' };
  if (!storage) return { ok: false, reason: 'unavailable' };
  const preference = sanitizeDesktopAppearancePreference(value, layout);
  try {
    storage.setItem(key, JSON.stringify(preference));
    return { ok: true, preference };
  } catch {
    return { ok: false, reason: 'write-failed' };
  }
}

function dimension(value: number, fallback = 0): number {
  return isFiniteNumber(value) && value > 0 ? value : fallback;
}

function railBounds(hostSize: DesktopRailSize, railSize: DesktopRailSize) {
  const hostWidth = dimension(hostSize.width);
  const hostHeight = dimension(hostSize.height);
  const width = dimension(railSize.width, DEFAULT_DESKTOP_RAIL_SIZE.width);
  const height = dimension(railSize.height, DEFAULT_DESKTOP_RAIL_SIZE.height);
  const availableX = Math.max(0, hostWidth - width);
  const availableY = Math.max(0, hostHeight - height);
  const insetX = Math.min(DESKTOP_RAIL_SAFE_INSET, availableX / 2);
  const insetY = Math.min(DESKTOP_RAIL_SAFE_INSET, availableY / 2);
  return {
    minX: insetX, maxX: availableX - insetX,
    minY: insetY, maxY: availableY - insetY,
    defaultX: 14, defaultY: hostHeight / 2 - 172,
  };
}

/** Coordinates are local to the full app host, not just its left navigation gutter. */
export function clampDesktopRailPosition(
  point: DesktopRailPoint,
  hostSize: DesktopRailSize,
  railSize: DesktopRailSize = DEFAULT_DESKTOP_RAIL_SIZE,
): DesktopRailPoint {
  const bounds = railBounds(hostSize, railSize);
  return {
    x: clamp(isFiniteNumber(point.x) ? point.x : bounds.defaultX, bounds.minX, bounds.maxX),
    y: clamp(isFiniteNumber(point.y) ? point.y : bounds.defaultY, bounds.minY, bounds.maxY),
  };
}

/** A null position keeps the existing left 14px / top calc(50% - 172px) anchor. */
export function resolveDesktopRailPosition(
  position: DesktopRailPosition | null,
  hostSize: DesktopRailSize,
  railSize: DesktopRailSize = DEFAULT_DESKTOP_RAIL_SIZE,
): DesktopRailPoint {
  const bounds = railBounds(hostSize, railSize);
  const normalized = sanitizePosition(position);
  if (normalized === null) return clampDesktopRailPosition({ x: bounds.defaultX, y: bounds.defaultY }, hostSize, railSize);
  return {
    x: bounds.minX + normalized.xRatio * (bounds.maxX - bounds.minX),
    y: bounds.minY + normalized.yRatio * (bounds.maxY - bounds.minY),
  };
}

/** Zero travel uses 0.5, preserving a centered intent when the host later grows. */
export function desktopRailPositionFromPixels(
  point: DesktopRailPoint,
  hostSize: DesktopRailSize,
  railSize: DesktopRailSize = DEFAULT_DESKTOP_RAIL_SIZE,
): DesktopRailPosition {
  const bounds = railBounds(hostSize, railSize);
  const clamped = clampDesktopRailPosition(point, hostSize, railSize);
  return {
    xRatio: bounds.maxX > bounds.minX ? (clamped.x - bounds.minX) / (bounds.maxX - bounds.minX) : 0.5,
    yRatio: bounds.maxY > bounds.minY ? (clamped.y - bounds.minY) / (bounds.maxY - bounds.minY) : 0.5,
  };
}
