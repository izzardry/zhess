/**
 * Zhess contracts.
 *
 * Every cross-package type and interface lives here (PLAN.md section 4). Packages code against
 * these shapes. A package that needs a change reports it to the orchestrator, which edits this
 * file serially. Shapes copied from DESIGN.md name their section.
 *
 * This file holds types and a handful of `as const` values only. No logic.
 */

/* ------------------------------------------------------------------------------------------------
 * Chess primitives
 * --------------------------------------------------------------------------------------------- */

/** Side: white or black. */
export type Color = 'w' | 'b';

/** Board file letter. */
export type File = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h';
/** Board rank digit. */
export type Rank = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
/** Algebraic square name, `a1` … `h8`. Identical to chess.js's `Square`. */
export type Square = `${File}${Rank}`;

/** Piece kind in chess.js letters: pawn, knight, bishop, rook, queen, king. */
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
/** Pieces a pawn may promote to. Queen is the default (DESIGN 6.2). */
export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

/** A piece standing on the board. */
export interface Piece {
  readonly color: Color;
  readonly type: PieceType;
}

/**
 * A move in UCI long algebraic form: from, to and an optional lower-case promotion letter,
 * e.g. `e2e4`, `e1g1` (castling is always the king's two-square move), `a7a8n`.
 */
export type Uci = string;

/** A legal move as offered by `ZhessApi.legalMoves`. */
export interface Move {
  readonly from: Square;
  readonly to: Square;
  /** Canonical UCI of this move, including the promotion letter. */
  readonly uci: Uci;
  /** Standard algebraic notation with English letters, e.g. `Nf3`, `exd5`, `O-O`, `e8=Q+`. */
  readonly san: string;
  readonly color: Color;
  /** The moving piece. */
  readonly piece: PieceType;
  /** The captured piece, also for en passant (`p`). */
  readonly captured?: PieceType;
  /** Set on promotions. chess.js lists one move per promotion piece. */
  readonly promotion?: PromotionPiece;
  /** Set on castling: `k` king side, `q` queen side. */
  readonly castle?: 'k' | 'q';
  /** True for an en passant capture. */
  readonly enPassant?: boolean;
}

/** Game result in PGN form. */
export type Result = '1-0' | '0-1' | '1/2-1/2';

/**
 * How a game ended (DESIGN 8, 12.1).
 * `material` = insufficient material, `fifty` = 50-move rule, `agreed` = draw by agreement.
 * `time` is a loss on time, or a draw when the side that did not flag cannot mate (DESIGN 8.2).
 */
export type Termination =
  | 'mate'
  | 'resign'
  | 'time'
  | 'stalemate'
  | 'repetition'
  | 'fifty'
  | 'material'
  | 'agreed';

/** End of a game: its result and the reason. */
export interface GameEnd {
  readonly result: Result;
  readonly by: Termination;
}

/** Play mode (DESIGN 3). `local` is pass-and-play ("Two players"). */
export type Mode = 'computer' | 'local' | 'room';

/** Chess clock: base time and Fischer increment in milliseconds; `null` = clock off (DESIGN 11). */
export type TimeControl = { readonly baseMs: number; readonly incMs: number } | null;

/**
 * Time control in its compact text form `minutes+incrementSeconds`, e.g. `5+0`, `15+10`.
 * Used in URLs (`t`), `SavedGame.tc` and protocol messages. Convert with `formatTc` / `parseTc`
 * in `lib/zhess.ts`.
 */
export type TcString = string;

/** One half-move in a game record (DESIGN 9.4). */
export interface Ply {
  /** The move in UCI. */
  readonly m: Uci;
  /** Milliseconds the mover used for it, measured on the mover's device. */
  readonly ms: number;
}

/* ------------------------------------------------------------------------------------------------
 * Game value and the rules wrapper
 * --------------------------------------------------------------------------------------------- */

/**
 * Immutable game value. Every operation of `ZhessApi` returns a new one; values are frozen and
 * plain JSON. `plies` keeps the redo tail after an undo; `cursor` says how many plies are applied.
 */
export interface Game {
  /** The start position (FEN). The standard start unless the game was created from a position. */
  readonly start: string;
  /** All recorded plies, including a redo tail beyond `cursor`. */
  readonly plies: readonly Ply[];
  /** Plies applied; `< plies.length` while redo is possible, or while reviewing. */
  readonly cursor: number;
  /** Position at `cursor` (FEN). */
  readonly fen: string;
  /** Side to move at `cursor`. */
  readonly turn: Color;
  /**
   * Set when the game is over. Automatic endings are detected by `play`, `undo` and `redo`;
   * resign, time and agreed draws are set with `end`. `goto` (review) keeps it unchanged.
   */
  readonly end?: GameEnd;
}

/** Engine evaluation from the side to move's point of view: centipawns or mate in N (negative = getting mated). */
export interface Eval {
  readonly cp?: number;
  readonly mate?: number;
}

/** PGN header values. Missing tags are written as `?`. `Result` comes from the game. */
export interface PgnMeta {
  readonly event?: string;
  readonly site?: string;
  /** `YYYY.MM.DD`. */
  readonly date?: string;
  readonly round?: string;
  readonly white?: string;
  readonly black?: string;
  /** Written as the PGN `TimeControl` tag (`seconds+increment`) when the clock was on. */
  readonly timeControl?: TimeControl;
  /** Extra tags, written after the seven-tag roster. */
  readonly tags?: Readonly<Record<string, string>>;
}

/** Material summary for the player strips (DESIGN 4.2). */
export interface Material {
  /** Pieces captured BY each color (so `captured.w` lists black pieces), grouped p, n, b, r, q. */
  readonly captured: Record<Color, PieceType[]>;
  /** Board material of white minus black, in pawns (P 1, N 3, B 3, R 5, Q 9). Positive = white ahead. */
  readonly diff: number;
}

/**
 * `lib/zhess.ts` — the rules wrapper over chess.js. Pure: no React, no DOM.
 * The first block is PLAN.md section 4; the rest are additions documented in place.
 */
export interface ZhessApi {
  /** A new game from the standard start or from `startFen`. Throws on an invalid FEN. */
  newGame(startFen?: string): Game;
  /** Legal moves at the cursor, optionally only from one square. Empty when the game is over. */
  legalMoves(g: Game, from?: Square): Move[];
  /**
   * Plays a move at the cursor and drops the redo tail. Accepts UCI; a pawn move to the last rank
   * without a letter promotes to a queen; a king dropped on its own rook castles (DESIGN 6.1).
   * Stores the canonical UCI. Detects mate, stalemate, insufficient material, threefold
   * repetition and the 50-move rule. Throws on an illegal move or when the game is over.
   */
  play(g: Game, uci: string, ms: number): Game;
  /** Moves the cursor back (keeps the redo tail). Drops any end and re-detects automatic endings. */
  undo(g: Game, plies: number): Game;
  /** Moves the cursor forward along the redo tail. Re-detects automatic endings. */
  redo(g: Game, plies: number): Game;
  /** Moves the cursor anywhere in `0..plies.length` for review. Keeps `end` unchanged. */
  goto(g: Game, cursor: number): Game;
  /** Ends the game at the cursor (drops the redo tail). A game that is already over is returned unchanged. */
  end(g: Game, result: Result, by: Termination): Game;
  /** Squares attacked by `by` at the cursor (threat peek). */
  attacked(g: Game, by: Color): Square[];
  /** The king square of the side to move if it is in check, else null. */
  inCheck(g: Game): Square | null;
  /** Captured pieces and material balance at the cursor. */
  material(g: Game): Material;
  /** SAN of every ply up to the cursor. */
  san(g: Game): string[];
  /**
   * PGN with English letters. Exports all plies of a finished game (review), otherwise the plies up
   * to the cursor. Result tag from `g.end`, `*` while running.
   */
  pgn(g: Game, meta: PgnMeta): string;
  /** Compact move list for the URL and storage (DESIGN 13.2). */
  encodeMoves(plies: readonly Ply[]): string;
  /**
   * Decodes `encodeMoves` output to UCI. Queen promotions come back without their letter
   * (e.g. `e7e8`); `play` turns them into queens. Throws on malformed input.
   */
  decodeMoves(s: string): string[];
  /**
   * Remaining ms per side at the cursor, excluding the running turn. Fischer: each counted move
   * subtracts its `ms` and adds the increment. Each side's first move is untimed (DESIGN 9.8:
   * "the first move of each side starts that side's clock"). With `tc === null` it returns the
   * time used per side instead (all plies counted), which the strips show dimmed.
   */
  clocks(g: Game, tc: TimeControl): Record<Color, number>;

  /* ---- additions ---- */

  /** Replays plies from `startFen` (default: standard start) with the cursor at the end. Throws on an illegal ply. */
  replay(plies: readonly Ply[], startFen?: string): Game;
  /**
   * Rebuilds a game from stored fields (`SavedGame.moves`, `.ms`, `.result`, `.by`): decodes,
   * replays, and applies a manual ending. With `lenient`, stops at the first illegal ply instead
   * of throwing (for links typed or cut by hand).
   */
  fromRecord(
    moves: string,
    ms: readonly number[],
    end?: GameEnd,
    opts?: { startFen?: string; lenient?: boolean },
  ): Game;
  /** Removes a manual ending (resign, time, agreed) so play can go on: the resign undo toast. Automatic endings stay. */
  reopen(g: Game): Game;
  /** Ends the game on time for `flagged`: a loss, or a draw if the other side cannot mate (DESIGN 8.2). */
  timeout(g: Game, flagged: Color): Game;
  /** Result of `flagged` running out of time in this position, without changing the game. */
  timeoutResult(g: Game, flagged: Color): GameEnd;
  /** Whether `color` still has material that could possibly mate (used for time-outs). */
  canMate(g: Game, color: Color): boolean;
  /** True when the side to move has made a move before in this game, so its clock is running (DESIGN 9.8). */
  clockRunning(g: Game): boolean;
  /** Time used per side up to the cursor (sum of `ms`, all plies). */
  timeUsed(g: Game): Record<Color, number>;
  /** Board at the cursor: 64 entries indexed by `squareIndex` (a1 = 0, b1 = 1, … h8 = 63). */
  board(g: Game): ReadonlyArray<Piece | null>;
  /** The last applied move (for the last-move highlight), or null at the start. */
  lastMove(g: Game): { from: Square; to: Square } | null;
  /** Verbose history up to the cursor: one `Move` per applied ply (move list, live region). */
  history(g: Game): Move[];
  /** Color that made ply `i` (0-based) of this game. */
  colorOfPly(g: Game, i: number): Color;
  /** Converts typed SAN (`Nf3`, `exd5`, `O-O`, also UCI) to canonical UCI if it is legal at the cursor, else null. */
  sanToUci(g: Game, text: string): Uci | null;
  /** Number of the full move at the cursor (1-based, as in FEN). */
  moveNumber(g: Game): number;
}

/* ------------------------------------------------------------------------------------------------
 * Persistence (DESIGN 12.1, 9.3, 13.1)
 * --------------------------------------------------------------------------------------------- */

/** Room seat: 0 = creator, 1 = joiner. */
export type Seat = 0 | 1;

/** A stored game (DESIGN 12.1). */
export interface SavedGame {
  /** The code for solo games, `${code}.${n}` for room games. */
  id: string;
  code: string;
  mode: Mode;
  /** Computer level 1–12; computer games only. */
  level?: number;
  /** This device's side; `w` in pass-and-play. */
  color: Color;
  /** Time control as `5+0`, or null. */
  tc: TcString | null;
  /** Compact move encoding (DESIGN 13.2). */
  moves: string;
  /** Time used per ply. */
  ms: number[];
  result?: Result;
  by?: Termination;
  /** A hint or an undo was used (DESIGN 7.3). */
  assisted: boolean;
  room?: { n: number; epoch: number };
  createdAt: number;
  lastPlayedAt: number;
}

/** A stored room record and its seat lock (DESIGN 9.3). */
export interface Room {
  /** Room code, e.g. `K7QW2M`. */
  code: string;
  /** 128-bit random secret, base64url; shared by both devices. */
  key: string;
  seat: Seat;
  createdAt: number;
  /** Last successful sync. */
  lastSeenAt: number;
  /** Points per seat, in half points ×2 (a win adds 2, a draw adds 1 to each). */
  score: [number, number];
  /** Ids of this room's games (`SavedGame.id`), oldest first. */
  games: string[];
}

/** `lib/storage.ts` — every read guarded, keys of DESIGN 13.1 under the `zhess:` prefix. */
export interface Store {
  /** Saved games, newest `lastPlayedAt` first. */
  games(): SavedGame[];
  /** Upsert by id; keeps newest first and at most 100. */
  saveGame(g: SavedGame): void;
  /** Removes and returns a game, for the undo toast. */
  deleteGame(id: string): SavedGame | undefined;
  /** Puts a deleted game back (undo toast). */
  restoreGame(g: SavedGame): void;
  rooms(): Room[];
  /** Upsert by code. */
  saveRoom(r: Room): void;
  /** Removes and returns a room record, for the undo toast. */
  deleteRoom(code: string): Room | undefined;
  /** A preference by its key without prefix (see `PrefKey`), or `fallback` if missing or unreadable. */
  pref<T>(key: string, fallback: T): T;
  setPref<T>(key: string, value: T): void;
}

/** Preference keys of DESIGN 13.1 (without the `zhess:` prefix). */
export type PrefKey =
  | 'opponent'
  | 'color'
  | 'clock'
  | 'helpers'
  | 'seating'
  | 'lang'
  | 'tutorial-seen'
  | 'donation-shown'
  | 'install-dismissed';

/** Opponent selector value (DESIGN 4.1), stored under `zhess:opponent`. */
export type Opponent =
  | { readonly mode: 'room' }
  | { readonly mode: 'local' }
  | { readonly mode: 'computer'; readonly level: number };

/** Color pill value (DESIGN 4.1), stored under `zhess:color`. */
export type ColorChoice = 'random' | Color;

/** Pass-and-play seating (DESIGN 5.2), stored under `zhess:seating`. */
export type Seating = 'face' | 'side';

/** UI language (DESIGN 14), stored under `zhess:lang`. */
export type Language = 'en' | 'de' | 'fr' | 'es';

/* ------------------------------------------------------------------------------------------------
 * Engine (DESIGN 10)
 * --------------------------------------------------------------------------------------------- */

/** Lifecycle of the lazily loaded engine worker. */
export type EngineState = 'idle' | 'loading' | 'ready' | 'failed';

/** `hooks/useZhessEngine` — and the fake used in tests. */
export interface EngineApi {
  readonly state: EngineState;
  /** 0..1 while loading. */
  readonly progress: number;
  load(): Promise<void>;
  /** Best move in UCI for `level` 1–12; `clock` lets level 12 and timed games respect the engine's own clock. */
  bestMove(fen: string, level: number, clock?: { wMs: number; bMs: number; incMs: number }): Promise<Uci>;
  /** Fixed-depth evaluation from the side to move; null on timeout. */
  evaluate(fen: string, depth: number, timeoutMs?: number): Promise<Eval | null>;
  multiPv(fen: string, n: number, depth: number): Promise<{ uci: Uci; eval: Eval }[]>;
  stop(): void;
}

/* ------------------------------------------------------------------------------------------------
 * Rooms: sync record, protocol, transport, controller (DESIGN 9)
 * --------------------------------------------------------------------------------------------- */

/**
 * Live record of one game in a room (DESIGN 9.4).
 * `white` and `tc` are additions: a device restored by `grant` must learn each game's colors and
 * time control, which the design's shape does not carry.
 */
export interface GameLog {
  /** Game number within the room, 1-based. */
  n: number;
  /** Incremented on every accepted takeback. */
  epoch: number;
  plies: Ply[];
  end?: GameEnd;
  /** Seat that plays white in this game (rematch alternates). */
  white: Seat;
  /** Time control of this game, e.g. `5+0`, or null. */
  tc: TcString | null;
}

/** The three request kinds of DESIGN 9.7. */
export type RequestKind = 'takeback' | 'draw' | 'rematch';

/** Current protocol version (DESIGN 9.11). */
export const PROTOCOL_VERSION = 1 as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

/** First message both ways. `nonce` is random, base64url. */
export interface HelloMsg { t: 'hello'; v: ProtocolVersion; hasKey: boolean; nonce: string }
/** HMAC-SHA-256(key, other side's nonce), base64url. */
export interface ProofMsg { t: 'proof'; v: ProtocolVersion; mac: string }
/** A device without a key asks for seat 1 of an open room. */
export interface JoinMsg { t: 'join'; v: ProtocolVersion }
/** Answer to `join`: the key, the joiner's seat, the time control and the joiner's color in the current game. */
export interface WelcomeMsg { t: 'welcome'; v: ProtocolVersion; key: string; seat: Seat; tc: TcString | null; color: Color }
/** A device without a key asks for its seat back in a locked room (DESIGN 9.5). */
export interface RejoinMsg { t: 'rejoin'; v: ProtocolVersion }
/** Rejoin allowed: everything the lost device needs. `score` is per seat, half points ×2. */
export interface GrantMsg { t: 'grant'; v: ProtocolVersion; key: string; seat: Seat; score: [number, number]; games: GameLog[] }
/** Rejoin declined. */
export interface DenyMsg { t: 'deny'; v: ProtocolVersion }
/**
 * Reconcile summary of the current game. `ended` feeds rule 5 (finished beats unfinished).
 * `turnMs` is an addition: the ms the sender has already used on its own running turn, reported
 * after a pause (DESIGN 9.8); omitted when it is not the sender's turn.
 */
export interface HeadMsg { t: 'head'; v: ProtocolVersion; n: number; epoch: number; len: number; hash: string; ended: boolean; turnMs?: number }
/** Reconcile payload: games the other side is missing, the current one last. */
export interface LogsMsg { t: 'logs'; v: ProtocolVersion; games: GameLog[] }
/** One live ply: ply index `i` (0-based) of game `n` at `epoch`. */
export interface MoveMsg { t: 'move'; v: ProtocolVersion; n: number; epoch: number; i: number; m: Uci; ms: number }
/** Acknowledges ply `i`. `n` and `epoch` are additions so a stale ack is ignored. */
export interface AckMsg { t: 'ack'; v: ProtocolVersion; n: number; epoch: number; i: number }
/**
 * A request (DESIGN 9.7). `n`, `epoch` and `len` (plies at the time of asking) are additions that
 * let the receiver drop a request made stale by a move or a takeback.
 */
export interface AskMsg { t: 'ask'; v: ProtocolVersion; kind: RequestKind; n: number; epoch: number; len: number }
/** Answer to `ask`, echoing its context. */
export interface ReplyMsg { t: 'reply'; v: ProtocolVersion; kind: RequestKind; ok: boolean; n: number; epoch: number; len: number }
/** Resign, flag, agreed draw. */
export interface EndMsg { t: 'end'; v: ProtocolVersion; n: number; result: Result; by: Termination }
/** Liveness every 5 s; three misses mark the peer disconnected. */
export interface PingMsg { t: 'ping'; v: ProtocolVersion }
export interface PongMsg { t: 'pong'; v: ProtocolVersion }

/** Every data-channel message (DESIGN 9.11), discriminated by `t`. JSON over the wire. */
export type Message =
  | HelloMsg
  | ProofMsg
  | JoinMsg
  | WelcomeMsg
  | RejoinMsg
  | GrantMsg
  | DenyMsg
  | HeadMsg
  | LogsMsg
  | MoveMsg
  | AckMsg
  | AskMsg
  | ReplyMsg
  | EndMsg
  | PingMsg
  | PongMsg;

/** The `t` tags of all messages. */
export type MessageType = Message['t'];

/** State of a transport connection. */
export type TransportState = 'connecting' | 'open' | 'closed' | 'failed';

/** Why a transport failed (DESIGN 9.10, PLAN 3B). */
export type TransportFailure = 'broker-unreachable' | 'id-taken' | 'ice-failed' | 'timeout';

/** `lib/transport` — one reliable, ordered data channel. */
export interface Transport {
  /** Transport role only; gives no authority over the game (DESIGN 9.2). */
  readonly role: 'anchor' | 'dialer';
  send(msg: Message): void;
  onMessage(cb: (msg: Message) => void): void;
  onState(cb: (s: TransportState) => void): void;
  close(): void;
}
export type TransportFactory = (code: string) => Promise<Transport>;

/** Presence of the opponent as the dot shows it (DESIGN 9.10). */
export type Presence = 'connecting' | 'waiting' | 'connected' | 'reconnecting';

/** Room lock state as seen from this device (DESIGN 9.3). */
export type RoomLock = 'open' | 'locked' | 'rejoin-pending';

/** Why the board is not playable for this device right now. */
export type LockReason =
  /** Timed game while the opponent is disconnected (DESIGN 9.6). */
  | 'disconnected'
  /** The room is open in another tab (DESIGN 9.12). */
  | 'other-tab'
  /** This device has no seat yet (waiting for welcome or grant). */
  | 'no-seat'
  /** The opponent runs another protocol version. */
  | 'version'
  /** Rejoin was declined or the challenge failed. */
  | 'denied';

/** One-off events the UI turns into toasts (DESIGN 9.5, 9.7, 9.10, 9.11). */
export type RoomNoticeKind =
  | 'opponent-joined'
  | 'opponent-connected'
  | 'opponent-disconnected'
  | 'reconnected'
  | 'restored-from-opponent'
  | 'sync-error'
  | 'version-mismatch'
  | 'rejoin-denied'
  | 'challenge-failed'
  | 'request-declined'
  | 'ice-failed';

export interface RoomNotice {
  /** Increases with every notice so the UI shows each one once. */
  readonly id: number;
  readonly kind: RoomNoticeKind;
  /** For `request-declined`: which request. */
  readonly request?: RequestKind;
}

/** Everything the room UI renders. Produced by `RoomController`. */
export interface RoomSnapshot {
  readonly code: string;
  readonly presence: Presence;
  readonly role: 'anchor' | 'dialer' | null;
  readonly lock: RoomLock;
  /** This device's seat; null until joined or granted. */
  readonly seat: Seat | null;
  /** Points per seat, half points ×2. */
  readonly score: readonly [number, number];
  /** Current game number and takeback epoch. */
  readonly n: number;
  readonly epoch: number;
  /** The current game. The room controller owns it in room mode (PLAN 7). */
  readonly game: Game;
  /** This device's color in the current game. */
  readonly color: Color;
  readonly tc: TimeControl;
  /** Pending requests. `incoming` may also be a rejoin request from a new device. */
  readonly requests: {
    readonly incoming?: RequestKind | 'rejoin';
    readonly outgoing?: RequestKind;
  };
  /** Non-null while the board is locked for this device. */
  readonly locked: LockReason | null;
  /** Plies played here but not yet acknowledged by the opponent. */
  readonly unsent: number;
  /**
   * Running-turn clock (DESIGN 9.8): `paused` while disconnected in a timed game; `turnStart` is the
   * `now()` stamp at which the side to move's current turn (re)started, null while paused;
   * `turnUsed` is what that side had already used in this turn before the last pause.
   */
  readonly clock: { readonly paused: boolean; readonly turnStart: number | null; readonly turnUsed: number };
  /** The latest notice, if any. */
  readonly notice: RoomNotice | null;
  /** Failure of the last connection attempt, for the calm failure message. */
  readonly failure: TransportFailure | null;
}

/** `lib/room.ts` — framework-free state machine over a `Transport`. */
export interface RoomController {
  readonly snapshot: RoomSnapshot;
  subscribe(cb: (s: RoomSnapshot) => void): () => void;
  move(uci: string, ms: number): void;
  ask(kind: RequestKind): void;
  reply(kind: RequestKind | 'rejoin', ok: boolean): void;
  resign(): void;
  flag(): void;
  leave(): void;
}

/* ------------------------------------------------------------------------------------------------
 * Injected time and randomness (PLAN 4)
 * --------------------------------------------------------------------------------------------- */

/** Monotonic or wall clock in ms, injected so tests are deterministic. */
export type Now = () => number;
/** Uniform random number in [0, 1), injected so tests are deterministic. */
export type Rng = () => number;
