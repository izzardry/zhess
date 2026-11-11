/**
 * The game on the stage (DESIGN 3, 4, 10.3, 12, 13).
 *
 * Owns the start-screen settings (code, opponent, color pill, clock pill), the open game session
 * (computer or pass-and-play), the undo/redo rules per mode, resign and its undo, autosave of every
 * change, the 15-second "last played" rule, resume, review, "continue from here", the Start pill
 * label, and the URL.
 *
 * Rooms (DESIGN 9, PLAN 7): the room controller owns the game. In room mode this hook runs
 * `useRoom` for the room's code and only reads from it: `session` is derived from the controller's
 * snapshot, moves, takeback requests, resignation and the flag go to the controller, and nothing is
 * saved here (the controller saves the room and its games). Start with `ROOM` creates or joins the
 * room of the shown code (DESIGN 9.2); an invite link (`?s=CODE&o=r`, also with `x` / `y`) opens it
 * at once; Back leaves it. Room addresses carry the code only, never moves (DESIGN 13.2).
 *
 * The rules themselves are pure functions in `lib/gameRecord.ts`; this hook wires them to React,
 * the store, the address bar and the clock. Inject `store`, `now` and `rng` in tests.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defaultRng, isValidCode, normalizeCode } from '@/lib/codes';
import { flags } from '@/lib/flags';
import {
  CLOCK_OFF,
  DEFAULT_LEVEL,
  DEFAULT_OPPONENT,
  LAST_PLAYED_DELAY_MS,
  applyAssisted,
  applyEnd,
  applyGoto,
  applyMove,
  applyRedo,
  applyReopen,
  applyResign,
  applyTimeout,
  applyTouch,
  applyUndo,
  canPlay,
  isRunning,
  clampLevel,
  continueSpec,
  createSession,
  findSolo,
  freshCode,
  gameFromSaved,
  isFinished,
  isSolo,
  notifySavedGames,
  onSavedGamesChange,
  parseClockPref,
  parseColorChoice,
  parseOpponent,
  redoTarget,
  resolveColor,
  sessionFromSaved,
  startPillFor,
  toSavedGame,
  undoRuleFor,
  undoTarget,
  viewOf,
  type GameSession,
  type StartPill,
  type UndoRule,
} from '@/lib/gameRecord';
import type { RoomCreateSettings, RoomState } from '@/lib/room';
import { store as defaultStore } from '@/lib/storage';
import { roomGameId } from '@/lib/sync';
import type {
  Color,
  ColorChoice,
  Game,
  GameEnd,
  Mode,
  Now,
  Opponent,
  Rng,
  SavedGame,
  Store,
  TcString,
} from '@/lib/types';
import {
  appBaseUrl,
  buildUrl,
  gameParams,
  parseUrl,
  roomShareUrl,
  shareUrl as buildShareUrl,
  urlQuery,
  useUrlParams,
  type UrlParams,
} from '@/lib/url';
import zhess from '@/lib/zhess';
import { useRoom, type RoomHandle, type UseRoomOptions } from './useRoom';

export type { GameSession, StartPill, UndoRule } from '@/lib/gameRecord';

/** Where the stage is (DESIGN 4): start screen, a live game, or the read-only review. */
export type Phase = 'start' | 'playing' | 'review';

export interface UseGameStateOptions {
  /** Persistence; defaults to the app store over `localStorage`. */
  store?: Store;
  /** Clock for timestamps and per-ply time; defaults to `Date.now`. */
  now?: Now;
  /** Randomness for codes and the random color; defaults to WebCrypto. */
  rng?: Rng;
  /** Base address for share links; defaults to the current page without hash. */
  baseUrl?: string;
  /**
   * Options of the room session (`useRoom`): tests inject the memory broker, the lock manager,
   * timers or a fake controller. The store, the create intent and the `x` / `y` signals come from
   * this hook.
   */
  room?: Omit<UseRoomOptions, 'enabled' | 'create' | 'offer' | 'answer' | 'onSignalUsed' | 'store'>;
}

/** The room open on the stage (room mode). The game itself lives in the room controller. */
interface RoomOpen {
  readonly code: string;
  /** Start with ROOM: the settings to create the room with if this device has none. Null for links and history. */
  readonly create: RoomCreateSettings | null;
  /** Review cursor (move list jump, stepping), or null while live. */
  readonly review: number | null;
  /** `now()` when the room was opened. */
  readonly openedAt: number;
}

/** Internal state: start-screen settings plus the open session. */
interface State {
  code: string;
  opponent: Opponent;
  colorChoice: ColorChoice;
  tc: TcString | null;
  /** Last solo opponent setting, for "continue from here" (DESIGN 12.3). */
  lastSolo: Opponent;
  session: GameSession | null;
  /** The open room (room mode); `session` is null then. */
  room: RoomOpen | null;
}

interface Ctx {
  store: Store;
  now: Now;
  rng: Rng;
}

/* ---------------------------------------------------------------------------------------------- */
/* Pure helpers (state ⇄ URL)                                                                       */
/* ---------------------------------------------------------------------------------------------- */

function initialSettings(ctx: Ctx): State {
  const opponent = parseOpponent(ctx.store.pref<unknown>('opponent', null));
  return {
    code: '',
    opponent,
    colorChoice: parseColorChoice(ctx.store.pref<unknown>('color', 'random')),
    tc: parseClockPref(ctx.store.pref<unknown>('clock', CLOCK_OFF)),
    lastSolo: isSolo(opponent) ? opponent : DEFAULT_OPPONENT,
    session: null,
    room: null,
  };
}

/**
 * Applies a URL to the state: a room link (preselect ROOM and the code, and open the room right
 * away, DESIGN 4.1), a game link (resume the stored game it names, or open it as a new game on this
 * device without overwriting anything), or start-screen settings.
 */
function applyUrl(prev: State, url: UrlParams, ctx: Ctx): State {
  const games = ctx.store.games();
  const code = url.code ?? (isValidCode(prev.code) ? prev.code : freshCode(games, ctx.rng));
  const isGameLink = !!url.playing || url.moves !== undefined;
  const base: State = { ...prev, code, session: null, room: null };

  if (url.mode === 'room') {
    // The room already open here (a manual-signalling `x` / `y` arriving in this tab): keep it.
    if (prev.room && prev.room.code === code) return prev;
    if (!url.code || !flags.rooms) return { ...base, opponent: { mode: 'room' } };
    return { ...base, opponent: { mode: 'room' }, room: { code, create: null, review: null, openedAt: ctx.now() } };
  }

  if (!isGameLink) {
    // Start-screen link: the parameters preselect the opponent, color and clock.
    let opponent = prev.opponent;
    if (url.mode === 'local') opponent = { mode: 'local' };
    else if (url.mode === 'computer' || (url.level !== undefined && opponent.mode === 'computer')) {
      opponent = { mode: 'computer', level: url.level ?? levelOf(prev) };
    }
    return {
      ...base,
      opponent,
      lastSolo: isSolo(opponent) ? opponent : prev.lastSolo,
      colorChoice: url.color ?? prev.colorChoice,
      tc: url.tc ?? prev.tc,
    };
  }

  const now = ctx.now();
  const mode: Mode = url.mode ?? 'local';
  const saved = findSolo(games, code);
  if (saved && (url.moves === undefined || url.moves === saved.moves)) {
    // A reload, or the device's own link: the stored game.
    return { ...base, session: sessionFromSaved(saved, now) };
  }

  let game: Game | undefined;
  if (url.moves !== undefined) {
    try {
      game = zhess.fromRecord(url.moves, [], url.end, { lenient: true });
    } catch {
      game = undefined;
    }
  }
  const spec = {
    // A different game under a code this device already uses gets a new code (never overwrite).
    code: saved ? freshCode(games, ctx.rng) : code,
    mode,
    level: mode === 'computer' ? (url.level ?? levelOf(prev)) : undefined,
    color: url.color ?? resolveColor(prev.colorChoice, mode, ctx.rng),
    tc: url.tc ?? null,
    game,
  };
  const session = createSession(spec, now);
  return { ...base, code: session.code, session };
}

function levelOf(s: State): number {
  if (s.opponent.mode === 'computer') return s.opponent.level;
  if (s.lastSolo.mode === 'computer') return s.lastSolo.level;
  return DEFAULT_LEVEL;
}

/**
 * What the address bar should say for a state. A room says its code only (DESIGN 13.2). The start
 * screen with `ROOM` selected leaves `o` out: `?s=CODE&o=r` is the invite link, which opens the room
 * at once, and the selection is remembered in `zhess:opponent` anyway.
 */
function desiredUrl(s: State): UrlParams {
  if (s.room) return { code: s.room.code, playing: true, mode: 'room' };
  if (s.session) {
    const rec = toSavedGame(s.session);
    return gameParams(rec);
  }
  return {
    code: isValidCode(s.code) ? s.code : undefined,
    level: s.opponent.mode === 'computer' ? s.opponent.level : undefined,
    mode: s.opponent.mode === 'room' ? undefined : s.opponent.mode,
    color: s.colorChoice === 'random' ? undefined : s.colorChoice,
    tc: s.tc ?? undefined,
  };
}

function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/** The start position, shown while the room controller has not loaded yet. */
const EMPTY_GAME = zhess.newGame();

/**
 * The stage's session for an open room, read from the controller's snapshot (PLAN 7: the controller
 * owns the game). Not saved by this hook. `review` is clamped to the game as it stands now (a
 * takeback may have cut it); reaching the live position means live.
 */
function roomSessionOf(open: RoomOpen, rs: RoomState | null): GameSession {
  const game = rs?.game ?? EMPTY_GAME;
  const cur = rs && rs.logs.length > 0 ? rs.logs[rs.logs.length - 1] : undefined;
  const n = rs?.n ?? 0;
  return {
    id: roomGameId(open.code, n),
    code: open.code,
    mode: 'room',
    color: rs?.color ?? 'w',
    tc: cur?.tc ?? null,
    game,
    assisted: false,
    createdAt: open.openedAt,
    lastPlayedAt: open.openedAt,
    touched: true,
    openedAt: open.openedAt,
    review: open.review === null ? null : Math.max(0, Math.min(open.review, game.cursor)),
    room: { n, epoch: rs?.epoch ?? 0 },
  };
}

/** The stored game of room `code` with the highest game number, if any. */
function latestRoomGame(games: readonly SavedGame[], code: string): SavedGame | null {
  let best: SavedGame | null = null;
  for (const g of games) {
    if (g.mode !== 'room' || g.code !== code) continue;
    if (!best || (g.room?.n ?? 0) > (best.room?.n ?? 0)) best = g;
  }
  return best;
}

/**
 * Whether a stored room game opens its room (reconnects) rather than a read-only review: an
 * unfinished game always does; a finished one when it is the room's current game, so its rematch
 * can be asked for (DESIGN 9.7). Older games of a room open in review (DESIGN 12.2).
 */
function opensRoom(saved: SavedGame, store: Store): boolean {
  if (saved.mode !== 'room' || !flags.rooms) return false;
  if (!isFinished(saved)) return true;
  if (!store.rooms().some((r) => r.code === saved.code)) return false;
  const n = saved.room?.n ?? 0;
  return !store.games().some((g) => g.mode === 'room' && g.code === saved.code && (g.room?.n ?? 0) > n);
}

/* ---------------------------------------------------------------------------------------------- */
/* The hook                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

export interface UseGameState {
  /* ---- where we are ---- */
  /** `start` (no game open), `playing` (live game), `review` (read-only replay). */
  phase: Phase;
  /** The open session, or null on the start screen. `session.game` is the live game. */
  session: GameSession | null;
  /** The game value the board shows: the review position in review, else the live game. Null on the start screen. */
  view: Game | null;

  /* ---- start-screen settings ---- */
  code: string;
  opponent: Opponent;
  colorChoice: ColorChoice;
  /** Clock pill value, e.g. `5+0`, or null for off. */
  tc: TcString | null;
  /** Sets the code (normalized: uppercase `0-9A-Z`, 1–8). Returns false and ignores an empty result. */
  setCode(code: string): boolean;
  /** A new random code that no stored game uses. Returns it. */
  regenerateCode(): string;
  /** Remembered in `zhess:opponent`. */
  setOpponent(o: Opponent): void;
  /** Remembered in `zhess:color`. */
  setColorChoice(c: ColorChoice): void;
  /** Remembered in `zhess:clock` (`off` for null). */
  setTc(tc: TcString | null): void;
  /** Label of the Start pill for the current code and opponent (DESIGN 4.1), and the stored game it refers to. */
  startPill: StartPill;
  /** Position for the blurred start-screen board: the stored game of the code, or the start position. */
  preview: Game;

  /* ---- opening and leaving games ---- */
  /**
   * The Start pill's action: resume or review the stored game of the code, or begin a new game
   * with the selected settings. With `ROOM` selected: create or join the room of the code (DESIGN
   * 9.2). False when rooms are switched off (`flags.rooms`).
   */
  start(): boolean;
  /**
   * Opens a stored game (history tap): resume if unfinished, review if finished. A room game opens
   * its room and reconnects (unfinished, or the room's current game); older room games open in review.
   */
  open(saved: SavedGame): boolean;
  /** "New game" on the overlay: a new code with the current game's mode, level and clock. False in a room (ask for a rematch there). */
  newGame(): boolean;
  /** Back to the start screen. The game is already saved; the code stays selected. Leaves an open room. */
  exit(): void;
  /**
   * The open room (room mode): its view (presence, requests, score, manual exchange, tab guard) and
   * actions. Null outside room mode, also while a finished room game is only reviewed from history.
   */
  room: RoomHandle | null;

  /* ---- playing ---- */
  /**
   * Plays a move (UCI; bare promotions become queens) for the side to move. `ms` is the time the
   * mover used; omitted, the hook's own turn timer is used (time per ply is recorded even
   * without a clock). In a room the move goes to the room controller. Returns false if illegal,
   * over, in review, or not this device's turn.
   */
  move(uci: string, ms?: number): boolean;
  /** Milliseconds the side to move has used on the current turn (paused while the tab is hidden or in review). */
  turnElapsed(): number;
  /** Undo rule of the open game: `ply` (pass-and-play), `turn` (computer), `request` (room). */
  undoRule: UndoRule | null;
  canUndo: boolean;
  canRedo: boolean;
  /** One ply back (pass-and-play) or one full turn back (computer). Marks the game assisted. In a room: asks for a takeback. */
  undo(): boolean;
  /** Replays what undo took back (session-only; empty after a resume). */
  redo(): boolean;
  /** Pass-and-play: the side to move resigns. Computer and room: the player resigns (final in a room). */
  resign(): boolean;
  /** Takes back a resignation, time-out or agreed draw (the 5-second undo toast). */
  reopen(): boolean;
  /** Ends the game with a result decided elsewhere (agreed draw with the computer). */
  finish(end: GameEnd): boolean;
  /** `flagged` ran out of time (loss, or draw if the opponent cannot mate). In a room the controller checks the clock itself. */
  timeout(flagged: Color): boolean;
  /** Marks the game assisted (a hint was used). */
  markAssisted(): void;
  /** True when the live game is over. */
  isOver: boolean;
  /** Live, not over, and it is this device's player's turn (always true in pass-and-play). */
  isPlayerTurn: boolean;
  /** Live computer game, not over, and the computer is to move (milestone 2 plugs the engine in here). */
  isComputerTurn: boolean;

  /* ---- review ---- */
  /** Review cursor, or null while live. */
  reviewCursor: number | null;
  /** Enters review at `cursor` (default: the current position). Leaving it on an unfinished game: `exitReview`. */
  enterReview(cursor?: number): void;
  /** Back to the live position of an unfinished game. No-op for finished games (they stay in review). */
  exitReview(): void;
  /** Jumps to a cursor (move list tap). Enters review; reaching the live position of an unfinished game leaves it. */
  goto(cursor: number): void;
  /** Steps the review by `delta` plies (negative = back). */
  step(delta: number): void;
  toStart(): void;
  toEnd(): void;
  canStepBack: boolean;
  canStepForward: boolean;
  /** "Continue from here": a new game from the shown position with a new code (DESIGN 12.3). */
  continueFromHere(): boolean;

  /* ---- sharing ---- */
  /**
   * Share link (DESIGN 13.2): room invite (`?s=CODE&o=r`) for rooms; the full URL (moves, and
   * the result of a finished game, which then opens in review) for solo games; on the start
   * screen the current settings.
   */
  shareUrl(): string;
}

export function useGameState(options: UseGameStateOptions = {}): UseGameState {
  const store = options.store ?? defaultStore;
  const nowOpt = options.now;
  const rngOpt = options.rng;
  const now = useCallback<Now>(() => (nowOpt ? nowOpt() : Date.now()), [nowOpt]);
  const rng = useCallback<Rng>(() => (rngOpt ? rngOpt() : defaultRng()), [rngOpt]);
  const ctx = useMemo<Ctx>(() => ({ store, now, rng }), [store, now, rng]);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const url = useUrlParams();
  const { write, isOwnWrite, search } = url;

  const [state, setState] = useState<State>(() => applyUrl(initialSettings(ctx), parseUrl(search), ctx));
  const ref = useRef(state);

  /* ---- the open room (DESIGN 9): the controller owns its game; this hook only reads it ---- */
  const roomOpen = state.room;
  const roomHandle = useRoom(roomOpen?.code ?? null, {
    ...options.room,
    store,
    enabled: !!roomOpen,
    create: roomOpen?.create ?? null,
    offer: roomOpen ? (url.params.offer ?? null) : null,
    answer: roomOpen ? (url.params.answer ?? null) : null,
    // `x` and `y` are transient: once used they leave the address bar (DESIGN 13.2).
    onSignalUsed: () => write({ ...desiredUrl(ref.current), offer: '', answer: '' }),
  });
  const roomRef = useRef(roomHandle);
  roomRef.current = roomHandle;
  const roomState = roomOpen ? roomHandle.state : null;
  const roomStateRef = useRef(roomState);
  roomStateRef.current = roomState;

  // The controller saves the room's games itself: tell the history and the Start pill.
  // The controller keeps `logs` as the same array until a game changes, so this runs per change.
  const roomLogs = roomState?.logs;
  useEffect(() => {
    if (roomLogs) notifySavedGames();
  }, [roomLogs]);

  /* ---- turn timer: ms per ply even without a clock ---- */
  const turn = useRef<{ used: number; since: number | null }>({ used: 0, since: null });
  const timerInit = useRef(false);
  if (!timerInit.current) {
    timerInit.current = true;
    if (isRunning(state.session) && isVisible()) turn.current.since = now();
  }

  const turnElapsed = useCallback(() => {
    if (ref.current.room) return roomRef.current.elapsed();
    const t = turn.current;
    return Math.max(0, t.used + (t.since !== null ? ctxRef.current.now() - t.since : 0));
  }, []);

  /** Sets state; keeps the turn timer in step with the live game. */
  const commit = useCallback((next: State) => {
    const prev = ref.current;
    ref.current = next;
    const t = turn.current;
    const running = isRunning(next.session) && isVisible();
    const at = ctxRef.current.now();
    if (prev.session?.game !== next.session?.game || prev.session?.id !== next.session?.id) {
      t.used = 0;
      t.since = running ? at : null;
    } else if (running && t.since === null) {
      t.since = at;
    } else if (!running && t.since !== null) {
      t.used += at - t.since;
      t.since = null;
    }
    setState(next);
  }, []);

  /** Updates the session with a transition; returns whether it applied. */
  const update = useCallback(
    (fn: (s: GameSession, at: number) => GameSession | null): boolean => {
      const st = ref.current;
      if (!st.session) return false;
      const next = fn(st.session, ctxRef.current.now());
      if (!next) return false;
      if (next !== st.session) commit({ ...st, session: next });
      return true;
    },
    [commit],
  );

  /* ---- pause the turn timer while the tab is hidden ---- */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = () => {
      const t = turn.current;
      const at = ctxRef.current.now();
      if (document.visibilityState === 'hidden') {
        if (t.since !== null) {
          t.used += at - t.since;
          t.since = null;
        }
      } else if (t.since === null && isRunning(ref.current.session)) {
        t.since = at;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  /* ---- URL: external changes in, own state out ---- */
  const handled = useRef(search);
  useEffect(() => {
    if (search === handled.current) return;
    handled.current = search;
    if (isOwnWrite(search)) return;
    // Another package's parameters (x, y) or a URL that already says what the state says.
    const incoming = parseUrl(search);
    if (urlQuery({ ...incoming, offer: undefined, answer: undefined }) === urlQuery(desiredUrl(ref.current))) return;
    // A link pasted into a running tab, or a hash edited by hand.
    commit(applyUrl(ref.current, incoming, ctxRef.current));
  }, [search, isOwnWrite, commit]);

  const desired = useMemo(() => desiredUrl(state), [state]);
  const desiredKey = urlQuery(desired);
  const desiredRef = useRef(desired);
  desiredRef.current = desired;
  useEffect(() => {
    write(desiredRef.current);
  }, [desiredKey, write]);

  /* ---- autosave on every change (DESIGN 12.1) ---- */
  const lastSaved = useRef<string | null>(null);
  useEffect(() => {
    const s = state.session;
    if (!s || !s.touched || s.mode === 'room') return;
    const rec = toSavedGame(s);
    const json = JSON.stringify(rec);
    if (json === lastSaved.current) return;
    lastSaved.current = json;
    store.saveGame(rec);
    notifySavedGames();
  }, [state.session, store]);

  /* ---- the 15-second "last played" rule ---- */
  const sessionId = state.session?.id;
  const touched = state.session?.touched ?? true;
  const openedAt = state.session?.openedAt ?? 0;
  useEffect(() => {
    if (sessionId === undefined || touched) return;
    const wait = Math.max(0, LAST_PLAYED_DELAY_MS - (ctxRef.current.now() - openedAt));
    const id = setTimeout(() => {
      const st = ref.current;
      if (!st.session || st.session.id !== sessionId || st.session.touched) return;
      commit({ ...st, session: applyTouch(st.session, ctxRef.current.now()) });
    }, wait);
    return () => clearTimeout(id);
  }, [sessionId, touched, openedAt, commit]);

  /* ---- stored games (start pill, preview) ---- */
  const [savedVersion, setSavedVersion] = useState(0);
  useEffect(() => {
    const bump = () => setSavedVersion((v) => v + 1);
    const off = onSavedGamesChange(bump);
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key.startsWith('zhess:')) bump();
    };
    window.addEventListener('storage', onStorage);
    // The autosave effect above runs before this subscription on mount (a game opened from a
    // link is saved at once): re-read the store so the Start pill knows that game after Back.
    bump();
    return () => {
      off();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const startPill = useMemo(
    () => startPillFor(state.code, state.opponent, store.games()),
    // savedVersion re-reads the store after saves and deletes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.code, state.opponent, store, savedVersion],
  );
  // With ROOM selected, the preview shows the current game of that room if this device has one.
  const roomPreview = useMemo(
    () => (state.opponent.mode === 'room' ? latestRoomGame(store.games(), state.code) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.code, state.opponent, store, savedVersion],
  );
  const previewSaved = startPill.saved ?? roomPreview;
  const preview = useMemo(() => (previewSaved ? gameFromSaved(previewSaved) : zhess.newGame()), [previewSaved]);

  /* ---- settings ---- */
  const setCode = useCallback(
    (input: string) => {
      const code = normalizeCode(input);
      if (!isValidCode(code)) return false;
      const st = ref.current;
      if (st.code !== code) commit({ ...st, code });
      return true;
    },
    [commit],
  );

  const regenerateCode = useCallback(() => {
    const code = freshCode(ctxRef.current.store.games(), ctxRef.current.rng);
    commit({ ...ref.current, code });
    return code;
  }, [commit]);

  const setOpponent = useCallback(
    (o: Opponent) => {
      const opponent = o.mode === 'computer' ? { mode: 'computer' as const, level: clampLevel(o.level) ?? DEFAULT_LEVEL } : o;
      ctxRef.current.store.setPref('opponent', opponent);
      const st = ref.current;
      commit({ ...st, opponent, lastSolo: isSolo(opponent) ? opponent : st.lastSolo });
    },
    [commit],
  );

  const setColorChoice = useCallback(
    (c: ColorChoice) => {
      ctxRef.current.store.setPref('color', c);
      commit({ ...ref.current, colorChoice: c });
    },
    [commit],
  );

  const setTc = useCallback(
    (tc: TcString | null) => {
      const value = parseClockPref(tc ?? CLOCK_OFF);
      ctxRef.current.store.setPref('clock', value ?? CLOCK_OFF);
      commit({ ...ref.current, tc: value });
    },
    [commit],
  );

  /* ---- opening and leaving ---- */
  const openSaved = useCallback(
    (saved: SavedGame) => {
      const st = ref.current;
      const at = ctxRef.current.now();
      if (opensRoom(saved, ctxRef.current.store)) {
        // Resuming a room game reconnects to its room (the controller loads it from the store).
        commit({ ...st, code: saved.code, session: null, room: { code: saved.code, create: null, review: null, openedAt: at } });
        return true;
      }
      if (saved.mode === 'room' && !isFinished(saved)) return false;
      commit({ ...st, code: saved.code, room: null, session: sessionFromSaved(saved, at) });
      return true;
    },
    [commit],
  );

  const start = useCallback(() => {
    const st = ref.current;
    const { store: s, rng: r, now: n } = ctxRef.current;
    if (st.opponent.mode === 'room') {
      // Creating and joining are the same action (DESIGN 9.2): the controller finds out which.
      if (!flags.rooms) return false;
      const code = isValidCode(st.code) ? st.code : freshCode(s.games(), r);
      const create: RoomCreateSettings = { tc: st.tc, color: st.colorChoice };
      commit({ ...st, code, session: null, room: { code, create, review: null, openedAt: n() } });
      return true;
    }
    const games = s.games();
    const code = isValidCode(st.code) ? st.code : freshCode(games, r);
    const pill = startPillFor(code, st.opponent, games);
    if (pill.saved) return openSaved(pill.saved);
    const mode = st.opponent.mode;
    const session = createSession(
      {
        code,
        mode,
        level: st.opponent.mode === 'computer' ? st.opponent.level : undefined,
        color: resolveColor(st.colorChoice, mode, r),
        tc: st.tc,
      },
      n(),
    );
    commit({ ...st, code, room: null, session });
    return true;
  }, [commit, openSaved]);

  const newGame = useCallback(() => {
    const st = ref.current;
    const { store: s, rng: r, now: n } = ctxRef.current;
    const cur = st.session;
    const mode: Mode = cur ? cur.mode : st.opponent.mode;
    if (mode === 'room' || st.room) return false;
    const level = cur ? cur.level : st.opponent.mode === 'computer' ? st.opponent.level : undefined;
    const code = freshCode(s.games(), r);
    const session = createSession(
      { code, mode, level, color: resolveColor(st.colorChoice, mode, r), tc: cur ? cur.tc : st.tc },
      n(),
    );
    commit({ ...st, code, room: null, session });
    return true;
  }, [commit]);

  const exit = useCallback(() => {
    const st = ref.current;
    if (st.room) {
      // Leaving the room: useRoom disposes its session (transport closed, lock released, turn banked).
      commit({ ...st, code: st.room.code, session: null, room: null });
      notifySavedGames();
      return;
    }
    if (!st.session) return;
    commit({ ...st, code: st.session.code, session: null });
  }, [commit]);

  /* ---- playing ---- */
  const move = useCallback(
    (uci: string, ms?: number) => {
      const st = ref.current;
      if (st.room) return st.room.review === null && roomRef.current.move(uci, ms);
      return update((s, at) => applyMove(s, uci, ms ?? turnElapsed(), at));
    },
    [update, turnElapsed],
  );
  const undo = useCallback(() => {
    // In a room, undo is a takeback request (DESIGN 4.2, 9.7).
    if (ref.current.room) return ref.current.room.review === null && roomRef.current.ask('takeback');
    return update((s, at) => applyUndo(s, at));
  }, [update]);
  const redo = useCallback(() => update((s, at) => applyRedo(s, at)), [update]);
  const resign = useCallback(() => {
    if (ref.current.room) return roomRef.current.resign();
    return update((s, at) => applyResign(s, at));
  }, [update]);
  const reopen = useCallback(() => update((s, at) => applyReopen(s, at)), [update]);
  const finish = useCallback((end: GameEnd) => update((s, at) => applyEnd(s, end, at)), [update]);
  const timeout = useCallback(
    (flagged: Color) => {
      // The controller decides: its own flag at zero, the opponent's 2 s past zero (DESIGN 9.8).
      if (ref.current.room) return roomRef.current.flag();
      return update((s, at) => applyTimeout(s, flagged, at));
    },
    [update],
  );
  const markAssisted = useCallback(() => {
    update((s) => applyAssisted(s));
  }, [update]);

  /* ---- review ---- */
  /** Room mode: sets the review cursor; reaching the live position means live. */
  const roomGoto = useCallback(
    (cursor: (review: number | null, max: number) => number, keepAtMax = false) => {
      const st = ref.current;
      if (!st.room) return;
      const max = roomRef.current.state?.game.cursor ?? 0;
      const c = Math.max(0, Math.min(max, Math.floor(cursor(st.room.review, max))));
      const review = c === max && !keepAtMax ? null : c;
      if (review !== st.room.review) commit({ ...st, room: { ...st.room, review } });
    },
    [commit],
  );
  const goto = useCallback(
    (cursor: number) => {
      if (ref.current.room) roomGoto(() => cursor);
      else update((s) => applyGoto(s, cursor));
    },
    [update, roomGoto],
  );
  const step = useCallback(
    (delta: number) => {
      if (ref.current.room) roomGoto((r, max) => (r ?? max) + Math.trunc(delta));
      else update((s) => applyGoto(s, (s.review ?? s.game.cursor) + Math.trunc(delta)));
    },
    [update, roomGoto],
  );
  const toStart = useCallback(() => goto(0), [goto]);
  const toEnd = useCallback(() => {
    if (ref.current.room) roomGoto((_, max) => max);
    else update((s) => applyGoto(s, s.game.cursor));
  }, [update, roomGoto]);
  const enterReview = useCallback(
    (cursor?: number) => {
      if (ref.current.room) {
        roomGoto((r, max) => cursor ?? r ?? max, true);
        return;
      }
      update((s) => {
        const c = Math.max(0, Math.min(s.game.cursor, Math.floor(cursor ?? s.review ?? s.game.cursor)));
        return s.review === c ? s : { ...s, review: c };
      });
    },
    [update, roomGoto],
  );
  const exitReview = useCallback(() => {
    const st = ref.current;
    if (st.room) {
      if (st.room.review !== null) commit({ ...st, room: { ...st.room, review: null } });
      return;
    }
    update((s) => (s.game.end || s.review === null ? s : { ...s, review: null }));
  }, [update, commit]);

  const continueFromHere = useCallback(() => {
    const st = ref.current;
    // In a live room the shown game is the controller's (with this hook's review cursor). The new
    // game is a solo game: room games are never forked into a room (DESIGN 12.3).
    const shown = st.room ? roomSessionOf(st.room, roomStateRef.current) : st.session;
    if (!shown) return false;
    const { store: s, rng: r, now: n } = ctxRef.current;
    const spec = continueSpec(viewOf(shown), st.lastSolo, freshCode(s.games(), r), st.tc);
    if (!spec) return false;
    const session = createSession(spec, n());
    commit({ ...st, code: session.code, room: null, session });
    return true;
  }, [commit]);

  /* ---- sharing ---- */
  const baseUrl = options.baseUrl;
  const shareUrl = useCallback(() => {
    const st = ref.current;
    const base = baseUrl ?? appBaseUrl();
    // Rooms share the invite only: `?s=CODE&o=r`, never moves or the key (DESIGN 13.2).
    if (st.room) return roomShareUrl(st.room.code, base);
    if (st.session) return buildShareUrl(toSavedGame(st.session), base);
    if (st.opponent.mode === 'room' && isValidCode(st.code)) return roomShareUrl(st.code, base);
    return buildUrl(desiredUrl(st), base);
  }, [baseUrl]);

  /* ---- derived ---- */
  const roomGame = roomState?.game ?? null;
  const roomColor = roomState?.color;
  const roomN = roomState?.n;
  const roomEpoch = roomState?.epoch;
  const roomTc = roomState && roomState.logs.length > 0 ? roomState.logs[roomState.logs.length - 1].tc : null;
  const roomSession = useMemo(
    () => (roomOpen ? roomSessionOf(roomOpen, roomStateRef.current) : null),
    // The derived session changes only when what it shows changes (not on every snapshot).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roomOpen, roomGame, roomColor, roomN, roomEpoch, roomTc],
  );
  const session = roomSession ?? state.session;
  const view = useMemo(() => (session ? viewOf(session) : null), [session]);
  const phase: Phase = !session ? 'start' : session.review !== null ? 'review' : 'playing';
  const rule = session ? undoRuleFor(session.mode) : null;
  const live = !!session && session.review === null && session.mode !== 'room';
  const canUndo = roomOpen
    ? session?.review === null && !!roomState?.canAsk.takeback
    : live && !!rule && undoTarget(session.game, rule, session.color) < session.game.cursor;
  const canRedo =
    live && !!rule && !session.game.end && redoTarget(session.game, rule, session.color) > session.game.cursor;
  const playable = canPlay(session);
  const isPlayerTurn = roomOpen
    ? session?.review === null && !!roomState?.canMove
    : playable && (session.mode === 'local' || session.game.turn === session.color);
  const isComputerTurn = playable && session.mode === 'computer' && session.game.turn !== session.color;
  const reviewCursor = session?.review ?? null;
  const viewCursor = session ? (session.review ?? session.game.cursor) : 0;
  const finished = !!session?.game.end;

  return {
    phase,
    session,
    view,

    code: state.code,
    opponent: state.opponent,
    colorChoice: state.colorChoice,
    tc: state.tc,
    setCode,
    regenerateCode,
    setOpponent,
    setColorChoice,
    setTc,
    startPill,
    preview,

    start,
    open: openSaved,
    newGame,
    exit,
    room: roomOpen ? roomHandle : null,

    move,
    turnElapsed,
    undoRule: rule,
    canUndo,
    canRedo,
    undo,
    redo,
    resign,
    reopen,
    finish,
    timeout,
    markAssisted,
    isOver: finished,
    isPlayerTurn,
    isComputerTurn,

    reviewCursor,
    enterReview,
    exitReview,
    goto,
    step,
    toStart,
    toEnd,
    canStepBack: !!session && viewCursor > 0,
    canStepForward: !!session && session.review !== null && session.review < session.game.cursor,
    continueFromHere,

    shareUrl,
  };
}

export default useGameState;
