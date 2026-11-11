import { useContext, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { Color, PieceType } from '@/lib/types';
import { PIECE_CHARS, PieceRenderContext, TEXT_VS, type PieceRender } from './pieceContext';
import { figurineParts } from './notation';

/** Supplies the board's SVG piece set to every piece drawn by the game chrome. */
export function PieceRenderProvider({ render, children }: { render: PieceRender; children: ReactNode }) {
  return <PieceRenderContext.Provider value={render}>{children}</PieceRenderContext.Provider>;
}

export interface PieceGlyphProps {
  type: PieceType;
  color: Color;
  /** Size classes, e.g. `w-4 h-4`. */
  className?: string;
}

/** One decorative piece (aria-hidden): the provided piece set, or a Unicode glyph. */
export function PieceGlyph({ type, color, className }: PieceGlyphProps) {
  const render = useContext(PieceRenderContext);
  if (render) {
    return (
      <span aria-hidden="true" data-piece={`${color}${type}`} className={cn('inline-flex shrink-0 items-center justify-center', className)}>
        {render(type, color, 'w-full h-full')}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      data-piece={`${color}${type}`}
      className={cn('inline-flex shrink-0 items-center justify-center leading-none font-normal', className)}
    >
      {PIECE_CHARS[color][type] + TEXT_VS}
    </span>
  );
}

export interface FigurineSanProps {
  san: string;
  /** Color of the side that made the move; its figurines are drawn in that color. */
  color: Color;
  className?: string;
}

/**
 * A SAN move in figurine notation (DESIGN 14: figurines in the UI, letters in PGN).
 * Screen readers get the English SAN as visually hidden text; the figurine rendering is aria-hidden.
 */
export function FigurineSan({ san, color, className }: FigurineSanProps) {
  return (
    <span className={cn('inline-flex items-baseline whitespace-nowrap', className)} data-san={san}>
      <span className="sr-only">{san}</span>
      <span aria-hidden="true" className="inline-flex items-baseline">
        {figurineParts(san).map((part, i) =>
          typeof part === 'string' ? (
            <span key={i}>{part}</span>
          ) : (
            <PieceGlyph key={i} type={part.piece} color={color} className="w-[1.05em] h-[1.05em] self-center" />
          ),
        )}
      </span>
    </span>
  );
}
