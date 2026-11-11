/**
 * How the game chrome draws a chess piece. The board package owns the real SVG piece set
 * (DESIGN 5.1); the integrator hands it in once through `PieceRenderProvider`. Without a provider
 * the chrome falls back to Unicode chess glyphs in text presentation.
 */
import { createContext } from 'react';
import type { ReactNode } from 'react';
import type { Color, PieceType } from '@/lib/types';

/**
 * Renders one piece. `className` carries the size (e.g. `w-4 h-4`); the piece set should fill it.
 * White pieces are outlined, black pieces solid (DESIGN 5.1).
 */
export type PieceRender = (type: PieceType, color: Color, className?: string) => ReactNode;

export const PieceRenderContext = createContext<PieceRender | null>(null);

/** Unicode chess symbols: outlined for white, solid for black. */
export const PIECE_CHARS: Record<Color, Record<PieceType, string>> = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};

/** Variation selector 15: forces text (not emoji) presentation, so ♟ never turns into a colored emoji. */
export const TEXT_VS = '︎';
