/**
 * In-memory transport for tests (PLAN 7: room logic is tested only over this transport).
 *
 * Two shapes:
 *
 * - `createMemoryPair(opts)`: two linked ends `a` (anchor) and `b` (dialer), open at once, with
 *   controls for delay, message drop, disconnect/reconnect, failure and close.
 * - `createMemoryNetwork(opts)`: a `TransportFactory` that behaves like the broker procedure of
 *   DESIGN 9.2: the first device of a code waits as anchor, the next one dials and both open; when
 *   one side closes, the other waits (and becomes anchor); a device that starts the same code later
 *   links again. This is what a "close the page, reopen it" test needs.
 *
 * Semantics match the real transports (see `RoomTransport` in common.ts): reliable and ordered,
 * every message makes a JSON round trip (so non-serializable values and shared references show up
 * in tests), in-flight messages are lost on disconnect, `send` while not open drops silently.
 *
 * Determinism: messages are delivered through the injected `timers` (default: global
 * `setTimeout`, so `vi.useFakeTimers()` controls them) after `delayMs` (default 0), or only on
 * `flush()` when `manual: true`. State changes from the controls are synchronous.
 */
import type { Message, Rng, TransportState } from '../types';
import { defaultTimers, TransportCore, type RoomTransport, type Timers, type TransportFailureKind, type TransportRole } from './common';

/** Which messages to drop: never/always, a probability (uses `rng`), or a predicate. */
export type DropRule = boolean | number | ((msg: Message, from: MemoryTransport) => boolean);

export interface MemoryOptions {
  /** One-way latency in ms. Default 0 (still asynchronous: one timer turn). */
  delayMs?: number;
  /** Drop rule. Default: deliver everything. */
  drop?: DropRule;
  /** Timer functions. Default: the global ones. */
  timers?: Timers;
  /** Random source for a probability drop rule. Default `Math.random`. */
  rng?: Rng;
  /** No timers at all: messages wait until `flush()`. Default false. */
  manual?: boolean;
  /** Pair only: start with the channel open. Default true. */
  open?: boolean;
}

/** One end of a memory link. */
export interface MemoryTransport extends RoomTransport {
  readonly kind: 'memory';
  /** `a` / `b` for a pair; `<CODE>#<n>` (1-based creation order) for a network. */
  readonly name: string;
}

/** A logged message. */
export interface MemoryLogEntry {
  from: string;
  to: string;
  msg: Message;
  dropped: boolean;
}

/** Controls of one link. */
export interface MemoryLinkControls {
  /** Changes the one-way latency for messages sent from now on. Order is always kept. */
  setDelay(ms: number): void;
  setDrop(rule: DropRule): void;
  /** Both ends lose the channel: in-flight messages are lost, both get `peer-gone` and go `connecting`. */
  disconnect(): void;
  /** Opens a fresh channel between the same ends (both go `open`). No-op if an end is closed. */
  reconnect(): void;
  /** Puts one or both ends into `failed` with `failure` (the channel goes down first). */
  fail(side: 'a' | 'b' | 'both', failure: TransportFailureKind): void;
  /** Delivers every in-flight message now, in order (also those sent while flushing). */
  flush(): void;
  /** Messages sent but not yet delivered. */
  readonly inFlight: number;
  /** Every message sent over this link, delivered or dropped, oldest first. */
  readonly log: readonly MemoryLogEntry[];
  /** True while the channel is up. */
  readonly up: boolean;
}

export interface MemoryPair extends MemoryLinkControls {
  readonly a: MemoryTransport;
  readonly b: MemoryTransport;
  /** Closes both ends (terminal). */
  close(): void;
}

/* ---------------------------------------------------------------------------------------------- */

interface LinkConfig {
  delayMs: number;
  drop: DropRule;
  timers: Timers;
  rng: Rng;
  manual: boolean;
}

interface Item {
  to: MemoryEnd;
  msg: Message;
  gen: number;
  timer: unknown;
}

class MemoryEnd implements MemoryTransport {
  readonly kind = 'memory' as const;
  readonly core: TransportCore;
  link: Link | null = null;
  /** Network hook: called once when this end is closed. */
  onClosed: (() => void) | null = null;
  /** Network hook: called on `reconnect()` while unlinked. */
  onReconnect: (() => void) | null = null;

  constructor(
    readonly name: string,
    role: TransportRole,
  ) {
    this.core = new TransportCore(role);
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

  send(msg: Message): void {
    if (this.core.state !== 'open' || !this.link?.up) return;
    this.link.carry(this, msg);
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
    this.onReconnect?.();
  }
  close(): void {
    if (this.core.state === 'closed') return;
    const link = this.link;
    this.core.close();
    link?.endClosed(this);
    this.onClosed?.();
  }
}

class Link implements MemoryLinkControls {
  up = false;
  private gen = 0;
  private queue: Item[] = [];
  private entries: MemoryLogEntry[] = [];

  constructor(
    readonly a: MemoryEnd,
    readonly b: MemoryEnd,
    private cfg: LinkConfig,
  ) {
    a.link = this;
    b.link = this;
  }

  get inFlight(): number {
    return this.queue.length;
  }
  get log(): readonly MemoryLogEntry[] {
    return this.entries;
  }

  closedEnd(): boolean {
    return this.a.state === 'closed' || this.b.state === 'closed';
  }

  other(end: MemoryEnd): MemoryEnd {
    return end === this.a ? this.b : this.a;
  }

  open(): void {
    if (this.closedEnd() || this.up) return;
    this.up = true;
    this.gen++;
    this.a.core.setState('open');
    this.b.core.setState('open');
  }

  /** Channel loss: drop in-flight messages; each live end gets `peer-gone` and `connecting`. */
  down(failure: TransportFailureKind | null = 'peer-gone', state: TransportState = 'connecting', ends = [this.a, this.b]): void {
    const wasUp = this.up;
    this.up = false;
    this.gen++;
    for (const it of this.queue) if (it.timer !== undefined) this.cfg.timers.clearTimeout(it.timer);
    this.queue = [];
    for (const e of ends) {
      if (e.state === 'closed') continue;
      if (failure && (wasUp || state === 'failed')) e.core.fail(failure);
      e.core.setState(state);
    }
  }

  /** Drop the channel and open a fresh one between the same ends. */
  bounce(): void {
    this.down(null);
    this.open();
  }

  /** One end closed: the other one loses its peer. */
  endClosed(end: MemoryEnd): void {
    const other = this.other(end);
    this.down('peer-gone', 'connecting', [other]);
    end.link = null;
    if (other.link === this) other.link = null;
  }

  carry(from: MemoryEnd, msg: Message): void {
    const to = this.other(from);
    // JSON round trip, as on the wire.
    const copy = JSON.parse(JSON.stringify(msg)) as Message;
    const dropped = this.shouldDrop(copy, from);
    this.entries.push({ from: from.name, to: to.name, msg: copy, dropped });
    if (dropped) return;
    const item: Item = { to, msg: copy, gen: this.gen, timer: undefined };
    this.queue.push(item);
    if (!this.cfg.manual) {
      item.timer = this.cfg.timers.setTimeout(() => this.deliverThrough(item), Math.max(0, this.cfg.delayMs));
    }
  }

  private shouldDrop(msg: Message, from: MemoryEnd): boolean {
    const d = this.cfg.drop;
    if (typeof d === 'boolean') return d;
    if (typeof d === 'number') return this.cfg.rng() < d;
    return d(msg, from);
  }

  /** Delivers every queued item up to and including `item` (keeps order when delays change). */
  private deliverThrough(item: Item): void {
    const idx = this.queue.indexOf(item);
    if (idx < 0) return;
    const batch = this.queue.splice(0, idx + 1);
    for (const it of batch) {
      if (it !== item && it.timer !== undefined) this.cfg.timers.clearTimeout(it.timer);
    }
    this.dispatch(batch);
  }

  private dispatch(batch: Item[]): void {
    for (const it of batch) {
      if (it.gen !== this.gen || !this.up) return;
      it.to.core.deliver(it.msg);
    }
  }

  flush(): void {
    // Messages sent by listeners during the flush are delivered too.
    for (let guard = 0; this.queue.length && guard < 100_000; guard++) {
      const batch = this.queue.splice(0, this.queue.length);
      for (const it of batch) if (it.timer !== undefined) this.cfg.timers.clearTimeout(it.timer);
      this.dispatch(batch);
    }
  }

  setDelay(ms: number): void {
    this.cfg.delayMs = ms;
  }
  setDrop(rule: DropRule): void {
    this.cfg.drop = rule;
  }
  disconnect(): void {
    if (!this.up) return;
    this.down('peer-gone', 'connecting');
  }
  reconnect(): void {
    if (this.up) this.down(null);
    this.open();
  }
  fail(side: 'a' | 'b' | 'both', failure: TransportFailureKind): void {
    const ends = side === 'a' ? [this.a] : side === 'b' ? [this.b] : [this.a, this.b];
    if (this.up) this.down('peer-gone', 'connecting', [this.a, this.b].filter((e) => !ends.includes(e)));
    this.down(failure, 'failed', ends);
  }
}

function config(opts: MemoryOptions): LinkConfig {
  return {
    delayMs: opts.delayMs ?? 0,
    drop: opts.drop ?? false,
    timers: opts.timers ?? defaultTimers,
    rng: opts.rng ?? Math.random,
    manual: opts.manual ?? false,
  };
}

/** Two linked ends: `a` is the anchor, `b` the dialer. Open at once unless `open: false`. */
export function createMemoryPair(opts: MemoryOptions = {}): MemoryPair {
  const a = new MemoryEnd('a', 'anchor');
  const b = new MemoryEnd('b', 'dialer');
  const link = new Link(a, b, config(opts));
  a.onReconnect = b.onReconnect = () => link.reconnect();
  if (opts.open !== false) link.open();
  return {
    a,
    b,
    get inFlight() {
      return link.inFlight;
    },
    get log() {
      return link.log;
    },
    get up() {
      return link.up;
    },
    setDelay: (ms) => link.setDelay(ms),
    setDrop: (r) => link.setDrop(r),
    disconnect: () => link.disconnect(),
    reconnect: () => link.reconnect(),
    fail: (side, f) => link.fail(side, f),
    flush: () => link.flush(),
    close: () => {
      a.close();
      b.close();
    },
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* Network: the broker procedure in memory                                                          */
/* ---------------------------------------------------------------------------------------------- */

export interface MemoryNetwork {
  /** `TransportFactory` for `RoomController`s. Resolves at once with a `MemoryTransport`. */
  readonly factory: (code: string) => Promise<MemoryTransport>;
  /** Controls of the current link of `code`; null while fewer than two devices are there. */
  link(code: string): MemoryLinkControls | null;
  /** Live (not closed) transports of `code`, the anchor first. */
  peers(code: string): MemoryTransport[];
  /** Every transport the factory created, in creation order. */
  readonly created: readonly MemoryTransport[];
  /**
   * Network outage for `code`: the current link goes down (both `connecting`) and no new link
   * forms until `setOnline(code, true)`.
   */
  setOnline(code: string, online: boolean): void;
  /** Delivers in-flight messages on every link. */
  flushAll(): void;
}

interface Slot {
  /** Live ends, the anchor first. */
  ends: MemoryEnd[];
  link: Link | null;
  online: boolean;
}

/**
 * The broker procedure of DESIGN 9.2 in memory. The first live device of a code is the anchor; a
 * new device dials and links with the anchor, and a dialer it replaces loses its channel and waits
 * (newest wins, as with PeerJS). When the anchor closes, the oldest remaining device becomes anchor
 * and links with the newest other one. Every link shares the network's delay and drop options.
 */
export function createMemoryNetwork(opts: MemoryOptions = {}): MemoryNetwork {
  const cfg = config(opts);
  const slots = new Map<string, Slot>();
  const created: MemoryEnd[] = [];
  const links: Link[] = [];

  const slot = (code: string): Slot => {
    let s = slots.get(code);
    if (!s) {
      s = { ends: [], link: null, online: true };
      slots.set(code, s);
    }
    return s;
  };

  /** Link the anchor with the newest other end, if both exist and the network is up. */
  const relink = (s: Slot, prefer?: MemoryEnd) => {
    if (!s.online || s.ends.length < 2) return;
    const anchor = s.ends[0];
    const dialer = prefer && prefer !== anchor ? prefer : s.ends[s.ends.length - 1];
    if (s.link && s.link.up && (s.link.a === anchor || s.link.b === anchor) && (s.link.a === dialer || s.link.b === dialer)) return;
    if (s.link) {
      const old = s.link;
      old.down('peer-gone', 'connecting');
      old.a.link = old.a.link === old ? null : old.a.link;
      old.b.link = old.b.link === old ? null : old.b.link;
    }
    anchor.core.setRole('anchor');
    dialer.core.setRole('dialer');
    const link = new Link(anchor, dialer, cfg);
    links.push(link);
    s.link = link;
    link.open();
  };

  const factory = async (code: string): Promise<MemoryTransport> => {
    const s = slot(code);
    const end = new MemoryEnd(`${code}#${created.length + 1}`, s.ends.length === 0 ? 'anchor' : 'dialer');
    created.push(end);
    s.ends.push(end);
    end.onClosed = () => {
      s.ends = s.ends.filter((e) => e !== end);
      if (s.link && (s.link.a === end || s.link.b === end)) s.link = null;
      if (s.ends.length) s.ends[0].core.setRole('anchor');
      relink(s);
    };
    end.onReconnect = () => {
      if (!s.online) return;
      if (end.link && !end.link.closedEnd()) end.link.bounce();
      else relink(s, end);
    };
    relink(s, end);
    return end;
  };

  return {
    factory,
    link: (code) => {
      const l = slots.get(code)?.link ?? null;
      return l && !l.closedEnd() ? l : null;
    },
    peers: (code) => [...(slots.get(code)?.ends ?? [])],
    get created() {
      return created;
    },
    setOnline: (code, online) => {
      const s = slot(code);
      s.online = online;
      if (!online) s.link?.disconnect();
      else if (s.link && !s.link.closedEnd()) s.link.reconnect();
      else relink(s);
    },
    flushAll: () => {
      for (const l of links) l.flush();
    },
  };
}
