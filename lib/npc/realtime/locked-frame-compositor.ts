/**
 * Reference CPU compositor for the desktop speech renderer. Not wired into the
 * live character window. A GPU implementation must preserve these invariants.
 * Equality is relative to this decoded base frame, before display/encoding.
 */
export type FrameIdentity = {
  assetRevision: string;
  clipId: string;
  frameIndex: number;
  playbackEpoch: number;
};

export type PixelRect = { x: number; y: number; width: number; height: number };
export type DecodedFrame = { width: number; height: number; rgba: Uint8ClampedArray };

/** Loaded from the approved local asset, never taken from an inference reply. */
export type ApprovedMouthMask = {
  frame: FrameIdentity;
  rect: PixelRect;
  alpha: Uint8Array;
};

export type MouthPatch = {
  frame: FrameIdentity;
  turnId: string;
  rect: PixelRect;
  rgba: Uint8ClampedArray;
};

export type CompositeResult = {
  rgba: Uint8ClampedArray;
  applied: boolean;
  reason: 'applied' | 'inactive' | 'stale-frame' | 'invalid-region';
};

function sameFrame(a: FrameIdentity, b: FrameIdentity): boolean {
  return a.assetRevision === b.assetRevision && a.clipId === b.clipId
    && a.frameIndex === b.frameIndex && a.playbackEpoch === b.playbackEpoch;
}

function validRect(rect: PixelRect, frame: DecodedFrame): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isSafeInteger)
    && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
    && rect.x + rect.width <= frame.width && rect.y + rect.height <= frame.height;
}

export function compositeMouthFrame(
  base: DecodedFrame,
  currentFrame: FrameIdentity,
  activeTurnId: string | null,
  approved: ApprovedMouthMask,
  patch: MouthPatch | null,
): CompositeResult {
  if (!Number.isSafeInteger(base.width) || !Number.isSafeInteger(base.height)
    || base.width <= 0 || base.height <= 0
    || base.rgba.length !== base.width * base.height * 4) {
    throw new Error('Invalid decoded base frame');
  }
  const output = base.rgba.slice();
  const skip = (reason: CompositeResult['reason']): CompositeResult =>
    ({ rgba: output, applied: false, reason });

  // On interruption the caller clears activeTurnId before accepting more data.
  if (!patch || !activeTurnId || patch.turnId !== activeTurnId) return skip('inactive');
  if (!sameFrame(approved.frame, currentFrame) || !sameFrame(patch.frame, currentFrame)) {
    return skip('stale-frame');
  }
  const rect = approved.rect;
  if (!validRect(rect, base) || !validRect(patch.rect, base)
    || rect.x !== patch.rect.x || rect.y !== patch.rect.y
    || rect.width !== patch.rect.width || rect.height !== patch.rect.height
    || approved.alpha.length !== rect.width * rect.height
    || patch.rgba.length !== rect.width * rect.height * 4) return skip('invalid-region');

  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      const local = y * rect.width + x;
      const alpha = approved.alpha[local] / 255 * patch.rgba[local * 4 + 3] / 255;
      if (alpha === 0) continue;
      const target = ((y + rect.y) * base.width + x + rect.x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        output[target + channel] = Math.round(
          base.rgba[target + channel] * (1 - alpha) + patch.rgba[local * 4 + channel] * alpha,
        );
      }
      // Preserve the base alpha, including pixels on a transparent scene edge.
    }
  }
  return { rgba: output, applied: true, reason: 'applied' };
}
