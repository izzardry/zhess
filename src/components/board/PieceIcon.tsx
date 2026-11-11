/**
 * One chess piece as inline SVG, drawn with the theme tokens so it works in light and dark.
 * Used by the board, and by other packages for captured pieces, the move strip (figurines),
 * thumbnails and the promotion dial.
 */
import { memo, type CSSProperties } from 'react';
import type { Color, PieceType } from '@/lib/types';
import { BACKGROUND, FOREGROUND, PIECE_SHAPES, partStyle, piecePaint, strokeForSize } from './pieceShapes';

export interface PieceIconProps {
  readonly type: PieceType;
  readonly color: Color;
  /** Rendered size in px; also thickens the stroke for small sizes. Omit to size with CSS. */
  readonly size?: number;
  /** Stroke width in viewBox units (100 = one piece). Overrides the size-based default. */
  readonly strokeWidth?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  /** Swap foreground and background, for a piece drawn on an inverted (`bg-foreground`) surface. */
  readonly inverted?: boolean;
  /** Accessible name. Without it the icon is decorative (`aria-hidden`). */
  readonly title?: string;
}

export const PieceIcon = memo(function PieceIcon({
  type,
  color,
  size,
  strokeWidth,
  className,
  style,
  inverted,
  title,
}: PieceIconProps) {
  const paint = inverted ? piecePaint(color, BACKGROUND, FOREGROUND) : piecePaint(color);
  const sw = strokeWidth ?? strokeForSize(size);
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      style={style}
      strokeWidth={sw}
      strokeLinejoin="round"
      strokeLinecap="round"
      data-piece={`${color}${type}`}
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true, focusable: false })}
    >
      {PIECE_SHAPES[type].map((p, i) => {
        const s = partStyle(p.kind, paint);
        return 'circle' in p ? (
          <circle key={i} cx={p.circle[0]} cy={p.circle[1]} r={p.circle[2]} fill={s.fill} stroke={s.stroke} />
        ) : (
          <path key={i} d={p.d} fill={s.fill} stroke={s.stroke} />
        );
      })}
    </svg>
  );
});
