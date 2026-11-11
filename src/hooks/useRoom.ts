/**
 * `useRoom` — the room controller (3C) wired to React, the transports (3B) and the browser
 * (DESIGN 9, PLAN milestone 3, package 3D).
 *
 * The work is done by `createRoomSession`, which has no React in it and is tested on its own:
 *
 * - **Tab guard (DESIGN 9.12).** The room is guarded by the Web Lock `zhess:room:<CODE>`. The tab
 *   that holds it owns the room: it runs the controller and connects. A second tab gets a read-only
 *   controller (`tab: 'other'`, board locked with reason `other-tab`), follows the other tab's
 *   writes through `storage` events, takes over by itself when the owner closes, and can take over
 *   at once with `takeOver()` (the lock is stolen; the old owner turns read-only). Without
 *   `navigator.locks` (old browsers, insecure origins) every tab owns the room.
 * - **Transports.** The broker (`createPeerJsFactory`, when `flags.peerjsBroker`) is started by the
 *   session and attached to the controller. The manual fallback (DESIGN 9.9, when
 *   `flags.manualSignalling`) runs beside it: `openManual()` makes this device the manual host;
 *   an `x` link (`offer`) makes it the guest; a `y` link (`answer`) opened in a new tab is handed to
 *   the waiting tab over `BroadcastChannel` (that tab stays passive, `tab: 'handover'`). A manual
 *   channel replaces the broker once it opens; when it is lost the broker is tried again, and the
 *   10-second rule offers the manual exchange again if that fails too.
 * - **10-second rule (DESIGN 9.9).** `manualCause` says when to show `Connect manually`: at once
 *   when the broker is unreachable or switched off, or when ICE failed; after `fallbackMs` (10 s) of
 *   failing signalling otherwise. A device waiting peacefully as the anchor is not failing.
 * - **Persistence.** The controller saves the room and every game through the `Store` (3C). This
 *   session adds the running turn's time: it is banked in `localStorage` on `pagehide`, on a
 *   hidden tab and on dispose, and handed back to the controller as `initialTurn` (DESIGN 9.8).
 *   `localStorage`, not `sessionStorage`: closing the app (a phone's normal way to leave) must not
 *   lose it, or the reconnect would report a turn time of 0.
 * - **Snapshot.** `subscribe` / `view` follow the `useSyncExternalStore` contract: the view object
 *   changes only when something in it changed.
 *
 * Time, timers, randomness, the lock manager, the transports and the controller itself are
 * injectable, so tests run over the memory transport with fake time (PLAN 7).
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { flags } from '@/lib/flags';
import { isValidCode } from '@/lib/codes';
import { createRoomController, type InitialTurn, type RoomControllerApi, type RoomControllerOptions, type RoomCreateSettings, type RoomState } from '@/lib/room';
import { store as defaultStore } from '@/lib/storage';
import { scoreView } from '@/lib/sync';
import {
  answerLink,
  answerManualOffer,
  createPeerJsFactory,
  handOverAnswer,
  ManualError,
  startManualHost,
  type ManualErrorReason,
  type ManualGuest,
  type ManualHost,
  type RoomTransport,
  type Timers,
} from '@/lib/transport';
import type { Now, RequestKind, RoomNotice, Rng, Store, Transport, TransportFactory, TransportState } from '@/lib/types';

/* ---------------------------------------------------------------------------------------------- */
/* Public types                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Who runs the room in this tab (DESIGN 9.12).
 * - `pending`: asking for the Web Lock (a moment); the controller is read-only meanwhile.
 * - `owner`: this tab runs the room (also when Web Locks are missing).
 * - `other`: another tab of this device runs it; read-only here, `takeOver()` moves it here.
 * - `handover`: this tab only passes a manual answer link (`y`) to the waiting tab; read-only.
 */
export type TabState = 'pending' | 'owner' | 'other' | 'handover';

/** The part of `navigator.locks` the tab guard uses. */
export interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable?: boolean; steal?: boolean; signal?: AbortSignal; mode?: 'exclusive' | 'shared' },
    callback: (lock: unknown) => unknown,
  ): Promise<unknown>;
}

/** What went wrong in the manual exchange: a `ManualError` reason, or ICE failing after the exchange. */
export type ManualIssue = ManualErrorReason | 'ice-failed';

/**
 * Steps of the manual exchange (DESIGN 9.9) as this device sees them.
 * - `idle`: nothing running.
 * - `preparing`: gathering ICE for the offer (host) or the answer (guest).
 * - `offer`: host, steps 1 and 2: `link` is the offer link to send; paste the answer below it.
 * - `connecting`: host, the answer was applied; waiting for the channel.
 * - `answer`: guest: `link` is the answer link to send back; waiting for the channel.
 * - `connected`: the manual channel is open and in use.
 * - `handover`: this tab opened an answer link: `handedOver` null = passing it on, true = the
 *   waiting tab took it, false = nobody took it (show `link` to copy and paste).
 * - `error`: `error` says why; `openManual()` starts over.
 */
export type ManualStep = 'idle' | 'preparing' | 'offer' | 'connecting' | 'answer' | 'connected' | 'handover' | 'error';

export interface ManualView {
  readonly step: ManualStep;
  readonly role: 'host' | 'guest' | null;
  /** Offer link (host), answer link (guest, hand-over). */
  readonly link: string | null;
  /** Problem of the last action (a bad paste keeps the `offer` step and sets this). */
  readonly error: ManualIssue | null;
  /** Hand-over result, see `ManualStep`. */
  readonly handedOver: boolean | null;
  /** An answer is being applied. */
  readonly busy: boolean;
}

/**
 * Why `Connect manually` is offered (DESIGN 9.9, 9.10):
 * `no-broker` (broker switched off), `broker-unreachable`, `ice-failed`, or `timeout` (signalling
 * failing for 10 s).
 */
export type ManualCause = 'no-broker' | 'broker-unreachable' | 'ice-failed' | 'timeout';

/** Everything the room UI renders. A new object only when something changed. */
export interface RoomView {
  readonly code: string;
  /** The controller's snapshot; null before a controller exists. */
  readonly state: RoomState | null;
  readonly tab: TabState;
  /** The Web Locks guard is in use. */
  readonly guarded: boolean;
  readonly manual: ManualView;
  /** Non-null when `Connect manually` should be offered. */
  readonly manualCause: ManualCause | null;
  /** Room score from this device's point of view, in points: `[mine, theirs]` (e.g. `[2.5, 1.5]`). */
  readonly score: readonly [number, number];
  /** The transport in use: the broker, a manual channel, or none yet. */
  readonly via: 'broker' | 'manual' | null;
}

/** The manual signalling functions (3B), injectable for tests. */
export interface ManualApi {
  startHost(code: string): Promise<ManualHost>;
  answerOffer(code: string, offer: string): Promise<ManualGuest>;
  handOver(code: string, answer: string): Promise<boolean>;
  /** Builds the answer link shown when a hand-over found no tab. */
  answerLink(code: string, answer: string): string;
}

/** Minimal event target (window, document). */
export interface EventSourceLike {
  addEventListener(type: string, cb: (e: Event) => void): void;
  removeEventListener(type: string, cb: (e: Event) => void): void;
}

/** Storage for the banked turn (`localStorage`). */
export type TurnStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface RoomSessionOptions {
  code: string;
  /** Default: the app store. */
  store?: Store;
  /** Start with ROOM: create the room if this device has none (3C `create`). Unset for invite links. */
  create?: RoomCreateSettings | null;
  /** `x` of a manual offer link: answer it as the guest. */
  offer?: string | null;
  /** `y` of a manual answer link: hand it to the waiting tab (this tab stays passive). */
  answer?: string | null;
  /** Broker transport factory. Default: PeerJS when `flags.peerjsBroker`, else none. Null = none. */
  broker?: TransportFactory | null;
  /** Manual fallback available. Default `flags.manualSignalling`. */
  manualEnabled?: boolean;
  /** Manual signalling functions. Default: 3B's. */
  manualApi?: Partial<ManualApi>;
  /** Web Locks. Default `navigator.locks`; null = no tab guard. */
  locks?: LockManagerLike | null;
  /** Controller factory. Default `createRoomController` (tests pass a fake). */
  createController?: (opts: RoomControllerOptions) => RoomControllerApi;
  /** Extra controller options (ping interval, grace, …). */
  controllerOptions?: Partial<Omit<RoomControllerOptions, 'code' | 'store' | 'transport' | 'factory' | 'readOnly' | 'create' | 'initialTurn'>>;
  /** Monotonic clock, shared with the controller and `useClock`. Default `performance.now()`. */
  now?: Now;
  /** Wall clock. Default `Date.now`. */
  wallNow?: Now;
  rng?: Rng;
  timers?: Timers;
  /** Where the running turn is banked. Default `localStorage`; null = no banking. */
  turnStorage?: TurnStorage | null;
  /** `window` (pagehide, storage). Default the global one; null = none. */
  window?: EventSourceLike | null;
  /** `document` (visibilitychange). Default the global one; null = none. */
  document?: (EventSourceLike & { visibilityState?: string }) | null;
  /** How long signalling may fail before `Connect manually` shows. Default 10 000 ms. */
  fallbackMs?: number;
  /** The `x` or `y` value was used: remove it from the address bar (DESIGN 13.2). */
  onSignalUsed?: () => void;
}

export interface RoomSession {
  readonly view: RoomView;
  readonly controller: RoomControllerApi | null;
  subscribe(cb: () => void): () => void;
  /** Notices of whichever controller is current (owner tab only), once each. */
  onNotice(cb: (n: RoomNotice) => void): () => void;
  /** Steals the Web Lock: this tab runs the room, the other one turns read-only. */
  takeOver(): void;
  /** Host step 1 of the manual exchange (no-op while one is running). */
  openManual(): void;
  /** Throws the running manual exchange away and starts a new one. */
  restartManual(): void;
  /** Host step 2, the paste path. Resolves null on success, else the problem. */
  acceptAnswer(text: string): Promise<ManualIssue | null>;
  /** Closes the manual sheet: a pending exchange is dropped, an open manual channel stays. */
  closeManual(): void;
  /** A new `x` / `y` from the address bar. Each value is used once. */
  signal(s: { offer?: string | null; answer?: string | null }): void;
  /** Banks the running turn's time now (also done on pagehide, hidden tab and dispose). */
  bank(): void;
  dispose(): void;
}

/* ---------------------------------------------------------------------------------------------- */
/* Helpers                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

/** Web Lock name of a room (DESIGN 9.12). */
export function roomLockName(code: string): string {
  return `zhess:room:${code}`;
}

/** localStorage key of the banked running turns, one entry per room code. */
export const ROOM_TURN_KEY = 'zhess:room-turn';
/** A bank older than this is ignored. */
export const ROOM_TURN_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** DESIGN 9.9: signalling failing this long offers the manual exchange. */
export const MANUAL_FALLBACK_MS = 10_000;

const IDLE_MANUAL: ManualView = Object.freeze({ step: 'idle', role: null, link: null, error: null, handedOver: null, busy: false });
const NO_SCORE: readonly [number, number] = Object.freeze([0, 0] as const);

/** The view before any session exists (no code). */
export const IDLE_ROOM_VIEW: RoomView = Object.freeze({
  code: '',
  state: null,
  tab: 'pending',
  guarded: false,
  manual: IDLE_MANUAL,
  manualCause: null,
  score: NO_SCORE,
  via: null,
});

interface BankEntry {
  code: string;
  n: number;
  epoch: number;
  len: number;
  ms: number;
  at: number;
}

function isBankEntry(v: unknown): v is BankEntry {
  if (!v || typeof v !== 'object') return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.code === 'string' &&
    [b.n, b.epoch, b.len, b.ms, b.at].every((x) => typeof x === 'number' && Number.isFinite(x))
  );
}

/** All banked turns by room code (an unreadable value counts as none). Never throws. */
function readBank(storage: TurnStorage): Record<string, BankEntry> {
  let raw: string | null = null;
  try {
    raw = storage.getItem(ROOM_TURN_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, BankEntry> = {};
  for (const [code, e] of Object.entries(v as Record<string, unknown>)) if (isBankEntry(e) && e.code === code) out[code] = e;
  return out;
}

function writeBank(storage: TurnStorage, bank: Record<string, BankEntry>): void {
  try {
    if (Object.keys(bank).length === 0) storage.removeItem(ROOM_TURN_KEY);
    else storage.setItem(ROOM_TURN_KEY, JSON.stringify(bank));
  } catch {
    /* ignore */
  }
}

const fresh = (e: BankEntry, now: number): boolean => {
  const age = now - e.at;
  return age >= 0 && age <= ROOM_TURN_MAX_AGE_MS;
};

/** Reads (and removes) the banked turn of `code`, if fresh. Never throws. */
export function takeBankedTurn(code: string, storage: TurnStorage | null, wallNow: Now): InitialTurn | null {
  if (!storage) return null;
  const bank = readBank(storage);
  const v = bank[code];
  if (!v) return null;
  delete bank[code];
  writeBank(storage, bank);
  if (!fresh(v, wallNow()) || v.ms <= 0) return null;
  return { n: v.n, epoch: v.epoch, len: v.len, ms: Math.round(v.ms) };
}

/** Writes the banked turn of `entry.code`, keeping other rooms' fresh entries. Never throws. */
export function bankRoomTurn(storage: TurnStorage | null, entry: BankEntry): void {
  if (!storage) return;
  const bank = readBank(storage);
  for (const [code, e] of Object.entries(bank)) if (!fresh(e, entry.at)) delete bank[code];
  bank[entry.code] = entry;
  writeBank(storage, bank);
}

function defaultLocks(): LockManagerLike | null {
  try {
    const l = (globalThis.navigator as (Navigator & { locks?: LockManagerLike }) | undefined)?.locks;
    return l && typeof l.request === 'function' ? l : null;
  } catch {
    return null;
  }
}

function defaultTurnStorage(): TurnStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

const globalTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function issueOf(e: unknown): ManualIssue {
  return e instanceof ManualError ? e.reason : 'webrtc';
}

function isAbort(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError';
}

function sameView(a: RoomView, b: RoomView): boolean {
  return (
    a.code === b.code &&
    a.state === b.state &&
    a.tab === b.tab &&
    a.guarded === b.guarded &&
    a.manual === b.manual &&
    a.manualCause === b.manualCause &&
    a.score[0] === b.score[0] &&
    a.score[1] === b.score[1] &&
    a.via === b.via
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Session                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

class Session implements RoomSession {
  private readonly code: string;
  private readonly store: Store;
  private readonly create: RoomCreateSettings | null;
  private readonly broker: TransportFactory | null;
  private readonly manualEnabled: boolean;
  private readonly manualApi: ManualApi;
  private readonly locks: LockManagerLike | null;
  private readonly makeCtrl: (opts: RoomControllerOptions) => RoomControllerApi;
  private readonly ctrlOpts: RoomSessionOptions['controllerOptions'];
  private readonly now: Now;
  private readonly wallNow: Now;
  private readonly rng: Rng | undefined;
  private readonly timers: Timers;
  private readonly turnStorage: TurnStorage | null;
  private readonly win: EventSourceLike | null;
  private readonly doc: (EventSourceLike & { visibilityState?: string }) | null;
  private readonly fallbackMs: number;
  private readonly onSignalUsed: (() => void) | undefined;

  private ctrl: RoomControllerApi | null = null;
  private ctrlOff: (() => void)[] = [];
  private tab: TabState = 'pending';
  private disposed = false;

  /* lock */
  private release: (() => void) | null = null;
  private waitAbort: AbortController | null = null;
  private lockGen = 0;

  /* transports */
  private brokerT: Transport | null = null;
  private brokerGen = 0;
  private brokerFailed = false;
  private manualT: Transport | null = null;
  private manualRole: 'host' | 'guest' | null = null;
  private host: ManualHost | null = null;
  private guest: ManualGuest | null = null;
  private pendingOff: (() => void) | null = null;
  private manualGen = 0;
  private manual: ManualView = IDLE_MANUAL;
  private pendingOffer: string | null = null;
  private readonly usedSignals = new Set<string>();

  /* 10-second rule */
  private troubleSince: number | null = null;
  private troubleTimer: unknown = null;

  /* output */
  private current: RoomView;
  private readonly subs = new Set<() => void>();
  private readonly noticeSubs = new Set<(n: RoomNotice) => void>();
  private readonly listeners: [EventSourceLike, string, (e: Event) => void][] = [];

  constructor(opts: RoomSessionOptions) {
    this.code = opts.code;
    this.store = opts.store ?? defaultStore;
    this.create = opts.create ?? null;
    this.broker = opts.broker !== undefined ? opts.broker : flags.peerjsBroker ? createPeerJsFactory() : null;
    this.manualEnabled = opts.manualEnabled ?? flags.manualSignalling;
    this.manualApi = {
      startHost: (c) => startManualHost(c),
      answerOffer: (c, o) => answerManualOffer(c, o),
      handOver: (c, a) => handOverAnswer(c, a),
      answerLink: (c, a) => answerLink(c, a),
      ...opts.manualApi,
    };
    this.locks = opts.locks !== undefined ? opts.locks : defaultLocks();
    this.makeCtrl = opts.createController ?? createRoomController;
    this.ctrlOpts = opts.controllerOptions;
    this.now = opts.now ?? defaultNow;
    this.wallNow = opts.wallNow ?? Date.now;
    this.rng = opts.rng;
    this.timers = opts.timers ?? globalTimers;
    this.turnStorage = opts.turnStorage !== undefined ? opts.turnStorage : defaultTurnStorage();
    this.win = opts.window !== undefined ? opts.window : typeof window !== 'undefined' ? window : null;
    this.doc = opts.document !== undefined ? opts.document : typeof document !== 'undefined' ? document : null;
    this.fallbackMs = opts.fallbackMs ?? MANUAL_FALLBACK_MS;
    this.onSignalUsed = opts.onSignalUsed;
    this.current = { ...IDLE_ROOM_VIEW, code: this.code, guarded: !!this.locks };

    this.listen(this.win, 'pagehide', () => this.bank());
    this.listen(this.doc, 'visibilitychange', () => {
      if (this.doc?.visibilityState === 'hidden') this.bank();
    });
    this.listen(this.win, 'storage', (e) => {
      const key = (e as StorageEvent).key;
      if (this.tab !== 'owner' && this.tab !== 'pending' && (key === null || key === 'zhess:games' || key === 'zhess:rooms')) {
        this.useController(true);
        this.refresh();
      }
    });

    if (opts.answer) {
      // A tab opened from an answer link only passes it on (DESIGN 9.9 step 3).
      this.tab = 'handover';
      this.useController(true);
      this.handOver(opts.answer);
      this.refresh();
      return;
    }
    if (opts.offer) this.pendingOffer = opts.offer;
    if (!this.locks) this.becomeOwner();
    else {
      // Show the stored room at once (read-only) while the lock is being asked for.
      this.useController(true);
      this.requestLock(false);
    }
    this.refresh();
  }

  /* ============================================================================================ */
  /* Public API                                                                                    */
  /* ============================================================================================ */

  get view(): RoomView {
    return this.current;
  }

  get controller(): RoomControllerApi | null {
    return this.ctrl;
  }

  subscribe(cb: () => void): () => void {
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

  takeOver(): void {
    if (this.disposed || !this.locks || this.tab !== 'other') return;
    this.cancelWait();
    this.requestLock(true);
  }

  openManual(): void {
    if (this.disposed || !this.manualEnabled || this.tab !== 'owner') return;
    const step = this.manual.step;
    if (step === 'preparing' || step === 'offer' || step === 'connecting' || step === 'answer') return;
    if (this.manualT && step === 'connected') return;
    this.startHost();
  }

  restartManual(): void {
    if (this.disposed || !this.manualEnabled || this.tab !== 'owner') return;
    this.dropPending();
    this.startHost();
  }

  async acceptAnswer(text: string): Promise<ManualIssue | null> {
    const host = this.host;
    if (this.disposed || !host || this.manual.step !== 'offer') return this.manual.step === 'connecting' ? 'used' : 'invalid';
    const gen = this.manualGen;
    this.setManual({ ...this.manual, busy: true, error: null });
    try {
      await host.acceptAnswer(text);
    } catch (e) {
      const issue = issueOf(e);
      if (gen === this.manualGen && !this.disposed) this.setManual({ ...this.manual, busy: false, error: issue });
      return issue;
    }
    if (gen === this.manualGen && !this.disposed && this.manual.step === 'offer') {
      this.setManual({ ...this.manual, step: 'connecting', busy: false, error: null });
    }
    return null;
  }

  closeManual(): void {
    if (this.disposed) return;
    this.dropPending();
    this.setManual(IDLE_MANUAL);
  }

  signal(s: { offer?: string | null; answer?: string | null }): void {
    if (this.disposed) return;
    if (s.answer && !this.usedSignals.has(`y:${s.answer}`)) {
      if (this.host && this.manual.step === 'offer') {
        // The answer reached this very tab: apply it directly.
        this.usedSignals.add(`y:${s.answer}`);
        this.onSignalUsed?.();
        void this.acceptAnswer(s.answer);
      } else {
        this.handOver(s.answer);
      }
    }
    if (s.offer && !this.usedSignals.has(`x:${s.offer}`)) {
      this.pendingOffer = s.offer;
      if (this.tab === 'owner') this.answerPendingOffer();
    }
  }

  bank(): void {
    const c = this.ctrl;
    if (!c || this.tab !== 'owner' || this.disposed) return;
    const s = c.snapshot;
    if (!s.myTurn || s.game.end) return;
    const ms = c.elapsed();
    if (!Number.isFinite(ms) || ms <= 0) return;
    bankRoomTurn(this.turnStorage, { code: this.code, n: s.n, epoch: s.epoch, len: s.game.plies.length, ms: Math.round(ms), at: this.wallNow() });
  }

  dispose(): void {
    if (this.disposed) return;
    this.bank();
    this.disposed = true;
    for (const [target, type, cb] of this.listeners) {
      try {
        target.removeEventListener(type, cb);
      } catch {
        /* ignore */
      }
    }
    this.listeners.length = 0;
    this.clearTrouble();
    this.cancelWait();
    this.releaseLock();
    this.dropPending();
    this.dropController();
    this.closeBroker();
    this.closeQuietly(this.manualT);
    this.manualT = null;
    this.subs.clear();
    this.noticeSubs.clear();
  }

  /* ============================================================================================ */
  /* Tab guard                                                                                     */
  /* ============================================================================================ */

  private requestLock(steal: boolean): void {
    const locks = this.locks;
    if (!locks) return;
    const gen = ++this.lockGen;
    let granted = false;
    let p: Promise<unknown>;
    try {
      p = locks.request(roomLockName(this.code), steal ? { steal: true } : { ifAvailable: true }, (lock) => {
        if (this.disposed || gen !== this.lockGen) return undefined;
        if (!lock) {
          this.becomeOther();
          return undefined;
        }
        granted = true;
        return this.holdLock();
      });
    } catch {
      // A lock manager that throws (e.g. a sandboxed frame): no guard.
      this.becomeOwner();
      return;
    }
    p.catch((e: unknown) => {
      if (this.disposed) return;
      if (granted) {
        // Another tab took the room over.
        if (this.release) this.release = null;
        this.becomeOther();
      } else if (gen === this.lockGen && !isAbort(e)) {
        this.becomeOwner();
      }
    });
  }

  /** Holds the lock until `releaseLock()`; makes this tab the owner. */
  private holdLock(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.release = resolve;
      this.becomeOwner();
    });
  }

  /** Waits for the owning tab to close, then owns the room. */
  private waitForLock(): void {
    const locks = this.locks;
    if (!locks || typeof AbortController === 'undefined') return;
    this.cancelWait();
    const ac = new AbortController();
    this.waitAbort = ac;
    const gen = ++this.lockGen;
    let granted = false;
    let p: Promise<unknown>;
    try {
      p = locks.request(roomLockName(this.code), { signal: ac.signal }, () => {
        if (this.disposed || gen !== this.lockGen) return undefined;
        granted = true;
        this.waitAbort = null;
        return this.holdLock();
      });
    } catch {
      return;
    }
    p.catch(() => {
      if (this.disposed || !granted) return;
      this.release = null;
      this.becomeOther();
    });
  }

  private cancelWait(): void {
    const ac = this.waitAbort;
    this.waitAbort = null;
    if (ac) {
      try {
        ac.abort();
      } catch {
        /* ignore */
      }
    }
  }

  private releaseLock(): void {
    const r = this.release;
    this.release = null;
    r?.();
  }

  private becomeOwner(): void {
    if (this.disposed || this.tab === 'owner') return;
    this.tab = 'owner';
    this.useController(false);
    this.connectBroker();
    this.answerPendingOffer();
    this.refresh();
  }

  private becomeOther(): void {
    if (this.disposed) return;
    this.bank();
    this.tab = 'other';
    this.dropPending();
    this.setManual(IDLE_MANUAL, false);
    this.useController(true);
    this.closeBroker();
    this.closeQuietly(this.manualT);
    this.manualT = null;
    this.manualRole = null;
    this.clearTrouble();
    this.refresh();
    this.waitForLock();
  }

  /* ============================================================================================ */
  /* Controller                                                                                    */
  /* ============================================================================================ */

  private useController(readOnly: boolean): void {
    this.dropController();
    const initialTurn = readOnly ? null : takeBankedTurn(this.code, this.turnStorage, this.wallNow);
    const ctrl = this.makeCtrl({
      ...this.ctrlOpts,
      code: this.code,
      store: this.store,
      now: this.now,
      wallNow: this.wallNow,
      rng: this.rng,
      timers: this.timers,
      create: readOnly ? null : this.create,
      readOnly,
      initialTurn,
    });
    this.ctrl = ctrl;
    this.ctrlOff = [
      ctrl.subscribe(() => this.refresh()),
      ctrl.onNotice((n) => {
        if (this.ctrl !== ctrl || this.disposed) return;
        for (const cb of [...this.noticeSubs]) {
          try {
            cb(n);
          } catch (e) {
            console.error(e);
          }
        }
      }),
    ];
  }

  private dropController(): void {
    for (const off of this.ctrlOff) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    this.ctrlOff = [];
    const c = this.ctrl;
    this.ctrl = null;
    try {
      c?.leave();
    } catch {
      /* ignore */
    }
  }

  /* ============================================================================================ */
  /* Broker                                                                                        */
  /* ============================================================================================ */

  private connectBroker(): void {
    const factory = this.broker;
    if (!factory || this.disposed || this.tab !== 'owner') return;
    const gen = ++this.brokerGen;
    this.brokerFailed = false;
    let p: Promise<Transport>;
    try {
      p = factory(this.code);
    } catch {
      this.brokerFailed = true;
      return;
    }
    p.then(
      (t) => {
        if (this.disposed || gen !== this.brokerGen || this.tab !== 'owner' || this.manualT || !this.ctrl) {
          this.closeQuietly(t);
          return;
        }
        this.brokerT = t;
        this.ctrl.attach(t);
        this.refresh();
      },
      () => {
        if (this.disposed || gen !== this.brokerGen) return;
        this.brokerFailed = true;
        this.refresh();
      },
    );
  }

  private closeBroker(): void {
    this.brokerGen++;
    const t = this.brokerT;
    this.brokerT = null;
    this.closeQuietly(t);
  }

  private closeQuietly(t: Transport | null): void {
    if (!t) return;
    try {
      t.close();
    } catch {
      /* ignore */
    }
  }

  /* ============================================================================================ */
  /* Manual exchange (DESIGN 9.9)                                                                  */
  /* ============================================================================================ */

  private setManual(m: ManualView, emit = true): void {
    this.manual = m;
    if (emit) this.refresh();
  }

  private startHost(): void {
    const gen = ++this.manualGen;
    this.setManual({ ...IDLE_MANUAL, step: 'preparing', role: 'host' });
    let p: Promise<ManualHost>;
    try {
      p = this.manualApi.startHost(this.code);
    } catch (e) {
      this.setManual({ ...IDLE_MANUAL, step: 'error', role: 'host', error: issueOf(e) });
      return;
    }
    p.then(
      (host) => {
        if (this.disposed || gen !== this.manualGen || this.tab !== 'owner') {
          this.closeQuietly(host.transport);
          return;
        }
        this.host = host;
        this.setManual({ ...IDLE_MANUAL, step: 'offer', role: 'host', link: host.link });
        this.watchPending(host.transport, 'host', gen);
      },
      (e: unknown) => {
        if (this.disposed || gen !== this.manualGen) return;
        this.setManual({ ...IDLE_MANUAL, step: 'error', role: 'host', error: issueOf(e) });
      },
    );
  }

  private answerPendingOffer(): void {
    const offer = this.pendingOffer;
    if (!offer || this.disposed || this.tab !== 'owner') return;
    this.pendingOffer = null;
    if (this.usedSignals.has(`x:${offer}`)) return;
    this.usedSignals.add(`x:${offer}`);
    if (!this.manualEnabled) {
      this.onSignalUsed?.();
      return;
    }
    this.dropPending();
    const gen = ++this.manualGen;
    this.setManual({ ...IDLE_MANUAL, step: 'preparing', role: 'guest' });
    let p: Promise<ManualGuest>;
    try {
      p = this.manualApi.answerOffer(this.code, offer);
    } catch (e) {
      this.onSignalUsed?.();
      this.setManual({ ...IDLE_MANUAL, step: 'error', role: 'guest', error: issueOf(e) });
      return;
    }
    p.then(
      (guest) => {
        this.onSignalUsed?.();
        if (this.disposed || gen !== this.manualGen || this.tab !== 'owner') {
          this.closeQuietly(guest.transport);
          return;
        }
        this.guest = guest;
        this.setManual({ ...IDLE_MANUAL, step: 'answer', role: 'guest', link: guest.link });
        this.watchPending(guest.transport, 'guest', gen);
      },
      (e: unknown) => {
        this.onSignalUsed?.();
        if (this.disposed || gen !== this.manualGen) return;
        this.setManual({ ...IDLE_MANUAL, step: 'error', role: 'guest', error: issueOf(e) });
      },
    );
  }

  private handOver(answer: string): void {
    if (this.usedSignals.has(`y:${answer}`)) return;
    this.usedSignals.add(`y:${answer}`);
    let link: string | null;
    try {
      link = this.manualApi.answerLink(this.code, answer);
    } catch {
      link = null;
    }
    const gen = ++this.manualGen;
    this.setManual({ ...IDLE_MANUAL, step: 'handover', role: 'host', link, handedOver: null });
    let p: Promise<boolean>;
    try {
      p = this.manualApi.handOver(this.code, answer);
    } catch {
      p = Promise.resolve(false);
    }
    p.then(
      (ok) => {
        this.onSignalUsed?.();
        if (this.disposed || gen !== this.manualGen) return;
        this.setManual({ ...this.manual, handedOver: ok });
      },
      () => {
        this.onSignalUsed?.();
        if (this.disposed || gen !== this.manualGen) return;
        this.setManual({ ...this.manual, handedOver: false });
      },
    );
  }

  /** Follows a pending manual transport until it opens (then it replaces the broker) or fails. */
  private watchPending(t: Transport, role: 'host' | 'guest', gen: number): void {
    const onState = (s: TransportState) => {
      if (this.disposed) return;
      if (this.manualT === t) {
        // The manual channel in use is gone: back to the broker (DESIGN 9.9).
        if (s === 'closed' || s === 'failed') this.manualLost(t);
        return;
      }
      if (gen !== this.manualGen) return;
      if (s === 'open') this.attachManual(t, role);
      else if (s === 'failed' || s === 'closed') {
        this.pendingOff?.();
        this.pendingOff = null;
        this.host = null;
        this.guest = null;
        this.closeQuietly(t);
        this.setManual({ ...IDLE_MANUAL, step: 'error', role, error: 'ice-failed' });
      }
    };
    const off = t.onState(onState) as unknown;
    this.pendingOff = typeof off === 'function' ? (off as () => void) : null;
    const st = (t as Partial<RoomTransport>).state;
    if (st === 'open' && this.manualT !== t) onState('open');
  }

  private attachManual(t: Transport, role: 'host' | 'guest'): void {
    const ctrl = this.ctrl;
    if (!ctrl || this.tab !== 'owner') return;
    this.host = null;
    this.guest = null;
    this.manualT = t;
    this.manualRole = role;
    this.closeBroker();
    ctrl.attach(t);
    this.setManual({ ...IDLE_MANUAL, step: 'connected', role });
  }

  private manualLost(t: Transport): void {
    if (this.manualT !== t) return;
    this.pendingOff?.();
    this.pendingOff = null;
    this.manualT = null;
    this.manualRole = null;
    this.closeQuietly(t);
    if (this.manual.step === 'connected') this.setManual(IDLE_MANUAL, false);
    this.connectBroker();
    this.refresh();
  }

  /** Drops a manual exchange that has not opened yet. An open manual channel stays. */
  private dropPending(): void {
    this.manualGen++;
    const pending = this.host?.transport ?? this.guest?.transport ?? null;
    this.host = null;
    this.guest = null;
    if (pending && pending !== this.manualT) {
      this.pendingOff?.();
      this.pendingOff = null;
      this.closeQuietly(pending);
    }
  }

  /* ============================================================================================ */
  /* 10-second rule and the view                                                                   */
  /* ============================================================================================ */

  private clearTrouble(): void {
    this.troubleSince = null;
    if (this.troubleTimer !== null) this.timers.clearTimeout(this.troubleTimer);
    this.troubleTimer = null;
  }

  private manualCauseOf(state: RoomState | null): ManualCause | null {
    if (!this.manualEnabled || this.tab !== 'owner' || !state || this.manualT) {
      this.clearTrouble();
      return null;
    }
    if (state.live || state.phase !== 'connecting') {
      this.clearTrouble();
      return null;
    }
    if (!this.broker) return 'no-broker';
    const failure =
      state.failureKind ?? (this.brokerT as Partial<RoomTransport> | null)?.failure ?? (this.brokerFailed ? 'broker-unreachable' : null);
    if (failure === 'broker-unreachable') return 'broker-unreachable';
    if (failure === 'ice-failed') return 'ice-failed';
    // Waiting peacefully as the anchor (the broker works; the opponent is just not here) is no failure.
    const trouble = (failure !== null && failure !== 'peer-gone') || state.role !== 'anchor';
    if (!trouble) {
      this.clearTrouble();
      return null;
    }
    const at = this.now();
    if (this.troubleSince === null) this.troubleSince = at;
    const left = this.troubleSince + this.fallbackMs - at;
    if (left <= 0) return 'timeout';
    if (this.troubleTimer === null) {
      this.troubleTimer = this.timers.setTimeout(() => {
        this.troubleTimer = null;
        this.refresh();
      }, left);
    }
    return null;
  }

  private refresh(): void {
    if (this.disposed) return;
    const state = this.ctrl?.snapshot ?? null;
    // A broker connection won the race against a pending manual exchange: drop the exchange.
    if (state?.live && !this.manualT && (this.host || this.guest)) {
      this.dropPending();
      this.manual = IDLE_MANUAL;
    }
    const seat = state?.seat ?? null;
    const score = state && seat !== null ? scoreView(state.score, seat) : NO_SCORE;
    const next: RoomView = {
      code: this.code,
      state,
      tab: this.tab,
      guarded: !!this.locks,
      manual: this.manual,
      manualCause: this.manualCauseOf(state),
      score: score === NO_SCORE ? NO_SCORE : [score[0], score[1]],
      via: this.tab !== 'owner' ? null : this.manualT ? 'manual' : this.brokerT ? 'broker' : null,
    };
    if (sameView(this.current, next)) return;
    this.current = Object.freeze(next);
    for (const cb of [...this.subs]) {
      try {
        cb();
      } catch (e) {
        console.error(e);
      }
    }
  }

  private listen(target: EventSourceLike | null, type: string, cb: (e: Event) => void): void {
    if (!target) return;
    try {
      target.addEventListener(type, cb);
      this.listeners.push([target, type, cb]);
    } catch {
      /* ignore */
    }
  }
}

/** Creates the room session for `opts.code` (see the module comment). */
export function createRoomSession(opts: RoomSessionOptions): RoomSession {
  return new Session(opts);
}

/* ---------------------------------------------------------------------------------------------- */
/* React hook                                                                                       */
/* ---------------------------------------------------------------------------------------------- */

export interface UseRoomOptions extends Omit<RoomSessionOptions, 'code'> {
  /** False: no session (start screen, solo modes). Default true. */
  enabled?: boolean;
  /** Each notice of the room, once (toasts). `RoomToasts` subscribes through `handle.onNotice` instead. */
  onNotice?: (n: RoomNotice) => void;
}

/** What `useRoom` returns: the view plus the actions. Stable between renders unless the view changed. */
export interface RoomHandle extends RoomView {
  /** The current controller (read-only while `tab` is not `owner`), or null. */
  readonly controller: RoomControllerApi | null;
  /** Plays this device's move (`ms` defaults to the controller's running turn). */
  move(uci: string, ms?: number): boolean;
  ask(kind: RequestKind): boolean;
  reply(kind: RequestKind | 'rejoin', ok: boolean): boolean;
  resign(): boolean;
  flag(): boolean;
  /** Ms the side to move has used on the running turn (for `useClock`'s display, or a move). */
  elapsed(): number;
  takeOver(): void;
  openManual(): void;
  restartManual(): void;
  acceptAnswer(text: string): Promise<ManualIssue | null>;
  closeManual(): void;
  bank(): void;
  /** Subscribes to the room's notices (stays valid when the controller is replaced). */
  onNotice(cb: (n: RoomNotice) => void): () => void;
}

const noopSubscribe = () => () => {};

/**
 * Runs the room `code` while `code` is a valid code and `enabled` is not false. A new code (or
 * `enabled` turning false) disposes the old session: the transport closes, the lock is released
 * and the running turn is banked. `create`, `broker`, `locks` and the other options are read when
 * the session starts; `offer` and `answer` are followed (each value is used once).
 */
export function useRoom(code: string | null, opts: UseRoomOptions = {}): RoomHandle {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const active = opts.enabled !== false && !!code && isValidCode(code);
  const [session, setSession] = useState<RoomSession | null>(null);

  useEffect(() => {
    if (!active || !code) {
      setSession(null);
      return;
    }
    const o = optsRef.current;
    const s = createRoomSession({ ...o, code, onSignalUsed: () => optsRef.current.onSignalUsed?.() });
    const off = s.onNotice((n) => optsRef.current.onNotice?.(n));
    setSession(s);
    return () => {
      off();
      s.dispose();
    };
  }, [active, code]);

  const { offer, answer } = opts;
  useEffect(() => {
    session?.signal({ offer, answer });
  }, [session, offer, answer]);

  const subscribe = useCallback((cb: () => void) => (session ? session.subscribe(cb) : noopSubscribe()), [session]);
  const getSnapshot = useCallback(() => (session ? session.view : IDLE_ROOM_VIEW), [session]);
  const view = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Actions are stable per session, so they can sit in effect dependencies.
  const actions = useMemo<Omit<RoomHandle, keyof RoomView | 'controller'>>(() => {
    const c = () => session?.controller ?? null;
    return {
      move: (uci, ms) => c()?.move(uci, ms) ?? false,
      ask: (kind) => c()?.ask(kind) ?? false,
      reply: (kind, ok) => c()?.reply(kind, ok) ?? false,
      resign: () => c()?.resign() ?? false,
      flag: () => c()?.flag() ?? false,
      elapsed: () => c()?.elapsed() ?? 0,
      takeOver: () => session?.takeOver(),
      openManual: () => session?.openManual(),
      restartManual: () => session?.restartManual(),
      acceptAnswer: (text) => (session ? session.acceptAnswer(text) : Promise.resolve<ManualIssue | null>('invalid')),
      closeManual: () => session?.closeManual(),
      bank: () => session?.bank(),
      onNotice: (cb) => (session ? session.onNotice(cb) : () => {}),
    };
  }, [session]);

  return useMemo<RoomHandle>(() => ({ ...view, ...actions, controller: session?.controller ?? null }), [view, actions, session]);
}
