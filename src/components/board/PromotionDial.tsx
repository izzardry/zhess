/**
 * Promotion dial (DESIGN 6.2): the Ztyle radial dial (chapter 08) ported from Zudoku's
 * `SudokuCell`, with four items Q R B N instead of nine digits.
 *
 * - Q at 12 o'clock, then clockwise R, B, N, on a 60 px radius; 40 px items.
 * - Center `×` (< 25 px from the start point) cancels.
 * - Aim zone 40–55 px: the item under the angle is aimed (`dial-item--aim`, scale 1.6).
 * - Commit zone ≥ 55 px: the item pops out to 105 px and inverts (`dial-item--commit`).
 * - Promotion has no secondary action, so releasing in the aim zone also commits (decision).
 * - Rubber band from the dial center to the pointer; portaled to `document.body`, clamped 80 px
 *   inside the viewport.
 *
 * The component is presentational: the board's input hook owns the pointer and keyboard and
 * passes the aim in. Items are clickable for mouse and keyboard users.
 */
import { createPortal } from 'react-dom';
import type { KeyboardEvent, RefObject } from 'react';
import { cn } from '@/lib/utils';
import type { Color, PromotionPiece } from '@/lib/types';
import { PieceIcon } from './PieceIcon';
import { DIAL_PIECES, DIAL_POP_RADIUS, DIAL_RADIUS, type DialZone } from './dial';

export interface PromotionDialProps {
  /** Dial center in client coordinates (already clamped). */
  readonly x: number;
  readonly y: number;
  /** Color of the promoting pawn: draws the items in that side's style. */
  readonly color: Color;
  /** Aimed piece, if any. */
  readonly aim: PromotionPiece | null;
  readonly zone: DialZone;
  /** Pointer offset from the dial center for the rubber band (0, 0 hides it). */
  readonly dx: number;
  readonly dy: number;
  /** Rotate the item glyphs 180° (far player in face-to-face seating). */
  readonly rotated?: boolean;
  /** Translated piece names and labels. */
  readonly labels: { readonly title: string; readonly keys: string; readonly cancel: string } & Readonly<
    Record<PromotionPiece, string>
  >;
  /** A piece was clicked (or null for the center). */
  readonly onChoose: (piece: PromotionPiece | null) => void;
  /** Keyboard handling while the dial has focus. */
  readonly onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  readonly menuRef?: RefObject<HTMLDivElement>;
}

export function PromotionDial({
  x,
  y,
  color,
  aim,
  zone,
  dx,
  dy,
  rotated,
  labels,
  onChoose,
  onKeyDown,
  menuRef,
}: PromotionDialProps) {
  if (typeof document === 'undefined') return null;
  const n = DIAL_PIECES.length;
  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={labels.title}
      aria-description={labels.keys}
      aria-activedescendant={aim ? `zhess-dial-${aim}` : undefined}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-testid="promotion-dial"
      data-zhess-dial=""
      className="fixed z-overlay select-none outline-none animate-scale-in"
      style={{ left: x, top: y, width: 0, height: 0 }}
    >
      {(dx !== 0 || dy !== 0) && (
        <svg
          className="pointer-events-none absolute text-foreground"
          style={{ left: 0, top: 0, overflow: 'visible' }}
          width="1"
          height="1"
          aria-hidden
        >
          <line x1="0" y1="0" x2={dx} y2={dy} stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" strokeLinecap="round" />
        </svg>
      )}
      <button
        type="button"
        role="menuitem"
        aria-label={labels.cancel}
        onPointerDown={(e) => {
          e.preventDefault();
          onChoose(null);
        }}
        className={cn('dial-item cursor-pointer', zone === 'center' && 'dial-item--commit')}
        style={{ left: -20, top: -20 }}
      >
        <span aria-hidden>×</span>
      </button>
      {DIAL_PIECES.map((piece, i) => {
        const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
        const hovered = aim === piece;
        const r = hovered && zone === 'commit' ? DIAL_POP_RADIUS : DIAL_RADIUS;
        const commit = hovered && zone === 'commit';
        return (
          <button
            key={piece}
            id={`zhess-dial-${piece}`}
            type="button"
            role="menuitem"
            aria-label={labels[piece]}
            data-piece={piece}
            data-aimed={hovered || undefined}
            onPointerDown={(e) => {
              e.preventDefault();
              onChoose(piece);
            }}
            className={cn(
              'dial-item cursor-pointer p-1.5',
              hovered && !commit && 'dial-item--aim',
              commit && 'dial-item--commit',
            )}
            style={{
              left: Math.cos(angle) * r - 20,
              top: Math.sin(angle) * r - 20,
              transform: hovered ? 'scale(1.6)' : 'scale(1)',
            }}
          >
            <PieceIcon
              type={piece}
              color={color}
              inverted={commit}
              size={26}
              className={cn('h-full w-full', rotated && 'rotate-180')}
            />
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
