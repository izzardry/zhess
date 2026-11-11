import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, TransportFactory, TransportState } from '../types';
import { ICE_SERVERS } from './common';
import {
  anchorPeerId,
  classifyPeerError,
  createPeerJsFactory,
  type DataConnectionLike,
  type PeerCtor,
  type PeerJsOptions,
  type PeerJsTransport,
  type PeerLike,
  type PeerOptionsLike,
} from './peerjs';

/* ---------------------------------------------------------------------------------------------- */
/* A fake PeerJS broker                                                                             */
/* ---------------------------------------------------------------------------------------------- */

type Fn = (...args: never[]) => void;

class Emitter {
  private h = new Map<string, Fn[]>();
  on(ev: string, cb: Fn): this {
    this.h.set(ev, [...(this.h.get(ev) ?? []), cb]);
    return this;
  }
  emit(ev: string, ...args: unknown[]): void {
    for (const cb of this.h.get(ev) ?? []) (cb as (...a: unknown[]) => void)(...args);
  }
}

/** How a registered peer reacts to an incoming connection. */
type AnswerMode = 'open' | 'silent' | 'ice-fail';

class FakeConn extends Emitter implements DataConnectionLike {
  open = false;
  closed = false;
  other: FakeConn | null = null;
  readonly sent: unknown[] = [];
  constructor(
    readonly peer: string,
    readonly broker: FakeBroker,
  ) {
    super();
  }
  send(d: unknown): void {
    if (!this.open) throw new Error('not open');
    this.sent.push(d);
    const o = this.other;
    const copy = JSON.parse(JSON.stringify(d));
    setTimeout(() => {
      if (o && o.open) o.emit('data', copy);
    }, 1);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.emit('close');
    this.other?.close();
  }
}

class FakeBroker {
  reachable = true;
  /** Ids held by silent squatters: registered, never answer. */
  readonly ids = new Map<string, FakePeer | 'squatter' | 'zombie'>();
  readonly created: FakePeer[] = [];
  answer: AnswerMode = 'open';

  readonly Peer: PeerCtor;
  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const broker = this;
    this.Peer = class extends FakePeer {
      constructor(id: string, opts: PeerOptionsLike) {
        super(broker, id, opts);
      }
    } as unknown as PeerCtor;
  }

  live(): FakePeer[] {
    return this.created.filter((p) => !p.destroyed);
  }
}

class FakePeer extends Emitter implements PeerLike {
  destroyed = false;
  disconnected = false;
  readonly conns: FakeConn[] = [];
  constructor(
    readonly broker: FakeBroker,
    readonly id: string,
    readonly opts: PeerOptionsLike,
  ) {
    super();
    broker.created.push(this);
    setTimeout(() => this.register(), 1);
  }
  private register(): void {
    if (this.destroyed) return;
    if (!this.broker.reachable) {
      this.emit('error', { type: 'network' });
      this.destroy();
      return;
    }
    if (this.broker.ids.has(this.id)) {
      this.emit('error', { type: 'unavailable-id' });
      this.destroy();
      return;
    }
    this.broker.ids.set(this.id, this);
    this.emit('open', this.id);
  }
  connect(id: string): DataConnectionLike {
    const local = new FakeConn(id, this.broker);
    this.conns.push(local);
    setTimeout(() => {
      const target = this.broker.ids.get(id);
      if (!target) {
        this.emit('error', { type: 'peer-unavailable' });
        return;
      }
      if (target === 'squatter') return; // never answers
      if (target === 'zombie') {
        local.emit('iceStateChanged', 'checking');
        return;
      }
      const remote = new FakeConn(this.id, this.broker);
      target.conns.push(remote);
      local.other = remote;
      remote.other = local;
      target.emit('connection', remote);
      const mode = this.broker.answer;
      setTimeout(() => {
        if (mode === 'silent') return;
        if (mode === 'ice-fail') {
          local.emit('iceStateChanged', 'checking');
          local.emit('iceStateChanged', 'failed');
          local.emit('error', { type: 'negotiation-failed' });
          return;
        }
        if (local.closed || remote.closed) return;
        local.open = remote.open = true;
        remote.emit('open');
        local.emit('open');
      }, 1);
    }, 1);
    return local;
  }
  /** The broker connection drops (phone asleep). */
  loseBroker(): void {
    this.disconnected = true;
    if (this.broker.ids.get(this.id) === this) this.broker.ids.delete(this.id);
    this.emit('disconnected', this.id);
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.disconnected = true;
    if (this.broker.ids.get(this.id) === this) this.broker.ids.delete(this.id);
    for (const c of this.conns) c.close();
    this.emit('close');
  }
}

/* ---------------------------------------------------------------------------------------------- */

const CODE = 'K7QW2M';
const ID = anchorPeerId(CODE);
const ping: Message = { t: 'ping', v: 1 };

let broker: FakeBroker;
let win: EventTarget;
let doc: EventTarget & { visibilityState: DocumentVisibilityState };
const opened: PeerJsTransport[] = [];

/** Seeded PRNG (mulberry32), so dialer ids differ but runs repeat. */
function seeded(seed = 7): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function factory(extra: Partial<PeerJsOptions> = {}) {
  const f = createPeerJsFactory({
    Peer: broker.Peer,
    rng: seeded(),
    window: win,
    document: doc,
    ...extra,
  });
  return async (code = CODE) => {
    const t = await f(code);
    opened.push(t);
    return t;
  };
}

/** Starts a factory call and runs fake time until it resolves. */
async function connect(make: (code?: string) => Promise<PeerJsTransport>, code = CODE): Promise<PeerJsTransport> {
  const p = make(code);
  let done = false;
  void p.then(() => (done = true));
  for (let i = 0; i < 2000; i++) {
    await vi.advanceTimersByTimeAsync(0);
    if (done) return p;
    await vi.advanceTimersByTimeAsync(1);
  }
  throw new Error('factory did not resolve');
}

function record(t: PeerJsTransport) {
  const states: TransportState[] = [];
  const failures: string[] = [];
  const msgs: Message[] = [];
  const roles: string[] = [];
  t.onState((s) => states.push(s));
  t.onFailure((f) => failures.push(f));
  t.onMessage((m) => msgs.push(m));
  t.onRole((r) => roles.push(r));
  return { states, failures, msgs, roles };
}

beforeEach(() => {
  vi.useFakeTimers();
  broker = new FakeBroker();
  win = new EventTarget();
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
});
afterEach(() => {
  for (const t of opened.splice(0)) t.close();
  vi.useRealTimers();
});

describe('classifyPeerError', () => {
  it.each([
    ['unavailable-id', 'dial'],
    ['peer-unavailable', 'reclaim'],
    ['network', { fail: 'broker-unreachable' }],
    ['server-error', { fail: 'broker-unreachable' }],
    ['socket-error', { fail: 'broker-unreachable' }],
    ['socket-closed', { fail: 'broker-unreachable' }],
    ['ssl-unavailable', { fail: 'broker-unreachable' }],
    ['webrtc', { fail: 'ice-failed' }],
    ['browser-incompatible', { fail: 'ice-failed' }],
    ['something-new', { fail: 'broker-unreachable' }],
  ])('%s → %j', (type, action) => {
    expect(classifyPeerError(type)).toEqual(action);
  });
});

describe('PeerJS transport: anchor or dial (DESIGN 9.2)', () => {
  it('waits the random pre-delay, then claims zhess-<CODE> with STUN-only ICE', async () => {
    const make = factory({ rng: () => 0.8 });
    void make();
    await vi.advanceTimersByTimeAsync(399);
    expect(broker.created).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(broker.created).toHaveLength(1);
    const p = broker.created[0];
    expect(p.id).toBe('zhess-K7QW2M');
    expect(p.opts.config?.iceServers).toBe(ICE_SERVERS);
    const urls = ICE_SERVERS.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.startsWith('stun:'))).toBe(true);
    expect(p.opts.debug).toBe(0);
  });

  it('first device becomes the anchor and waits; the second dials; both open and exchange JSON', async () => {
    const make = factory();
    const a = await connect(make);
    expect(a.role).toBe('anchor');
    expect(a.state).toBe('connecting');
    expect(a.kind).toBe('peerjs');
    const ra = record(a);

    const b = await connect(make);
    expect(b.role).toBe('dialer');
    const rb = record(b);
    await vi.advanceTimersByTimeAsync(20);
    expect(a.state).toBe('open');
    expect(b.state).toBe('open');
    expect(ra.states).toEqual(['connecting', 'open']);

    // The dialer registered a random id of its own and dialled the anchor.
    const dialerPeer = broker.created[2];
    expect(dialerPeer.id).toMatch(/^zhess-K7QW2M-[0-9a-z]{10}$/);

    a.send(ping);
    b.send({ t: 'pong', v: 1 });
    await vi.advanceTimersByTimeAsync(5);
    expect(rb.msgs).toEqual([ping]);
    expect(ra.msgs).toEqual([{ t: 'pong', v: 1 }]);
  });

  it('the dialer uses a reliable JSON data connection', async () => {
    const make = factory();
    await connect(make);
    const spy = vi.spyOn(FakePeer.prototype, 'connect');
    await connect(make);
    await vi.advanceTimersByTimeAsync(20);
    expect(spy).toHaveBeenCalledWith(ID, { reliable: true, serialization: 'json' });
    spy.mockRestore();
  });

  it('drops data that is not a message, and sends while not open', async () => {
    const make = factory();
    const a = await connect(make);
    const b = await connect(make);
    await vi.advanceTimersByTimeAsync(20);
    const ra = record(a);
    const anchorConn = broker.created[0].conns[0];
    anchorConn.emit('data', 'not json');
    anchorConn.emit('data', { no: 't' });
    anchorConn.emit('data', [1, 2]);
    anchorConn.emit('data', JSON.stringify(ping));
    expect(ra.msgs).toEqual([ping]);
    b.close();
    expect(() => b.send(ping)).not.toThrow();
  });

  it('dial fails with peer-unavailable (the old anchor is gone): claims again and becomes the anchor', async () => {
    const make = factory({ rng: () => 0.5 });
    // A stale entry: the id looks taken at claim time but is gone when dialled.
    broker.ids.set(ID, 'squatter');
    const t = make();
    await vi.advanceTimersByTimeAsync(252); // pre-delay + unavailable-id
    broker.ids.delete(ID);
    const tr = await connect(() => t);
    const r = record(tr);
    expect(tr.role).toBe('dialer');
    await vi.advanceTimersByTimeAsync(600);
    expect(tr.role).toBe('anchor');
    expect(r.roles).toEqual(['dialer', 'anchor']);
    expect(tr.state).toBe('connecting');
    expect(r.failures).toEqual([]);
    expect(broker.ids.get(ID)).toBeInstanceOf(FakePeer);
  });

  it('when the anchor leaves, the dialer reports peer-gone, re-runs the procedure and becomes the anchor', async () => {
    const make = factory();
    const a = await connect(make);
    const b = await connect(make);
    await vi.advanceTimersByTimeAsync(20);
    const rb = record(b);
    a.close();
    expect(rb.failures).toEqual(['peer-gone']);
    expect(b.state).toBe('connecting');
    await vi.advanceTimersByTimeAsync(1000);
    expect(b.role).toBe('anchor');
    // A device returning now dials the new anchor.
    const c = await connect(make);
    expect(c.role).toBe('dialer');
    await vi.advanceTimersByTimeAsync(20);
    expect(b.state).toBe('open');
    expect(c.state).toBe('open');
    expect(rb.states).toEqual(['open', 'connecting', 'open']);
  });

  it('when the dialer leaves, the anchor keeps the id and waits for it to come back', async () => {
    const make = factory();
    const a = await connect(make);
    const b = await connect(make);
    await vi.advanceTimersByTimeAsync(20);
    const ra = record(a);
    const created = broker.created.length;
    b.close();
    expect(ra.failures).toEqual(['peer-gone']);
    expect(a.state).toBe('connecting');
    await vi.advanceTimersByTimeAsync(5000);
    expect(broker.created.length).toBe(created); // no new claim
    const b2 = await connect(make);
    await vi.advanceTimersByTimeAsync(20);
    expect(b2.state).toBe('open');
    expect(ra.states).toEqual(['open', 'connecting', 'open']);
  });

  it('newest connection wins at the anchor; the room sees a fresh channel', async () => {
    const make = factory();
    const a = await connect(make);
    const b = await connect(make);
    await vi.advanceTimersByTimeAsync(20);
    const ra = record(a);
    const rb = record(b);
    const c = await connect(make);
    await vi.advanceTimersByTimeAsync(20);
    expect(c.state).toBe('open');
    expect(a.state).toBe('open');
    expect(ra.states).toEqual(['open', 'connecting', 'open']);
    expect(rb.failures).toContain('peer-gone');
    const rc = record(c);
    a.send(ping);
    await vi.advanceTimersByTimeAsync(5);
    expect(rc.msgs).toEqual([ping]);
  });

  it('reconnect() starts over at once', async () => {
    const make = factory();
    const a = await connect(make);
    const b = await connect(make);
    await vi.advanceTimersByTimeAsync(20);
    const rb = record(b);
    b.reconnect();
    expect(b.state).toBe('connecting');
    await vi.advanceTimersByTimeAsync(400);
    expect(b.state).toBe('open');
    expect(a.state).toBe('open');
    expect(rb.states).toEqual(['open', 'connecting', 'open']);
  });

  it('close() is terminal: peer destroyed, listeners gone, no more attempts', async () => {
    const make = factory();
    const a = await connect(make);
    const ra = record(a);
    a.close();
    expect(ra.states).toEqual(['connecting', 'closed']);
    expect(broker.created[0].destroyed).toBe(true);
    const n = broker.created.length;
    win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(broker.created.length).toBe(n);
    a.reconnect();
    expect(a.state).toBe('closed');
  });
});

describe('PeerJS transport: failures and backoff (DESIGN 9.10)', () => {
  it('broker unreachable: failed, then retries after 1, 2, 4 … s, capped at 30 s', async () => {
    broker.reachable = false;
    const make = factory({ rng: () => 0 });
    const t0 = Date.now();
    const at = async (ms: number) => vi.advanceTimersByTimeAsync(t0 + ms - Date.now());
    const t = await connect(make);
    expect(t.state).toBe('failed');
    expect(t.failure).toBe('broker-unreachable');
    const r = record(t);
    const count = () => broker.created.length;
    // Attempt k (0-based) starts at about 1000 × (2^k − 1) ms (plus a few ms per failing attempt),
    // the wait capped at 30 s.
    const checks: [number, number][] = [
      [990, 1],
      [1050, 2],
      [2950, 2],
      [3050, 3],
      [6950, 3],
      [7050, 4],
      [15050, 5],
      [31050, 6],
      [60950, 6],
      [61050, 7],
      [90950, 7],
      [91100, 8],
    ];
    for (const [ms, n] of checks) {
      await at(ms);
      expect([ms, count()]).toEqual([ms, n]);
    }
    // The listener added after the first failure got 'failed' replayed, then seven more.
    expect(r.states.filter((s) => s === 'failed').length).toBe(8);
    expect(new Set(r.failures)).toEqual(new Set(['broker-unreachable']));
    expect(t.attempt).toBe(8);
  });

  it('a broker that never answers times out as broker-unreachable', async () => {
    const Silent = class {
      destroyed = false;
      disconnected = false;
      on() {}
      connect(): never {
        throw new Error('no');
      }
      destroy() {
        this.destroyed = true;
      }
    } as unknown as PeerCtor;
    const make = factory({ Peer: Silent, rng: () => 0, brokerTimeoutMs: 3000 });
    const p = make();
    await vi.advanceTimersByTimeAsync(2999);
    let done = false;
    void p.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const t = await p;
    expect(t.failure).toBe('broker-unreachable');
  });

  it('online resets the backoff and retries at once; focus and visibility retry at once', async () => {
    broker.reachable = false;
    const make = factory({ rng: () => 0 });
    const t = await connect(make);
    await vi.advanceTimersByTimeAsync(1001 + 2001 + 4001); // three retries, next wait is 8 s
    const n = broker.created.length;
    broker.reachable = true;
    win.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(2);
    expect(broker.created.length).toBe(n + 1);
    expect(t.role).toBe('anchor');
    expect(t.state).toBe('connecting');
    // Anchored and waiting: triggers do not restart a healthy anchor.
    win.dispatchEvent(new Event('focus'));
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(2);
    expect(broker.created.length).toBe(n + 1);

    t.reconnect(); // drop the claim
    broker.reachable = false;
    await vi.advanceTimersByTimeAsync(2);
    expect(t.state).toBe('failed');
    const m = broker.created.length;
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(2);
    expect(broker.created.length).toBe(m);
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(2);
    expect(broker.created.length).toBe(m + 1);

    await vi.advanceTimersByTimeAsync(2);
    expect(t.attempt).toBeGreaterThan(0);
    win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(2);
    expect(broker.created.length).toBe(m + 2);
    expect(t.attempt).toBe(1); // reset to 0, then one more failure
  });

  it('the anchor that loses the broker while waiting retries; with an open channel it plays on', async () => {
    const make = factory({ rng: () => 0 });
    const a = await connect(make);
    const ra = record(a);
    const anchorPeer = broker.created[0];
    anchorPeer.loseBroker();
    expect(a.state).toBe('failed');
    expect(ra.failures).toEqual(['broker-unreachable']);
    await vi.advanceTimersByTimeAsync(1001);
    expect(a.role).toBe('anchor');
    expect(a.state).toBe('connecting');

    const b = await connect(make);
    await vi.advanceTimersByTimeAsync(20);
    expect(b.state).toBe('open');
    const n = broker.created.length;
    broker.live().find((p) => p.id === ID)!.loseBroker();
    expect(a.state).toBe('open');
    await vi.advanceTimersByTimeAsync(5000);
    expect(a.state).toBe('open');
    expect(broker.created.length).toBe(n);
    // When the channel then closes, the anchor runs the procedure again.
    b.close();
    expect(a.state).toBe('connecting');
    await vi.advanceTimersByTimeAsync(5);
    expect(broker.created.length).toBe(n + 1);
  });

  it('id held but its holder never answers: id-taken after the dial timeout', async () => {
    broker.ids.set(ID, 'squatter');
    const make = factory({ rng: () => 0, dialTimeoutMs: 10_000 });
    const t = await connect(make);
    expect(t.role).toBe('dialer');
    const r = record(t);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(t.state).toBe('connecting');
    await vi.advanceTimersByTimeAsync(1_100);
    expect(t.state).toBe('failed');
    expect(r.failures).toEqual(['id-taken']);
    // It keeps trying with backoff.
    const n = broker.created.length;
    await vi.advanceTimersByTimeAsync(1_010);
    expect(broker.created.length).toBeGreaterThan(n);
  });

  it('a holder that reached ICE checking but never connects is ice-failed at the timeout', async () => {
    broker.ids.set(ID, 'zombie');
    const make = factory({ rng: () => 0, dialTimeoutMs: 5_000 });
    const t = await connect(make);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(t.failure).toBe('ice-failed');
  });

  it('ICE failure on the dial is classified ice-failed', async () => {
    const make = factory({ rng: () => 0 });
    await connect(make);
    broker.answer = 'ice-fail';
    const b = await connect(make);
    const r = record(b);
    await vi.advanceTimersByTimeAsync(10);
    expect(b.state).toBe('failed');
    expect(r.failures[0]).toBe('ice-failed');
  });

  it('the anchor ignores a failed incoming attempt and keeps waiting', async () => {
    const make = factory({ rng: () => 0 });
    const a = await connect(make);
    const ra = record(a);
    broker.answer = 'ice-fail';
    await connect(make);
    await vi.advanceTimersByTimeAsync(10);
    expect(a.state).toBe('connecting');
    expect(ra.failures).toEqual([]);
  });

  it('a flapping id (taken at claim, gone at dial) gives up after maxFlips with peer-gone', async () => {
    // Every claim sees the id taken; every dial finds nobody.
    const Flappy = class extends (broker.Peer as unknown as new (id: string, o: PeerOptionsLike) => FakePeer) {
      constructor(id: string, o: PeerOptionsLike) {
        super(id, o);
        if (id === ID) broker.ids.set(ID, 'squatter');
      }
      connect(id: string) {
        broker.ids.delete(ID);
        return super.connect(id);
      }
    } as unknown as PeerCtor;
    const make = factory({ Peer: Flappy, rng: () => 0, maxFlips: 2 });
    const t = await connect(make);
    const r = record(t);
    await vi.advanceTimersByTimeAsync(40);
    expect(t.state).toBe('failed');
    expect(r.failures).toEqual(['peer-gone']);
  });

  it('an open channel lost through ICE failure reports peer-gone and reconnects', async () => {
    const make = factory({ rng: () => 0 });
    const a = await connect(make);
    const b = await connect(make);
    await vi.advanceTimersByTimeAsync(20);
    const rb = record(b);
    const dialerConn = broker.created[2].conns[0];
    dialerConn.emit('iceStateChanged', 'disconnected'); // transient: ignored
    expect(b.state).toBe('open');
    dialerConn.emit('iceStateChanged', 'failed');
    expect(rb.failures).toEqual(['peer-gone']);
    expect(b.state).toBe('connecting');
    await vi.advanceTimersByTimeAsync(50);
    expect(b.state).toBe('open');
    expect(a.state).toBe('open');
  });

  it('createPeerJsFactory returns a TransportFactory', () => {
    const f: TransportFactory = createPeerJsFactory({ Peer: broker.Peer });
    expect(typeof f).toBe('function');
  });

  it('works with codes of other rooms independently', async () => {
    const make = factory({ rng: () => 0 });
    const a = await connect(make, 'AAA');
    const b = await connect(make, 'BBB');
    expect(a.role).toBe('anchor');
    expect(b.role).toBe('anchor');
    expect(a.code).toBe('AAA');
  });
});
