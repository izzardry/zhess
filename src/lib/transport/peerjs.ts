/**
 * PeerJS transport (DESIGN 9.1, 9.2, 9.10).
 *
 * Procedure, run on start and again on every reconnect, by both devices:
 *
 * 1. Wait a random 0–500 ms (injected `rng`) so two devices do not grab the id at once.
 * 2. Claim `zhess-<CODE>` at the broker. On `open` this device is the **anchor**: it waits for the
 *    other device to connect. A newer incoming connection replaces an older one (newest wins), so a
 *    peer that comes back after a network change gets in at once.
 * 3. On `unavailable-id` another device holds the id: register a random id and **dial**
 *    `zhess-<CODE>`. If the dial fails because that peer is gone (`peer-unavailable`), the old anchor
 *    has left: claim again (step 1).
 *
 * Failures are classified for the UI (`TransportFailureKind`): `broker-unreachable` (the broker
 * cannot be reached or dropped us), `id-taken` (the id is held but its holder never answered: a
 * stale or squatted id), `ice-failed` (no direct path), `peer-gone` (an open channel was lost, or the
 * anchor kept vanishing), `timeout` (anything else that did not open in time). After a failure the
 * transport is `failed` and retries with backoff 1, 2, 4 … 30 s; `visibilitychange` (to visible),
 * `online` and `focus` retry at once. A lost channel is retried at once.
 *
 * ICE uses public STUN servers only (`ICE_SERVERS`); PeerJS's default TURN server is overridden.
 * Messages are JSON over a reliable, ordered PeerJS data connection.
 *
 * `peerjs` is imported lazily on the first claim, so it stays out of the main bundle. Tests inject
 * a fake `Peer` class; PeerJS itself is only touched by the best-effort e2e (PLAN 7).
 */
import type { Message, Rng, TransportState } from '../types';
import {
  backoffMs,
  defaultTimers,
  ICE_SERVERS,
  parseMessage,
  randomToken,
  TransportCore,
  type RoomTransport,
  type Timers,
  type TransportFailureKind,
  type TransportRole,
} from './common';

/* ---------------------------------------------------------------------------------------------- */
/* The slice of PeerJS this module uses (structural, so tests can fake it)                          */
/* ---------------------------------------------------------------------------------------------- */

type Handler = (...args: never[]) => void;

/** A PeerJS `DataConnection`, as far as this module uses it. */
export interface DataConnectionLike {
  readonly peer: string;
  readonly open: boolean;
  readonly peerConnection?: RTCPeerConnection | null;
  on(event: 'open' | 'close' | 'data' | 'error' | 'iceStateChanged', cb: Handler): unknown;
  send(data: unknown): unknown;
  close(): void;
}

/** A PeerJS `Peer`, as far as this module uses it. */
export interface PeerLike {
  readonly destroyed: boolean;
  readonly disconnected: boolean;
  on(event: 'open' | 'connection' | 'error' | 'disconnected' | 'close', cb: Handler): unknown;
  connect(id: string, options?: { reliable?: boolean; serialization?: string; label?: string }): DataConnectionLike;
  destroy(): void;
}

export interface PeerOptionsLike {
  config?: RTCConfiguration;
  debug?: number;
}

export type PeerCtor = new (id: string, options: PeerOptionsLike) => PeerLike;

/* ---------------------------------------------------------------------------------------------- */

/** The broker peer id of a room (DESIGN 9.2). */
export function anchorPeerId(code: string): string {
  return `zhess-${code}`;
}

/** What a PeerJS `Peer` error means for the procedure. */
export type PeerErrorAction =
  /** The anchor id is held by someone else: dial it. */
  | 'dial'
  /** The dialled anchor is gone: claim again. */
  | 'reclaim'
  /** A failure of this kind; retry with backoff. */
  | { fail: TransportFailureKind };

/** Classifies a PeerJS error `type` (PeerErrorType). Pure; exported for tests. */
export function classifyPeerError(type: string): PeerErrorAction {
  switch (type) {
    case 'unavailable-id':
      return 'dial';
    case 'peer-unavailable':
      return 'reclaim';
    case 'webrtc':
    case 'browser-incompatible':
      return { fail: 'ice-failed' };
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
    case 'ssl-unavailable':
    case 'invalid-key':
    case 'invalid-id':
    case 'disconnected':
    default:
      return { fail: 'broker-unreachable' };
  }
}

/** Minimal event target (window, document). */
export interface EventSourceLike {
  addEventListener(type: string, cb: () => void): void;
  removeEventListener(type: string, cb: () => void): void;
}

export interface PeerJsOptions {
  /** PeerJS `Peer` class. Default: `import('peerjs')` on first use. */
  Peer?: PeerCtor;
  /** Random source for the pre-delay and the dialer id. Default `Math.random`. */
  rng?: Rng;
  timers?: Timers;
  /** STUN servers. Default `ICE_SERVERS` (no TURN). */
  iceServers?: RTCIceServer[];
  /** Upper bound of the random pre-delay. Default 500 ms. */
  preDelayMaxMs?: number;
  /** Longest wait for the broker's `open`. Default 10 s. */
  brokerTimeoutMs?: number;
  /** Longest wait from dialling to an open channel. Default 10 s. */
  dialTimeoutMs?: number;
  /** Consecutive claim/dial flips before giving up with `peer-gone`. Default 3. */
  maxFlips?: number;
  /** Backoff base and cap. Default 1000 / 30000 ms. */
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** Where `online`/`focus` and `visibilitychange` are listened for. Default `window` / `document`; null disables. */
  window?: EventSourceLike | null;
  document?: (EventSourceLike & { readonly visibilityState?: DocumentVisibilityState }) | null;
  /** PeerJS log level. Default 0 (silent). */
  debug?: number;
}

export interface PeerJsTransport extends RoomTransport {
  readonly kind: 'peerjs';
  readonly code: string;
  /** Retries with backoff since the last open (0 after an open). */
  readonly attempt: number;
}

let peerModule: Promise<PeerCtor> | null = null;
function loadPeer(): Promise<PeerCtor> {
  if (!peerModule) {
    peerModule = import('peerjs').then((m) => m.Peer as unknown as PeerCtor);
    peerModule.catch(() => {
      peerModule = null;
    });
  }
  return peerModule;
}

class PeerJsTransportImpl implements PeerJsTransport {
  readonly kind = 'peerjs' as const;
  readonly core = new TransportCore('anchor');
  attempt = 0;

  private peer: PeerLike | null = null;
  private conn: DataConnectionLike | null = null;
  /** Bumped on every (re)start and on close; callbacks of older runs are ignored. */
  private run = 0;
  private flips = 0;
  private timers: Timers;
  private rng: Rng;
  private timer: unknown = undefined;
  private watchdog: unknown = undefined;
  private lastIce: RTCIceConnectionState | null = null;
  private brokerLost = false;
  private detach: (() => void) | null = null;
  /** Resolves on the first role decision or the first failure (the factory awaits it). */
  readonly ready: Promise<void>;
  private markReady!: () => void;

  constructor(
    readonly code: string,
    private opts: PeerJsOptions,
  ) {
    this.timers = opts.timers ?? defaultTimers;
    this.rng = opts.rng ?? Math.random;
    this.ready = new Promise((r) => (this.markReady = r));
    this.listen();
  }

  get role(): TransportRole {
    return this.core.role;
  }
  get state(): TransportState {
    return this.core.state;
  }
  get failure(): TransportFailureKind | null {
    return this.core.failure;
  }

  /* ---------------------------------------------------------------- triggers */

  private listen(): void {
    const win = this.opts.window !== undefined ? this.opts.window : typeof window !== 'undefined' ? window : null;
    const doc =
      this.opts.document !== undefined ? this.opts.document : typeof document !== 'undefined' ? document : null;
    const onOnline = () => {
      this.attempt = 0;
      this.nudge();
    };
    const onFocus = () => this.nudge();
    const onVisible = () => {
      if (!doc || doc.visibilityState === undefined || doc.visibilityState === 'visible') this.nudge();
    };
    win?.addEventListener('online', onOnline);
    win?.addEventListener('focus', onFocus);
    doc?.addEventListener('visibilitychange', onVisible);
    this.detach = () => {
      win?.removeEventListener('online', onOnline);
      win?.removeEventListener('focus', onFocus);
      doc?.removeEventListener('visibilitychange', onVisible);
    };
  }

  /** Retry now if waiting on a backoff, or if the anchor lost the broker while waiting. */
  private nudge(): void {
    const s = this.core.state;
    if (s === 'closed') return;
    if (s === 'failed') {
      this.start();
      return;
    }
    if (s === 'connecting' && this.core.role === 'anchor' && this.peer && !this.conn && (this.peer.disconnected || this.peer.destroyed)) {
      this.start();
    }
  }

  /* ---------------------------------------------------------------- procedure */

  private clearTimers(): void {
    if (this.timer !== undefined) this.timers.clearTimeout(this.timer);
    if (this.watchdog !== undefined) this.timers.clearTimeout(this.watchdog);
    this.timer = undefined;
    this.watchdog = undefined;
  }

  private teardown(): void {
    this.clearTimers();
    const conn = this.conn;
    const peer = this.peer;
    this.conn = null;
    this.peer = null;
    this.lastIce = null;
    this.brokerLost = false;
    try {
      conn?.close();
    } catch {
      /* ignore */
    }
    try {
      peer?.destroy();
    } catch {
      /* ignore */
    }
  }

  /** (Re)starts the procedure: pre-delay, then claim. */
  start(): void {
    if (this.core.state === 'closed') return;
    this.teardown();
    const run = ++this.run;
    this.core.setState('connecting');
    const delay = Math.floor(this.rng() * (this.opts.preDelayMaxMs ?? 500));
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      void this.claim(run);
    }, delay);
  }

  private stale(run: number): boolean {
    return run !== this.run || this.core.state === 'closed';
  }

  private async peerClass(run: number): Promise<PeerCtor | null> {
    if (this.opts.Peer) return this.opts.Peer;
    try {
      return await loadPeer();
    } catch {
      if (!this.stale(run)) this.failed('broker-unreachable');
      return null;
    }
  }

  private newPeer(Peer: PeerCtor, id: string): PeerLike {
    return new Peer(id, {
      config: { iceServers: this.opts.iceServers ?? ICE_SERVERS },
      debug: this.opts.debug ?? 0,
    });
  }

  private armWatchdog(ms: number, onTimeout: () => void): void {
    if (this.watchdog !== undefined) this.timers.clearTimeout(this.watchdog);
    this.watchdog = this.timers.setTimeout(() => {
      this.watchdog = undefined;
      onTimeout();
    }, ms);
  }

  private disarmWatchdog(): void {
    if (this.watchdog !== undefined) this.timers.clearTimeout(this.watchdog);
    this.watchdog = undefined;
  }

  private async claim(run: number): Promise<void> {
    const Peer = await this.peerClass(run);
    if (!Peer || this.stale(run)) return;
    let peer: PeerLike;
    try {
      peer = this.newPeer(Peer, anchorPeerId(this.code));
    } catch {
      this.failed('broker-unreachable');
      return;
    }
    this.peer = peer;
    this.armWatchdog(this.opts.brokerTimeoutMs ?? 10_000, () => {
      if (!this.stale(run) && this.peer === peer) this.failed('broker-unreachable');
    });

    peer.on('open', () => {
      if (this.stale(run) || this.peer !== peer) return;
      this.disarmWatchdog();
      this.core.setRole('anchor');
      this.markReady();
    });
    peer.on('connection', ((c: DataConnectionLike) => {
      if (this.stale(run) || this.peer !== peer) {
        c.close();
        return;
      }
      this.acceptIncoming(run, c);
    }) as Handler);
    peer.on('disconnected', () => {
      if (this.stale(run) || this.peer !== peer) return;
      // Lost the broker. With an open channel, play on; re-run the procedure when it closes.
      if (this.conn && this.core.state === 'open') this.brokerLost = true;
      else this.failed('broker-unreachable');
    });
    peer.on('error', ((e: { type?: string }) => {
      if (this.stale(run) || this.peer !== peer) return;
      const action = classifyPeerError(e?.type ?? '');
      if (action === 'dial') {
        this.disarmWatchdog();
        this.peer = null;
        try {
          peer.destroy();
        } catch {
          /* ignore */
        }
        void this.dial(run);
      } else if (action === 'reclaim') {
        /* not expected for the anchor */
      } else if (this.conn && this.core.state === 'open') {
        this.brokerLost = true;
      } else {
        this.failed(action.fail);
      }
    }) as Handler);
  }

  private acceptIncoming(run: number, c: DataConnectionLike): void {
    c.on('open', () => {
      if (this.stale(run)) {
        c.close();
        return;
      }
      const old = this.conn;
      if (old && old !== c) {
        // Newest wins: the room starts its handshake again on the fresh channel.
        this.conn = null;
        try {
          old.close();
        } catch {
          /* ignore */
        }
        this.core.setState('connecting');
      }
      this.opened(c);
    });
    this.wireConn(run, c);
  }

  private async dial(run: number): Promise<void> {
    const Peer = await this.peerClass(run);
    if (!Peer || this.stale(run)) return;
    this.core.setRole('dialer');
    this.markReady();
    let peer: PeerLike;
    try {
      peer = this.newPeer(Peer, `${anchorPeerId(this.code)}-${randomToken(this.rng, 10)}`);
    } catch {
      this.failed('broker-unreachable');
      return;
    }
    this.peer = peer;
    this.armWatchdog(this.opts.brokerTimeoutMs ?? 10_000, () => {
      if (!this.stale(run) && this.peer === peer) this.failed('broker-unreachable');
    });

    peer.on('open', () => {
      if (this.stale(run) || this.peer !== peer) return;
      let c: DataConnectionLike;
      try {
        c = peer.connect(anchorPeerId(this.code), { reliable: true, serialization: 'json' });
      } catch {
        this.failed('ice-failed');
        return;
      }
      this.conn = c;
      this.armWatchdog(this.opts.dialTimeoutMs ?? 10_000, () => {
        if (!this.stale(run) && this.conn === c && this.core.state !== 'open') this.failed(this.classifyDialTimeout(c));
      });
      c.on('open', () => {
        if (this.stale(run) || this.conn !== c) return;
        this.opened(c);
      });
      this.wireConn(run, c);
    });
    peer.on('connection', ((c: DataConnectionLike) => c.close()) as Handler);
    peer.on('disconnected', () => {
      if (this.stale(run) || this.peer !== peer) return;
      if (this.conn && this.core.state === 'open') this.brokerLost = true;
      else this.failed('broker-unreachable');
    });
    peer.on('error', ((e: { type?: string }) => {
      if (this.stale(run) || this.peer !== peer) return;
      const action = classifyPeerError(e?.type ?? '');
      if (action === 'reclaim') {
        if (this.core.state === 'open') return;
        this.flips++;
        if (this.flips > (this.opts.maxFlips ?? 3)) this.failed('peer-gone');
        else this.start();
      } else if (action === 'dial') {
        // Our random id collided: unlikely; start over.
        this.start();
      } else if (this.conn && this.core.state === 'open') {
        if (action.fail !== 'broker-unreachable') this.channelLost(this.conn);
        else this.brokerLost = true;
      } else {
        this.failed(action.fail);
      }
    }) as Handler);
  }

  private classifyDialTimeout(c: DataConnectionLike): TransportFailureKind {
    const pc = c.peerConnection ?? null;
    const ice = pc?.iceConnectionState ?? this.lastIce;
    if (ice === 'checking' || ice === 'failed' || ice === 'disconnected') return 'ice-failed';
    if (pc && !pc.remoteDescription) return 'id-taken';
    if (!pc && this.lastIce === null) return 'id-taken';
    return 'timeout';
  }

  /** Data, close and error handlers shared by both roles. */
  private wireConn(run: number, c: DataConnectionLike): void {
    c.on('data', ((d: unknown) => {
      if (this.stale(run) || this.conn !== c || this.core.state !== 'open') return;
      const m = parseMessage(d);
      if (m) this.core.deliver(m);
    }) as Handler);
    c.on('iceStateChanged', ((s: RTCIceConnectionState) => {
      if (this.stale(run)) return;
      if (this.conn === c) this.lastIce = s;
      if (s === 'failed') this.connDown(run, c, 'ice-failed');
    }) as Handler);
    c.on('error', ((e: { type?: string }) => {
      if (this.stale(run)) return;
      this.connDown(run, c, e?.type === 'negotiation-failed' ? 'ice-failed' : 'timeout');
    }) as Handler);
    c.on('close', () => {
      if (this.stale(run)) return;
      this.connDown(run, c, 'ice-failed');
    });
  }

  /** A connection went down: lost channel if it was the open one, failed attempt otherwise. */
  private connDown(run: number, c: DataConnectionLike, beforeOpen: TransportFailureKind): void {
    if (this.stale(run)) return;
    if (this.conn !== c) return;
    if (this.core.state === 'open') this.channelLost(c);
    else if (this.core.role === 'dialer') this.failed(beforeOpen);
    else {
      // Anchor: an incoming attempt failed; keep waiting for the next one.
      this.conn = null;
    }
  }

  private opened(c: DataConnectionLike): void {
    this.disarmWatchdog();
    this.conn = c;
    this.attempt = 0;
    this.flips = 0;
    this.core.setState('open');
  }

  /** The open channel was lost: report `peer-gone` and reconnect at once. */
  private channelLost(c: DataConnectionLike): void {
    if (this.conn !== c) return;
    this.conn = null;
    try {
      c.close();
    } catch {
      /* ignore */
    }
    this.core.fail('peer-gone');
    const peer = this.peer;
    if (this.core.role === 'anchor' && peer && !peer.disconnected && !peer.destroyed && !this.brokerLost) {
      // Still holding the id: wait for the other device to dial again.
      this.core.setState('connecting');
    } else {
      this.start();
    }
  }

  private failed(f: TransportFailureKind): void {
    if (this.core.state === 'closed') return;
    this.teardown();
    this.run++;
    this.core.fail(f);
    this.core.setState('failed');
    this.markReady();
    const delay = backoffMs(this.attempt, this.opts.backoffBaseMs ?? 1000, this.opts.backoffMaxMs ?? 30_000);
    this.attempt++;
    this.flips = 0;
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      this.start();
    }, delay);
  }

  /* ---------------------------------------------------------------- Transport */

  send(msg: Message): void {
    if (this.core.state !== 'open' || !this.conn) return;
    try {
      void Promise.resolve(this.conn.send(msg)).catch(() => {
        /* the close event follows */
      });
    } catch {
      /* the close event follows */
    }
  }
  onMessage(cb: (msg: Message) => void): () => void {
    return this.core.onMessage(cb);
  }
  onState(cb: (s: TransportState) => void): () => void {
    return this.core.onState(cb);
  }
  onFailure(cb: (f: TransportFailureKind) => void): () => void {
    return this.core.onFailure(cb);
  }
  onRole(cb: (r: TransportRole) => void): () => void {
    return this.core.onRole(cb);
  }
  reconnect(): void {
    if (this.core.state === 'closed') return;
    this.attempt = 0;
    this.flips = 0;
    this.start();
  }
  close(): void {
    if (this.core.state === 'closed') return;
    this.run++;
    this.teardown();
    this.detach?.();
    this.detach = null;
    this.core.close();
    this.markReady();
  }
}

/**
 * A `TransportFactory` over the public PeerJS broker. The promise resolves once the first role is
 * decided (anchor: id claimed; dialer: id taken, dialling) or the first attempt failed; the
 * transport keeps (re)connecting by itself until `close()`.
 */
export function createPeerJsFactory(opts: PeerJsOptions = {}): (code: string) => Promise<PeerJsTransport> {
  return async (code: string) => {
    const t = new PeerJsTransportImpl(code, opts);
    t.start();
    await t.ready;
    return t;
  };
}
