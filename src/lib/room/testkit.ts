/**
 * Test kit for the room controller: deterministic time and timers, seeded randomness, and a
 * harness that runs several devices over 3B's memory network (PLAN 7: room logic is tested only
 * over the memory transport). Used by tests only; never imported by the app.
 */
import type { Message, RoomNotice, Rng, Store } from '../types';
import { createStore, memoryStorage, type StorageLike } from '../storage';
import type { Timers } from '../transport/common';
import { createMemoryNetwork, createMemoryPair, type MemoryNetwork, type MemoryOptions, type MemoryPair, type MemoryTransport } from '../transport/memory';
import { createRoomController } from './controller';
import type { RoomControllerApi, RoomControllerOptions } from './types';

/** Wall-clock origin of the fake time (stored stamps are `WALL0 + t`). */
export const WALL0 = 1_700_000_000_000;

/** Fake monotonic time with a timer queue. Nothing runs until `runDue()`. */
export class FakeTime implements Timers {
  t = 0;
  private seq = 0;
  private q: { id: number; at: number; fn: () => void }[] = [];

  readonly now = (): number => this.t;
  readonly wall = (): number => WALL0 + this.t;

  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.q.push({ id, at: this.t + Math.max(0, Number.isFinite(ms) ? ms : 0), fn });
    return id;
  };

  clearTimeout = (h: unknown): void => {
    this.q = this.q.filter((x) => x.id !== h);
  };

  /** Earliest pending timer, or null. */
  nextAt(): number | null {
    let best: number | null = null;
    for (const x of this.q) if (best === null || x.at < best) best = x.at;
    return best;
  }

  hasDue(): boolean {
    return this.q.some((x) => x.at <= this.t);
  }

  /** Runs every timer due at the current time (also ones they schedule for now). */
  runDue(): boolean {
    let ran = false;
    for (let guard = 0; ; guard++) {
      if (guard > 100_000) throw new Error('FakeTime: timer storm');
      let due: { id: number; at: number; fn: () => void } | undefined;
      for (const x of this.q) if (x.at <= this.t && (!due || x.at < due.at || (x.at === due.at && x.id < due.id))) due = x;
      if (!due) return ran;
      const d = due;
      this.q = this.q.filter((x) => x !== d);
      d.fn();
      ran = true;
    }
  }
}

/** Seeded PRNG (mulberry32). */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One turn of the real event loop (WebCrypto resolves outside the fake timers). */
const macrotask = (): Promise<void> =>
  new Promise<void>((r) => (typeof setImmediate === 'function' ? setImmediate(r) : setTimeout(r, 0)));

/** A device in a test: a controller with its own storage and the notices it raised. */
export interface Device {
  readonly name: string;
  readonly ctrl: RoomControllerApi;
  readonly store: Store;
  readonly storage: StorageLike & { dump(): Record<string, string> };
  readonly notices: RoomNotice[];
  /** Notice kinds in order. */
  kinds(): string[];
}

export interface DeviceOptions extends Partial<Omit<RoomControllerOptions, 'store'>> {
  /** Reuse a device's storage (a reload or a returning device). */
  storage?: StorageLike & { dump(): Record<string, string> };
  seed?: number;
}

export interface Harness {
  readonly time: FakeTime;
  readonly net: MemoryNetwork;
  readonly code: string;
  readonly devices: Device[];
  /** Starts a device on the network (it dials or anchors like the broker procedure). */
  device(name: string, opts?: DeviceOptions): Device;
  /** Starts a controller on an explicit transport (pairs and scripted peers). */
  deviceOn(name: string, transport: MemoryTransport | null, opts?: DeviceOptions): Device;
  /** Runs due timers and waits for every controller to handle its messages, until quiet. */
  settle(): Promise<void>;
  /** Moves time forward by `ms`, firing timers in order and settling at each. */
  advance(ms: number): Promise<void>;
  /** Messages carried on the code's current link (delivered and dropped); a new link starts a new log. */
  sent(): readonly { from: string; to: string; msg: Message; dropped: boolean }[];
}

export function createHarness(opts: { code?: string; memory?: MemoryOptions } = {}): Harness {
  const time = new FakeTime();
  const code = opts.code ?? 'K7QW2M';
  const net = createMemoryNetwork({ timers: time, ...opts.memory });
  const devices: Device[] = [];
  let seed = 1;

  const make = (name: string, base: Partial<RoomControllerOptions>, o: DeviceOptions): Device => {
    const storage = o.storage ?? memoryStorage();
    const store = createStore(storage);
    const notices: RoomNotice[] = [];
    const { storage: _s, seed: s, ...rest } = o;
    const ctrl = createRoomController({
      code,
      store,
      now: time.now,
      wallNow: time.wall,
      rng: seeded(s ?? seed++ * 7919),
      timers: time,
      ...base,
      ...rest,
    });
    ctrl.onNotice((n) => notices.push(n));
    const d: Device = { name, ctrl, store, storage, notices, kinds: () => notices.map((n) => n.kind) };
    devices.push(d);
    return d;
  };

  const settle = async (): Promise<void> => {
    let quiet = 0;
    for (let i = 0; i < 2000; i++) {
      const ran = time.runDue();
      await Promise.all(devices.map((d) => d.ctrl.idle()));
      await macrotask();
      if (!ran && !time.hasDue()) {
        if (++quiet >= 3) return;
      } else quiet = 0;
    }
    throw new Error('harness: did not settle');
  };

  return {
    time,
    net,
    code,
    devices,
    device: (name, o = {}) => make(name, { factory: net.factory }, o),
    deviceOn: (name, transport, o = {}) => make(name, transport ? { transport } : {}, o),
    settle,
    advance: async (ms: number) => {
      const target = time.t + ms;
      await settle();
      for (;;) {
        const next = time.nextAt();
        if (next === null || next > target) break;
        time.t = Math.max(time.t, next);
        await settle();
      }
      time.t = target;
      await settle();
    },
    sent: () => net.link(code)?.log ?? [],
  };
}

/** A memory pair on fake time, for scripted-peer tests. */
export function fakePair(time: FakeTime, opts: MemoryOptions = {}): MemoryPair {
  return createMemoryPair({ timers: time, ...opts });
}

/** A scripted peer on a raw transport end: records what it receives and sends what the test says. */
export function scriptPeer(t: MemoryTransport): { inbox: Message[]; send(m: Message): void; of<K extends Message['t']>(k: K): Extract<Message, { t: K }>[] } {
  const inbox: Message[] = [];
  t.onMessage((m) => inbox.push(m));
  return {
    inbox,
    send: (m) => t.send(m),
    of: <K extends Message['t']>(k: K) => inbox.filter((m): m is Extract<Message, { t: K }> => m.t === k),
  };
}
