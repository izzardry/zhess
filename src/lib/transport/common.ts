/**
 * Shared pieces of the transports (DESIGN 9.1, 9.10).
 *
 * Every transport implements `Transport` from `types.ts` with the same extended semantics,
 * written down once here as `RoomTransport`:
 *
 * - `onState`, `onMessage`, `onFailure` and `onRole` accept any number of listeners and return an
 *   unsubscribe function. `onState` and `onRole` call the new listener at once with the current
 *   value, so a listener added after the factory resolved never misses `open`.
 * - Messages that arrive before the first `onMessage` listener is added are buffered and handed to
 *   that listener.
 * - Every `open` is a fresh channel: the room starts its handshake (hello, challenge) again.
 * - `send` while not open drops the message silently; the room's ack queue and reconcile cover it.
 * - `closed` is terminal and follows `close()` (or, for the single-use manual transport, the loss of
 *   its channel). `failed` means the last attempt failed: `failure` says why. The PeerJS transport
 *   keeps retrying after `failed` (it emits `connecting` when the next attempt starts); the manual
 *   transport cannot and stays `failed`.
 */
import type { Message, Transport, TransportFailure, TransportState } from '../types';

/**
 * Why a connection attempt failed or a channel was lost. `TransportFailure` from `types.ts` plus
 * `peer-gone` (an open channel was closed by the other side or lost). Contract change requested.
 */
export type TransportFailureKind = TransportFailure | 'peer-gone';

/** Transport role (DESIGN 9.2): anchor holds `zhess-<CODE>` (or made the manual offer). */
export type TransportRole = 'anchor' | 'dialer';

/** `Transport` with the extras every Zhess transport offers. */
export interface RoomTransport extends Transport {
  /** Current role. For PeerJS it may change on every reconnect (DESIGN 9.2). */
  readonly role: TransportRole;
  /** Current state. */
  readonly state: TransportState;
  /** Why the last attempt failed or the channel was lost; null after a successful open. */
  readonly failure: TransportFailureKind | null;
  /** Which implementation this is. */
  readonly kind: 'peerjs' | 'manual' | 'memory';
  onMessage(cb: (msg: Message) => void): () => void;
  onState(cb: (s: TransportState) => void): () => void;
  /** Called on every classified failure (also `peer-gone`, which is not followed by `failed`). */
  onFailure(cb: (f: TransportFailureKind) => void): () => void;
  /** Called with the current role and again whenever it changes. */
  onRole(cb: (r: TransportRole) => void): () => void;
  /**
   * Drops the current channel (if any) and connects again now, skipping any backoff wait. The room
   * calls this after three missed pongs. No-op for a closed transport and for the manual transport.
   */
  reconnect(): void;
}

/** Timer functions, injected so tests are deterministic. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const defaultTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * Public STUN servers only, no TURN (DESIGN 9.1). PeerJS's own default config carries a TURN
 * server, so it is always overridden with this list.
 */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/** Reconnect backoff of DESIGN 9.10: 1, 2, 4, 8 … up to 30 seconds. `attempt` is 0-based. */
export function backoffMs(attempt: number, baseMs = 1000, maxMs = 30_000): number {
  if (attempt <= 0) return baseMs;
  return Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 30));
}

/**
 * Shape check for a message from the wire: a plain object with a string `t`. Version and fields
 * are the room's business (a peer with another `v` must still reach it for the version toast).
 */
export function isMessage(x: unknown): x is Message {
  return typeof x === 'object' && x !== null && !Array.isArray(x) && typeof (x as { t?: unknown }).t === 'string';
}

/** Parses a JSON text frame; null if it is not a message. */
export function parseMessage(data: unknown): Message | null {
  let v: unknown = data;
  if (typeof data === 'string') {
    try {
      v = JSON.parse(data);
    } catch {
      return null;
    }
  }
  return isMessage(v) ? v : null;
}

/** A tiny listener set. */
export class Listeners<T> {
  private set = new Set<(v: T) => void>();
  add(cb: (v: T) => void): () => void {
    this.set.add(cb);
    return () => {
      this.set.delete(cb);
    };
  }
  emit(v: T): void {
    for (const cb of [...this.set]) {
      try {
        cb(v);
      } catch (e) {
        // A throwing listener must not break the transport or the other listeners.
        console.error(e);
      }
    }
  }
  get size(): number {
    return this.set.size;
  }
  clear(): void {
    this.set.clear();
  }
}

/**
 * The bookkeeping every transport shares: listeners, current state/role/failure, and the message
 * buffer for the time before the first `onMessage` listener.
 */
export class TransportCore {
  state: TransportState = 'connecting';
  role: TransportRole;
  failure: TransportFailureKind | null = null;
  readonly states = new Listeners<TransportState>();
  readonly messages = new Listeners<Message>();
  readonly failures = new Listeners<TransportFailureKind>();
  readonly roles = new Listeners<TransportRole>();
  private buffer: Message[] = [];

  constructor(role: TransportRole) {
    this.role = role;
  }

  setState(s: TransportState): void {
    if (this.state === 'closed') return;
    if (s === 'open') this.failure = null;
    if (s === this.state) return;
    this.state = s;
    this.states.emit(s);
  }

  setRole(r: TransportRole): void {
    if (r === this.role) return;
    this.role = r;
    this.roles.emit(r);
  }

  fail(f: TransportFailureKind): void {
    if (this.state === 'closed') return;
    this.failure = f;
    this.failures.emit(f);
  }

  deliver(msg: Message): void {
    if (this.state === 'closed') return;
    if (this.messages.size === 0) this.buffer.push(msg);
    else this.messages.emit(msg);
  }

  onMessage(cb: (msg: Message) => void): () => void {
    const off = this.messages.add(cb);
    if (this.buffer.length) {
      const pending = this.buffer;
      this.buffer = [];
      for (const m of pending) cb(m);
    }
    return off;
  }

  onState(cb: (s: TransportState) => void): () => void {
    const off = this.states.add(cb);
    cb(this.state);
    return off;
  }

  onRole(cb: (r: TransportRole) => void): () => void {
    const off = this.roles.add(cb);
    cb(this.role);
    return off;
  }

  onFailure(cb: (f: TransportFailureKind) => void): () => void {
    return this.failures.add(cb);
  }

  /** Terminal: emits `closed` once and drops every listener and buffered message. */
  close(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.states.emit('closed');
    this.buffer = [];
    this.states.clear();
    this.messages.clear();
    this.failures.clear();
    this.roles.clear();
  }
}

/** Random base36 token of `len` characters from `rng`. */
export function randomToken(rng: () => number, len = 12): string {
  const a = '0123456789abcdefghijklmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < len; i++) s += a[Math.min(35, Math.floor(rng() * 36))];
  return s;
}
