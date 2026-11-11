/**
 * The game on the stage (DESIGN 3, 4, 10.3, 12, 13).
 *
 * Owns the start-screen settings (code, opponent, color pill, clock pill), the open game session
 * (computer or pass-and-play; rooms are owned by the room controller and come in milestone 3), the
 * undo/redo rules per mode, resign and its undo, autosave of every change, the 15-second "last
 * played" rule, resume, review, "continue from here", the Start pill label, and the URL.
 *
 * The rules themselves are pure functions in `lib/gameRecord.ts`; this hook wires them to React,
 * the store, the address bar and the clock. Inject `store`, `now` and `rng` in tests.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defaultRng, isValidCode, normalizeCode } from '@/lib/codes';
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
import { store as defaultStore } from '@/lib/storage';
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
  shareUrl as buildShareUrl,
  urlQuery,
  useUrlParams,
  type UrlParams,
} from '@/lib/url';
import zhess from '@/lib/zhess';

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
  /** Code of a room invite link waiting to be started (DESIGN 4.1). */
  invite: string | null;
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
    invite: null,
  };
}

/**
 * Applies a URL to the state: a room invite (preselect ROOM and the code, start right away), a
 * game link (resume the stored game it names, or open it as a new game on this device without
 * overwriting anything), or start-screen settings.
 */
function applyUrl(prev: State, url: UrlParams, ctx: Ctx): State {
  const games = ctx.store.games();
  const code = url.code ?? (isValidCode(prev.code) ? prev.code : freshCode(games, ctx.rng));
  const isGameLink = !!url.playing || url.moves !== undefined;
  const base: State = { ...prev, code, session: null, invite: null };

  if (url.mode === 'room') {
    return { ...base, opponent: { mode: 'room' }, invite: url.playing ? code : null };
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

/** What the address bar should say for a state. */
function desiredUrl(s: State): UrlParams {
  if (s.session) {
    const rec = toSavedGame(s.session);
    return gameParams(rec);
  }
  if (s.invite) return { code: s.invite, playing: true, mode: 'room' };
  return {
    code: isValidCode(s.code) ? s.code : undefined,
    level: s.opponent.mode === 'computer' ? s.opponent.level : undefined,
    mode: s.opponent.mode,
    color: s.colorChoice === 'random' ? undefined : s.colorChoice,
    tc: s.tc ?? undefined,
  };
}

function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
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
   * with the selected settings. Returns false for `ROOM` (milestone 3: show `Coming soon`).
   */
  start(): boolean;
  /** Opens a stored game (history tap): resume if unfinished, review if finished. False for an unfinished room game. */
  open(saved: SavedGame): boolean;
  /** "New game" on the overlay: a new code with the current game's mode, level and clock. */
  newGame(): boolean;
  /** Back to the start screen. The game is already saved; the code stays selected. */
  exit(): void;
  /** Code of a room invite link that should start right away, else null (milestone 3). */
  invite: string | null;
  /** Clears `invite` once it was handled. */
  consumeInvite(): void;

  /* ---- playing ---- */
  /**
   * Plays a move (UCI; bare promotions become queens) for the side to move. `ms` is the time the
   * mover used; omitted, the hook's own turn timer is used (time per ply is recorded even
   * without a clock). Returns false if illegal, over, in review, or in a room.
   */
  move(uci: string, ms?: number): boolean;
  /** Milliseconds the side to move has used on the current turn (paused while the tab is hidden or in review). */
  turnElapsed(): number;
  /** Undo rule of the open game: `ply` (pass-and-play), `turn` (computer), `request` (room). */
  undoRule: UndoRule | null;
  canUndo: boolean;
  canRedo: boolean;
  /** One ply back (pass-and-play) or one full turn back (computer). Marks the game assisted. */
  undo(): boolean;
  /** Replays what undo took back (session-only; empty after a resume). */
  redo(): boolean;
  /** Pass-and-play: the side to move resigns. Computer: the player resigns. */
  resign(): boolean;
  /** Takes back a resignation, time-out or agreed draw (the 5-second undo toast). */
  reopen(): boolean;
  /** Ends the game with a result decided elsewhere (agreed draw with the computer). */
  finish(end: GameEnd): boolean;
  /** `flagged` ran out of time (loss, or draw if the opponent cannot mate). */
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

  /* ---- turn timer: ms per ply even without a clock ---- */
  const turn = useRef<{ used: number; since: number | null }>({ used: 0, since: null });
  const timerInit = useRef(false);
  if (!timerInit.current) {
    timerInit.current = true;
    if (canPlay(state.session) && isVisible()) turn.current.since = now();
  }

  const turnElapsed = useCallback(() => {
    const t = turn.current;
    return Math.max(0, t.used + (t.since !== null ? ctxRef.current.now() - t.since : 0));
  }, []);

  /** Sets state; keeps the turn timer in step with the live game. */
  const commit = useCallback((next: State) => {
    const prev = ref.current;
    ref.current = next;
    const t = turn.current;
    const running = canPlay(next.session) && isVisible();
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
      } else if (t.since === null && canPlay(ref.current.session)) {
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
  const preview = useMemo(() => (startPill.saved ? gameFromSaved(startPill.saved) : zhess.newGame()), [startPill.saved]);

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
      if (saved.mode === 'room' && !isFinished(saved)) return false;
      const st = ref.current;
      commit({ ...st, code: saved.code, invite: null, session: sessionFromSaved(saved, ctxRef.current.now()) });
      return true;
    },
    [commit],
  );

  const start = useCallback(() => {
    const st = ref.current;
    const { store: s, rng: r, now: n } = ctxRef.current;
    if (st.opponent.mode === 'room') return false;
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
    commit({ ...st, code, invite: null, session });
    return true;
  }, [commit, openSaved]);

  const newGame = useCallback(() => {
    const st = ref.current;
    const { store: s, rng: r, now: n } = ctxRef.current;
    const cur = st.session;
    const mode: Mode = cur ? cur.mode : st.opponent.mode;
    if (mode === 'room') return false;
    const level = cur ? cur.level : st.opponent.mode === 'computer' ? st.opponent.level : undefined;
    const code = freshCode(s.games(), r);
    const session = createSession(
      { code, mode, level, color: resolveColor(st.colorChoice, mode, r), tc: cur ? cur.tc : st.tc },
      n(),
    );
    commit({ ...st, code, invite: null, session });
    return true;
  }, [commit]);

  const exit = useCallback(() => {
    const st = ref.current;
    if (!st.session && !st.invite) return;
    commit({ ...st, code: st.session?.code ?? st.code, session: null, invite: null });
  }, [commit]);

  const consumeInvite = useCallback(() => {
    const st = ref.current;
    if (st.invite) commit({ ...st, invite: null });
  }, [commit]);

  /* ---- playing ---- */
  const move = useCallback(
    (uci: string, ms?: number) => update((s, at) => applyMove(s, uci, ms ?? turnElapsed(), at)),
    [update, turnElapsed],
  );
  const undo = useCallback(() => update((s, at) => applyUndo(s, at)), [update]);
  const redo = useCallback(() => update((s, at) => applyRedo(s, at)), [update]);
  const resign = useCallback(() => update((s, at) => applyResign(s, at)), [update]);
  const reopen = useCallback(() => update((s, at) => applyReopen(s, at)), [update]);
  const finish = useCallback((end: GameEnd) => update((s, at) => applyEnd(s, end, at)), [update]);
  const timeout = useCallback((flagged: Color) => update((s, at) => applyTimeout(s, flagged, at)), [update]);
  const markAssisted = useCallback(() => {
    update((s) => applyAssisted(s));
  }, [update]);

  /* ---- review ---- */
  const goto = useCallback((cursor: number) => void update((s) => applyGoto(s, cursor)), [update]);
  const step = useCallback(
    (delta: number) =>
      void update((s) => applyGoto(s, (s.review ?? s.game.cursor) + Math.trunc(delta))),
    [update],
  );
  const toStart = useCallback(() => goto(0), [goto]);
  const toEnd = useCallback(() => void update((s) => applyGoto(s, s.game.cursor)), [update]);
  const enterReview = useCallback(
    (cursor?: number) =>
      void update((s) => {
        const c = Math.max(0, Math.min(s.game.cursor, Math.floor(cursor ?? s.review ?? s.game.cursor)));
        return s.review === c ? s : { ...s, review: c };
      }),
    [update],
  );
  const exitReview = useCallback(
    () => void update((s) => (s.game.end || s.review === null ? s : { ...s, review: null })),
    [update],
  );

  const continueFromHere = useCallback(() => {
    const st = ref.current;
    if (!st.session) return false;
    const { store: s, rng: r, now: n } = ctxRef.current;
    const spec = continueSpec(viewOf(st.session), st.lastSolo, freshCode(s.games(), r), st.tc);
    if (!spec) return false;
    const session = createSession(spec, n());
    commit({ ...st, code: session.code, invite: null, session });
    return true;
  }, [commit]);

  /* ---- sharing ---- */
  const baseUrl = options.baseUrl;
  const shareUrl = useCallback(() => {
    const st = ref.current;
    const base = baseUrl ?? appBaseUrl();
    if (st.session) return buildShareUrl(toSavedGame(st.session), base);
    return buildUrl(desiredUrl(st), base);
  }, [baseUrl]);

  /* ---- derived ---- */
  const session = state.session;
  const view = useMemo(() => (session ? viewOf(session) : null), [session]);
  const phase: Phase = !session ? 'start' : session.review !== null ? 'review' : 'playing';
  const rule = session ? undoRuleFor(session.mode) : null;
  const live = !!session && session.review === null && session.mode !== 'room';
  const canUndo = live && !!rule && undoTarget(session.game, rule, session.color) < session.game.cursor;
  const canRedo =
    live && !!rule && !session.game.end && redoTarget(session.game, rule, session.color) > session.game.cursor;
  const playable = canPlay(session);
  const isPlayerTurn = playable && (session.mode === 'local' || session.game.turn === session.color);
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
    invite: state.invite,
    consumeInvite,

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
