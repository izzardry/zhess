/**
 * Local persistence (DESIGN 13.1, 12.1, Ztyle chapter 11).
 *
 * Keys are `zhess:<key>`. Values are JSON. Every read and write is wrapped in try/catch: private
 * mode, a full quota or corrupt data never break the app; reads fall back to defaults.
 */
import type { Room, SavedGame, Store } from './types';

/** The key prefix of every stored value. */
export const PREFIX = 'zhess:';

/** Most games kept (DESIGN 12.1). */
export const MAX_GAMES = 100;

/** Storage keys of DESIGN 13.1, without prefix. */
export const KEYS = {
  games: 'games',
  rooms: 'rooms',
  opponent: 'opponent',
  color: 'color',
  clock: 'clock',
  helpers: 'helpers',
  seating: 'seating',
  lang: 'lang',
  tutorialSeen: 'tutorial-seen',
  donationShown: 'donation-shown',
  installDismissed: 'install-dismissed',
} as const;

/** The part of the Web Storage API the store uses. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** A storage, or a function that returns one (evaluated on every access, inside try/catch). */
export type StorageSource = StorageLike | null | undefined | (() => StorageLike | null | undefined);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Shape check for a stored game; drops entries that would crash the UI. */
export function isSavedGame(v: unknown): v is SavedGame {
  return (
    isObj(v) &&
    typeof v.id === 'string' &&
    typeof v.code === 'string' &&
    (v.mode === 'computer' || v.mode === 'local' || v.mode === 'room') &&
    (v.color === 'w' || v.color === 'b') &&
    typeof v.moves === 'string' &&
    Array.isArray(v.ms) &&
    typeof v.createdAt === 'number' &&
    typeof v.lastPlayedAt === 'number'
  );
}

/** Shape check for a stored room record. */
export function isRoom(v: unknown): v is Room {
  return (
    isObj(v) &&
    typeof v.code === 'string' &&
    typeof v.key === 'string' &&
    (v.seat === 0 || v.seat === 1) &&
    Array.isArray(v.score) &&
    v.score.length === 2 &&
    Array.isArray(v.games)
  );
}

/** Newest `lastPlayedAt` first; stable for equal stamps. */
function sortGames(games: SavedGame[]): SavedGame[] {
  return games
    .map((g, i) => [g, i] as const)
    .sort((a, b) => b[0].lastPlayedAt - a[0].lastPlayedAt || a[1] - b[1])
    .map(([g]) => g);
}

/** A `Store` over any Storage-like object (tests pass an in-memory one). */
export function createStore(source: StorageSource): Store {
  const storage = (): StorageLike | null => {
    try {
      const s = typeof source === 'function' ? source() : source;
      return s ?? null;
    } catch {
      return null;
    }
  };

  const readRaw = (key: string): string | null => {
    try {
      return storage()?.getItem(PREFIX + key) ?? null;
    } catch {
      return null;
    }
  };

  const write = (key: string, value: unknown): void => {
    try {
      storage()?.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* quota or private mode: keep running without persistence */
    }
  };

  const readList = <T>(key: string, guard: (v: unknown) => v is T): T[] => {
    const raw = readRaw(key);
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(guard) : [];
    } catch {
      return [];
    }
  };

  const writeGames = (games: SavedGame[]) => write(KEYS.games, sortGames(games).slice(0, MAX_GAMES));

  return {
    games: () => sortGames(readList(KEYS.games, isSavedGame)),

    saveGame(g) {
      const rest = readList(KEYS.games, isSavedGame).filter((x) => x.id !== g.id);
      writeGames([g, ...rest]);
    },

    deleteGame(id) {
      const all = readList(KEYS.games, isSavedGame);
      const found = all.find((x) => x.id === id);
      if (!found) return undefined;
      writeGames(all.filter((x) => x.id !== id));
      return found;
    },

    restoreGame(g) {
      const rest = readList(KEYS.games, isSavedGame).filter((x) => x.id !== g.id);
      writeGames([g, ...rest]);
    },

    rooms: () => readList(KEYS.rooms, isRoom),

    saveRoom(r) {
      const rest = readList(KEYS.rooms, isRoom).filter((x) => x.code !== r.code);
      write(KEYS.rooms, [r, ...rest]);
    },

    deleteRoom(code) {
      const all = readList(KEYS.rooms, isRoom);
      const found = all.find((x) => x.code === code);
      if (!found) return undefined;
      write(
        KEYS.rooms,
        all.filter((x) => x.code !== code),
      );
      return found;
    },

    pref<T>(key: string, fallback: T): T {
      const raw = readRaw(key);
      if (raw === null) return fallback;
      try {
        const v: unknown = JSON.parse(raw);
        if (v === null || v === undefined) return fallback;
        // A value of another type than the fallback is treated as missing (null fallbacks accept anything).
        if (fallback !== null && fallback !== undefined && typeof v !== typeof fallback) return fallback;
        return v as T;
      } catch {
        // Not JSON: a bare string written by older code or by hand.
        return typeof fallback === 'string' ? (raw as T) : fallback;
      }
    },

    setPref<T>(key: string, value: T): void {
      if (value === undefined) {
        try {
          storage()?.removeItem(PREFIX + key);
        } catch {
          /* ignore */
        }
        return;
      }
      write(key, value);
    },
  };
}

/** The app's store over `window.localStorage` (looked up lazily; absent storage reads as empty). */
export const store: Store = createStore(() => (typeof localStorage === 'undefined' ? null : localStorage));

/** An in-memory Storage-like object for tests and for environments without storage. */
export function memoryStorage(initial: Record<string, string> = {}): StorageLike & { dump(): Record<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    dump: () => Object.fromEntries(data),
  };
}

export default store;
