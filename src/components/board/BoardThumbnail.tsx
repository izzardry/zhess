/**
 * Small static board of a FEN for history cards (DESIGN 12.2). One SVG, no input, no state;
 * strokes are thickened so outlined pieces stay visible at thumbnail size.
 */
import { memo, useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { Color, Square } from '@/lib/types';
import { HIGHLIGHT_ALPHA, cellToSquare, isLightSquare, parseFenBoard, squareToCell } from './geometry';
import { PIECE_SHAPES, partStyle, piecePaint, strokeForSize } from './pieceShapes';

export interface BoardThumbnailProps {
  /** Position to draw (only the placement field is read; a malformed FEN draws what it can). */
  readonly fen: string;
  /** Edge length in px. Default 64. */
  readonly size?: number;
  /** Color at the bottom. Default white. */
  readonly orientation?: Color;
  /** Squares to tint as the last move. */
  readonly lastMove?: { readonly from: Square; readonly to: Square } | null;
  /** Accessible name; without it the thumbnail is decorative. */
  readonly label?: string;
  readonly className?: string;
}

export const BoardThumbnail = memo(function BoardThumbnail({
  fen,
  size = 64,
  orientation = 'w',
  lastMove,
  label,
  className,
}: BoardThumbnailProps) {
  const pieces = useMemo(() => parseFenBoard(fen), [fen]);
  const sw = strokeForSize(size / 8);
  const cells: JSX.Element[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = cellToSquare(col, row, orientation) as Square;
      const tints: string[] = [];
      // Square tones and the half-step last-move tint as on the board (Square.tsx).
      tints.push(`var(--zhess-sq-${isLightSquare(sq) ? 'light' : 'dark'})`);
      if (lastMove && (lastMove.from === sq || lastMove.to === sq)) tints.push(`hsl(var(--foreground) / ${HIGHLIGHT_ALPHA})`);
      tints.forEach((fill, i) =>
        cells.push(<rect key={`${sq}-${i}`} x={col * 100} y={row * 100} width={100} height={100} fill={fill} />),
      );
    }
  }
  const glyphs: JSX.Element[] = [];
  pieces.forEach((p, i) => {
    if (!p) return;
    const sq = `${'abcdefgh'[i % 8]}${Math.floor(i / 8) + 1}` as Square;
    const { col, row } = squareToCell(sq, orientation);
    const paint = piecePaint(p.color);
    glyphs.push(
      <g key={sq} transform={`translate(${col * 100} ${row * 100})`} data-piece={`${p.color}${p.type}`} data-thumb-square={sq}>
        {PIECE_SHAPES[p.type].map((part, k) => {
          const s = partStyle(part.kind, paint);
          return 'circle' in part ? (
            <circle key={k} cx={part.circle[0]} cy={part.circle[1]} r={part.circle[2]} fill={s.fill} stroke={s.stroke} />
          ) : (
            <path key={k} d={part.d} fill={s.fill} stroke={s.stroke} />
          );
        })}
      </g>,
    );
  });
  return (
    <svg
      viewBox="0 0 800 800"
      width={size}
      height={size}
      className={cn('shrink-0 overflow-hidden rounded-sm bg-card', className)}
      strokeWidth={sw}
      strokeLinejoin="round"
      strokeLinecap="round"
      data-testid="board-thumbnail"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true, focusable: false })}
    >
      <rect width={800} height={800} fill="hsl(var(--card))" />
      {cells}
      {glyphs}
    </svg>
  );
});
