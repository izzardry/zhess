/**
 * Pure helpers of the stage (pages/Index.tsx): what the board, strips, pill and overlay show for a
 * session. No React, no DOM, so they are unit-tested on their own.
 */
import type { GameSession } from '@/lib/gameRecord';
import { formatClock, formatElapsed, isLowTime } from '@/lib/timeUtils';
import type { Color, Game, Mode, PgnMeta, TimeControl } from '@/lib/types';
import zhess, { clockRunning, legalMoves, parseTc } from '@/lib/zhess';

/**
 * Modes that can be started in this build. Milestone 2 turns `computer` on, milestone 3 `room`;
 * until then the Start pill answers them with a `Coming soon` toast (PLAN Integrator 1).
 */
export const PLAYABLE_MODES: Readonly<Record<Mode, boolean>> = {
  local: true,
  computer: false,
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

/** Time used by both sides up to the cursor (overlay summary). */
export function totalTime(g: Game): number {
  let ms = 0;
  for (let i = 0; i < g.cursor; i++) ms += g.plies[i].ms;
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

export interface StripClockView {
  text: string;
  running: boolean;
  low: boolean;
  flagged: boolean;
  untimed: boolean;
  /** Remaining (timed) or used (untimed) ms. */
  ms: number;
}

/**
 * The strip's time slot for one side (DESIGN 4.2, 11): remaining time with a clock, else the time
 * used, dimmed. `liveMs` is what the side to move has spent on the running turn.
 */
export function stripClock(g: Game, tcString: string | null, color: Color, live: boolean, liveMs: number): StripClockView {
  const tc: TimeControl = parseTc(tcString);
  const base = zhess.clocks(g, tc)[color];
  const toMove = live && g.turn === color && !g.end;
  if (!tc) {
    const ms = base + (toMove ? liveMs : 0);
    return { text: formatElapsed(ms), running: false, low: false, flagged: false, untimed: true, ms };
  }
  const running = toMove && clockRunning(g);
  const ms = Math.max(0, base - (running ? liveMs : 0));
  // The flag falls on the side to move (DESIGN 11): at 0 the clock reads `0.0` in `destructive`.
  const flagged = (g.end?.by === 'time' && g.turn === color) || ms <= 0;
  return { text: formatClock(ms), running, low: isLowTime(ms), flagged, untimed: false, ms };
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
