/**
 * Room sync (DESIGN 9.3, 9.4, 9.5, 9.7, 9.8, 9.11, 12.1) — pure and framework-free.
 *
 * - Log hashing and the `head` summary message.
 * - `reconcile`: the five rules of DESIGN 9.4 as one function, used twice per connection:
 *   first with the other side's `head`, then with any `logs` it sends. Every adopted log is
 *   validated by replaying it from the start through `ZhessApi`.
 * - Live-play helpers on a `GameLog`: applying a received move, takeback, rematch.
 * - Room score across games (colors swap on rematch).
 * - Seat key: generation, nonces and the HMAC-SHA-256 proof through WebCrypto (DESIGN 9.3).
 * - Conversion between `GameLog` and the stored `SavedGame`.
 *
 * Time and randomness are injected (`rng`); nothing here reads the clock, storage or the network.
 */
import type {
  Color,
  GameEnd,
  Game,
  GameLog,
  HeadMsg,
  LogsMsg,
  MoveMsg,
  Ply,
  Result,
  Rng,
  SavedGame,
  Seat,
  Termination,
  ZhessApi,
} from './types';
import { PROTOCOL_VERSION } from './types';
import zhess, { parseTc } from './zhess';

/* ---------------------------------------------------------------------------------------------- */
/* Small helpers                                                                                    */
/* ---------------------------------------------------------------------------------------------- */

const RESULTS: ReadonlySet<string> = new Set<Result>(['1-0', '0-1', '1/2-1/2']);
const TERMINATIONS: ReadonlySet<string> = new Set<Termination>([
  'mate',
  'resign',
  'time',
  'stalemate',
  'repetition',
  'fifty',
  'material',
  'agreed',
]);
/** Endings `ZhessApi.play` detects by itself; a log may only claim them if the position says so. */
const AUTO_ENDINGS: ReadonlySet<Termination> = new Set<Termination>([
  'mate',
  'stalemate',
  'repetition',
  'fifty',
  'material',
]);
const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/** The other seat. */
export function otherSeat(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

/** This seat's color in a game. */
export function colorOf(log: Pick<GameLog, 'white'>, seat: Seat): Color {
  return log.white === seat ? 'w' : 'b';
}

/** The seat that plays `color` in a game. */
export function seatOf(log: Pick<GameLog, 'white'>, color: Color): Seat {
  return color === 'w' ? log.white : otherSeat(log.white);
}

/** The color that made ply `i` (0-based). Room games always start from the standard position. */
export function colorOfPly(i: number): Color {
  return i % 2 === 0 ? 'w' : 'b';
}

/** The current game: the log with the highest `n`, or undefined for an empty list. */
export function currentLog(logs: readonly GameLog[]): GameLog | undefined {
  let best: GameLog | undefined;
  for (const l of logs) if (!best || l.n > best.n) best = l;
  return best;
}

/** Sorts logs by game number, oldest first, keeping one log per `n` (the last one given wins). */
export function sortLogs(logs: readonly GameLog[]): GameLog[] {
  const byN = new Map<number, GameLog>();
  for (const l of logs) byN.set(l.n, l);
  return [...byN.values()].sort((a, b) => a.n - b.n);
}

function samePly(a: Ply, b: Ply): boolean {
  return a.m === b.m && a.ms === b.ms;
}

function sameEnd(a: GameEnd | undefined, b: GameEnd | undefined): boolean {
  if (!a || !b) return a === b;
  return a.result === b.result && a.by === b.by;
}

/** Length of the common prefix of two ply lists (move and time must both match). */
export function commonPrefix(a: readonly Ply[], b: readonly Ply[]): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && samePly(a[i], b[i])) i++;
  return i;
}

/* ---------------------------------------------------------------------------------------------- */
/* Hashing and head                                                                                 */
/* ---------------------------------------------------------------------------------------------- */

/**
 * 64-bit non-cryptographic string hash (two 32-bit multiply-xorshift lanes, cyrb53 style), as 16
 * lower-case hex digits. Stable across devices and JS engines.
 */
export function hashString(s: string): string {
  let h1 = 0xdeadbeef ^ s.length;
  let h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (x: number) => (x >>> 0).toString(16).padStart(8, '0');
  return hex(h1) + hex(h2);
}

/**
 * Hash of a game's identity and its first `len` plies (default: all): `n`, `epoch`, `white`, `tc`
 * and every ply's move and time. The end is not included, so the hash of a prefix can be compared
 * with the other side's `head`. 16 hex digits.
 */
export function pliesHash(log: GameLog, len: number = log.plies.length): string {
  const k = Math.max(0, Math.min(log.plies.length, Math.floor(len)));
  let s = `${log.n}|${log.epoch}|${log.white}|${log.tc ?? '-'}|`;
  for (let i = 0; i < k; i++) s += `${log.plies[i].m},${log.plies[i].ms};`;
  return hashString(s);
}

/**
 * The `head.hash` of a log: `pliesHash`, followed by `.result.by` when the game is over, e.g.
 * `3f2a…9c` or `3f2a…9c.1-0.resign`. Two logs have the same hash exactly when they agree on
 * `n`, `epoch`, `white`, `tc`, every ply and the end.
 */
export function hashLog(log: GameLog): string {
  const h = pliesHash(log);
  return log.end ? `${h}.${log.end.result}.${log.end.by}` : h;
}

/** The plies part of a `head.hash` (everything before the first `.`). */
export function headPliesHash(hash: string): string {
  const i = hash.indexOf('.');
  return i < 0 ? hash : hash.slice(0, i);
}

/**
 * The `head` reconcile summary of this device's current game (DESIGN 9.4, 9.11). `log` is the
 * current game, or undefined when this device has no game in the room yet (then `n` is 0).
 * `turnMs` is the time this device has already used on its own running turn (DESIGN 9.8); pass it
 * only when it is this device's turn.
 */
export function makeHead(log: GameLog | undefined, turnMs?: number): HeadMsg {
  const head: HeadMsg = log
    ? { t: 'head', v: PROTOCOL_VERSION, n: log.n, epoch: log.epoch, len: log.plies.length, hash: hashLog(log), ended: !!log.end }
    : { t: 'head', v: PROTOCOL_VERSION, n: 0, epoch: 0, len: 0, hash: '', ended: false };
  if (turnMs !== undefined && Number.isFinite(turnMs)) head.turnMs = Math.max(0, Math.round(turnMs));
  return head;
}

/** A `logs` message (games oldest first, the current one last). */
export function makeLogs(games: readonly GameLog[]): LogsMsg {
  return { t: 'logs', v: PROTOCOL_VERSION, games: sortLogs(games) };
}

/* ---------------------------------------------------------------------------------------------- */
/* Validation                                                                                       */
/* ---------------------------------------------------------------------------------------------- */

export type ValidLog = { ok: true; log: GameLog; game: Game };
export type InvalidLog = { ok: false; error: string };

/**
 * Checks a log received from the other device (any JSON) and replays it from the standard start
 * through `api` (DESIGN 9.4 rule 3: an illegal ply aborts the sync).
 *
 * Rejects: wrong shapes, `n < 1`, a negative epoch, an unknown seat, an unreadable time control,
 * an illegal ply or a ply after the game ended, an automatic ending the position does not show
 * (or that differs from the one it shows), `agreed` that is not a draw, `resign` that is a draw.
 *
 * The returned log is a fresh, normalized copy: plies in canonical UCI with whole, non-negative
 * ms (as `api.play` stores them) and the automatic ending filled in if the sender left it out.
 * `game` is the replayed game with its end applied.
 */
export function validateLog(raw: unknown, api: ZhessApi = zhess): ValidLog | InvalidLog {
  const bad = (error: string): InvalidLog => ({ ok: false, error });
  if (typeof raw !== 'object' || raw === null) return bad('not an object');
  const r = raw as Record<string, unknown>;
  const { n, epoch, white, tc, plies, end } = r;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) return bad('bad n');
  if (typeof epoch !== 'number' || !Number.isInteger(epoch) || epoch < 0) return bad('bad epoch');
  if (white !== 0 && white !== 1) return bad('bad white');
  if (tc !== null && (typeof tc !== 'string' || parseTc(tc) === null)) return bad('bad tc');
  if (!Array.isArray(plies)) return bad('bad plies');
  let ending: GameEnd | undefined;
  if (end !== undefined && end !== null) {
    if (typeof end !== 'object') return bad('bad end');
    const e = end as Record<string, unknown>;
    if (typeof e.result !== 'string' || !RESULTS.has(e.result)) return bad('bad result');
    if (typeof e.by !== 'string' || !TERMINATIONS.has(e.by)) return bad('bad termination');
    ending = { result: e.result as Result, by: e.by as Termination };
    if (ending.by === 'agreed' && ending.result !== '1/2-1/2') return bad('agreed draw with a winner');
    if (ending.by === 'resign' && ending.result === '1/2-1/2') return bad('resignation without a winner');
  }

  let g = api.newGame();
  for (let i = 0; i < plies.length; i++) {
    const p = plies[i] as unknown;
    if (typeof p !== 'object' || p === null) return bad(`bad ply ${i}`);
    const { m, ms } = p as Record<string, unknown>;
    if (typeof m !== 'string' || !UCI_RE.test(m)) return bad(`bad move at ply ${i}`);
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return bad(`bad time at ply ${i}`);
    try {
      g = api.play(g, m, ms);
    } catch {
      return bad(`illegal ply ${i}: ${m}`);
    }
  }

  if (g.end) {
    // The position itself ended the game: a log may leave the end out, but not contradict it.
    if (ending && !sameEnd(ending, g.end)) return bad('end contradicts the position');
    ending = g.end;
  } else if (ending) {
    if (AUTO_ENDINGS.has(ending.by)) return bad('automatic end not shown by the position');
    g = api.end(g, ending.result, ending.by);
  }

  const log: GameLog = {
    n,
    epoch,
    white,
    tc: (tc as string | null) ?? null,
    plies: g.plies.map((p) => ({ m: p.m, ms: p.ms })),
  };
  if (ending) log.end = { result: ending.result, by: ending.by };
  return { ok: true, log, game: g };
}

/** The game of a log (replayed, end applied). Throws on an invalid log. */
export function logToGame(log: GameLog, api: ZhessApi = zhess): Game {
  const v = validateLog(log, api);
  if (!v.ok) throw new Error(`Invalid game log: ${v.error}`);
  return v.game;
}

/* ---------------------------------------------------------------------------------------------- */
/* Comparing two copies of one game (DESIGN 9.4 rules 2–5)                                          */
/* ---------------------------------------------------------------------------------------------- */

/** Which copy of a game wins, and whether they were a true fork (rule 4). */
export interface Comparison {
  winner: 'local' | 'remote' | 'same';
  /** Rule 4 decided it: seat 0's copy won over a contradicting one. */
  fork: boolean;
  /** The rule that decided (2 epoch, 3 prefix, 4 fork, 5 finished), or 0 when the copies are identical. */
  rule: 0 | 2 | 3 | 4 | 5;
}

/**
 * Compares two copies of the same game `n` (rules 2–5). Antisymmetric: the other device, comparing
 * the same two copies from its side with its own seat, reaches the mirrored verdict.
 *
 * 2. The higher epoch wins.
 * 3. If one ply list is a prefix of the other, the longer wins.
 * 4. Equal length with different content, or any other contradiction: seat 0's copy wins.
 * 5. Of two identical ply lists, the finished copy wins.
 *
 * Where the design is silent: a finished copy also beats a longer unfinished copy that continues it
 * (no ply can follow the end of a game; this is an offline resignation crossing an offline move),
 * and two finished copies of different length or with different ends are a fork (rule 4).
 */
export function compareLogs(local: GameLog, remote: GameLog, localSeat: Seat): Comparison {
  const fork = (): Comparison => ({ winner: localSeat === 0 ? 'local' : 'remote', fork: true, rule: 4 });
  if (local.epoch !== remote.epoch) {
    return { winner: local.epoch > remote.epoch ? 'local' : 'remote', fork: false, rule: 2 };
  }
  if (local.white !== remote.white || local.tc !== remote.tc) return fork();
  const lp = local.plies;
  const rp = remote.plies;
  const p = commonPrefix(lp, rp);
  if (p === lp.length && p === rp.length) {
    if (sameEnd(local.end, remote.end)) return { winner: 'same', fork: false, rule: 0 };
    if (local.end && remote.end) return fork();
    return { winner: local.end ? 'local' : 'remote', fork: false, rule: 5 };
  }
  if (p === Math.min(lp.length, rp.length)) {
    const localShorter = lp.length < rp.length;
    const shorter = localShorter ? local : remote;
    const longer = localShorter ? remote : local;
    if (!shorter.end) return { winner: localShorter ? 'remote' : 'local', fork: false, rule: 3 };
    if (!longer.end) return { winner: localShorter ? 'local' : 'remote', fork: false, rule: 5 };
    return fork();
  }
  return fork();
}

/* ---------------------------------------------------------------------------------------------- */
/* Reconcile (DESIGN 9.4 rules 1–5, 9.5)                                                            */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Outcome of one reconcile step.
 *
 * - `in-sync`: nothing to do.
 * - `ahead`: this device's copy wins; `send` holds the logs to send.
 * - `behind`: the other copy wins. After a `head`: wait for its `logs` (seat 1 may still have
 *   `send` set, see below). After `logs`: store `adopt`.
 * - `fork`: after a `head` only. The copies contradict each other (rule 4); both devices send their
 *   logs (`send`) and the `logs` step settles it.
 *
 * Whatever the status, send `send` when it is set. A fork is reported (`forked`) only by the
 * `logs` step, exactly once per device: seat 1 when it adopts seat 0's copy, seat 0 when it receives
 * seat 1's contradicting copy. To make sure seat 0 sees it, seat 1 also sends its copy after a
 * `head` whenever it cannot rule a fork out (it is shorter and unfinished).
 * - `invalid`: a received log (or head) failed validation; nothing is adopted. Show the sync error
 *   toast.
 */
export type SyncStatus = 'in-sync' | 'ahead' | 'behind' | 'fork' | 'invalid';

export interface SyncResult {
  status: SyncStatus;
  /**
   * Validated, normalized logs to store, oldest first. Each replaces the local log with the same
   * `n`; the one with the highest `n` is the current game. Only set after a `logs` message.
   */
  adopt?: GameLog[];
  /** Logs to send as a `logs` message (`makeLogs(send)`), oldest first, the current one last. */
  send?: GameLog[];
  /**
   * Show `Game restored from opponent's copy` (rule 4). Set only when a `logs` message reveals a
   * fork: on the adopting side and on seat 0, whose copy won. Never set by the `head` step.
   */
  forked: boolean;
  /** Why validation failed (`invalid` only). */
  error?: string;
  /** The rule that decided the current game (see `Comparison.rule`; 1 = game number). */
  rule?: 0 | 1 | 2 | 3 | 4 | 5;
}

/** The other side's message: its `head`, its `logs` message, or the games of a `logs` / `grant`. */
export type RemoteSync = HeadMsg | LogsMsg | readonly GameLog[];

/**
 * The one reconcile function (DESIGN 9.4). Call it with every `head` and every `logs` the other
 * device sends, passing all logs of the room this device holds (any order) and its seat.
 *
 * Protocol around it: on connect (after the challenge) both devices send `makeHead(current)`.
 * On a `head`, call `reconcile`; if it returns `send`, send `makeLogs(send)`. On `logs`, call it
 * again: store `adopt`, show the toast if `forked`, and send `send` back if set (the other copy
 * lost). Two copies converge after at most one `logs` each way.
 *
 * Rule 1: the higher game number wins; the device that is behind receives every game from its
 * own current number on (its unfinished game, the finished games it missed, the current one).
 * Older games are not compared after a `head`, only when they arrive in `logs`.
 */
export function reconcile(local: readonly GameLog[], remote: RemoteSync, localSeat: Seat, api: ZhessApi = zhess): SyncResult {
  if (isHead(remote)) return reconcileHead(local, remote, localSeat);
  const games = Array.isArray(remote) ? (remote as readonly GameLog[]) : (remote as LogsMsg).games;
  return reconcileLogs(local, games, localSeat, api);
}

function isHead(r: RemoteSync): r is HeadMsg {
  return !Array.isArray(r) && (r as HeadMsg | LogsMsg).t === 'head';
}

/** Local games with `n >= from`, oldest first. */
function gamesFrom(local: readonly GameLog[], from: number): GameLog[] {
  return sortLogs(local).filter((l) => l.n >= from);
}

const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;

function reconcileHead(local: readonly GameLog[], head: HeadMsg, localSeat: Seat): SyncResult {
  if (!isCount(head.n) || !isCount(head.epoch) || !isCount(head.len) || typeof head.hash !== 'string' || typeof head.ended !== 'boolean') {
    return { status: 'invalid', forked: false, error: 'bad head' };
  }
  const cur = currentLog(local);
  const n = cur?.n ?? 0;
  const ahead = (rule: SyncResult['rule'], send: GameLog[]): SyncResult =>
    send.length ? { status: 'ahead', send, forked: false, rule } : { status: 'in-sync', forked: false, rule };
  const behind = (rule: SyncResult['rule']): SyncResult => ({ status: 'behind', forked: false, rule });
  const fork = (): SyncResult => ({ status: 'fork', send: cur ? [cur] : [], forked: false, rule: 4 });

  // Rule 1: game number.
  if (head.n > n) return behind(1);
  if (head.n < n) return ahead(1, gamesFrom(local, Math.max(1, head.n)));
  if (!cur) return { status: 'in-sync', forked: false, rule: 0 }; // neither side has a game yet
  // Rule 2: epoch.
  if (head.epoch > cur.epoch) return behind(2);
  if (head.epoch < cur.epoch) return ahead(2, [cur]);

  const len = cur.plies.length;
  const remotePlies = headPliesHash(head.hash);
  if (head.len === len) {
    if (head.hash === hashLog(cur)) return { status: 'in-sync', forked: false, rule: 0 };
    if (remotePlies !== pliesHash(cur)) return fork();
    // Same plies, different end state (rule 5) or two different ends (rule 4).
    if (cur.end && !head.ended) return ahead(5, [cur]);
    if (!cur.end && head.ended) return behind(5);
    return fork();
  }
  if (head.len < len) {
    // This device is longer and can check whether the other copy is a prefix of its own.
    if (remotePlies !== pliesHash(cur, head.len)) return fork();
    if (!head.ended) return ahead(3, [cur]);
    if (!cur.end) return behind(5); // a finished copy beats a longer unfinished continuation
    return fork();
  }
  // This device is shorter and cannot check its copy against the longer one.
  if (cur.end) return head.ended ? fork() : ahead(5, [cur]);
  // Unfinished: the longer copy wins (rule 3) unless the copies fork, and the other device sends in
  // both cases. Seat 1 sends its copy as well, so that seat 0 sees a fork if there is one and both
  // devices show the toast (a fork is only ever reported by the `logs` step).
  if (localSeat === 1) return { status: 'behind', send: [cur], forked: false, rule: 3 };
  return behind(3);
}

function reconcileLogs(local: readonly GameLog[], remoteRaw: readonly GameLog[], localSeat: Seat, api: ZhessApi): SyncResult {
  if (!Array.isArray(remoteRaw)) return { status: 'invalid', forked: false, error: 'logs is not a list' };
  const remote: GameLog[] = [];
  for (const raw of remoteRaw) {
    const v = validateLog(raw, api);
    if (!v.ok) return { status: 'invalid', forked: false, error: `game ${(raw as GameLog | null)?.n ?? '?'}: ${v.error}` };
    remote.push(v.log);
  }
  const theirs = sortLogs(remote);
  const mine = new Map(sortLogs(local).map((l) => [l.n, l] as const));
  const localCur = currentLog(local);
  const remoteCur = currentLog(theirs);

  const adopt: GameLog[] = [];
  const send: GameLog[] = [];
  let forked = false;
  let rule: SyncResult['rule'];
  let curWinner: Comparison['winner'] | undefined;

  for (const r of theirs) {
    const l = mine.get(r.n);
    let c: { winner: Comparison['winner']; fork: boolean; rule: NonNullable<SyncResult['rule']> };
    if (!l) c = { winner: 'remote', fork: false, rule: 1 };
    else c = compareLogs(l, r, localSeat);
    if (c.fork) forked = true;
    if (c.winner === 'remote') adopt.push(r);
    else if (c.winner === 'local' && l) send.push(l);
    if (r === remoteCur && localCur && r.n === localCur.n) {
      rule = c.rule;
      curWinner = c.winner;
    }
  }

  // Rule 1 seen from this side: the other device is behind on game number.
  if (localCur && (!remoteCur || localCur.n > remoteCur.n)) {
    // Every game from the other side's current one on, except those it sent (already compared).
    const sent = new Set(theirs.map((l) => l.n));
    const from = remoteCur ? remoteCur.n : 1;
    for (const l of gamesFrom(local, from)) if (!sent.has(l.n)) send.push(l);
    rule = 1;
    curWinner = 'local';
  } else if (remoteCur && (!localCur || remoteCur.n > localCur.n)) {
    rule = 1;
    curWinner = 'remote';
  }

  const result: SyncResult = { status: 'in-sync', forked, rule };
  if (adopt.length) result.adopt = sortLogs(adopt);
  if (send.length) result.send = sortLogs(send);
  if (curWinner === 'remote') result.status = 'behind';
  else if (curWinner === 'local') result.status = 'ahead';
  else if (adopt.length) result.status = 'behind';
  else if (send.length) result.status = 'ahead';
  return result;
}

/**
 * Merges adopted logs into the local list: each adopted log replaces the one with its `n`.
 * Returns all logs oldest first.
 */
export function mergeLogs(local: readonly GameLog[], adopt: readonly GameLog[]): GameLog[] {
  return sortLogs([...local, ...adopt]);
}

/* ---------------------------------------------------------------------------------------------- */
/* Live play on a log (DESIGN 9.4, 9.7)                                                             */
/* ---------------------------------------------------------------------------------------------- */

/** A fresh game: game 1 of a room, or a rematch. */
export function newLog(n: number, white: Seat, tc: string | null): GameLog {
  return { n, epoch: 0, plies: [], white, tc };
}

/** The rematch of a game: `n + 1`, colors swapped, same time control (DESIGN 9.7). */
export function rematchLog(prev: GameLog): GameLog {
  return newLog(prev.n + 1, otherSeat(prev.white), prev.tc);
}

/** Seat that plays white in game `n` when seat `firstWhite` had white in game 1 (colors alternate). */
export function whiteOfGame(n: number, firstWhite: Seat): Seat {
  return n % 2 === 1 ? firstWhite : otherSeat(firstWhite);
}

/** The color to move in a log (standard start, so white on even ply counts). */
export function turnOf(log: GameLog): Color {
  return colorOfPly(log.plies.length);
}

/** The seat to move in a log. */
export function seatToMove(log: GameLog): Seat {
  return seatOf(log, turnOf(log));
}

/** A new log with one ply played by `api` (canonical UCI, ending detected). Throws on an illegal move. */
export function appendPly(log: GameLog, m: string, ms: number, api: ZhessApi = zhess): GameLog {
  if (log.end) throw new Error('Game is over');
  const g = api.play(api.replay(log.plies), m, ms);
  const out: GameLog = { ...log, plies: g.plies.map((p) => ({ m: p.m, ms: p.ms })) };
  delete out.end;
  if (g.end) out.end = { ...g.end };
  return out;
}

/** A new log with the game ended (resign, flag, agreed draw). A finished log is returned unchanged. */
export function endLog(log: GameLog, end: GameEnd): GameLog {
  if (log.end) return log;
  return { ...log, end: { result: end.result, by: end.by } };
}

/**
 * Outcome of a live `move` message against the local copy:
 * - `applied`: a new ply; `log` is the new copy (ack it).
 * - `duplicate`: this ply is already in the log (a resend): ack it again, change nothing.
 * - `stale`: another game or an older epoch; ignore it.
 * - `gap`: the move skips plies or the other copy is ahead in some other way; ask for a reconcile
 *   (send `head`).
 * - `conflict`: a different ply at that index, a ply after the end, or an illegal move; reconcile.
 */
export type MoveOutcome =
  | { kind: 'applied'; log: GameLog }
  | { kind: 'duplicate' }
  | { kind: 'stale' }
  | { kind: 'gap' }
  | { kind: 'conflict'; error: string };

/** Applies a live `move` message (DESIGN 9.4: `{n, epoch, i, m, ms}`) to the local copy of the game. */
export function applyMoveMsg(log: GameLog, msg: Pick<MoveMsg, 'n' | 'epoch' | 'i' | 'm' | 'ms'>, api: ZhessApi = zhess): MoveOutcome {
  if (msg.n < log.n || (msg.n === log.n && msg.epoch < log.epoch)) return { kind: 'stale' };
  if (msg.n > log.n || msg.epoch > log.epoch) return { kind: 'gap' };
  if (!Number.isInteger(msg.i) || msg.i < 0) return { kind: 'conflict', error: 'bad index' };
  if (msg.i < log.plies.length) {
    const have = log.plies[msg.i];
    if (have.m === msg.m && have.ms === Math.max(0, Math.round(msg.ms))) return { kind: 'duplicate' };
    // A resend in non-canonical form (e.g. a queen promotion without its letter) still matches.
    try {
      const g = api.play(api.replay(log.plies.slice(0, msg.i)), msg.m, msg.ms);
      if (samePly(g.plies[msg.i], have)) return { kind: 'duplicate' };
    } catch {
      /* fall through */
    }
    return { kind: 'conflict', error: `different ply at ${msg.i}` };
  }
  if (msg.i > log.plies.length) return { kind: 'gap' };
  if (log.end) return { kind: 'conflict', error: 'game is over' };
  if (typeof msg.m !== 'string' || !UCI_RE.test(msg.m)) return { kind: 'conflict', error: 'bad move' };
  if (typeof msg.ms !== 'number' || !Number.isFinite(msg.ms) || msg.ms < 0) return { kind: 'conflict', error: 'bad time' };
  try {
    return { kind: 'applied', log: appendPly(log, msg.m, msg.ms, api) };
  } catch {
    return { kind: 'conflict', error: `illegal move ${msg.m}` };
  }
}

/**
 * The takeback of DESIGN 9.7: the log cut back to before `requester`'s last move, `epoch + 1`.
 * Null when that seat has not moved yet or the game is over.
 */
export function takebackLog(log: GameLog, requester: Seat): GameLog | null {
  if (log.end) return null;
  const color = colorOf(log, requester);
  for (let i = log.plies.length - 1; i >= 0; i--) {
    if (colorOfPly(i) === color) {
      return { n: log.n, epoch: log.epoch + 1, white: log.white, tc: log.tc, plies: log.plies.slice(0, i) };
    }
  }
  return null;
}

/* ---------------------------------------------------------------------------------------------- */
/* Score (DESIGN 9.3, 9.7)                                                                          */
/* ---------------------------------------------------------------------------------------------- */

/** Points a finished game adds per seat, in half points ×2: a win 2, a draw 1 each, a loss 0. */
export function gamePoints(log: Pick<GameLog, 'white' | 'end'>): [number, number] {
  const out: [number, number] = [0, 0];
  if (!log.end) return out;
  if (log.end.result === '1/2-1/2') return [1, 1];
  const winner = seatOf(log, log.end.result === '1-0' ? 'w' : 'b');
  out[winner] = 2;
  return out;
}

/** Room score per seat (half points ×2) over the given games; unfinished games count nothing. */
export function roomScore(logs: readonly Pick<GameLog, 'white' | 'end'>[]): [number, number] {
  const s: [number, number] = [0, 0];
  for (const l of logs) {
    const p = gamePoints(l);
    s[0] += p[0];
    s[1] += p[1];
  }
  return s;
}

/** A score (half points ×2 per seat) from this seat's point of view, in points: `[mine, theirs]`. */
export function scoreView(score: readonly [number, number], seat: Seat): [number, number] {
  return [score[seat] / 2, score[otherSeat(seat)] / 2];
}

/* ---------------------------------------------------------------------------------------------- */
/* base64url and the seat key (DESIGN 9.3)                                                          */
/* ---------------------------------------------------------------------------------------------- */

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Bytes → base64url without padding. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64URL[v >> 18] + B64URL[(v >> 12) & 63] + B64URL[(v >> 6) & 63] + B64URL[v & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const v = bytes[i] << 16;
    out += B64URL[v >> 18] + B64URL[(v >> 12) & 63];
  } else if (rest === 2) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64URL[v >> 18] + B64URL[(v >> 12) & 63] + B64URL[(v >> 6) & 63];
  }
  return out;
}

/** base64url (padding optional) → bytes. Throws on any other character or an impossible length. */
export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const t = s.replace(/=+$/, '');
  if (t.length % 4 === 1) throw new Error('Bad base64url length');
  const out = new Uint8Array(Math.floor((t.length * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < t.length; i++) {
    const v = B64URL.indexOf(t[i]);
    if (v < 0) throw new Error('Bad base64url character');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

/** Bytes in a seat key (128 bits) and in a challenge nonce. */
export const KEY_BYTES = 16;
export const NONCE_BYTES = 16;

/**
 * `n` random bytes: from `rng` when given (tests), else from `crypto.getRandomValues`.
 * Without either (no WebCrypto), falls back to `Math.random`.
 */
export function randomBytes(n: number, rng?: Rng): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  if (!rng) {
    const c = globalThis.crypto;
    if (c?.getRandomValues) {
      c.getRandomValues(out);
      return out;
    }
    rng = Math.random;
  }
  for (let i = 0; i < n; i++) out[i] = Math.min(255, Math.max(0, Math.floor(rng() * 256)));
  return out;
}

/** A new room key: 128 random bits, base64url (22 characters). */
export function generateKey(rng?: Rng): string {
  return toBase64Url(randomBytes(KEY_BYTES, rng));
}

/** A new challenge nonce for `hello`: 128 random bits, base64url. */
export function generateNonce(rng?: Rng): string {
  return toBase64Url(randomBytes(NONCE_BYTES, rng));
}

/** True for a well-formed room key (base64url of exactly 16 bytes). */
export function isValidKey(key: unknown): key is string {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(key)) return false;
  try {
    return fromBase64Url(key).length === KEY_BYTES;
  } catch {
    return false;
  }
}

/**
 * The bytes a proof signs: the challenge nonce, the room code (UTF-8), and the prover's seat.
 * The seat is an addition to DESIGN 9.3's `HMAC(key, nonce)`: without it a device without the key
 * could echo a device's own nonce back and replay that device's proof to it.
 */
export function proofMessage(nonce: string, code: string, proverSeat: Seat): Uint8Array<ArrayBuffer> {
  const n = fromBase64Url(nonce);
  if (n.length < 8) throw new Error('Nonce too short');
  const c = new TextEncoder().encode(code);
  const out = new Uint8Array(n.length + c.length + 1);
  out.set(n, 0);
  out.set(c, n.length);
  out[out.length - 1] = proverSeat;
  return out;
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('WebCrypto is not available');
  return s;
}

async function hmacKey(key: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  if (!isValidKey(key)) throw new Error('Bad room key');
  return subtle().importKey('raw', fromBase64Url(key), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

/**
 * The `proof.mac` answering the other side's `hello.nonce`:
 * base64url(HMAC-SHA-256(key, nonce ‖ code ‖ proverSeat)), where `proverSeat` is this device's seat.
 * Rejects on a malformed key or nonce, or without WebCrypto.
 */
export async function proveSeat(key: string, nonce: string, code: string, proverSeat: Seat): Promise<string> {
  const k = await hmacKey(key, 'sign');
  const mac = await subtle().sign('HMAC', k, proofMessage(nonce, code, proverSeat));
  return toBase64Url(new Uint8Array(mac));
}

/**
 * Checks the other side's `proof.mac` against the nonce this device sent. `proverSeat` is the seat
 * the other device must hold (the other seat of this room). Constant-time through WebCrypto.
 * Never rejects: anything malformed is simply false.
 */
export async function verifySeat(key: string, nonce: string, code: string, proverSeat: Seat, mac: string): Promise<boolean> {
  try {
    const k = await hmacKey(key, 'verify');
    const sig = fromBase64Url(mac);
    if (sig.length !== 32) return false;
    return await subtle().verify('HMAC', k, sig, proofMessage(nonce, code, proverSeat));
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Stored games (DESIGN 12.1)                                                                       */
/* ---------------------------------------------------------------------------------------------- */

/** `SavedGame.id` of a room game: `${code}.${n}`. */
export function roomGameId(code: string, n: number): string {
  return `${code}.${n}`;
}

/**
 * A `SavedGame` for a room game as this device stores it. `prev` (the stored copy, if any) keeps
 * `createdAt` and `assisted`; `lastPlayedAt` defaults to `now`.
 */
export function logToSaved(
  log: GameLog,
  opts: { code: string; seat: Seat; now: number; prev?: SavedGame; lastPlayedAt?: number },
  api: ZhessApi = zhess,
): SavedGame {
  const s: SavedGame = {
    id: roomGameId(opts.code, log.n),
    code: opts.code,
    mode: 'room',
    color: colorOf(log, opts.seat),
    tc: log.tc,
    moves: api.encodeMoves(log.plies),
    ms: log.plies.map((p) => p.ms),
    assisted: opts.prev?.assisted ?? false,
    room: { n: log.n, epoch: log.epoch },
    createdAt: opts.prev?.createdAt ?? opts.now,
    lastPlayedAt: opts.lastPlayedAt ?? opts.now,
  };
  if (log.end) {
    s.result = log.end.result;
    s.by = log.end.by;
  }
  return s;
}

/**
 * The `GameLog` of a stored room game, for this device's `seat`. Null when the record is not a room
 * game or does not replay.
 */
export function savedToLog(saved: SavedGame, seat: Seat, api: ZhessApi = zhess): GameLog | null {
  if (saved.mode !== 'room' || !saved.room) return null;
  let g: Game;
  try {
    const end = saved.result && saved.by ? { result: saved.result, by: saved.by } : undefined;
    g = api.fromRecord(saved.moves, saved.ms, end);
  } catch {
    return null;
  }
  const log: GameLog = {
    n: saved.room.n,
    epoch: saved.room.epoch,
    plies: g.plies.map((p) => ({ m: p.m, ms: p.ms })),
    white: saved.color === 'w' ? seat : otherSeat(seat),
    tc: saved.tc,
  };
  if (g.end) log.end = { result: g.end.result, by: g.end.by };
  return log;
}
