/**
 * Geometry of the promotion dial (Ztyle 08 radial dial, ported from Zudoku's SudokuCell):
 * distances, zones and the angle-to-item mapping. Pure.
 */
import type { PromotionPiece } from '@/lib/types';

/** Items in dial order: Q at 12 o'clock, then clockwise. */
export const DIAL_PIECES: readonly PromotionPiece[] = ['q', 'r', 'b', 'n'];

export const DIAL_RADIUS = 60;
export const DIAL_POP_RADIUS = 105;
export const DIAL_CENTER_THRESHOLD = 25;
export const DIAL_AIM_THRESHOLD = 40;
export const DIAL_COMMIT_THRESHOLD = 55;
/** Dial radius + half an item: how far the dial reaches from its center. */
export const DIAL_REACH = 80;
/** Hold time on a promotion target that opens the dial (DESIGN 6.4). */
export const DIAL_HOLD_MS = 300;

export type DialZone = 'center' | 'none' | 'aim' | 'commit';

export interface DialPick {
  readonly zone: DialZone;
  readonly piece: PromotionPiece | null;
}

/** What a pointer offset from the dial's start point selects. */
export function dialPick(dx: number, dy: number): DialPick {
  const d = Math.hypot(dx, dy);
  if (d < DIAL_CENTER_THRESHOLD) return { zone: 'center', piece: null };
  if (d <= DIAL_AIM_THRESHOLD) return { zone: 'none', piece: null };
  const n = DIAL_PIECES.length;
  let a = Math.atan2(dy, dx) + Math.PI / 2 + Math.PI / n;
  a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const piece = DIAL_PIECES[Math.floor((a / (2 * Math.PI)) * n) % n];
  return { zone: d >= DIAL_COMMIT_THRESHOLD ? 'commit' : 'aim', piece };
}

/** The dial center for a pointer position, clamped so the whole dial stays on screen. */
export function clampDialCenter(x: number, y: number, vw: number, vh: number): { x: number; y: number } {
  return {
    x: Math.max(DIAL_REACH, Math.min(vw - DIAL_REACH, x)),
    y: Math.max(DIAL_REACH, Math.min(vh - DIAL_REACH, y)),
  };
}
