/**
 * Where the custom clock dial (`ClockDial.tsx`) opens: its centre, clamped so the dial, its caption
 * and a committed item popped out at 6 o'clock stay inside the viewport (DESIGN 4.1, Ztyle 08).
 */
import { DIAL_GEOMETRY } from '@/lib/clock';

/** Gap between the dial's items and the caption below it. */
export const CAPTION_GAP = 36;
/** Height of the caption pill: 10 px text at line-height 1.5, `py-1`, a 1 px border (rounded up). */
const CAPTION_HEIGHT = 26;
/** Least distance between the dial (or its caption) and the edge of the viewport. */
export const DIAL_MARGIN = 8;

/**
 * How far the open dial reaches from its centre, in px. Sideways and up: the items at rest plus the
 * margin. Down: the caption (`radius + CAPTION_GAP + CAPTION_HEIGHT`) or a committed item popped to
 * `popRadius` at scale 1.6, whichever is lower, plus the margin.
 */
export const DIAL_EXTENT = Object.freeze({
  side: DIAL_GEOMETRY.reach + DIAL_MARGIN,
  top: DIAL_GEOMETRY.reach + DIAL_MARGIN,
  bottom:
    Math.max(DIAL_GEOMETRY.radius + CAPTION_GAP + CAPTION_HEIGHT, DIAL_GEOMETRY.popRadius + 20 * 1.6) + DIAL_MARGIN,
});

/** The viewport the dial is clamped into. `safeBottom` is `env(safe-area-inset-bottom)` in px. */
export interface DialViewport {
  readonly width: number;
  readonly height: number;
  readonly safeBottom?: number;
}

/** `env(safe-area-inset-bottom)` in px (0 where unsupported or outside a browser). */
function safeAreaBottom(): number {
  if (typeof document === 'undefined' || !document.body) return 0;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom, 0px)';
  document.body.appendChild(probe);
  const px = parseFloat(getComputedStyle(probe).paddingBottom);
  probe.remove();
  return Number.isFinite(px) ? px : 0;
}

function currentViewport(): DialViewport {
  if (typeof window === 'undefined') return { width: 0, height: 0 };
  return { width: window.innerWidth, height: window.innerHeight, safeBottom: safeAreaBottom() };
}

/**
 * The dial's centre for a hold at (`x`, `y`): moved just enough that the dial and its caption stay
 * inside `view` with `DIAL_MARGIN` to spare (and above the bottom safe area). A viewport too small
 * for the dial on an axis leaves that axis alone; an unknown viewport (0) leaves both.
 */
export function clampCenter(x: number, y: number, view: DialViewport = currentViewport()): { x: number; y: number } {
  const { side, top, bottom } = DIAL_EXTENT;
  const floor = view.height - Math.max(0, view.safeBottom ?? 0) - bottom;
  return {
    x: view.width >= 2 * side ? Math.max(side, Math.min(view.width - side, x)) : x,
    y: floor >= top ? Math.max(top, Math.min(floor, y)) : y,
  };
}
