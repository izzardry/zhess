/**
 * The time already spent on the running turn, kept across a reload and across Back → Resume
 * (DESIGN 11: solo clocks pause on Back and resume on return; Gate 2: a reload loses at most a
 * second).
 *
 * The move log only holds finished plies, so the running turn's time would otherwise be lost.
 * The stage banks `useClock().elapsed()` when the page hides (`pagehide` / `visibilitychange`)
 * and when the player leaves with Back, and hands it back to `useClock` as `initialTurnMs` when
 * the same game opens again at the same position. A bank for another game, another position
 * (a move was made since) or older than `MAX_AGE_MS` is ignored.
 *
 * Kept in `sessionStorage` (one tab's state; not one of the `zhess:` keys of DESIGN 13.1, which
 * are device-wide), with an in-memory fallback when storage is blocked. Pure apart from the
 * injected storage; every access is guarded.
 */
import type { Game, Now } from './types';

export const TURN_BANK_KEY = 'zhess:turn';

/** A bank older than this is stale (a tab reopened the next day starts the turn fresh). */
export const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface BankedTurn {
  /** `GameSession.id`. */
  readonly id: string;
  /** Position the time belongs to. */
  readonly cursor: number;
  readonly fen: string;
  /** Ms spent on that turn. */
  readonly ms: number;
  /** Wall-clock time of banking (`Date.now`). */
  readonly at: number;
}

/** The storage subset used here (`sessionStorage`). */
export type BankStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

let memory: string | null = null;

const memoryStorage: BankStorage = {
  getItem: () => memory,
  setItem: (_k, v) => {
    memory = v;
  },
  removeItem: () => {
    memory = null;
  },
};

function defaultStorage(): BankStorage {
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage) return sessionStorage;
  } catch {
    /* blocked: fall through */
  }
  return memoryStorage;
}

function isBank(v: unknown): v is BankedTurn {
  if (!v || typeof v !== 'object') return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.id === 'string' &&
    typeof b.cursor === 'number' &&
    typeof b.fen === 'string' &&
    typeof b.ms === 'number' &&
    Number.isFinite(b.ms) &&
    typeof b.at === 'number'
  );
}

/** Banks `ms` for the turn at `game`'s cursor of session `id`. Never throws. */
export function bankTurn(id: string, game: Game, ms: number, now: Now = Date.now, storage: BankStorage = defaultStorage()): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  const entry: BankedTurn = { id, cursor: game.cursor, fen: game.fen, ms: Math.round(ms), at: now() };
  const json = JSON.stringify(entry);
  try {
    storage.setItem(TURN_BANK_KEY, json);
  } catch {
    memoryStorage.setItem(TURN_BANK_KEY, json);
  }
}

/** Ms banked for this exact turn (same session, cursor and position, not stale), else 0. Never throws. */
export function bankedTurnMs(id: string, game: Game, now: Now = Date.now, storage: BankStorage = defaultStorage()): number {
  let raw: string | null = null;
  try {
    raw = storage.getItem(TURN_BANK_KEY);
  } catch {
    raw = memoryStorage.getItem(TURN_BANK_KEY);
  }
  if (!raw) return 0;
  let b: unknown;
  try {
    b = JSON.parse(raw);
  } catch {
    return 0;
  }
  if (!isBank(b)) return 0;
  if (b.id !== id || b.cursor !== game.cursor || b.fen !== game.fen || game.end) return 0;
  const age = now() - b.at;
  if (age < 0 || age > MAX_AGE_MS) return 0;
  return Math.max(0, b.ms);
}

/** Forgets the bank. Never throws. */
export function clearBankedTurn(storage: BankStorage = defaultStorage()): void {
  try {
    storage.removeItem(TURN_BANK_KEY);
  } catch {
    /* ignore */
  }
  memoryStorage.removeItem(TURN_BANK_KEY);
}
