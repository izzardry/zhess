/**
 * Pure helpers of the stage (pages/Index.tsx): what the board, strips, pill and overlay show for a
 * session. No React, no DOM, so they are unit-tested on their own.
 */
import { clockView, toTimeControl, type ClockView } from '@/lib/clock';
import { flags } from '@/lib/flags';
import type { GameSession } from '@/lib/gameRecord';
import type { Color, Game, Mode, PgnMeta, TcString, TimeControl } from '@/lib/types';
import zhess, { legalMoves, parseTc } from '@/lib/zhess';

/**
 * Modes that can be started in this build. Milestone 2 turned `computer` on (behind
 * `flags.computer`); milestone 3 turns on `room`. Until then the Start pill answers a mode that
 * is off with a `Coming soon` toast (PLAN Integrator 1).
 */
export const PLAYABLE_MODES: Readonly<Record<Mode, boolean>> = {
  local: true,
  computer: flags.computer,
  room: false,
};

/** Duration of the start ⇄ game blur transition (Ztyle 07, Zudoku). */
export const TRANSITION_MS = 500;

/** Minimum horizontal travel of a swipe on the review board (px). */
export const SWIPE_MIN_PX = 40;

/**
 * Board cell size. DESIGN 5.1's `clamp(34px, min(11.5vw, 10vh), 76px)`, with one more bound in
 * portrait: 20rem of height stay free for the chrome, so on short desktop windows the info pill,
 * the two player strips and the toolbar never overlap the board in a game, and the start screen's
 * header and footer barely touch the blurred preview. The board keeps one size in every state, so
 * it never moves. Phones are limited by width (11.5vw) and are unaffected. Mobile landscape has the
 * chrome in side rails, so only the height of the screen limits the board there.
 */
export const CELL_SIZE_PORTRAIT = 'clamp(34px, min(11.5vw, 10vh, calc((100dvh - 20rem) / 8)), 76px)';
export const CELL_SIZE_LANDSCAPE = 'clamp(34px, calc((100dvh - 3rem) / 8), 76px)';

export const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

/** The color drawn at the bottom: white in pass-and-play, the player's side otherwise (DESIGN 5.1). */
export function baseOrientation(s: Pick<GameSession, 'mode' | 'color'>): Color {
  return s.mode === 'local' ? 'w' : s.color;
}

/** SAN of every ply of the live game, including the redo tail (for the move strip and list). */
export function allSan(g: Game): string[] {
  return zhess.san(g.cursor === g.plies.length ? g : zhess.goto(g, g.plies.length));
}

/**
 * Time used by both sides up to the cursor (overlay summary, DESIGN 8.4). The log holds only played
 * plies, so a game lost on time (`tc` given) also counts the flagged turn: the whole time the side
 * to move had left when it began. That follows from the log and the time control alone, so the
 * live overlay, a reload and a saved game all give the same duration.
 */
export function totalTime(g: Game, tc?: TimeControl | TcString | null): number {
  let ms = 0;
  for (let i = 0; i < g.cursor; i++) ms += g.plies[i].ms;
  const control = toTimeControl(tc);
  if (control && g.end?.by === 'time' && g.cursor === g.plies.length) {
    ms += Math.max(0, zhess.clocks(g, control)[g.turn]);
  }
  return ms;
}

/**
 * True when the shown position still has a move to play ("continue from here" is possible). The
 * review view of a finished game carries that game's end, so the position is judged on its own.
 */
export function canContinueFrom(g: Game): boolean {
  if (!g.end) return legalMoves(g).length > 0;
  try {
    return !zhess.replay(g.plies.slice(0, g.cursor), g.start).end;
  } catch {
    return false;
  }
}

/**
 * The strips' clocks in review (DESIGN 12.3): both clocks as they stood at the shown move, not
 * running. A finished game's review view carries the ending; before the last move it does not
 * apply, so it is dropped there (otherwise the side to move at that point would read `0.0`).
 */
export function reviewClockView(view: Game, tc: string | null): ClockView {
  const g = view.end && view.cursor < view.plies.length ? { ...view, end: undefined } : view;
  return clockView(g, parseTc(tc), 0, { live: false });
}

/** PGN headers for a session (English names; DESIGN 14: English letters in PGN). */
export function pgnMeta(s: GameSession, site: string): PgnMeta {
  const d = new Date(s.createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const you = 'Player';
  const cpu = `Zhess Level ${s.level ?? ''}`.trim();
  const [white, black] =
    s.mode === 'computer' ? (s.color === 'w' ? [you, cpu] : [cpu, you]) : s.mode === 'local' ? ['White', 'Black'] : [you, 'Opponent'];
  return {
    event: `Zhess ${s.code}`,
    site,
    date: `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`,
    white,
    black,
    timeControl: parseTc(s.tc),
  };
}
