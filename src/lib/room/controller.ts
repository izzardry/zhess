/**
 * The room state machine (DESIGN 9): a framework-free `RoomController` over any `Transport`.
 *
 * Connection round (every `open` of the transport is a fresh channel):
 *
 * 1. Both devices send `hello {v, hasKey, nonce}`. `hasKey` = this device holds a room record.
 *    A different `v` locks the room with reason `version` and a notice.
 * 2. Both hold a key: mutual challenge. Each answers the other's nonce with `proof` (3A's
 *    HMAC-SHA-256 over nonce, code and the prover's seat) and checks the other's.
 *    - Success: authenticated. An open room (never synced) becomes locked.
 *    - Failure with a locked room: notice `challenge-failed`, nothing about the game is sent, and the
 *      transport reconnects after a backoff so the real opponent can get through. A `join` that
 *      follows on the same channel is still treated as a rejoin request.
 *    - Failure with an open (provisional) room: the codes collided with another room. The dialer
 *      drops its provisional room; either side then asks for a seat with `join`.
 * 3. A device without a record sends `join`. The keyholder answers:
 *    - open room (never synced): `welcome {key, seat, tc, color}` — the first join (DESIGN 9.3);
 *    - locked room: a pending `rejoin` request (`requests.incoming = 'rejoin'`); `reply('rejoin', ok)`
 *      sends `grant {key, seat, score, games}` or `deny` (DESIGN 9.5);
 *    - no record on either side: the anchor creates the room and welcomes the dialer.
 * 4. Once authenticated (or welcomed / granted) both send `head` and reconcile through 3A's
 *    `reconcile` (DESIGN 9.4). The first `head` from the other side makes the room live.
 *
 * Live play: `move {n, epoch, i, m, ms}` is acknowledged with `ack`; unacknowledged moves are sent
 * again after `resendMs` and are covered by the reconcile on the next connection. Untimed games
 * accept this device's move while disconnected (DESIGN 9.6); timed games lock the board. Requests
 * (`ask` / `reply`) carry the game context `(n, epoch, len)` and lapse when it changes. `end` carries
 * the same context as an addition so a resignation crossing a move is settled by reconcile.
 *
 * Clocks (DESIGN 9.8): the running turn is `turnUsed + (now - turnStart)`. A disconnect pauses it
 * (timed games; in untimed games this device's own turn keeps counting because it may move
 * offline). On reconnect the side to move reports its turn time in `head.turnMs`. This device's
 * own flag falls at zero; the opponent's is claimed after it has read zero for `graceMs` while live.
 *
 * Liveness: `ping` every `pingMs`; `missLimit` intervals without any message mark the peer
 * disconnected and reconnect the transport.
 */
import type {
  AckMsg,
  AskMsg,
  Color,
  DenyMsg,
  EndMsg,
  Game,
  GameEnd,
  GameLog,
  GrantMsg,
  HeadMsg,
  HelloMsg,
  LogsMsg,
  Message,
  MoveMsg,
  Presence,
  ProofMsg,
  ReplyMsg,
  RequestKind,
  Room,
  RoomLock,
  LockReason,
  RoomNotice,
  RoomNoticeKind,
  SavedGame,
  Seat,
  Store,
  TimeControl,
  Transport,
  TransportFailure,
  TransportState,
  WelcomeMsg,
  ZhessApi,
} from '../types';
import { PROTOCOL_VERSION } from '../types';
import zhessDefault, { parseTc } from '../zhess';
import { remaining } from '../clock';
import { defaultTimers, type RoomTransport, type Timers, type TransportFailureKind, type TransportRole } from '../transport/common';
import {
  appendPly,
  applyMoveMsg,
  colorOf,
  currentLog,
  endLog,
  gamePoints,
  generateKey,
  generateNonce,
  isValidKey,
  logToGame,
  logToSaved,
  makeHead,
  mergeLogs,
  newLog,
  otherSeat,
  proveSeat,
  reconcile,
  rematchLog,
  roomGameId,
  roomScore,
  savedToLog,
  seatToMove,
  sortLogs,
  takebackLog,
  verifySeat,
} from '../sync';
import type { InitialTurn, RoomControllerApi, RoomControllerOptions, RoomCreateSettings, RoomPhase, RoomState } from './types';

/* ---------------------------------------------------------------------------------------------- */
/* Constants and small helpers                                                                      */
/* ---------------------------------------------------------------------------------------------- */

export const DEFAULTS = Object.freeze({
  pingMs: 5000,
  missLimit: 3,
  graceMs: 2000,
  resendMs: 3000,
  retryMs: 5000,
  retryMaxMs: 30_000,
  maxMessageBytes: 200_000,
});

const V = PROTOCOL_VERSION;
const REQUEST_KINDS: ReadonlySet<string> = new Set<RequestKind>(['takeback', 'draw', 'rematch']);
const END_BY: ReadonlySet<string> = new Set(['resign', 'time', 'agreed']);

/** Game context a request or an `end` refers to. */
interface Ctx {
  n: number;
  epoch: number;
  len: number;
}

/** `end` as this controller sends it: the contract's fields plus the context (contract addition). */
type EndOut = EndMsg & { epoch?: number; len?: number };

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;
const isSeat = (x: unknown): x is Seat => x === 0 || x === 1;

function ctxOf(log: GameLog | undefined): Ctx | null {
  return log ? { n: log.n, epoch: log.epoch, len: log.plies.length } : null;
}

function sameCtx(a: Ctx | null, b: Ctx | null): boolean {
  return !!a && !!b && a.n === b.n && a.epoch === b.epoch && a.len === b.len;
}

function lossFor(color: Color): GameEnd['result'] {
  return color === 'w' ? '0-1' : '1-0';
}

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

/** One connection round (hello, challenge or join, head) on an open channel. */
interface Round {
  /** Nonce this device sent in its `hello`. */
  nonce: string;
  /** The other side's `hello` of this round. */
  peer: HelloMsg | null;
  stage: 'hello' | 'proving' | 'joining' | 'asked' | 'auth' | 'stranger' | 'version' | 'denied';
  /** First `head` from the other side handled (live). */
  headSeen: boolean;
  /** Re-handshake on the same channel while live: no connect notices. */
  quiet: boolean;
  /** The other side failed the key challenge (the notice waits for the retry: a join may follow). */
  failed: boolean;
  /** Any message received since the last ping tick. */
  rx: boolean;
  misses: number;
  /** Ping ticks spent in a handshake stage that needs no person (a lost hello, proof or head). */
  stall: number;
}

interface Pending {
  msg: MoveMsg;
  sentAt: number | null;
}

/* ---------------------------------------------------------------------------------------------- */
/* Controller                                                                                       */
/* ---------------------------------------------------------------------------------------------- */

class Controller implements RoomControllerApi {
  /* config */
  private readonly code: string;
  private readonly store: Store;
  private readonly api: ZhessApi;
  private readonly now: () => number;
  private readonly wall: () => number;
  private readonly rng: (() => number) | undefined;
  private readonly timers: Timers;
  private readonly create: RoomCreateSettings | null;
  private readonly readOnly: boolean;
  private initialTurn: InitialTurn | null;
  private readonly pingMs: number;
  private readonly missLimit: number;
  private readonly graceMs: number;
  private readonly resendMs: number;
  private readonly retryMs: number;
  private readonly maxBytes: number;

  /* room */
  private room: Room | null = null;
  private logs: GameLog[] = [];
  private game: Game;

  /* transport */
  private t: Transport | null = null;
  private tGen = 0;
  private tOff: (() => void)[] = [];
  private role: TransportRole | null = null;
  private tState: TransportState = 'connecting';
  private failure: TransportFailure | null = null;
  private failureKind: TransportFailureKind | null = null;
  private iceNotified = false;

  /* connection */
  private chGen = 0;
  private round: Round | null = null;
  private live = false;
  private everLive = false;
  private versionLocked = false;
  private denied = false;
  private closed = false;
  private retries = 0;
  /** A `grant` / `welcome` this device sent and whose `head` reply locks an open room. */
  private bindOnHead = false;

  /* requests */
  private incoming: RequestKind | 'rejoin' | undefined;
  private incomingCtx: Ctx | null = null;
  private outgoing: RequestKind | undefined;
  private outgoingCtx: Ctx | null = null;
  private outgoingAt: number | null = null;

  /* moves */
  private pending: Pending[] = [];

  /* clock */
  private turnKey = '';
  private turnUsed = 0;
  private turnStart: number | null = null;

  /* timers */
  private pingTimer: unknown = null;
  private resendTimer: unknown = null;
  private flagTimer: unknown = null;
  private retryTimer: unknown = null;

  /* output */
  private noticeSeq = 0;
  private lastNotice: RoomNotice | null = null;
  private subs = new Set<(s: RoomState) => void>();
  private noticeSubs = new Set<(n: RoomNotice) => void>();
  private snap: RoomState;
  private queue: Promise<void> = Promise.resolve();

  constructor(opts: RoomControllerOptions) {
    this.code = opts.code;
    this.store = opts.store;
    this.api = opts.zhess ?? zhessDefault;
    this.now = opts.now ?? defaultNow;
    this.wall = opts.wallNow ?? Date.now;
    this.rng = opts.rng;
    this.timers = opts.timers ?? defaultTimers;
    this.create = opts.create ?? null;
    this.readOnly = !!opts.readOnly;
    this.initialTurn = opts.initialTurn ?? null;
    this.pingMs = opts.pingMs ?? DEFAULTS.pingMs;
    this.missLimit = opts.missLimit ?? DEFAULTS.missLimit;
    this.graceMs = opts.graceMs ?? DEFAULTS.graceMs;
    this.resendMs = opts.resendMs ?? DEFAULTS.resendMs;
    this.retryMs = opts.retryMs ?? DEFAULTS.retryMs;
    this.maxBytes = opts.maxMessageBytes ?? DEFAULTS.maxMessageBytes;
    this.game = this.api.newGame();

    this.load();
    if (!this.room && this.create && !this.readOnly) this.createRoom(this.create);
    this.recomputeClock();
    this.snap = this.build();

    if (this.readOnly) return;
    if (opts.transport) this.attach(opts.transport);
    else if (opts.factory) {
      opts.factory(this.code).then(
        (t) => {
          if (this.closed) t.close();
          else if (!this.t) this.attach(t);
        },
        () => {
          if (this.closed) return;
          this.failure = 'broker-unreachable';
          this.failureKind = 'broker-unreachable';
          this.emit();
        },
      );
    }
  }

  /* ============================================================================================ */
  /* Public API                                                                                    */
  /* ============================================================================================ */

  get snapshot(): RoomState {
    return this.snap;
  }

  get transport(): Transport | null {
    return this.t;
  }

  subscribe(cb: (s: RoomState) => void): () => void {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }

  onNotice(cb: (n: RoomNotice) => void): () => void {
    this.noticeSubs.add(cb);
    return () => {
      this.noticeSubs.delete(cb);
    };
  }

  idle(): Promise<void> {
    const wait = async (): Promise<void> => {
      let last: Promise<void> | null = null;
      while (last !== this.queue) {
        last = this.queue;
        await last;
      }
    };
    return wait();
  }

  elapsed(): number {
    return Math.max(0, this.turnUsed + (this.turnStart !== null ? Math.max(0, this.now() - this.turnStart) : 0));
  }

  move(uci: string, ms?: number): boolean {
    const cur = this.cur();
    if (!this.room || !cur || cur.end || this.lockReason() !== null) return false;
    if (seatToMove(cur) !== this.room.seat) return false;
    const used = typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : this.elapsed();
    let next: GameLog;
    try {
      next = appendPly(cur, uci, used, this.api);
    } catch {
      return false;
    }
    const i = cur.plies.length;
    const msg: MoveMsg = { t: 'move', v: V, n: next.n, epoch: next.epoch, i, m: next.plies[i].m, ms: next.plies[i].ms };
    this.pending.push({ msg, sentAt: null });
    this.setLogs(this.replaceCur(next));
    if (this.live) this.sendMove(this.pending[this.pending.length - 1]);
    this.emit();
    return true;
  }

  ask(kind: RequestKind): boolean {
    if (!REQUEST_KINDS.has(kind) || !this.canAsk(kind)) return false;
    const cur = this.cur() as GameLog;
    if (this.incoming === kind && kind !== 'takeback' && sameCtx(this.incomingCtx, ctxOf(cur))) {
      // Both asked for the same thing: that is an agreement.
      return this.reply(kind, true);
    }
    this.outgoing = kind;
    this.outgoingCtx = ctxOf(cur);
    this.sendAsk();
    this.emit();
    return true;
  }

  reply(kind: RequestKind | 'rejoin', ok: boolean): boolean {
    if (this.closed) return false;
    if (kind === 'rejoin') return this.replyRejoin(ok);
    if (this.incoming !== kind || !this.room || !this.live) return false;
    const cur = this.cur();
    const ctx = this.incomingCtx;
    this.incoming = undefined;
    this.incomingCtx = null;
    if (!cur || !ctx || !this.requestValid(kind, ctx, otherSeat(this.room.seat))) {
      this.emit();
      return false;
    }
    this.send({ t: 'reply', v: V, kind, ok, n: ctx.n, epoch: ctx.epoch, len: ctx.len } satisfies ReplyMsg);
    if (ok) this.applyRequest(kind, otherSeat(this.room.seat));
    if (this.outgoing === kind) this.clearOutgoing();
    this.emit();
    return true;
  }

  resign(): boolean {
    const cur = this.cur();
    if (!this.room || !cur || cur.end || this.closed || this.readOnly || this.versionLocked || this.denied) return false;
    const end: GameEnd = { result: lossFor(colorOf(cur, this.room.seat)), by: 'resign' };
    this.finish(end);
    return true;
  }

  flag(): boolean {
    return this.flagCheck();
  }

  leave(): void {
    if (this.closed) return;
    this.recomputeClock();
    this.closed = true;
    this.turnUsed = this.elapsed();
    this.turnStart = null;
    for (const h of [this.pingTimer, this.resendTimer, this.flagTimer, this.retryTimer]) if (h !== null) this.timers.clearTimeout(h);
    this.pingTimer = this.resendTimer = this.flagTimer = this.retryTimer = null;
    const t = this.t;
    this.live = false;
    this.detach();
    this.round = null;
    try {
      t?.close();
    } catch {
      /* ignore */
    }
    this.emit();
    this.subs.clear();
    this.noticeSubs.clear();
  }

  attach(t: Transport): void {
    if (this.closed || this.readOnly || this.t === t) return;
    this.detach();
    this.t = t;
    const gen = ++this.tGen;
    const rt = t as Partial<RoomTransport>;
    const guard =
      <T,>(fn: (v: T) => void) =>
      (v: T) => {
        if (gen === this.tGen && !this.closed) fn(v);
      };
    const offs: (() => void)[] = [];
    const keep = (off: unknown) => {
      if (typeof off === 'function') offs.push(off as () => void);
    };
    this.role = t.role;
    this.tState = 'connecting';
    if (typeof rt.onRole === 'function') keep(rt.onRole(guard((r: TransportRole) => this.onRole(r))));
    if (typeof rt.onFailure === 'function') keep(rt.onFailure(guard((f: TransportFailureKind) => this.onFailure(f))));
    // A RoomTransport replays its current state at once: an already open channel starts a round
    // before the messages it buffered are handed over, so they belong to that round.
    keep(t.onState(guard((s: TransportState) => this.onState(s))));
    // A plain transport may not replay its state; trust its `state` if it has one.
    if (this.tState === 'connecting' && rt.state === 'open') this.onState('open');
    keep(t.onMessage(guard((m: Message) => this.onMessage(m))));
    this.tOff = offs;
    this.emit();
  }

  /* ============================================================================================ */
  /* Loading, creating and persisting                                                              */
  /* ============================================================================================ */

  private load(): void {
    let room: Room | undefined;
    try {
      room = this.store.rooms().find((r) => r.code === this.code);
    } catch {
      room = undefined;
    }
    if (!room || !isValidKey(room.key) || !isSeat(room.seat)) return;
    this.room = { ...room, score: [room.score[0] ?? 0, room.score[1] ?? 0], games: [...room.games] };
    const logs: GameLog[] = [];
    let saved: SavedGame[] = [];
    try {
      saved = this.store.games();
    } catch {
      saved = [];
    }
    for (const s of saved) {
      if (s.mode !== 'room' || s.code !== this.code || !s.room) continue;
      const log = savedToLog(s, room.seat, this.api);
      if (log) logs.push(log);
    }
    this.logs = sortLogs(logs);
    this.refreshGame();
  }

  /** Creates an open room with this device in seat 0 (DESIGN 9.3: the creator generates the key). */
  private createRoom(settings: RoomCreateSettings): void {
    const pick = this.rng ?? Math.random;
    const white: Seat = settings.color === 'w' ? 0 : settings.color === 'b' ? 1 : pick() < 0.5 ? 0 : 1;
    const tc = settings.tc && parseTc(settings.tc) ? settings.tc : null;
    const at = this.wall();
    this.room = { code: this.code, key: generateKey(this.rng), seat: 0, createdAt: at, lastSeenAt: 0, score: [0, 0], games: [] };
    this.logs = [];
    this.setLogs([newLog(1, white, tc)]);
  }

  /** Drops this device's provisional (never synced) room after a code collision. */
  private discardProvisional(): void {
    const room = this.room;
    if (!room || room.lastSeenAt !== 0) return;
    try {
      for (const id of room.games) this.store.deleteGame(id);
      for (const l of this.logs) this.store.deleteGame(roomGameId(this.code, l.n));
      this.store.deleteRoom(this.code);
    } catch {
      /* storage trouble: the in-memory state still moves on */
    }
    this.room = null;
    this.logs = [];
    this.pending = [];
    this.clearOutgoing();
    this.refreshGame();
    this.recomputeClock();
  }

  /** Persists the room record (score, game ids, stamps). */
  private saveRoom(): void {
    if (!this.room) return;
    const ids = new Set(this.room.games);
    for (const l of this.logs) ids.add(roomGameId(this.code, l.n));
    const games = [...ids].sort((a, b) => Number(a.slice(a.lastIndexOf('.') + 1)) - Number(b.slice(b.lastIndexOf('.') + 1)));
    this.room = { ...this.room, games };
    try {
      this.store.saveRoom(this.room);
    } catch {
      /* ignore */
    }
  }

  private markSynced(): void {
    if (!this.room) return;
    this.room = { ...this.room, lastSeenAt: Math.max(1, this.wall()) };
    this.saveRoom();
  }

  /**
   * Replaces the room's logs: recomputes the score, persists every changed game and the room,
   * refreshes the current game, drops stale requests and pending moves, and restarts the turn
   * when the position changed.
   */
  private setLogs(next: GameLog[]): void {
    const before = new Map(this.logs.map((l) => [l.n, l] as const));
    this.logs = sortLogs(next);
    const changed = this.logs.filter((l) => before.get(l.n) !== l);
    if (this.room) {
      const cur = this.cur();
      const covered = !!cur && this.logs.length === cur.n && this.logs.every((l, i) => l.n === i + 1);
      let score: [number, number];
      if (covered) score = roomScore(this.logs);
      else {
        score = [this.room.score[0], this.room.score[1]];
        for (const l of changed) {
          const was = before.get(l.n);
          const add = gamePoints(l);
          const sub = was ? gamePoints(was) : [0, 0];
          score[0] += add[0] - sub[0];
          score[1] += add[1] - sub[1];
        }
      }
      this.room = { ...this.room, score };
      const at = this.wall();
      let stored: SavedGame[] = [];
      try {
        stored = this.store.games();
      } catch {
        stored = [];
      }
      for (const l of changed) {
        const id = roomGameId(this.code, l.n);
        const prev = stored.find((g) => g.id === id);
        try {
          this.store.saveGame(logToSaved(l, { code: this.code, seat: this.room.seat, now: at, prev }, this.api));
        } catch {
          /* ignore */
        }
      }
      this.saveRoom();
    }
    this.refreshGame();
    this.prunePending();
    this.pruneRequests();
    this.recomputeClock();
  }

  private replaceCur(log: GameLog): GameLog[] {
    return [...this.logs.filter((l) => l.n !== log.n), log];
  }

  private refreshGame(): void {
    const cur = this.cur();
    if (!cur) {
      this.game = this.api.newGame();
      return;
    }
    try {
      this.game = logToGame(cur, this.api);
    } catch {
      this.game = this.api.newGame();
    }
  }

  private cur(): GameLog | undefined {
    return currentLog(this.logs);
  }

  /* ============================================================================================ */
  /* Transport events                                                                              */
  /* ============================================================================================ */

  private detach(): void {
    for (const off of this.tOff) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    this.tOff = [];
    this.tGen++;
    if (this.round) this.channelLost();
    this.t = null;
  }

  private onRole(r: TransportRole): void {
    this.role = r;
    this.emit();
  }

  private onFailure(f: TransportFailureKind): void {
    this.failureKind = f;
    if (f !== 'peer-gone') this.failure = f;
    if (f === 'ice-failed' && !this.iceNotified) {
      this.iceNotified = true;
      this.notify('ice-failed');
    }
    this.emit();
  }

  private onState(s: TransportState): void {
    this.tState = s;
    if (s === 'open') {
      this.failure = null;
      this.failureKind = null;
      if (this.round) this.channelLost();
      else this.chGen++;
      this.startRound();
    } else if (this.round) {
      this.channelLost();
    }
    this.emit();
  }

  private onMessage(m: Message): void {
    if (this.closed || typeof m !== 'object' || m === null) return;
    if (this.round) {
      this.round.rx = true;
      this.round.misses = 0;
    }
    const gen = this.chGen;
    this.queue = this.queue
      .then(() => (gen === this.chGen || (m.t === 'hello' && !this.round && this.tState === 'open') ? this.handle(m) : undefined))
      .catch((e: unknown) => {
        console.error('room: message handler failed', e);
      });
  }

  /** Starts a handshake round on the current channel and sends `hello`. */
  private startRound(): void {
    this.round = {
      nonce: generateNonce(this.rng),
      peer: null,
      stage: 'hello',
      headSeen: false,
      quiet: false,
      failed: false,
      rx: false,
      misses: 0,
      stall: 0,
    };
    this.bindOnHead = false;
    this.send({ t: 'hello', v: V, hasKey: !!this.room, nonce: this.round.nonce } satisfies HelloMsg);
    this.startPing();
  }

  /** The channel is gone (or the peer stopped answering): back to waiting. */
  private channelLost(): void {
    this.chGen++;
    this.round = null;
    this.bindOnHead = false;
    this.stopPing();
    if (this.resendTimer !== null) {
      this.timers.clearTimeout(this.resendTimer);
      this.resendTimer = null;
    }
    for (const p of this.pending) p.sentAt = null;
    if (this.incoming) {
      this.incoming = undefined;
      this.incomingCtx = null;
    }
    if (this.live) {
      this.live = false;
      this.notify('opponent-disconnected');
    }
    this.recomputeClock();
  }

  /* ---- ping / pong ---- */

  private startPing(): void {
    this.stopPing();
    const tick = () => {
      this.pingTimer = null;
      const r = this.round;
      if (!r || this.closed) return;
      if (!r.rx) r.misses++;
      r.rx = false;
      // A handshake that stalls (nobody is deciding anything) is retried like a dead channel.
      const stalled = !this.live && (r.stage === 'hello' || r.stage === 'proving' || (r.stage === 'auth' && !r.headSeen));
      r.stall = stalled ? r.stall + 1 : 0;
      if (r.misses >= this.missLimit || r.stall > this.missLimit) {
        this.livenessLost();
        return;
      }
      this.send({ t: 'ping', v: V });
      this.pingTimer = this.timers.setTimeout(tick, this.pingMs);
    };
    this.pingTimer = this.timers.setTimeout(tick, this.pingMs);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) this.timers.clearTimeout(this.pingTimer);
    this.pingTimer = null;
  }

  private livenessLost(): void {
    this.channelLost();
    const rt = this.t as Partial<RoomTransport> | null;
    if (rt && typeof rt.reconnect === 'function') rt.reconnect();
    else if (this.tState === 'open') this.startRound(); // no reconnect: start over on this channel
    this.emit();
  }

  /** After a failed challenge or a declined rejoin: reconnect later so the real opponent can get through. */
  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    const delay = Math.min(DEFAULTS.retryMaxMs, this.retryMs * 2 ** Math.min(this.retries, 10));
    this.retries++;
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      const r = this.round;
      if (this.closed || !r || r.stage !== 'stranger') return;
      if (r.failed) this.notify('challenge-failed');
      const rt = this.t as Partial<RoomTransport> | null;
      if (rt && typeof rt.reconnect === 'function') rt.reconnect();
    }, delay);
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /* ============================================================================================ */
  /* Message handlers                                                                              */
  /* ============================================================================================ */

  private async handle(m: Message): Promise<void> {
    if (this.closed) return;
    switch (m.t) {
      case 'hello':
        return this.onHello(m);
      case 'proof':
        return this.onProof(m);
      case 'join':
      case 'rejoin':
        return this.onJoin();
      case 'welcome':
        return this.onWelcome(m);
      case 'grant':
        return this.onGrant(m);
      case 'deny':
        return this.onDeny(m);
      case 'ping':
        this.send({ t: 'pong', v: V });
        return;
      case 'pong':
        return;
      default:
        break;
    }
    if (this.round?.stage !== 'auth') return;
    switch (m.t) {
      case 'head':
        return this.onHead(m);
      case 'logs':
        return this.onLogs(m);
      case 'move':
        return this.onMove(m);
      case 'ack':
        return this.onAck(m);
      case 'ask':
        return this.onAsk(m);
      case 'reply':
        return this.onReply(m);
      case 'end':
        return this.onEnd(m);
      default:
        return;
    }
  }

  /* ---- hello and challenge ---- */

  private async onHello(m: HelloMsg): Promise<void> {
    if (typeof m.nonce !== 'string' || typeof m.hasKey !== 'boolean') return;
    if (!this.round) {
      if (this.tState !== 'open') return;
      this.startRound();
    } else if (this.round.peer) {
      // The other side started over on this channel: start a new round too.
      const quiet = this.live;
      this.incoming = undefined;
      this.incomingCtx = null;
      if (this.live) {
        this.live = false;
        this.recomputeClock();
      }
      this.round = null;
      this.startRound();
      const fresh = this.round as Round | null;
      if (fresh) fresh.quiet = quiet;
    }
    const r = this.round as Round;
    r.peer = m;
    if ((m as { v: unknown }).v !== PROTOCOL_VERSION) {
      r.stage = 'version';
      if (!this.versionLocked) {
        this.versionLocked = true;
        this.notify('version-mismatch');
      }
      this.recomputeClock();
      this.emit();
      return;
    }
    if (this.room && m.hasKey) {
      r.stage = 'proving';
      const room = this.room;
      let mac: string;
      try {
        mac = await proveSeat(room.key, m.nonce, this.code, room.seat);
      } catch {
        mac = '';
      }
      if (this.round !== r) return;
      this.send({ t: 'proof', v: V, mac } satisfies ProofMsg);
    } else if (this.room) {
      r.stage = 'hello'; // wait for the newcomer's join
    } else if (this.denied) {
      r.stage = 'denied'; // declined once: do not ask again
    } else {
      r.stage = 'joining';
      this.send({ t: 'join', v: V });
    }
    this.emit();
  }

  private async onProof(m: ProofMsg): Promise<void> {
    const r = this.round;
    const room = this.room;
    if (!r || !room || r.stage !== 'proving' || typeof m.mac !== 'string') return;
    const ok = await verifySeat(room.key, r.nonce, this.code, otherSeat(room.seat), m.mac);
    if (this.round !== r || this.room !== room) return;
    if (ok) {
      this.authenticate();
      return;
    }
    if (room.lastSeenAt === 0) {
      // A provisional room met another room of the same code. The dialer gives its room up;
      // either way this device now asks the other side for a seat.
      if (this.role === 'dialer') this.discardProvisional();
      r.stage = 'joining';
      this.send({ t: 'join', v: V });
      this.emit();
      return;
    }
    r.stage = 'stranger';
    r.failed = true;
    this.scheduleRetry();
    this.emit();
  }

  /** The other device proved the key (or was just welcomed / granted): exchange heads. */
  private authenticate(): void {
    const r = this.round;
    if (!r) return;
    r.stage = 'auth';
    this.cancelRetry();
    this.retries = 0;
    if (this.room && this.room.lastSeenAt === 0) this.bindOnHead = true;
    this.sendHead();
    this.emit();
  }

  /* ---- join, welcome, rejoin ---- */

  private onJoin(): void {
    const r = this.round;
    if (!r || !r.peer || r.stage === 'version' || r.stage === 'auth') return;
    if (!this.room) {
      // Nobody holds the room: the anchor creates it (DESIGN 9.5: the first to start creates).
      if (this.role !== 'anchor') return;
      this.createRoom(this.create ?? { tc: null, color: 'random' });
    }
    const room = this.room as Room;
    if (room.lastSeenAt === 0) {
      this.sendWelcome();
      return;
    }
    // Locked room, a device without the key: the seated player decides (DESIGN 9.5).
    this.cancelRetry();
    r.stage = 'asked';
    this.incoming = 'rejoin';
    this.incomingCtx = null;
    this.emit();
  }

  private sendWelcome(): void {
    const r = this.round;
    const room = this.room;
    const cur = this.cur();
    if (!r || !room || !cur) return;
    const seat = otherSeat(room.seat);
    this.send({ t: 'welcome', v: V, key: room.key, seat, tc: cur.tc, color: colorOf(cur, seat) } satisfies WelcomeMsg);
    this.authenticate();
  }

  private onWelcome(m: WelcomeMsg): void {
    const r = this.round;
    if (!r || r.stage !== 'joining') return;
    if (!isValidKey(m.key) || !isSeat(m.seat) || (m.color !== 'w' && m.color !== 'b')) return;
    if (m.tc !== null && (typeof m.tc !== 'string' || !parseTc(m.tc))) return;
    if (this.room) {
      if (this.room.lastSeenAt !== 0) return;
      this.discardProvisional();
    }
    const at = this.wall();
    const white: Seat = m.color === 'w' ? m.seat : otherSeat(m.seat);
    this.room = { code: this.code, key: m.key, seat: m.seat, createdAt: at, lastSeenAt: Math.max(1, at), score: [0, 0], games: [] };
    this.logs = [];
    this.setLogs([newLog(1, white, m.tc)]);
    this.authenticate();
  }

  private replyRejoin(ok: boolean): boolean {
    const r = this.round;
    const room = this.room;
    if (this.incoming !== 'rejoin' || !r || r.stage !== 'asked' || !room) return false;
    this.incoming = undefined;
    this.incomingCtx = null;
    if (!ok) {
      this.send({ t: 'deny', v: V } satisfies DenyMsg);
      r.stage = 'stranger';
      this.scheduleRetry();
      this.emit();
      return true;
    }
    // Everything the lost device needs (DESIGN 9.5). Large rooms: the newest games that fit go in
    // the grant, the rest follows in `logs` messages.
    const all = sortLogs(this.logs);
    const base: GrantMsg = { t: 'grant', v: V, key: room.key, seat: otherSeat(room.seat), score: [room.score[0], room.score[1]], games: [] };
    let size = JSON.stringify(base).length;
    const inGrant: GameLog[] = [];
    for (let i = all.length - 1; i >= 0; i--) {
      const s = JSON.stringify(all[i]).length + 1;
      if (inGrant.length && size + s > this.maxBytes) break;
      inGrant.unshift(all[i]);
      size += s;
    }
    this.send({ ...base, games: inGrant });
    const rest = all.slice(0, all.length - inGrant.length);
    if (rest.length) this.sendLogs(rest);
    this.authenticate();
    return true;
  }

  private onGrant(m: GrantMsg): void {
    const r = this.round;
    if (!r || r.stage !== 'joining') return;
    if (!isValidKey(m.key) || !isSeat(m.seat) || !Array.isArray(m.games)) return;
    const score: [number, number] =
      Array.isArray(m.score) && m.score.length === 2 && isInt(m.score[0]) && isInt(m.score[1]) ? [m.score[0], m.score[1]] : [0, 0];
    const res = reconcile([], m.games, m.seat, this.api);
    if (res.status === 'invalid') {
      this.notify('sync-error');
      this.emit();
      return;
    }
    if (this.room) {
      if (this.room.lastSeenAt !== 0) return;
      this.discardProvisional();
    }
    const at = this.wall();
    this.room = { code: this.code, key: m.key, seat: m.seat, createdAt: at, lastSeenAt: Math.max(1, at), score, games: [] };
    this.logs = [];
    this.setLogs(res.adopt ?? []);
    this.authenticate();
  }

  private onDeny(_m: DenyMsg): void {
    const r = this.round;
    if (!r || r.stage !== 'joining') return;
    r.stage = 'denied';
    this.denied = true;
    this.notify('rejoin-denied');
    this.recomputeClock();
    this.emit();
  }

  /* ---- reconcile ---- */

  private sendHead(): void {
    const cur = this.cur();
    const mine = !!cur && !cur.end && !!this.room && seatToMove(cur) === this.room.seat;
    this.send(makeHead(cur, mine ? this.elapsed() : undefined));
  }

  /** Sends logs, split so that no message exceeds `maxMessageBytes`; the current game goes last. */
  private sendLogs(games: readonly GameLog[]): void {
    const sorted = sortLogs(games);
    const chunks: GameLog[][] = [];
    let chunk: GameLog[] = [];
    let size = 40;
    for (const g of sorted) {
      const s = JSON.stringify(g).length + 1;
      if (chunk.length && size + s > this.maxBytes) {
        chunks.push(chunk);
        chunk = [];
        size = 40;
      }
      chunk.push(g);
      size += s;
    }
    if (chunk.length) chunks.push(chunk);
    for (const c of chunks) this.send({ t: 'logs', v: V, games: c } satisfies LogsMsg);
  }

  private onHead(m: HeadMsg): void {
    const r = this.round as Round;
    const room = this.room;
    if (!room) return;
    if (this.bindOnHead) {
      // The joiner has its key: the room is locked from now on (DESIGN 9.3).
      this.bindOnHead = false;
      this.markSynced();
      this.notify('opponent-joined');
      r.quiet = true;
    }
    this.confirmPending(m);
    const res = reconcile(this.logs, m, room.seat, this.api);
    if (res.status === 'invalid') this.notify('sync-error');
    if (res.send?.length) this.sendLogs(res.send);
    if (!r.headSeen) {
      r.headSeen = true;
      this.goLive();
    }
    // DESIGN 9.8: the side to move reports the time it already used on its running turn.
    const cur = this.cur();
    if (cur && !cur.end && typeof m.turnMs === 'number' && Number.isFinite(m.turnMs) && m.turnMs >= 0) {
      if (sameCtx(ctxOf(cur), { n: m.n, epoch: m.epoch, len: m.len }) && seatToMove(cur) !== room.seat) {
        this.recomputeClock();
        this.turnUsed = m.turnMs;
        this.turnStart = this.turnStart !== null ? this.now() : null;
        this.armFlagTimer();
      }
    }
    if (res.status === 'in-sync') this.markSynced();
    this.emit();
  }

  private onLogs(m: LogsMsg): void {
    const room = this.room;
    if (!room) return;
    const res = reconcile(this.logs, m, room.seat, this.api);
    if (res.status === 'invalid') {
      this.notify('sync-error');
      this.emit();
      return;
    }
    if (res.adopt?.length) this.setLogs(mergeLogs(this.logs, res.adopt));
    if (res.forked) this.notify('restored-from-opponent');
    if (res.send?.length) this.sendLogs(res.send);
    if (res.adopt?.length) this.sendHead(); // tells the other side what this device holds now
    if (!res.send?.length) this.markSynced();
    this.emit();
  }

  private goLive(): void {
    this.live = true;
    const r = this.round;
    if (!r?.quiet) this.notify(this.everLive ? 'reconnected' : 'opponent-connected');
    this.everLive = true;
    this.recomputeClock();
    // Moves made while syncing (or offline) that no reconcile carried yet.
    for (const p of this.pending) if (p.sentAt === null) this.sendMove(p);
    // A request still pending from before the disconnect is asked again.
    if (this.outgoing) {
      if (this.requestValid(this.outgoing, this.outgoingCtx, this.room?.seat ?? 0) && sameCtx(this.outgoingCtx, ctxOf(this.cur()))) this.sendAsk();
      else this.clearOutgoing();
    }
  }

  /* ---- live play ---- */

  private onMove(m: MoveMsg): void {
    const room = this.room;
    const cur = this.cur();
    if (!room) return;
    if (!cur || !isInt(m.n) || !isInt(m.epoch) || !isInt(m.i) || typeof m.m !== 'string' || typeof m.ms !== 'number') {
      this.sendHead();
      return;
    }
    // Only the opponent's plies arrive as moves.
    if (m.n === cur.n && m.epoch === cur.epoch && m.i === cur.plies.length && seatToMove(cur) === room.seat) {
      this.sendHead();
      return;
    }
    const out = applyMoveMsg(cur, m, this.api);
    switch (out.kind) {
      case 'applied':
        this.setLogs(this.replaceCur(out.log));
        this.send({ t: 'ack', v: V, n: m.n, epoch: m.epoch, i: m.i } satisfies AckMsg);
        break;
      case 'duplicate':
        this.send({ t: 'ack', v: V, n: m.n, epoch: m.epoch, i: m.i } satisfies AckMsg);
        break;
      default:
        // stale, gap or conflict: let reconcile settle it.
        this.sendHead();
        break;
    }
    this.emit();
  }

  private onAck(m: AckMsg): void {
    if (!isInt(m.n) || !isInt(m.epoch) || !isInt(m.i)) return;
    const before = this.pending.length;
    this.pending = this.pending.filter((p) => !(p.msg.n === m.n && p.msg.epoch === m.epoch && p.msg.i <= m.i));
    if (this.pending.length !== before) this.emit();
  }

  private sendMove(p: Pending): void {
    p.sentAt = this.now();
    this.send(p.msg);
    this.armResend();
  }

  /** A `head` from the other side shows which of this device's moves it holds. */
  private confirmPending(h: HeadMsg): void {
    const cur = this.cur();
    if (!cur || !isInt(h.len)) return;
    if (h.n !== cur.n || h.epoch !== cur.epoch) return;
    this.pending = this.pending.filter((p) => !(p.msg.n === h.n && p.msg.epoch === h.epoch && p.msg.i < h.len));
  }

  /** Drops pending moves that are no longer part of the current game (takeback, adoption). */
  private prunePending(): void {
    const cur = this.cur();
    this.pending = this.pending.filter(
      (p) => !!cur && p.msg.n === cur.n && p.msg.epoch === cur.epoch && p.msg.i < cur.plies.length && cur.plies[p.msg.i].m === p.msg.m,
    );
  }

  private armResend(): void {
    if (this.resendTimer !== null || this.closed) return;
    this.resendTimer = this.timers.setTimeout(() => {
      this.resendTimer = null;
      if (!this.live || this.closed) return;
      const due = this.now() - this.resendMs;
      let again = false;
      for (const p of this.pending) {
        if (p.sentAt === null || p.sentAt <= due) {
          p.sentAt = this.now();
          this.send(p.msg);
        }
        again = true;
      }
      if (this.outgoing && this.outgoingAt !== null) {
        if (this.outgoingAt <= due) this.sendAsk();
        again = true;
      }
      if (again) this.armResend();
    }, this.resendMs);
  }

  /* ---- requests ---- */

  private canAsk(kind: RequestKind): boolean {
    const cur = this.cur();
    if (!this.room || !cur || !this.live || this.outgoing || this.lockedHard()) return false;
    return this.requestValid(kind, ctxOf(cur), this.room.seat);
  }

  /** Whether a request of `kind` by `requester` fits the current game at `ctx`. */
  private requestValid(kind: RequestKind, ctx: Ctx | null, requester: Seat): boolean {
    const cur = this.cur();
    if (!cur || !ctx) return false;
    if (kind === 'rematch') return ctx.n === cur.n && !!cur.end;
    if (!sameCtx(ctx, ctxOf(cur)) || cur.end) return false;
    if (kind === 'takeback') return takebackLog(cur, requester) !== null;
    return true;
  }

  private sendAsk(): void {
    const ctx = this.outgoingCtx;
    if (!this.outgoing || !ctx) return;
    this.outgoingAt = this.now();
    if (!this.live) return;
    this.send({ t: 'ask', v: V, kind: this.outgoing, n: ctx.n, epoch: ctx.epoch, len: ctx.len } satisfies AskMsg);
    this.armResend();
  }

  private clearOutgoing(): void {
    this.outgoing = undefined;
    this.outgoingCtx = null;
    this.outgoingAt = null;
  }

  /** Requests lapse when the game they refer to changes (DESIGN 9.7, 8.3). */
  private pruneRequests(): void {
    const room = this.room;
    if (this.incoming && this.incoming !== 'rejoin') {
      if (!room || !this.requestValid(this.incoming, this.incomingCtx, otherSeat(room.seat))) {
        this.incoming = undefined;
        this.incomingCtx = null;
      }
    }
    if (this.outgoing) {
      if (!room || !this.requestValid(this.outgoing, this.outgoingCtx, room.seat)) this.clearOutgoing();
    }
  }

  private onAsk(m: AskMsg): void {
    const room = this.room;
    if (!room || !REQUEST_KINDS.has(m.kind) || !isInt(m.n) || !isInt(m.epoch) || !isInt(m.len)) return;
    const ctx: Ctx = { n: m.n, epoch: m.epoch, len: m.len };
    const cur = this.cur();
    if (!this.requestValid(m.kind, ctx, otherSeat(room.seat))) {
      if (!sameCtx(ctx, ctxOf(cur))) this.sendHead();
      return;
    }
    if (this.incoming === m.kind && sameCtx(this.incomingCtx, ctx)) return; // asked again
    if (this.outgoing === m.kind && m.kind !== 'takeback' && sameCtx(this.outgoingCtx, ctx)) {
      // Both offered a draw, or both asked for a rematch: agreed.
      this.incoming = m.kind;
      this.incomingCtx = ctx;
      this.reply(m.kind, true);
      return;
    }
    this.incoming = m.kind;
    this.incomingCtx = ctx;
    this.emit();
  }

  private onReply(m: ReplyMsg): void {
    const room = this.room;
    if (!room || !this.outgoing || m.kind !== this.outgoing || typeof m.ok !== 'boolean') return;
    const ctx: Ctx = { n: m.n, epoch: m.epoch, len: m.len };
    const kind = this.outgoing;
    if (!sameCtx(ctx, this.outgoingCtx)) return;
    this.clearOutgoing();
    if (!this.requestValid(kind, ctx, room.seat)) {
      // The game moved on in the meantime; reconcile decides.
      this.sendHead();
      this.emit();
      return;
    }
    if (m.ok) this.applyRequest(kind, room.seat);
    else this.notify('request-declined', kind);
    this.emit();
  }

  /** Applies an accepted request on this device; both sides compute the same result. */
  private applyRequest(kind: RequestKind, requester: Seat): void {
    const cur = this.cur();
    if (!cur) return;
    if (kind === 'takeback') {
      const next = takebackLog(cur, requester);
      if (next) this.setLogs(this.replaceCur(next));
    } else if (kind === 'draw') {
      this.setLogs(this.replaceCur(endLog(cur, { result: '1/2-1/2', by: 'agreed' })));
    } else if (cur.end) {
      this.setLogs([...this.logs, rematchLog(cur)]);
    }
  }

  /* ---- end of a game ---- */

  private finish(end: GameEnd): void {
    const cur = this.cur();
    if (!cur || cur.end) return;
    const ctx = ctxOf(cur) as Ctx;
    this.setLogs(this.replaceCur(endLog(cur, end)));
    const msg: EndOut = { t: 'end', v: V, n: ctx.n, result: end.result, by: end.by, epoch: ctx.epoch, len: ctx.len };
    if (this.live) this.send(msg);
    this.emit();
  }

  private onEnd(m: EndOut): void {
    const room = this.room;
    const cur = this.cur();
    if (!room || !cur || !isInt(m.n) || !END_BY.has(m.by)) return;
    if (m.n !== cur.n) {
      if (m.n > cur.n) this.sendHead();
      return;
    }
    if (cur.end) {
      if (cur.end.by !== m.by || cur.end.result !== m.result) this.sendHead();
      return;
    }
    if ((m.len !== undefined && m.len !== cur.plies.length) || (m.epoch !== undefined && m.epoch !== cur.epoch)) {
      this.sendHead();
      return;
    }
    const game = this.game;
    let end: GameEnd;
    if (m.by === 'time') end = this.api.timeoutResult(game, game.turn);
    else if (m.by === 'resign') end = { result: lossFor(colorOf(cur, otherSeat(room.seat))), by: 'resign' };
    else end = { result: '1/2-1/2', by: 'agreed' };
    this.setLogs(this.replaceCur(endLog(cur, end)));
    this.emit();
  }

  /* ============================================================================================ */
  /* Clock (DESIGN 9.8)                                                                            */
  /* ============================================================================================ */

  private tc(): TimeControl {
    const cur = this.cur();
    return cur ? parseTc(cur.tc) : null;
  }

  private myTurn(): boolean {
    const cur = this.cur();
    return !!this.room && !!cur && !cur.end && seatToMove(cur) === this.room.seat;
  }

  private shouldRun(): boolean {
    const cur = this.cur();
    if (!cur || cur.end || !this.room || this.closed || this.readOnly || this.versionLocked || this.denied) return false;
    if (this.live) return true;
    return !this.tc() && this.myTurn();
  }

  /** Restarts the turn when the position changed; pauses or resumes it to match the connection. */
  private recomputeClock(): void {
    const cur = this.cur();
    const key = cur ? `${cur.n}|${cur.epoch}|${cur.plies.length}|${cur.end ? 1 : 0}` : '-';
    if (key !== this.turnKey) {
      this.turnKey = key;
      this.turnUsed = 0;
      this.turnStart = null;
      const it = this.initialTurn;
      if (it && cur && this.myTurn() && it.n === cur.n && it.epoch === cur.epoch && it.len === cur.plies.length && it.ms > 0) {
        this.turnUsed = it.ms;
      }
      this.initialTurn = null;
    }
    const run = this.shouldRun();
    const at = this.now();
    if (run && this.turnStart === null) this.turnStart = at;
    else if (!run && this.turnStart !== null) {
      this.turnUsed += Math.max(0, at - this.turnStart);
      this.turnStart = null;
    }
    this.armFlagTimer();
  }

  private armFlagTimer(): void {
    if (this.flagTimer !== null) this.timers.clearTimeout(this.flagTimer);
    this.flagTimer = null;
    const tc = this.tc();
    if (!tc || this.turnStart === null || this.closed) return;
    const game = this.game;
    if (game.end || !this.api.clockRunning(game)) return;
    const mine = this.myTurn();
    if (!mine && !this.live) return;
    const left = remaining(game, tc, this.elapsed())[game.turn];
    const delay = Math.max(0, mine ? left : left + this.graceMs);
    this.flagTimer = this.timers.setTimeout(() => {
      this.flagTimer = null;
      if (!this.flagCheck()) this.armFlagTimer();
    }, delay);
  }

  /** Ends the game on time when the running clock allows it (DESIGN 9.8). */
  private flagCheck(): boolean {
    const cur = this.cur();
    const tc = this.tc();
    if (!this.room || !cur || cur.end || !tc || this.closed || this.readOnly || this.versionLocked || this.denied) return false;
    const game = this.game;
    if (!this.api.clockRunning(game)) return false;
    const left = remaining(game, tc, this.elapsed())[game.turn];
    if (this.myTurn()) {
      if (left > 0) return false;
    } else if (!this.live || left > -this.graceMs) return false;
    this.finish(this.api.timeoutResult(game, game.turn));
    return true;
  }

  /* ============================================================================================ */
  /* Snapshot                                                                                      */
  /* ============================================================================================ */

  /** Locks that also stop requests and resignation. */
  private lockedHard(): boolean {
    return this.readOnly || this.versionLocked || this.denied || this.closed;
  }

  private lockReason(): LockReason | null {
    if (this.readOnly) return 'other-tab';
    if (this.versionLocked) return 'version';
    if (this.denied) return 'denied';
    if (!this.room) return 'no-seat';
    const cur = this.cur();
    if (this.tc() && !this.live && cur && !cur.end) return 'disconnected';
    if (this.closed) return 'disconnected';
    return null;
  }

  private presence(): Presence {
    if (this.live) return 'connected';
    if (this.everLive) return 'reconnecting';
    if (this.tState === 'open') return 'connecting';
    return this.role === 'anchor' ? 'waiting' : 'connecting';
  }

  private phase(): RoomPhase {
    if (this.closed) return 'closed';
    if (this.readOnly) return 'read-only';
    if (this.versionLocked) return 'version';
    if (this.denied) return 'denied';
    const r = this.round;
    if (!r) return 'connecting';
    if (this.live) return 'live';
    switch (r.stage) {
      case 'joining':
        return 'joining';
      case 'asked':
        return 'approving';
      case 'auth':
        return 'syncing';
      case 'stranger':
        return 'stranger';
      case 'version':
        return 'version';
      case 'denied':
        return 'denied';
      default:
        return 'handshake';
    }
  }

  private lock(): RoomLock {
    if (this.incoming === 'rejoin') return 'rejoin-pending';
    if (!this.room || this.room.lastSeenAt === 0) return 'open';
    return 'locked';
  }

  private build(): RoomState {
    const cur = this.cur();
    const room = this.room;
    const seat = room ? room.seat : null;
    const color: Color = cur && room ? colorOf(cur, room.seat) : this.create?.color === 'b' ? 'b' : 'w';
    const locked = this.lockReason();
    const myTurn = this.myTurn();
    const tc = this.tc();
    const requests: { incoming?: RequestKind | 'rejoin'; outgoing?: RequestKind } = {};
    if (this.incoming) requests.incoming = this.incoming;
    if (this.outgoing) requests.outgoing = this.outgoing;
    return Object.freeze({
      code: this.code,
      presence: this.presence(),
      role: this.role,
      lock: this.lock(),
      seat,
      score: Object.freeze([room?.score[0] ?? 0, room?.score[1] ?? 0] as const),
      n: cur?.n ?? 0,
      epoch: cur?.epoch ?? 0,
      game: this.game,
      color,
      tc,
      requests: Object.freeze(requests),
      locked,
      unsent: this.pending.length,
      clock: Object.freeze({ paused: !!tc && !!cur && !cur.end && !this.live && !!room, turnStart: this.turnStart, turnUsed: this.turnUsed }),
      notice: this.lastNotice,
      failure: this.failure,
      phase: this.phase(),
      live: this.live,
      logs: Object.freeze([...this.logs]),
      myTurn,
      canMove: myTurn && locked === null,
      canAsk: Object.freeze({ takeback: this.canAsk('takeback'), draw: this.canAsk('draw'), rematch: this.canAsk('rematch') }),
      failureKind: this.failureKind,
      lastSeenAt: room?.lastSeenAt ?? 0,
    });
  }

  private emit(): void {
    this.snap = this.build();
    for (const cb of [...this.subs]) {
      try {
        cb(this.snap);
      } catch (e) {
        console.error(e);
      }
    }
  }

  private notify(kind: RoomNoticeKind, request?: RequestKind): void {
    const n: RoomNotice = request ? { id: ++this.noticeSeq, kind, request } : { id: ++this.noticeSeq, kind };
    this.lastNotice = n;
    for (const cb of [...this.noticeSubs]) {
      try {
        cb(n);
      } catch (e) {
        console.error(e);
      }
    }
    this.emit();
  }

  private send(msg: Message): void {
    const t = this.t;
    if (!t || this.closed || this.tState !== 'open') return;
    try {
      t.send(msg);
    } catch {
      /* the channel is going away; reconcile covers it */
    }
  }
}

/**
 * Creates the room controller for `opts.code` (DESIGN 9). It loads the room from `opts.store`,
 * creates an open room when `opts.create` is set and no record exists, and connects through
 * `opts.transport` or `opts.factory`. Every change is persisted through the store.
 */
export function createRoomController(opts: RoomControllerOptions): RoomControllerApi {
  return new Controller(opts);
}
