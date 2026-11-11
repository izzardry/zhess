/**
 * The knight of the piece set (src/components/board/pieceShapes.ts, the same glyph as the app
 * icon) as a self-contained inline SVG, for small illustrations such as the tutorial. Drawn like
 * a white piece (stroke `currentColor`, fill the page background); `solid` draws a black one.
 * The path data is copied so the platform package does not depend on the board package at runtime.
 */
import { cn } from '@/lib/utils';

export interface KnightGlyphProps {
  className?: string;
  solid?: boolean;
  /** Accessible name; decorative (aria-hidden) when omitted. */
  title?: string;
}

const BODY =
  'M33 78 C33 64 40 58 48 50 C42 50 37 54 31 56 C24 58 20 52 24 47 L40 30 C42 24 46 19 50 14 L53 22 C66 25 75 40 72 78 Z';
const DETAIL = 'M58 30 C65 40 67 55 66 70';
const BASE = 'M24 88 H76 V83 Q76 78 71 78 H29 Q24 78 24 83 Z';

export function KnightGlyph({ className, solid = false, title }: KnightGlyphProps) {
  const fill = solid ? 'currentColor' : 'hsl(var(--background))';
  const contrast = solid ? 'hsl(var(--background))' : 'currentColor';
  return (
    <svg
      viewBox="14 8 72 86"
      className={cn('w-4 h-4', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <g stroke="currentColor" strokeWidth={5} strokeLinejoin="round" strokeLinecap="round">
        <path d={BODY} fill={fill} />
        <circle cx={43} cy={33} r={3.5} fill={contrast} stroke="none" />
        <path d={DETAIL} fill="none" stroke={contrast} />
        <path d={BASE} fill={fill} />
      </g>
    </svg>
  );
}
