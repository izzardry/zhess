/**
 * Room session (useRoom's engine) over the memory transport on fake time (PLAN 7): tab guard,
 * transports and the manual fallback, the 10-second rule, turn banking, notices.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRoomController, type RoomControllerApi, type RoomControllerOptions } from '@/lib/room';
import { createHarness, seeded, type Harness } from '@/lib/room/testkit';
import { createStore, memoryStorage } from '@/lib/storage';
import { createMemoryPair, ManualError, type MemoryPair, type RoomTransport, type TransportFailureKind, type TransportRole } from '@/lib/transport';
import type { Message, RoomNotice, Store, Transport, TransportFactory, TransportState } from '@/lib/types';
import {
  bankRoomTurn,
  createRoomSession,
  MANUAL_FALLBACK_MS,
  ROOM_TURN_KEY,
  roomLockName,
  takeBankedTurn,
  type LockManagerLike,
  type ManualApi,
  type RoomSession,
  type RoomSessionOptions,
  type TurnStorage,
} from './useRoom';

/* ---------------------------------------------------------------------------------------------- */
/* Fakes                                                                                            */
/* ---------------------------------------------------------------------------------------------- */

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

/** Web Locks with exclusive locks, `ifAvailable`, `steal` and `signal`, as the spec describes them. */
class FakeLocks implements LockManagerLike {
  private seq = 0;
  readonly held = new Map<string, { id: number; reject: (e: unknown) => void }>();
  private readonly queue = new Map<string, { start: () => void; abort: () => void }[]>();
  readonly calls: { name: string; options: Record<string, unknown> }[] = [];

  request(name: string, options: { ifAvailable?: boolean; steal?: boolean; signal?: AbortSignal }, cb: (lock: unknown) => unknown): Promise<unknown> {
    this.calls.push({ name, options: { ...options } });
    return new Promise((resolve, reject) => {
      const run = () => {
        const id = ++this.seq;
        this.held.set(name, { id, reject });
        Promise.resolve()
          .then(() => cb({ name, mode: 'exclusive' }))
          .then(
            (v) => {
              if (this.held.get(name)?.id !== id) return;
              this.held.delete(name);
              resolve(v);
              this.pump(name);
            },
            (e) => {
              if (this.held.get(name)?.id !== id) return;
              this.held.delete(name);
              reject(e);
              this.pump(name);
            },
          );
      };
      if (options.steal) {
        const h = this.held.get(name);
        if (h) {
          this.held.delete(name);
          h.reject(abortError());
        }
        run();
        return;
      }
      const q = this.queue.get(name) ?? [];
      this.queue.set(name, q);
      if (!this.held.has(name) && q.length === 0) {
        run();
        return;
      }
      if (options.ifAvailable) {
        Promise.resolve()
          .then(() => cb(null))
          .then(resolve, reject);
        return;
      }
      const entry = { start: run, abort: () => reject(abortError()) };
      q.push(entry);
      options.signal?.addEventListener('abort', () => {
        const i = q.indexOf(entry);
        if (i >= 0) {
          q.splice(i, 1);
          entry.abort();
        }
      });
    });
  }

  private pump(name: string): void {
    const q = this.queue.get(name);
    if (!this.held.has(name) && q && q.length) q.shift()!.start();
  }

  waiting(name: string): number {
    return this.queue.get(name)?.length ?? 0;
  }
}

/** A hand-driven RoomTransport for the 10-second rule. */
class FakeTransport implements RoomTransport {
  readonly kind = 'memory' as const;
  state: TransportState = 'connecting';
  failure: TransportFailureKind | null = null;
  closed = 0;
  private stateCbs = new Set<(s: TransportState) => void>();
  private failCbs = new Set<(f: TransportFailureKind) => void>();
  private roleCbs = new Set<(r: TransportRole) => void>();
  constructor(public role: TransportRole) {}
  send(_m: Message): void {}
  onMessage(): () => void {
    return () => {};
  }
  onState(cb: (s: TransportState) => void): () => void {
    this.stateCbs.add(cb);
    cb(this.state);
    return () => this.stateCbs.delete(cb);
  }
  onFailure(cb: (f: TransportFailureKind) => void): () => void {
    this.failCbs.add(cb);
    return () => this.failCbs.delete(cb);
  }
  onRole(cb: (r: TransportRole) => void): () => void {
    this.roleCbs.add(cb);
    cb(this.role);
    return () => this.roleCbs.delete(cb);
  }
  reconnect(): void {}
  close(): void {
    this.closed++;
    this.setState('closed');
  }
  setState(s: TransportState): void {
    this.state = s;
    for (const cb of [...this.stateCbs]) cb(s);
  }
  setRole(r: TransportRole): void {
    this.role = r;
    for (const cb of [...this.roleCbs]) cb(r);
  }
  fail(f: TransportFailureKind): void {
    this.failure = f;
    for (const cb of [...this.failCbs]) cb(f);
    this.setState('failed');
  }
}

const macrotask = () => new Promise<void>((r) => setTimeout(r, 0));

interface Rig {
  h: Harness;
  sessions: RoomSession[];
  session(opts?: Partial<RoomSessionOptions> & { store?: Store }): RoomSession;
  settle(): Promise<void>;
  advance(ms: number): Promise<void>;
  newStore(): Store;
}

function rig(): Rig {
  const h = createHarness();
  const sessions: RoomSession[] = [];
  let seed = 11;
  const settle = async () => {
    let quiet = 0;
    for (let i = 0; i < 2000; i++) {
      const ran = h.time.runDue();
      await Promise.all([...h.devices.map((d) => d.ctrl.idle()), ...sessions.map((s) => s.controller?.idle())]);
      await macrotask();
      if (!ran && !h.time.hasDue()) {
        if (++quiet >= 3) return;
      } else quiet = 0;
    }
    throw new Error('did not settle');
  };
  return {
    h,
    sessions,
    newStore: () => createStore(memoryStorage()),
    session: (opts = {}) => {
      const s = createRoomSession({
        code: h.code,
        store: opts.store ?? createStore(memoryStorage()),
        broker: h.net.factory,
        locks: null,
        now: h.time.now,
        wallNow: h.time.wall,
        timers: h.time,
        rng: seeded(seed++ * 104729),
        turnStorage: null,
        window: null,
        document: null,
        manualEnabled: true,
        ...opts,
      });
      sessions.push(s);
      return s;
    },
    settle,
    advance: async (ms: number) => {
      const target = h.time.t + ms;
      await settle();
      for (;;) {
        const next = h.time.nextAt();
        if (next === null || next > target) break;
        h.time.t = Math.max(h.time.t, next);
        await settle();
      }
      h.time.t = target;
      await settle();
    },
  };
}

/** Manual signalling over memory pairs: the "offer" is a pair; the guest end connects to it. */
function fakeManual(time: Harness['time']) {
  const pairs: MemoryPair[] = [];
  const answered: string[] = [];
  const handOvers: string[] = [];
  let handOverResult = true;
  let hostError: Error | null = null;
  const api: ManualApi = {
    startHost: async (code) => {
      if (hostError) throw hostError;
      const pair = createMemoryPair({ timers: time, open: false });
      pairs.push(pair);
      const n = pairs.length;
      return {
        transport: pair.a as never,
        offer: `OFFER${n}`,
        link: `https://zhess.test/#/?s=${code}&o=r&x=OFFER${n}`,
        acceptAnswer: async (text: string) => {
          if (!text.includes(`ANSWER${n}`)) throw new ManualError(text.includes('x=') ? 'wrong-kind' : 'invalid');
          answered.push(text);
        },
      };
    },
    answerOffer: async (code, offer) => {
      const pair = createMemoryPair({ timers: time, open: false });
      pairs.push(pair);
      if (offer === 'BROKEN') throw new ManualError('invalid');
      return { transport: pair.b as never, answer: `ANS-${offer}`, link: `https://zhess.test/#/?s=${code}&o=r&y=ANS-${offer}` };
    },
    handOver: async (_code, answer) => {
      handOvers.push(answer);
      return handOverResult;
    },
    answerLink: (code, answer) => `https://zhess.test/#/?s=${code}&o=r&y=${answer}`,
  };
  return {
    api,
    pairs,
    answered,
    handOvers,
    setHandOver: (ok: boolean) => {
      handOverResult = ok;
    },
    setHostError: (e: Error | null) => {
      hostError = e;
    },
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* Helpers                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

describe('room helpers', () => {
  it('names the room lock', () => {
    expect(roomLockName('K7QW2M')).toBe('zhess:room:K7QW2M');
  });

  it('banks and takes back the running turn once, for the same code and while fresh', () => {
    const s = memoryStorage();
    const wall = () => 1_000_000;
    bankRoomTurn(s, { code: 'AB12', n: 2, epoch: 1, len: 7, ms: 4321.6, at: 999_000 });
    expect(takeBankedTurn('ZZZZ', s, wall)).toBeNull();
    expect(takeBankedTurn('AB12', s, wall)).toEqual({ n: 2, epoch: 1, len: 7, ms: 4322 });
    expect(takeBankedTurn('AB12', s, wall)).toBeNull(); // used once
    bankRoomTurn(s, { code: 'AB12', n: 2, epoch: 1, len: 7, ms: 500, at: 1_000_000 - 13 * 3600_000 });
    expect(takeBankedTurn('AB12', s, wall)).toBeNull(); // too old
    s.setItem(ROOM_TURN_KEY, '{nonsense');
    expect(takeBankedTurn('AB12', s, wall)).toBeNull();
    expect(takeBankedTurn('AB12', null, wall)).toBeNull();
    const throwing: TurnStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    };
    expect(() => bankRoomTurn(throwing, { code: 'A', n: 1, epoch: 0, len: 0, ms: 1, at: 0 })).not.toThrow();
    expect(takeBankedTurn('A', throwing, wall)).toBeNull();
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Owner sessions over the broker                                                                   */
/* ---------------------------------------------------------------------------------------------- */

describe('room session · broker', () => {
  it('creates, invites and plays: two devices meet over the broker transport', async () => {
    const r = rig();
    const a = r.session({ create: { tc: null, color: 'w' } });
    await r.settle();
    expect(a.view.tab).toBe('owner');
    expect(a.view.guarded).toBe(false);
    expect(a.view.state?.seat).toBe(0);
    expect(a.view.state?.presence).toBe('waiting');
    expect(a.view.via).toBe('broker');
    // Waiting peacefully as the anchor is no failure: no manual offer, even after a while.
    await r.advance(MANUAL_FALLBACK_MS * 2);
    expect(a.view.manualCause).toBeNull();

    const b = r.session();
    await r.settle();
    expect(a.view.state?.live).toBe(true);
    expect(b.view.state?.live).toBe(true);
    expect(b.view.state?.seat).toBe(1);
    expect(b.view.state?.color).toBe('b');

    expect(a.controller?.move('e2e4')).toBe(true);
    await r.settle();
    expect(b.view.state?.game.plies.map((p) => p.m)).toEqual(['e2e4']);

    expect(b.controller?.resign()).toBe(true);
    await r.settle();
    expect(a.view.score).toEqual([1, 0]);
    expect(b.view.score).toEqual([0, 1]);
  });

  it('keeps the view object stable while nothing changes (useSyncExternalStore contract)', async () => {
    const r = rig();
    const a = r.session({ create: { tc: null, color: 'w' } });
    await r.settle();
    const v1 = a.view;
    const listener = vi.fn();
    a.subscribe(listener);
    await r.advance(1000);
    expect(a.view).toBe(v1);
    expect(Object.isFrozen(v1)).toBe(true);
  });

  it('forwards notices of the current controller and stops after dispose', async () => {
    const r = rig();
    const a = r.session({ create: { tc: null, color: 'w' } });
    const seen: RoomNotice[] = [];
    a.onNotice((n) => seen.push(n));
    await r.settle();
    r.session();
    await r.settle();
    expect(seen.map((n) => n.kind)).toContain('opponent-joined');
    const created = r.h.net.created.length;
    a.dispose();
    await r.settle();
    expect(a.controller).toBeNull();
    // The transport is closed, the other device sees the opponent leave.
    expect(r.h.net.created.slice(0, created).some((t) => t.state === 'closed')).toBe(true);
    expect(r.sessions[1].view.state?.presence).toBe('reconnecting');
    a.dispose(); // idempotent
  });

  it('runs the room without a broker: the manual exchange is offered at once', async () => {
    const r = rig();
    const a = r.session({ broker: null, create: { tc: null, color: 'w' } });
    await r.settle();
    expect(a.view.via).toBeNull();
    expect(a.view.manualCause).toBe('no-broker');
    const off = r.session({ broker: null, manualEnabled: false });
    await r.settle();
    expect(off.view.manualCause).toBeNull();
  });

  it('offers the manual exchange at once when the broker is unreachable', async () => {
    const r = rig();
    const factory: TransportFactory = () => Promise.reject(new Error('down'));
    const a = r.session({ broker: factory, create: { tc: null, color: 'w' } });
    await r.settle();
    expect(a.view.manualCause).toBe('broker-unreachable');
  });

  it('follows a broker transport that reports the broker unreachable or ICE failure', async () => {
    const r = rig();
    const t = new FakeTransport('anchor');
    const a = r.session({ broker: async () => t, create: { tc: null, color: 'w' } });
    await r.settle();
    expect(a.view.manualCause).toBeNull();
    t.fail('broker-unreachable');
    await r.settle();
    expect(a.view.manualCause).toBe('broker-unreachable');

    const t2 = new FakeTransport('dialer');
    const b = r.session({ broker: async () => t2 });
    await r.settle();
    t2.fail('ice-failed');
    await r.settle();
    expect(b.view.manualCause).toBe('ice-failed');
  });

  it('applies the 10-second rule to a dial that never connects', async () => {
    const r = rig();
    const t = new FakeTransport('dialer');
    const a = r.session({ broker: async () => t });
    await r.settle();
    expect(a.view.manualCause).toBeNull();
    await r.advance(MANUAL_FALLBACK_MS - 1);
    expect(a.view.manualCause).toBeNull();
    await r.advance(1);
    expect(a.view.manualCause).toBe('timeout');
    // A role flip to a waiting anchor ends the trouble; a dial again restarts the 10 s.
    t.setRole('anchor');
    await r.settle();
    expect(a.view.manualCause).toBeNull();
    t.setRole('dialer');
    await r.advance(MANUAL_FALLBACK_MS / 2);
    expect(a.view.manualCause).toBeNull();
    await r.advance(MANUAL_FALLBACK_MS / 2);
    expect(a.view.manualCause).toBe('timeout');
  });

  it('counts a factory that has not answered yet as failing signalling', async () => {
    const r = rig();
    const a = r.session({ broker: () => new Promise<Transport>(() => {}) });
    await r.advance(MANUAL_FALLBACK_MS);
    expect(a.view.manualCause).toBe('timeout');
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Tab guard (DESIGN 9.12)                                                                          */
/* ---------------------------------------------------------------------------------------------- */

describe('room session · tab guard', () => {
  it('a second tab on the same room is read-only, takes over, and the first turns read-only', async () => {
    const r = rig();
    const locks = new FakeLocks();
    const store = r.newStore();
    const one = r.session({ store, locks, create: { tc: null, color: 'w' } });
    expect(one.view.tab).toBe('pending');
    await r.settle();
    expect(one.view.tab).toBe('owner');
    expect(one.view.guarded).toBe(true);
    expect(locks.held.has('zhess:room:K7QW2M')).toBe(true);
    const transports = r.h.net.created.length;
    expect(transports).toBe(1);

    const two = r.session({ store, locks, create: { tc: null, color: 'w' } });
    await r.settle();
    expect(two.view.tab).toBe('other');
    expect(two.view.state?.locked).toBe('other-tab');
    expect(two.view.state?.phase).toBe('read-only');
    expect(two.view.state?.seat).toBe(0); // loaded from the shared store
    expect(two.view.via).toBeNull();
    expect(r.h.net.created.length).toBe(transports); // the second tab never connects
    expect(locks.waiting('zhess:room:K7QW2M')).toBe(1); // waits for the first tab

    two.takeOver();
    await r.settle();
    expect(two.view.tab).toBe('owner');
    expect(two.view.state?.locked).toBeNull();
    expect(two.view.via).toBe('broker');
    expect(one.view.tab).toBe('other');
    expect(one.view.state?.phase).toBe('read-only');
    expect(r.h.net.created[0].state).toBe('closed');
    expect(one.view.manualCause).toBeNull();

    // takeOver does nothing for the owner.
    two.takeOver();
    await r.settle();
    expect(two.view.tab).toBe('owner');
  });

  it('a waiting tab takes the room over by itself when the owning tab closes', async () => {
    const r = rig();
    const locks = new FakeLocks();
    const store = r.newStore();
    const one = r.session({ store, locks, create: { tc: null, color: 'w' } });
    await r.settle();
    const two = r.session({ store, locks });
    await r.settle();
    expect(two.view.tab).toBe('other');
    one.dispose();
    await r.settle();
    expect(two.view.tab).toBe('owner');
    expect(two.view.state?.seat).toBe(0);
    expect(two.view.via).toBe('broker');
    two.dispose();
    await r.settle();
    expect(locks.held.size).toBe(0);
  });

  it('owns the room without Web Locks, or when the lock manager throws', async () => {
    const r = rig();
    const a = r.session({ locks: null, create: { tc: null, color: 'w' } });
    expect(a.view.tab).toBe('owner');
    const throwing: LockManagerLike = {
      request: () => {
        throw new Error('SecurityError');
      },
    };
    const b = r.session({ locks: throwing });
    expect(b.view.tab).toBe('owner');
    const rejecting: LockManagerLike = { request: () => Promise.reject(new Error('InvalidStateError')) };
    const c = r.session({ locks: rejecting });
    await r.settle();
    expect(c.view.tab).toBe('owner');
  });

  it('falls back to no guard where navigator.locks is missing (jsdom)', async () => {
    const r = rig();
    const a = r.session({ locks: undefined, create: { tc: null, color: 'w' } });
    expect(a.view.tab).toBe('owner');
    expect(a.view.guarded).toBe(false);
  });

  it('the read-only tab follows the owner tab through storage events', async () => {
    const r = rig();
    const locks = new FakeLocks();
    const storage = memoryStorage();
    const store = createStore(storage);
    const win = new EventTarget();
    r.session({ store, locks, create: { tc: null, color: 'w' } });
    await r.settle();
    const two = r.session({ store, locks, window: win });
    await r.settle();
    expect(two.view.tab).toBe('other');
    r.session({ store: r.newStore() }); // the opponent joins the first tab
    await r.settle();
    expect(r.sessions[0].controller?.move('d2d4')).toBe(true);
    await r.settle();
    expect(two.view.state?.game.plies.length).toBe(0); // no event yet
    const ev = Object.assign(new Event('storage'), { key: 'zhess:games' });
    win.dispatchEvent(ev);
    expect(two.view.state?.game.plies.map((p) => p.m)).toEqual(['d2d4']);
    expect(two.view.state?.locked).toBe('other-tab');
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Manual fallback (DESIGN 9.9)                                                                     */
/* ---------------------------------------------------------------------------------------------- */

describe('room session · manual connection', () => {
  it('host: offer, bad paste, good paste, the channel opens and replaces the broker', async () => {
    const r = rig();
    const m = fakeManual(r.h.time);
    const brokerT = new FakeTransport('dialer');
    const host = r.session({ broker: async () => brokerT, manualApi: m.api, create: { tc: null, color: 'w' } });
    await r.settle();
    host.openManual();
    expect(host.view.manual.step).toBe('preparing');
    expect(host.view.manual.role).toBe('host');
    await r.settle();
    expect(host.view.manual.step).toBe('offer');
    expect(host.view.manual.link).toContain('x=OFFER1');
    host.openManual(); // already running: the same offer stays
    await r.settle();
    expect(m.pairs).toHaveLength(1);

    expect(await host.acceptAnswer('garbage')).toBe('invalid');
    expect(host.view.manual.step).toBe('offer');
    expect(host.view.manual.error).toBe('invalid');
    expect(await host.acceptAnswer('https://zhess.test/#/?s=K7QW2M&o=r&x=OFFER1')).toBe('wrong-kind');
    expect(await host.acceptAnswer('https://zhess.test/#/?s=K7QW2M&o=r&y=ANSWER1')).toBeNull();
    expect(host.view.manual.step).toBe('connecting');
    expect(host.view.manual.error).toBeNull();
    expect(await host.acceptAnswer('again')).toBe('used');

    // The opponent sits on the other end of the manual channel.
    r.h.deviceOn('guest', m.pairs[0].b);
    m.pairs[0].reconnect(); // the channel opens
    await r.settle();
    expect(host.view.manual.step).toBe('connected');
    expect(host.view.via).toBe('manual');
    expect(brokerT.closed).toBe(1);
    expect(host.view.state?.live).toBe(true);
    expect(host.view.manualCause).toBeNull();
    expect(r.h.devices[0].ctrl.snapshot.seat).toBe(1);

    // Closing the sheet keeps the open channel.
    host.closeManual();
    await r.settle();
    expect(host.view.manual.step).toBe('idle');
    expect(host.view.state?.live).toBe(true);
  });

  it('falls back to the broker when the manual channel is lost', async () => {
    const r = rig();
    const m = fakeManual(r.h.time);
    let calls = 0;
    const host = r.session({
      broker: async () => {
        calls++;
        return new FakeTransport('anchor');
      },
      manualApi: m.api,
      create: { tc: null, color: 'w' },
    });
    await r.settle();
    expect(calls).toBe(1);
    host.openManual();
    await r.settle();
    r.h.deviceOn('guest', m.pairs[0].b);
    m.pairs[0].reconnect();
    await r.settle();
    expect(host.view.via).toBe('manual');
    m.pairs[0].a.close(); // single-use channel gone
    await r.settle();
    expect(calls).toBe(2);
    expect(host.view.via).toBe('broker');
    expect(host.view.manual.step).toBe('idle');
    expect(host.view.state?.live).toBe(false);
  });

  it('guest: an offer link answers at once, removes x from the address bar and connects', async () => {
    const r = rig();
    const m = fakeManual(r.h.time);
    const used = vi.fn();
    const guest = r.session({ broker: null, manualApi: m.api, offer: 'OFFER9', onSignalUsed: used });
    await r.settle();
    expect(guest.view.manual.step).toBe('answer');
    expect(guest.view.manual.role).toBe('guest');
    expect(guest.view.manual.link).toContain('y=ANS-OFFER9');
    expect(used).toHaveBeenCalledTimes(1);
    // The same x again (the hook re-sends it) is ignored.
    guest.signal({ offer: 'OFFER9' });
    await r.settle();
    expect(m.pairs).toHaveLength(1);

    const creator = r.h.deviceOn('creator', m.pairs[0].a, { create: { tc: null, color: 'w' } });
    m.pairs[0].reconnect();
    await r.settle();
    expect(guest.view.manual.step).toBe('connected');
    expect(guest.view.state?.live).toBe(true);
    expect(guest.view.state?.seat).toBe(1);
    expect(creator.ctrl.snapshot.live).toBe(true);
  });

  it('guest: a broken offer shows the problem and still clears x', async () => {
    const r = rig();
    const m = fakeManual(r.h.time);
    const used = vi.fn();
    const guest = r.session({ broker: null, manualApi: m.api, offer: 'BROKEN', onSignalUsed: used });
    await r.settle();
    expect(guest.view.manual.step).toBe('error');
    expect(guest.view.manual.error).toBe('invalid');
    expect(used).toHaveBeenCalledTimes(1);
  });

  it('guest: an offer that arrives while another tab owns the room waits for the lock', async () => {
    const r = rig();
    const m = fakeManual(r.h.time);
    const locks = new FakeLocks();
    const store = r.newStore();
    const one = r.session({ store, locks, broker: null, manualApi: m.api });
    await r.settle();
    const two = r.session({ store, locks, broker: null, manualApi: m.api, offer: 'OFFER5' });
    await r.settle();
    expect(two.view.tab).toBe('other');
    expect(m.pairs).toHaveLength(0);
    one.dispose();
    await r.settle();
    expect(two.view.tab).toBe('owner');
    expect(two.view.manual.step).toBe('answer');
  });

  it('hand-over: a tab opened from an answer link passes it on and stays passive', async () => {
    const r = rig();
    const m = fakeManual(r.h.time);
    const used = vi.fn();
    const locks = new FakeLocks();
    const brokerCalls = vi.fn(async () => new FakeTransport('anchor'));
    const tab = r.session({ broker: brokerCalls, locks, manualApi: m.api, answer: 'ANS-OFFER1', onSignalUsed: used });
    expect(tab.view.tab).toBe('handover');
    expect(tab.view.manual.step).toBe('handover');
    expect(tab.view.manual.handedOver).toBeNull();
    expect(tab.view.manual.link).toContain('y=ANS-OFFER1');
    await r.settle();
    expect(tab.view.manual.handedOver).toBe(true);
    expect(m.handOvers).toEqual(['ANS-OFFER1']);
    expect(used).toHaveBeenCalledTimes(1);
    expect(brokerCalls).not.toHaveBeenCalled();
    expect(locks.calls).toHaveLength(0);
    expect(tab.view.state?.phase).toBe('read-only');
    tab.openManual(); // passive: nothing
    expect(tab.view.manual.step).toBe('handover');

    m.setHandOver(false);
    const lonely = r.session({ broker: null, manualApi: m.api, answer: 'ANS-OFFER2' });
    await r.settle();
    expect(lonely.view.manual.handedOver).toBe(false);
  });

  it('hand-over through a real BroadcastChannel to a waiting tab (same device)', async () => {
    const r = rig();
    const waiting = new BroadcastChannel('zhess:manual:K7QW2M');
    const got: unknown[] = [];
    waiting.onmessage = (e: MessageEvent) => {
      got.push(e.data);
      const m = e.data as { t: string; id: string };
      if (m.t === 'answer') waiting.postMessage({ t: 'took', id: m.id });
    };
    try {
      const used = vi.fn();
      const tab = r.session({ broker: null, answer: 'ANSWER_VALUE_0123456789', onSignalUsed: used });
      await vi.waitFor(() => expect(tab.view.manual.handedOver).toBe(true), { timeout: 1000 });
      expect(got).toEqual([expect.objectContaining({ t: 'answer', answer: 'ANSWER_VALUE_0123456789' })]);
      expect(used).toHaveBeenCalledTimes(1);
      expect(tab.view.manual.link).toMatch(/#\/\?s=K7QW2M&o=r&y=ANSWER_VALUE_0123456789$/);
    } finally {
      waiting.close();
    }
  });

  it('an answer link that reaches the hosting tab itself is applied directly', async () => {
    const r = rig();
    const m = fakeManual(r.h.time);
    const used = vi.fn();
    const host = r.session({ broker: null, manualApi: m.api, create: { tc: null, color: 'w' }, onSignalUsed: used });
    host.openManual();
    await r.settle();
    host.signal({ answer: 'ANSWER1' });
    await r.settle();
    expect(m.answered).toEqual(['ANSWER1']);
    expect(host.view.manual.step).toBe('connecting');
    expect(used).toHaveBeenCalledTimes(1);
    expect(m.handOvers).toEqual([]);
  });

  it('start over, a failing host, and an exchange whose ICE fails', async () => {
    const r = rig();
    const m = fakeManual(r.h.time);
    const host = r.session({ broker: null, manualApi: m.api, create: { tc: null, color: 'w' } });
    host.openManual();
    await r.settle();
    host.restartManual();
    await r.settle();
    expect(m.pairs).toHaveLength(2);
    expect(m.pairs[0].a.state).toBe('closed'); // the old offer is dropped
    expect(host.view.manual.link).toContain('OFFER2');

    m.pairs[1].fail('a', 'ice-failed');
    await r.settle();
    expect(host.view.manual.step).toBe('error');
    expect(host.view.manual.error).toBe('ice-failed');

    m.setHostError(new ManualError('webrtc'));
    host.openManual();
    await r.settle();
    expect(host.view.manual.step).toBe('error');
    expect(host.view.manual.error).toBe('webrtc');
    m.setHostError(new Error('weird'));
    host.restartManual();
    await r.settle();
    expect(host.view.manual.error).toBe('webrtc');
  });

  it('closing the sheet drops a pending exchange; a broker win drops it too', async () => {
    const r = rig();
    const m = fakeManual(r.h.time);
    const host = r.session({ manualApi: m.api, create: { tc: null, color: 'w' } });
    host.openManual();
    await r.settle();
    host.closeManual();
    await r.settle();
    expect(host.view.manual.step).toBe('idle');
    expect(m.pairs[0].a.state).toBe('closed');

    host.openManual();
    await r.settle();
    expect(host.view.manual.step).toBe('offer');
    r.session(); // the opponent arrives through the broker first
    await r.settle();
    expect(host.view.state?.live).toBe(true);
    expect(host.view.manual.step).toBe('idle');
    expect(m.pairs[1].a.state).toBe('closed');
    expect(host.view.via).toBe('broker');
  });

  it('does nothing manual when the fallback is switched off or the tab is not the owner', async () => {
    const r = rig();
    const m = fakeManual(r.h.time);
    const a = r.session({ manualEnabled: false, manualApi: m.api, offer: 'OFFER1', onSignalUsed: vi.fn() });
    a.openManual();
    await r.settle();
    expect(a.view.manual.step).toBe('idle');
    expect(m.pairs).toHaveLength(0);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Turn banking (DESIGN 9.8)                                                                        */
/* ---------------------------------------------------------------------------------------------- */

describe('room session · turn banking', () => {
  it('banks the own running turn on pagehide and hands it back after a reload', async () => {
    const r = rig();
    const turnStorage = memoryStorage();
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const storeA = r.newStore();
    const a = r.session({ store: storeA, create: { tc: '5+0', color: 'w' }, turnStorage, window: win, document: doc });
    r.session({ store: r.newStore() });
    await r.settle();
    expect(a.view.state?.live).toBe(true);
    // Both first moves are untimed; then white's clock runs.
    a.controller!.move('e2e4');
    await r.settle();
    r.sessions[1].controller!.move('e7e5');
    await r.settle();
    await r.advance(7000);
    expect(a.controller!.elapsed()).toBe(7000);

    win.dispatchEvent(new Event('pagehide'));
    const banked = JSON.parse(turnStorage.getItem(ROOM_TURN_KEY)!);
    expect(banked).toMatchObject({ code: 'K7QW2M', n: 1, epoch: 0, len: 2, ms: 7000 });

    // Not this device's turn: nothing banked.
    turnStorage.removeItem(ROOM_TURN_KEY);
    r.sessions[1].dispose();
    await r.settle();

    // A hidden tab banks too.
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(turnStorage.getItem(ROOM_TURN_KEY)).not.toBeNull();

    // Reload: the new session hands the banked time to its controller.
    const seen: RoomControllerOptions[] = [];
    a.dispose();
    const again = r.session({
      store: storeA,
      turnStorage,
      createController: (o) => {
        seen.push(o);
        return createRoomController(o);
      },
    });
    await r.settle();
    expect(again.view.tab).toBe('owner');
    const owner = seen.find((o) => !o.readOnly)!;
    expect(owner.initialTurn).toMatchObject({ n: 1, epoch: 0, len: 2 });
    expect(owner.initialTurn!.ms).toBeGreaterThanOrEqual(7000);
    expect(turnStorage.getItem(ROOM_TURN_KEY)).toBeNull();
  });

  it('does not bank when it is the opponent to move', async () => {
    const r = rig();
    const turnStorage = memoryStorage();
    const a = r.session({ create: { tc: null, color: 'b' }, turnStorage });
    r.session();
    await r.settle();
    await r.advance(3000);
    a.bank();
    expect(turnStorage.getItem(ROOM_TURN_KEY)).toBeNull();
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Controller injection                                                                             */
/* ---------------------------------------------------------------------------------------------- */

describe('room session · controller factory', () => {
  it('passes code, store, clocks, create and read-only to the controller it makes', async () => {
    const r = rig();
    const seen: RoomControllerOptions[] = [];
    const store = r.newStore();
    const make = (o: RoomControllerOptions): RoomControllerApi => {
      seen.push(o);
      return createRoomController(o);
    };
    const locks = new FakeLocks();
    r.session({ store, locks, createController: make, create: { tc: '3+2', color: 'random' }, controllerOptions: { pingMs: 1234 } });
    await r.settle();
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ code: 'K7QW2M', readOnly: true, create: null, pingMs: 1234 });
    expect(seen[1]).toMatchObject({ code: 'K7QW2M', readOnly: false, create: { tc: '3+2', color: 'random' }, pingMs: 1234 });
    expect(seen[1].store).toBe(store);
    expect(seen[1].now).toBe(r.h.time.now);
    expect(seen[1].timers).toBe(r.h.time);
  });
});
