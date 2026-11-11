/**
 * Types of the board package (1A). Cross-package shapes live in `src/lib/types.ts`; these are
 * local to the board and re-exported from `components/board/index.ts`.
 */
import type { Color, Game, PromotionPiece, Seating, Square, Uci } from '@/lib/types';

/** A queued move for the opponent's turn (DESIGN 6.3). */
export interface Premove {
  readonly from: Square;
  readonly to: Square;
  /** Set when a pawn premoves to the last rank; absent means queen. */
  readonly promotion?: PromotionPiece;
}

/** Transient highlights the parent drives (hint bulb, threat peek, blunder guard). */
export interface BoardHighlights {
  /**
   * Squares that play the green hint pulse once (DESIGN 7.3). Pass a new array to replay the
   * pulse; the first square also takes the keyboard focus ("hints move focus to the square").
   */
  readonly hint?: readonly Square[];
  /** Squares shaded `destructive/10` while the threat peek is held. */
  readonly threats?: readonly Square[];
  /**
   * Square whose piece pulses red once (blunder guard, DESIGN 7.2). Shown only with helpers on.
   * Pass the square again after a change (or set `blunderKey`) to replay the pulse.
   */
  readonly blunder?: Square | null;
  /** Bump to replay the blunder pulse on the same square. */
  readonly blunderKey?: number;
}

/** Which side(s) the person at this board may move. */
export type Movable = Color | 'both' | 'none';

export interface ChessBoardProps {
  /** The game to show (controlled). The board draws `game.fen` and never changes the game itself. */
  readonly game: Game;
  /** Color drawn at the bottom. */
  readonly orientation: Color;
  /** Helpers bundle (DESIGN 7.1): legal-move dots, last move, check glow, coordinates, blunder pulse. */
  readonly helpers: boolean;
  /** Accept input at all. False for previews, review, game over, locked rooms. Default true. */
  readonly interactive?: boolean;
  /**
   * Which pieces the person may move. `both` (pass-and-play, default): whichever side is to move.
   * A color: only that side, on its turn; on the other side's turn it may queue a premove when
   * `onPremove` is given. `none`: nothing.
   */
  readonly movable?: Movable;
  /** Pass-and-play seating (DESIGN 5.2). `face` draws the far side's pieces rotated 180°. Default `side`. */
  readonly seating?: Seating;
  /** The queued premove to draw with dashed rings, or null. */
  readonly premove?: Premove | null;
  readonly highlights?: BoardHighlights;
  /**
   * A move was made on the board (tap-tap, drag, keyboard or typed SAN). Always a legal move of
   * the side to move, as canonical UCI with the promotion letter (`e7e8q` when auto-queened).
   */
  readonly onMove: (uci: Uci) => void;
  /** A premove was queued (`Premove`) or cancelled (`null`). Without it, premoves are off. */
  readonly onPremove?: (premove: Premove | null) => void;
  /**
   * Listen for typed SAN on the whole window, not only while the board has focus. Default: true
   * when interactive. Keys typed into inputs or with Ctrl/Meta/Alt are ignored; `z` is never
   * taken (undo / redo belong to the page).
   */
  readonly captureKeys?: boolean;
  /** Announce each new move in a polite live region (DESIGN 14.1). Default true. */
  readonly announce?: boolean;
  /** CSS length for `--cell-size`. Default `clamp(34px, min(11.5vw, 10vh), 96px)` (DESIGN 5.1). */
  readonly cellSize?: string;
  /** Extra classes on the outer wrapper (e.g. the blur of the start-screen preview). */
  readonly className?: string;
}
