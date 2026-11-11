/**
 * What the game-over overlay says, from the device player's point of view (DESIGN 8.4). Pure.
 */
import type { TranslationKey } from '@/lib/i18n';
import type { Color, GameEnd, Mode } from '@/lib/types';

/** Outcome for this device's player; pass-and-play has no single player and reports `local`. */
export type Outcome = 'win' | 'loss' | 'draw' | 'local';

/** Page tint behind the overlay: `success/12` for a win, `destructive/12` for a loss, none otherwise. */
export type Tint = 'success' | 'destructive' | null;

/** Winning color, or null for a draw. */
export function winner(end: GameEnd): Color | null {
  if (end.result === '1-0') return 'w';
  if (end.result === '0-1') return 'b';
  return null;
}

/** Outcome for the player of `myColor`. Pass-and-play reports `local` unless it is a draw. */
export function outcomeFor(end: GameEnd, mode: Mode, myColor: Color): Outcome {
  const w = winner(end);
  if (w === null) return 'draw';
  if (mode === 'local') return 'local';
  return w === myColor ? 'win' : 'loss';
}

/** The page tint for an ending (none in pass-and-play and for draws). */
export function tintFor(end: GameEnd, mode: Mode, myColor: Color): Tint {
  const o = outcomeFor(end, mode, myColor);
  return o === 'win' ? 'success' : o === 'loss' ? 'destructive' : null;
}

export interface EndTexts {
  /** Show the 🎉 glyph. */
  glyph: boolean;
  title: TranslationKey;
  /** A second line naming the reason, when the title does not say it already. */
  reason?: TranslationKey;
}

const DRAW_REASONS: Partial<Record<GameEnd['by'], TranslationKey>> = {
  stalemate: 'game.reason.stalemate',
  repetition: 'game.reason.repetition',
  fifty: 'game.reason.fifty',
  material: 'game.reason.material',
  agreed: 'game.reason.agreed',
  time: 'game.reason.timeNoMate',
};

/** Glyph, title and reason line of the overlay (DESIGN 8.4 table). */
export function endTexts(end: GameEnd, mode: Mode, myColor: Color): EndTexts {
  const w = winner(end);
  if (w === null) return { glyph: false, title: 'game.title.draw', reason: DRAW_REASONS[end.by] };

  if (mode === 'local') {
    const title: TranslationKey = w === 'w' ? 'game.title.whiteWins' : 'game.title.blackWins';
    const loserIsWhite = w === 'b';
    const reason: TranslationKey | undefined =
      end.by === 'mate'
        ? 'game.reason.mate'
        : end.by === 'resign'
          ? loserIsWhite
            ? 'game.reason.whiteResigned'
            : 'game.reason.blackResigned'
          : end.by === 'time'
            ? loserIsWhite
              ? 'game.reason.whiteTime'
              : 'game.reason.blackTime'
            : undefined;
    return { glyph: true, title, reason };
  }

  if (w === myColor) {
    if (end.by === 'mate') return { glyph: true, title: 'game.title.checkmateWin' };
    if (end.by === 'resign') return { glyph: true, title: 'game.title.youWon', reason: 'game.reason.opponentResigned' };
    if (end.by === 'time') return { glyph: true, title: 'game.title.youWon', reason: 'game.reason.opponentTime' };
    return { glyph: true, title: 'game.title.youWon' };
  }

  if (end.by === 'mate') return { glyph: false, title: 'game.title.checkmateLoss' };
  if (end.by === 'time') return { glyph: false, title: 'game.title.outOfTime' };
  return { glyph: false, title: 'game.title.resigned' };
}

/**
 * Ztyle's page-tint classes for the stage root: `page-tint` (1000 ms background transition) plus
 * `completion-success` / `completion-failure`. Keep `page-tint` on the root at all times so the
 * tint fades in and out.
 */
export function tintClass(tint: Tint): string {
  return tint === 'success' ? 'page-tint completion-success' : tint === 'destructive' ? 'page-tint completion-failure' : 'page-tint';
}
