/**
 * Toolbar geometry (StatusBar): every button is a 44 px touch target (DESIGN 14.1). In portrait only
 * the bar's spacing shrinks on narrow screens; in mobile landscape the rail folds into two columns
 * where one column would not fit below Help with room left for toasts.
 */

/** Top of the landscape rail: below Help (top 1.5rem, 44 px on touch) with a small gap. */
export const RAIL_TOP = 'calc(max(1.5rem, env(safe-area-inset-top)) + 2.75rem + 0.5rem)';

/** Least touch target of a toolbar button (DESIGN 14.1). */
export const TARGET = 44;
/** Least space left beside the portrait bar on each side. */
const EDGE = 4;
/** Full portrait spacing: bar padding per side, divider margin per side, gap. */
const PAD = 8;
const DIV_MARGIN = 4;
const GAP = 2;
/** Room kept under a centered one-column rail for toasts, besides the rail itself. */
const TOAST_ROOM = 96;
/** RAIL_TOP in px where the safe area is 0 (1.5rem + 2.75rem + 0.5rem). */
const RAIL_TOP_PX = 76;

/** One rail variant: its height in px (for centering below Help). */
interface RailSize {
  readonly height: number;
}

export interface ToolbarLayout {
  /** Portrait bar spacing as CSS variables (`--tb-pad`, `--tb-div`, `--tb-gap`). */
  readonly bar: Record<string, string>;
  /** Landscape: one-column rail. */
  readonly column: RailSize;
  /** Landscape: two-column rail. */
  readonly grid: RailSize;
  /** Landscape: 2 when a two-column rail is possible (more than 3 buttons), else 1. */
  readonly cols: 1 | 2;
  /** Media query that holds when the one-column rail fits with room for toasts below it. */
  readonly singleColumnQuery: string;
}

/**
 * Toolbar geometry for groups of the given sizes. Pure, so it can be tested: every button is a
 * 44 px target; only spacing shrinks (portrait) or the rail folds into two columns (landscape).
 */
export function toolbarLayout(groupSizes: readonly number[], landscape: boolean): ToolbarLayout {
  const count = groupSizes.reduce((n, g) => n + g, 0);
  const dividers = Math.max(0, groupSizes.length - 1);
  // Portrait: buttons, the 1 px border on each side and 1 px dividers always take their space.
  const need = count * TARGET + 2 + dividers;
  const slack = (spent: number) => `(100vw - ${need + spent}px)`;
  const bar: Record<string, string> = {
    '--tb-pad': `clamp(0px, calc(${slack(2 * EDGE)} / 2), ${PAD}px)`,
    '--tb-div': dividers > 0 ? `clamp(0px, calc(${slack(2 * EDGE + 2 * PAD)} / ${2 * dividers}), ${DIV_MARGIN}px)` : '0px',
    '--tb-gap': `clamp(0px, calc(${slack(2 * EDGE + 2 * PAD + 2 * DIV_MARGIN * dividers)} / ${Math.max(1, count + dividers - 1)}), ${GAP}px)`,
  };
  // Landscape one column: py-4, gap-0.5 between every child, dividers h-px my-1.
  const columnHeight = count * TARGET + (count + dividers - 1) * 2 + dividers * 9 + 32 + 2;
  // Two columns: p-1.5; each group takes ceil(n / 2) rows; dividers are rows of their own.
  const rows = groupSizes.reduce((n, g) => n + Math.ceil(g / 2), 0);
  const gridHeight = rows * TARGET + (rows + dividers - 1) * 2 + dividers * 9 + 12 + 2;
  const cols: 1 | 2 = landscape && count > 3 ? 2 : 1;
  const tall = RAIL_TOP_PX + columnHeight + TOAST_ROOM;
  return {
    bar,
    column: { height: columnHeight },
    grid: { height: gridHeight },
    cols,
    singleColumnQuery: `(min-height: ${tall}px)`,
  };
}

/** The rail is centered when there is room, but never higher than just below Help. */
export function railVars(size: RailSize): Record<string, string> {
  return { '--rail-top': `max(${RAIL_TOP}, calc(50% - ${size.height / 2}px))` };
}
