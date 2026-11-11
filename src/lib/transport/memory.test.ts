import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, TransportFactory, TransportState } from '../types';
import { createMemoryNetwork, createMemoryPair, type MemoryTransport } from './memory';

const ping: Message = { t: 'ping', v: 1 };
const pong: Message = { t: 'pong', v: 1 };
const move = (i: number): Message => ({ t: 'move', v: 1, n: 1, epoch: 0, i, m: 'e2e4', ms: 100 });

function record(t: MemoryTransport) {
  const msgs: Message[] = [];
  const states: TransportState[] = [];
  const failures: string[] = [];
  t.onMessage((m) => msgs.push(m));
  t.onState((s) => states.push(s));
  t.onFailure((f) => failures.push(f));
  return { msgs, states, failures };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createMemoryPair', () => {
  it('starts open with anchor and dialer roles; onState replays the current state', () => {
    const p = createMemoryPair();
    expect(p.a.role).toBe('anchor');
    expect(p.b.role).toBe('dialer');
    expect(p.a.kind).toBe('memory');
    const s: TransportState[] = [];
    p.a.onState((x) => s.push(x));
    expect(s).toEqual(['open']);
    const roles: string[] = [];
    p.b.onRole((r) => roles.push(r));
    expect(roles).toEqual(['dialer']);
  });

  it('delivers asynchronously, in order, as JSON copies', async () => {
    const p = createMemoryPair();
    const rb = record(p.b);
    const msg = move(0);
    p.a.send(msg);
    p.a.send(move(1));
    expect(rb.msgs).toEqual([]);
    expect(p.inFlight).toBe(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(rb.msgs).toEqual([move(0), move(1)]);
    expect(rb.msgs[0]).not.toBe(msg);
    expect(p.log.map((e) => [e.from, e.to, e.dropped])).toEqual([
      ['a', 'b', false],
      ['a', 'b', false],
    ]);
  });

  it('drops undefined fields like JSON does', async () => {
    const p = createMemoryPair();
    const rb = record(p.b);
    p.a.send({ t: 'head', v: 1, n: 1, epoch: 0, len: 0, hash: 'x', ended: false, turnMs: undefined });
    await vi.runAllTimersAsync();
    expect('turnMs' in rb.msgs[0]).toBe(false);
  });

  it('honours the delay and keeps order when the delay shrinks', async () => {
    const p = createMemoryPair({ delayMs: 100 });
    const rb = record(p.b);
    p.a.send(move(0));
    p.setDelay(10);
    p.a.send(move(1));
    await vi.advanceTimersByTimeAsync(10);
    // The faster second message pulls the first one along: order is kept.
    expect(rb.msgs.map((m) => (m as { i: number }).i)).toEqual([0, 1]);
    await vi.advanceTimersByTimeAsync(200);
    expect(rb.msgs).toHaveLength(2);
  });

  it('delivers nothing before the delay has passed', async () => {
    const p = createMemoryPair({ delayMs: 50 });
    const ra = record(p.a);
    p.b.send(pong);
    await vi.advanceTimersByTimeAsync(49);
    expect(ra.msgs).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(ra.msgs).toEqual([pong]);
  });

  it('drops by rule: boolean, predicate and probability', async () => {
    const p = createMemoryPair({ drop: true });
    const rb = record(p.b);
    p.a.send(ping);
    await vi.runAllTimersAsync();
    expect(rb.msgs).toEqual([]);
    expect(p.log[0].dropped).toBe(true);

    p.setDrop((m) => m.t === 'ping');
    p.a.send(ping);
    p.a.send(pong);
    await vi.runAllTimersAsync();
    expect(rb.msgs).toEqual([pong]);

    const seq = [0.1, 0.9];
    const q = createMemoryPair({ drop: 0.5, rng: () => seq.shift() ?? 0 });
    const rq = record(q.b);
    q.a.send(move(0));
    q.a.send(move(1));
    await vi.runAllTimersAsync();
    expect(rq.msgs).toEqual([move(1)]);
  });

  it('manual mode waits for flush, which also delivers replies sent while flushing', () => {
    const p = createMemoryPair({ manual: true });
    const ra = record(p.a);
    p.b.onMessage((m) => {
      if (m.t === 'ping') p.b.send(pong);
    });
    p.a.send(ping);
    vi.advanceTimersByTime(1000);
    expect(p.inFlight).toBe(1);
    p.flush();
    expect(ra.msgs).toEqual([pong]);
    expect(p.inFlight).toBe(0);
  });

  it('buffers messages until the first onMessage listener', async () => {
    const p = createMemoryPair();
    p.a.send(move(0));
    p.a.send(move(1));
    await vi.runAllTimersAsync();
    const got: Message[] = [];
    p.b.onMessage((m) => got.push(m));
    expect(got).toEqual([move(0), move(1)]);
  });

  it('supports several listeners and unsubscribe', async () => {
    const p = createMemoryPair();
    const x: Message[] = [];
    const y: Message[] = [];
    const offX = p.b.onMessage((m) => x.push(m));
    p.b.onMessage((m) => y.push(m));
    p.a.send(ping);
    await vi.runAllTimersAsync();
    offX();
    p.a.send(pong);
    await vi.runAllTimersAsync();
    expect(x).toEqual([ping]);
    expect(y).toEqual([ping, pong]);
  });

  it('disconnect loses in-flight messages, reports peer-gone and drops sends; reconnect opens a fresh channel', async () => {
    const p = createMemoryPair({ delayMs: 20 });
    const ra = record(p.a);
    const rb = record(p.b);
    p.a.send(move(0));
    p.disconnect();
    expect(p.up).toBe(false);
    expect(p.a.state).toBe('connecting');
    expect(p.b.state).toBe('connecting');
    expect(ra.failures).toEqual(['peer-gone']);
    expect(rb.failures).toEqual(['peer-gone']);
    expect(p.a.failure).toBe('peer-gone');
    p.a.send(move(1));
    await vi.runAllTimersAsync();
    expect(rb.msgs).toEqual([]);
    expect(p.inFlight).toBe(0);

    p.reconnect();
    expect(ra.states).toEqual(['open', 'connecting', 'open']);
    expect(p.a.failure).toBeNull();
    p.a.send(move(2));
    await vi.runAllTimersAsync();
    expect(rb.msgs).toEqual([move(2)]);
  });

  it('a transport reconnect() bounces the channel (connecting, then open)', () => {
    const p = createMemoryPair();
    const rb = record(p.b);
    p.a.reconnect();
    expect(rb.states).toEqual(['open', 'connecting', 'open']);
    expect(rb.failures).toEqual([]);
  });

  it('fail() puts one side into failed with a reason; the other loses its peer', () => {
    const p = createMemoryPair();
    const ra = record(p.a);
    const rb = record(p.b);
    p.fail('a', 'ice-failed');
    expect(p.a.state).toBe('failed');
    expect(p.a.failure).toBe('ice-failed');
    expect(ra.failures).toEqual(['ice-failed']);
    expect(p.b.state).toBe('connecting');
    expect(rb.failures).toEqual(['peer-gone']);
    p.reconnect();
    expect(p.a.state).toBe('open');
    expect(p.b.state).toBe('open');
    p.fail('both', 'broker-unreachable');
    expect([p.a.failure, p.b.failure]).toEqual(['broker-unreachable', 'broker-unreachable']);
  });

  it('closing one end: it goes closed, the other loses its peer and waits; sends are dropped', async () => {
    const p = createMemoryPair();
    const ra = record(p.a);
    const rb = record(p.b);
    p.b.send(ping);
    p.a.close();
    expect(ra.states).toEqual(['open', 'closed']);
    expect(rb.states).toEqual(['open', 'connecting']);
    expect(rb.failures).toEqual(['peer-gone']);
    p.b.send(pong);
    p.a.send(ping);
    await vi.runAllTimersAsync();
    expect(ra.msgs).toEqual([]);
    expect(rb.msgs).toEqual([]);
    p.reconnect(); // cannot revive a closed end
    expect(p.b.state).toBe('connecting');
    p.a.close(); // idempotent
    expect(ra.states).toEqual(['open', 'closed']);
  });

  it('close() closes both ends and is terminal', () => {
    const p = createMemoryPair();
    const ra = record(p.a);
    p.close();
    expect(p.a.state).toBe('closed');
    expect(p.b.state).toBe('closed');
    expect(ra.states).toEqual(['open', 'closed']);
    p.a.reconnect();
    expect(p.a.state).toBe('closed');
  });

  it('can start closed-off and open later', () => {
    const p = createMemoryPair({ open: false });
    expect(p.a.state).toBe('connecting');
    p.reconnect();
    expect(p.a.state).toBe('open');
  });

  it('uses injected timers', () => {
    const queue: (() => void)[] = [];
    const timers = { setTimeout: (fn: () => void) => queue.push(fn), clearTimeout: () => {} };
    const p = createMemoryPair({ timers });
    const rb = record(p.b);
    p.a.send(ping);
    expect(queue).toHaveLength(1);
    queue.shift()!();
    expect(rb.msgs).toEqual([ping]);
  });

  it('a listener that throws does not stop delivery to the others', async () => {
    const p = createMemoryPair();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const got: Message[] = [];
    p.b.onMessage(() => {
      throw new Error('boom');
    });
    p.b.onMessage((m) => got.push(m));
    p.a.send(ping);
    await vi.runAllTimersAsync();
    expect(got).toEqual([ping]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('createMemoryNetwork', () => {
  it('its factory is a TransportFactory', async () => {
    const f: TransportFactory = createMemoryNetwork().factory;
    const t = await f('X');
    expect(t.role).toBe('anchor');
  });

  it('first device waits as anchor; the second dials and both open', async () => {
    const net = createMemoryNetwork();
    const a = await net.factory('K7QW2M');
    expect(a.role).toBe('anchor');
    expect(a.state).toBe('connecting');
    expect(net.link('K7QW2M')).toBeNull();
    const b = await net.factory('K7QW2M');
    expect(b.role).toBe('dialer');
    expect(a.state).toBe('open');
    expect(b.state).toBe('open');
    const rb = record(b);
    a.send(ping);
    await vi.runAllTimersAsync();
    expect(rb.msgs).toEqual([ping]);
    expect(net.link('K7QW2M')!.log).toHaveLength(1);
    expect(net.created.map((t) => t.name)).toEqual(['K7QW2M#1', 'K7QW2M#2']);
  });

  it('codes are separate rooms', async () => {
    const net = createMemoryNetwork();
    const a = await net.factory('AAA');
    const b = await net.factory('BBB');
    expect(a.state).toBe('connecting');
    expect(b.state).toBe('connecting');
    expect(b.role).toBe('anchor');
  });

  it('close the guest, the host waits; the guest comes back with a new transport and links again', async () => {
    const net = createMemoryNetwork();
    const host = await net.factory('R');
    const guest = await net.factory('R');
    const rh = record(host);
    guest.close();
    expect(host.state).toBe('connecting');
    expect(rh.failures).toEqual(['peer-gone']);
    host.send(move(0)); // dropped: nobody there
    const guest2 = await net.factory('R');
    expect(guest2.state).toBe('open');
    expect(host.state).toBe('open');
    expect(rh.states).toEqual(['open', 'connecting', 'open']);
    const rg = record(guest2);
    await vi.runAllTimersAsync();
    expect(rg.msgs).toEqual([]);
  });

  it('when the anchor leaves, the remaining device becomes anchor', async () => {
    const net = createMemoryNetwork();
    const a = await net.factory('R');
    const b = await net.factory('R');
    const roles: string[] = [];
    b.onRole((r) => roles.push(r));
    a.close();
    expect(b.role).toBe('anchor');
    expect(roles).toEqual(['dialer', 'anchor']);
    const c = await net.factory('R');
    expect(c.role).toBe('dialer');
    expect(b.state).toBe('open');
    expect(net.peers('R')).toEqual([b, c]);
  });

  it('a third device replaces the dialer (newest wins); the replaced one waits until it reconnects', async () => {
    const net = createMemoryNetwork();
    const a = await net.factory('R');
    const b = await net.factory('R');
    const ra = record(a);
    const rb = record(b);
    const c = await net.factory('R');
    expect(c.state).toBe('open');
    expect(b.state).toBe('connecting');
    expect(rb.failures).toEqual(['peer-gone']);
    expect(ra.states).toEqual(['open', 'connecting', 'open']);
    b.reconnect();
    expect(b.state).toBe('open');
    expect(c.state).toBe('connecting');
  });

  it('link controls apply to the current link; setOnline models an outage', async () => {
    const net = createMemoryNetwork({ delayMs: 5 });
    const a = await net.factory('R');
    const b = await net.factory('R');
    const rb = record(b);
    net.setOnline('R', false);
    expect(a.state).toBe('connecting');
    a.reconnect(); // no network: nothing happens
    expect(a.state).toBe('connecting');
    const c = await net.factory('R'); // no link forms while offline
    expect(c.state).toBe('connecting');
    c.close();
    net.setOnline('R', true);
    expect(a.state).toBe('open');
    expect(b.state).toBe('open');
    a.send(ping);
    await vi.advanceTimersByTimeAsync(5);
    expect(rb.msgs).toEqual([ping]);
    net.link('R')!.disconnect();
    expect(b.state).toBe('connecting');
    b.reconnect();
    expect(b.state).toBe('open');
  });

  it('flushAll delivers in manual mode', async () => {
    const net = createMemoryNetwork({ manual: true });
    const a = await net.factory('R');
    const b = await net.factory('R');
    const rb = record(b);
    a.send(ping);
    await vi.runAllTimersAsync();
    expect(rb.msgs).toEqual([]);
    net.flushAll();
    expect(rb.msgs).toEqual([ping]);
  });
});
