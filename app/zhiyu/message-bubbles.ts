export type BubblePosition = 'single' | 'start' | 'middle' | 'end';

export function bubblePosition(previous: boolean, next: boolean): BubblePosition {
  if (previous && next) return 'middle';
  if (previous) return 'end';
  if (next) return 'start';
  return 'single';
}
