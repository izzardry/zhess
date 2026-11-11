/**
 * Pure helpers behind the history list (DESIGN 12.2, Ztyle 10 "List card"): grouping by time,
 * the facts on each card, relative time and the room score. No React.
 */
import { zhess } from '@/lib/zhess';
import type { Color, Language, Room, SavedGame } from '@/lib/types';

const DAY = 24 * 60 * 60 * 1000;

/** Most recent games shown above the "N more games" button. */
export const RECENT_GAMES = 5;

export type HistoryGroup = 'today' | 'thisWeek' | 'thisMonth' | 'thisYear' | 'older';
export const HISTORY_GROUPS: readonly HistoryGroup[] = ['today', 'thisWeek', 'thisMonth', 'thisYear', 'older'];

/** Newest `lastPlayedAt` first, without changing the input. */
export function sortByRecent(games: readonly SavedGame[]): SavedGame[] {
  return [...games].sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
}

/** Group of a timestamp as Zudoku draws it: since local midnight, then 7 / 30 / 365 days before it. */
export function groupOf(time: number, now: number): HistoryGroup {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const start = midnight.getTime();
  if (time >= start) return 'today';
  if (time >= start - 7 * DAY) return 'thisWeek';
  if (time >= start - 30 * DAY) return 'thisMonth';
  if (time >= start - 365 * DAY) return 'thisYear';
  return 'older';
}

/** Non-empty groups in order, games newest first. */
export function groupByTime(games: readonly SavedGame[], now: number): { group: HistoryGroup; games: SavedGame[] }[] {
  const buckets = new Map<HistoryGroup, SavedGame[]>(HISTORY_GROUPS.map((g) => [g, []]));
  for (const g of sortByRecent(games)) buckets.get(groupOf(g.lastPlayedAt, now))!.push(g);
  return HISTORY_GROUPS.filter((g) => buckets.get(g)!.length > 0).map((group) => ({ group, games: buckets.get(group)! }));
}

/** Number of plies stored in a game; 0 for an unreadable move string. */
export function plyCount(game: SavedGame): number {
  if (!game.moves) return 0;
  try {
    return zhess.decodeMoves(game.moves).length;
  } catch {
    return Array.isArray(game.ms) ? game.ms.length : 0;
  }
}

/** Full moves started, as the game-over summary counts them (`34 moves`). */
export function moveCount(plies: number): number {
  return Math.ceil(plies / 2);
}

/**
 * Side to move. `SavedGame` carries no start position, so this assumes the standard start
 * (white first); a game continued from a position (DESIGN 12.3) may be off by one.
 */
export function sideToMove(plies: number): Color {
  return plies % 2 === 0 ? 'w' : 'b';
}

/** What the state cell of a card says (DESIGN 12.2). */
export type CardState =
  | { kind: 'yourMove' }
  | { kind: 'theirMove' }
  | { kind: 'toMove'; color: Color }
  | { kind: 'won' }
  | { kind: 'lost' }
  | { kind: 'draw' }
  | { kind: 'result'; text: '1–0' | '0–1' };

export function cardState(game: SavedGame, plies: number = plyCount(game)): CardState {
  if (game.result) {
    if (game.result === '1/2-1/2') return { kind: 'draw' };
    const winner: Color = game.result === '1-0' ? 'w' : 'b';
    if (game.mode === 'local') return { kind: 'result', text: winner === 'w' ? '1–0' : '0–1' };
    return { kind: winner === game.color ? 'won' : 'lost' };
  }
  const turn = sideToMove(plies);
  if (game.mode === 'local') return { kind: 'toMove', color: turn };
  return { kind: turn === game.color ? 'yourMove' : 'theirMove' };
}

/** `2`, `1½`, `½` from half points ×2. */
export function formatPoints(halfPointsX2: number): string {
  const whole = Math.floor(halfPointsX2 / 2);
  const half = halfPointsX2 % 2 === 1;
  if (!half) return String(whole);
  return whole === 0 ? '½' : `${whole}½`;
}

/** Room score from this device's seat first, `2 – 1` (DESIGN 4.2). */
export function formatRoomScore(room: Pick<Room, 'score' | 'seat'>): string {
  const mine = room.score[room.seat] ?? 0;
  const theirs = room.score[room.seat === 0 ? 1 : 0] ?? 0;
  return `${formatPoints(mine)} – ${formatPoints(theirs)}`;
}

/** The room record a room game belongs to, if this device still has it. */
export function roomOf(game: SavedGame, rooms: readonly Room[] | undefined): Room | undefined {
  if (game.mode !== 'room' || !rooms) return undefined;
  return rooms.find((r) => r.code === game.code || r.games.includes(game.id));
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/**
 * Relative time in the UI language through `Intl.RelativeTimeFormat`: `now`, `5 min. ago`,
 * `3 hr. ago`, `yesterday`, `4 days ago`; from a week back the date (`Nov 3`, with the year when
 * it differs).
 */
export function formatRelativeTime(time: number, now: number, lang: Language): string {
  const diff = Math.max(0, now - time);
  try {
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' });
    if (diff < MINUTE) return rtf.format(0, 'second');
    if (diff < HOUR) return rtf.format(-Math.floor(diff / MINUTE), 'minute');
    if (diff < DAY) return rtf.format(-Math.floor(diff / HOUR), 'hour');
    if (diff < 7 * DAY) {
      // Calendar days, so "yesterday" means yesterday and not "24 hours ago".
      const a = new Date(now);
      a.setHours(0, 0, 0, 0);
      const b = new Date(time);
      b.setHours(0, 0, 0, 0);
      const days = Math.max(1, Math.round((a.getTime() - b.getTime()) / DAY));
      return rtf.format(-days, 'day');
    }
    const d = new Date(time);
    const sameYear = d.getFullYear() === new Date(now).getFullYear();
    return d.toLocaleDateString(lang, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return new Date(time).toISOString().slice(0, 10);
  }
}
