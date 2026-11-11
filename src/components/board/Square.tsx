/**
 * One board square with every state of DESIGN 5.3, drawn as overlays on the square color
 * (Ztyle 09: fills are `background-image` tints over `bg-card`, never replacements).
 */
import { memo, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import type { Piece, Square } from '@/lib/types';
import { HIGHLIGHT_ALPHA } from './geometry';
import { PieceIcon } from './PieceIcon';

export interface BoardSquareProps {
  readonly square: Square;
  readonly piece: Piece | null;
  readonly light: boolean;
  /** Accessible name, e.g. `white knight, g1`. */
  readonly label: string;
  /** Roving tabindex: the one square in the tab order. */
  readonly focusable: boolean;
  readonly selected?: boolean;
  readonly lastMove?: boolean;
  /** Legal target: a dot on an empty square, a ring on a capture. */
  readonly target?: 'dot' | 'ring' | null;
  readonly premove?: boolean;
  readonly check?: boolean;
  readonly threat?: boolean;
  /** Valid drop target under the dragged piece. */
  readonly dropOver?: boolean;
  /** The piece is being dragged away: draw it faint. */
  readonly lifted?: boolean;
  /** Far side in face-to-face seating: draw the piece upside down. */
  readonly rotated?: boolean;
  /** Non-zero replays the green hint pulse (key changes restart it). */
  readonly hintKey?: number;
  /** Non-zero replays the red blunder pulse on the piece. */
  readonly blunderKey?: number;
  /** Coordinates (helpers): file letter on the bottom row, rank digit on the left column. */
  readonly fileLabel?: string;
  readonly rankLabel?: string;
  readonly onFocus?: (sq: Square) => void;
}

const tint = (alphaColor: string) => `linear-gradient(${alphaColor}, ${alphaColor})`;
const FG = (a: number) => `hsl(var(--foreground) / ${a})`;
const RED = (a: number) => `hsl(var(--destructive) / ${a})`;
/**
 * Light and dark squares differ by a `foreground/10` overlay, placed on the dark squares in the
 * light theme and on the light squares in the dark theme (src/index.css), so light squares are
 * the lighter ones in both. Grey state fills use half that step: a highlighted square lands
 * between the two square tones and never matches the other color, so the checkerboard holds.
 */
const SQUARE_TONE = (light: boolean) => `var(--zhess-sq-${light ? 'light' : 'dark'})`;

export const BoardSquare = memo(function BoardSquare({
  square,
  piece,
  light,
  label,
  focusable,
  selected,
  lastMove,
  target,
  premove,
  check,
  threat,
  dropOver,
  lifted,
  rotated,
  hintKey = 0,
  blunderKey = 0,
  fileLabel,
  rankLabel,
  onFocus,
}: BoardSquareProps) {
  // Overlays, top first (CSS paints the first background image on top).
  const overlays: string[] = [];
  if (threat) overlays.push(tint(RED(0.1)));
  if (check) overlays.push(tint(RED(0.15)));
  if (selected) overlays.push(tint(FG(HIGHLIGHT_ALPHA)));
  if (lastMove) overlays.push(tint(FG(HIGHLIGHT_ALPHA)));
  overlays.push(tint(SQUARE_TONE(light)));
  const style: CSSProperties = {
    width: 'var(--cell-size)',
    height: 'var(--cell-size)',
    backgroundImage: overlays.join(', '),
  };

  return (
    <div
      role="gridcell"
      aria-label={label}
      aria-selected={selected || undefined}
      tabIndex={focusable ? 0 : -1}
      data-square={square}
      data-state={
        [
          selected && 'selected',
          lastMove && 'last',
          target && `target-${target}`,
          premove && 'premove',
          check && 'check',
          threat && 'threat',
          hintKey && 'hint',
        ]
          .filter(Boolean)
          .join(' ') || undefined
      }
      onFocus={onFocus ? () => onFocus(square) : undefined}
      className="zhess-square relative flex shrink-0 items-center justify-center bg-card"
      style={style}
    >
      {rankLabel && (
        <span aria-hidden className="pointer-events-none absolute left-0.5 top-0.5 text-[0.5rem] leading-none text-foreground/40">
          {rankLabel}
        </span>
      )}
      {fileLabel && (
        <span aria-hidden className="pointer-events-none absolute bottom-0.5 right-0.5 text-[0.5rem] leading-none text-foreground/40">
          {fileLabel}
        </span>
      )}

      {check && (
        <>
          <span aria-hidden className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-destructive/40" />
          <span aria-hidden className="pointer-events-none absolute inset-0 animate-error-pulse" />
        </>
      )}

      {piece && (
        <PieceIcon
          key={blunderKey}
          type={piece.type}
          color={piece.color}
          className={cn(
            'pointer-events-none relative h-full w-full',
            rotated && 'rotate-180',
            lifted && 'opacity-30',
            blunderKey > 0 && 'zhess-blunder',
          )}
        />
      )}

      {target === 'dot' && (
        <span
          aria-hidden
          data-marker="dot"
          className="pointer-events-none absolute left-1/2 top-1/2 h-[28%] w-[28%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/25"
        />
      )}
      {target === 'ring' && (
        <span
          aria-hidden
          data-marker="ring"
          className="pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(transparent 0 64%, ${FG(0.25)} 65% 72%, transparent 73%)` }}
        />
      )}

      {selected && <span aria-hidden className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-foreground/50" />}
      {dropOver && <span aria-hidden className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-foreground/40" />}
      {premove && (
        <span
          aria-hidden
          data-marker="premove"
          className="pointer-events-none absolute inset-0 outline-dashed outline-2 outline-foreground/40"
          style={{ outlineOffset: '-3px' }}
        />
      )}
      {hintKey > 0 && <span key={hintKey} aria-hidden data-marker="hint" className="zhess-hint pointer-events-none absolute inset-0 animate-hint-pulse" />}
    </div>
  );
});
