import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, TransportState } from '../types';
import { parseUrl } from '../url';
import {
  answerLink,
  answerManualOffer,
  handOverAnswer,
  handOverChannelName,
  ManualError,
  offerLink,
  parseManualInput,
  startManualHost,
  waitForGathering,
  type ManualOptions,
  type ManualTransport,
} from './manual';
import { decodeSignal, reduceSdp } from './sdp';

/* ---------------------------------------------------------------------------------------------- */
/* Fake WebRTC                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

class FakeDC extends EventTarget {
  readyState: RTCDataChannelState = 'connecting';
  other: FakeDC | null = null;
  constructor(readonly label: string) {
    super();
  }
  send(data: string): void {
    if (this.readyState !== 'open') throw new Error('InvalidStateError');
    const o = this.other;
    setTimeout(() => o?.readyState === 'open' && o.dispatchEvent(new MessageEvent('message', { data })), 0);
  }
  close(): void {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.dispatchEvent(new Event('close'));
    this.other?.close();
  }
  openNow(): void {
    this.readyState = 'open';
    this.dispatchEvent(new Event('open'));
  }
}

type PcMode = 'ok' | 'never-gathers' | 'ice-fails' | 'never-connects';

/** Pairs fake connections by ICE ufrag, the way real ICE would find the other side. */
const registry = new Map<string, FakePC>();
let pcCount = 0;
let pcMode: PcMode = 'ok';
const pcs: FakePC[] = [];

class FakePC extends EventTarget {
  iceGatheringState: RTCIceGatheringState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  connectionState: RTCPeerConnectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  readonly ufrag: string;
  readonly pwd: string;
  readonly mode = pcMode;
  readonly channels: FakeDC[] = [];
  remoteUfrag = '';
  closed = false;
  setup: 'actpass' | 'active' = 'actpass';

  constructor(readonly config?: RTCConfiguration) {
    super();
    pcCount++;
    this.ufrag = `uf${pcCount}`;
    this.pwd = `pwd${pcCount}abcdefghijklmnopqrstuv`;
    pcs.push(this);
  }
  private sdp(withCandidates: boolean): string {
    const fp = Array.from({ length: 32 }, (_, i) => ((i * 7 + pcCount) & 255).toString(16).padStart(2, '0').toUpperCase()).join(':');
    const lines = [
      'v=0',
      `o=- ${1000 + pcCount} 2 IN IP4 127.0.0.1`,
      's=-',
      't=0 0',
      'a=group:BUNDLE 0',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 0.0.0.0',
      ...(withCandidates
        ? [
            `a=candidate:1 1 udp 2113937151 0d6c3a9e-1b2f-4c5d-8e7f-a0b1c2d3e4f${pcCount % 10}.local 5000${pcCount % 10} typ host generation 0`,
            `a=candidate:2 1 udp 1677729535 203.0.113.${pcCount} 5000${pcCount % 10} typ srflx raddr 0.0.0.0 rport 0 generation 0`,
          ]
        : []),
      `a=ice-ufrag:${this.ufrag}`,
      `a=ice-pwd:${this.pwd}`,
      'a=ice-options:trickle',
      `a=fingerprint:sha-256 ${fp}`,
      `a=setup:${this.setup}`,
      'a=mid:0',
      'a=sctp-port:5000',
    ];
    return lines.join('\r\n') + '\r\n';
  }
  createDataChannel(label: string): FakeDC {
    const dc = new FakeDC(label);
    this.channels.push(dc);
    return dc;
  }
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: this.sdp(false) };
  }
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    this.setup = 'active';
    return { type: 'answer', sdp: this.sdp(false) };
  }
  async setLocalDescription(d: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = d;
    registry.set(this.ufrag, this);
    this.iceGatheringState = 'gathering';
    if (this.mode === 'never-gathers') {
      this.localDescription = { ...d, sdp: this.sdp(true).replace(/a=candidate:2.*\r\n/, '') };
      return;
    }
    setTimeout(() => {
      this.localDescription = { ...d, sdp: this.sdp(true) };
      this.iceGatheringState = 'complete';
      this.dispatchEvent(new Event('icegatheringstatechange'));
    }, 30);
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit): Promise<void> {
    // Real browsers parse it: so does the fake, strictly.
    const r = reduceSdp(d.sdp ?? '', d.type === 'offer' ? 'offer' : 'answer');
    if (!/^m=application 9 UDP\/DTLS\/SCTP webrtc-datachannel$/m.test(d.sdp ?? '')) throw new Error('bad m-line');
    this.remoteDescription = d;
    this.remoteUfrag = r.ufrag;
    if (d.type === 'answer') this.connect();
  }
  private connect(): void {
    const peer = registry.get(this.remoteUfrag);
    if (!peer || peer.remoteUfrag !== this.ufrag) return;
    if (this.mode === 'never-connects') return;
    setTimeout(() => {
      this.iceConnectionState = peer.iceConnectionState = 'checking';
      if (this.mode === 'ice-fails') {
        this.iceConnectionState = peer.iceConnectionState = 'failed';
        this.dispatchEvent(new Event('iceconnectionstatechange'));
        peer.dispatchEvent(new Event('iceconnectionstatechange'));
        return;
      }
      this.iceConnectionState = peer.iceConnectionState = 'connected';
      for (const local of this.channels) {
        const remote = new FakeDC(local.label);
        local.other = remote;
        remote.other = local;
        peer.channels.push(remote);
        const ev = new Event('datachannel') as Event & { channel: FakeDC };
        ev.channel = remote;
        peer.dispatchEvent(ev);
        local.openNow();
        remote.openNow();
      }
    }, 10);
  }
  close(): void {
    this.closed = true;
    for (const c of this.channels) c.close();
  }
}

/** In-memory BroadcastChannel (same-origin tabs). */
const bcBus = new Map<string, Set<FakeBC>>();
class FakeBC {
  onmessage: ((e: MessageEvent) => void) | null = null;
  closed = false;
  constructor(readonly name: string) {
    if (!bcBus.has(name)) bcBus.set(name, new Set());
    bcBus.get(name)!.add(this);
  }
  postMessage(data: unknown): void {
    const copy = structuredClone(data);
    for (const o of bcBus.get(this.name) ?? []) {
      if (o !== this) setTimeout(() => !o.closed && o.onmessage?.(new MessageEvent('message', { data: copy })), 0);
    }
  }
  close(): void {
    this.closed = true;
    bcBus.get(this.name)?.delete(this);
  }
}

const PC = FakePC as unknown as ManualOptions['RTCPeerConnection'];
const BC = FakeBC as unknown as typeof BroadcastChannel;
const BASE = 'https://izzardry.github.io/zhess/';
const CODE = 'K7QW2M';
const opts = (extra: Partial<ManualOptions> = {}): ManualOptions => ({ RTCPeerConnection: PC, BroadcastChannel: BC, base: BASE, ...extra });

function record(t: ManualTransport) {
  const states: TransportState[] = [];
  const failures: string[] = [];
  const msgs: Message[] = [];
  t.onState((s) => states.push(s));
  t.onFailure((f) => failures.push(f));
  t.onMessage((m) => msgs.push(m));
  return { states, failures, msgs };
}

async function settle(ms = 100) {
  await vi.advanceTimersByTimeAsync(ms);
}

/** The real `setTimeout`, captured before the fake timers are installed. */
const realSetTimeout = globalThis.setTimeout;

/**
 * Advances fake time until `ok()` holds. Each round also yields one real macrotask, because the
 * (de)compression streams behind the signal codec settle on real ticks, which a fixed fake advance
 * does not wait for when the machine is busy.
 */
async function until(ok: () => boolean, rounds = 400) {
  for (let i = 0; i < rounds && !ok(); i++) {
    await vi.advanceTimersByTimeAsync(5);
    await new Promise((r) => realSetTimeout(r, 1));
  }
}

/** Runs fake time until the promise settles. */
async function run<T>(p: Promise<T>): Promise<T> {
  let done = false;
  p.then(
    () => (done = true),
    () => (done = true),
  );
  for (let i = 0; i < 1000 && !done; i++) await vi.advanceTimersByTimeAsync(5);
  return p;
}

beforeEach(() => {
  vi.useFakeTimers();
  registry.clear();
  bcBus.clear();
  pcMode = 'ok';
  pcs.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

/* ---------------------------------------------------------------------------------------------- */

describe('links', () => {
  it('offer and answer links follow DESIGN 9.9 and parse back', () => {
    expect(offerLink(CODE, 'abc_-123', BASE)).toBe(`${BASE}#/?s=K7QW2M&o=r&x=abc_-123`);
    expect(answerLink(CODE, 'xyz', BASE)).toBe(`${BASE}#/?s=K7QW2M&o=r&y=xyz`);
    const p = parseUrl(offerLink(CODE, 'abc_-123', BASE).split('?')[1]);
    expect(p).toEqual({ code: CODE, mode: 'room', offer: 'abc_-123' });
  });

  it.each([
    [`${BASE}#/?s=K7QW2M&o=r&x=OFFER_value-1`, { code: CODE, offer: 'OFFER_value-1' }],
    [`  ${BASE}#/?s=K7QW2M&o=r&y=ANSWER\n`, { code: CODE, answer: 'ANSWER' }],
    ['s=k7qw2m&o=r&y=ANS', { code: CODE, answer: 'ANS' }],
    ['?y=ANS', { answer: 'ANS' }],
    ['y=ANS', { answer: 'ANS' }],
    ['abcdefghijklmnopqrstuvwxyz0123456789_-', { raw: 'abcdefghijklmnopqrstuvwxyz0123456789_-' }],
  ])('parseManualInput(%j)', (input, expected) => {
    expect(parseManualInput(input)).toEqual(expected);
  });

  it.each(['', '   ', 'hello', `${BASE}#/?s=K7QW2M&o=r`, 'short', 'x=bad value!', 'not a link but long text here'])(
    'parseManualInput rejects %j',
    (input) => {
      expect(parseManualInput(input)).toBeNull();
    },
  );
});

describe('manual connection over a fake RTCPeerConnection', () => {
  it('host offer → guest answer → paste: both open, roles set, JSON both ways', async () => {
    const host = await run(startManualHost(CODE, opts()));
    expect(host.link.startsWith(`${BASE}#/?s=K7QW2M&o=r&x=`)).toBe(true);
    expect(host.transport.kind).toBe('manual');
    expect(host.transport.role).toBe('anchor');
    expect(host.transport.state).toBe('connecting');
    // STUN only.
    expect(pcs[0].config?.iceServers?.flatMap((s) => [s.urls].flat()).every((u) => String(u).startsWith('stun:'))).toBe(true);

    // The offer is non-trickle: it carries the gathered candidates.
    const offer = await decodeSignal(host.offer);
    expect(offer.kind).toBe('offer');
    expect(offer.ufrag).toBe(pcs[0].ufrag);
    expect(offer.candidates).toHaveLength(2);

    const guest = await run(answerManualOffer(CODE, host.link, opts()));
    expect(guest.link.startsWith(`${BASE}#/?s=K7QW2M&o=r&y=`)).toBe(true);
    expect(guest.transport.role).toBe('dialer');
    const ans = await decodeSignal(guest.answer);
    expect(ans).toMatchObject({ kind: 'answer', re: pcs[0].ufrag, setup: 'active' });
    // The guest's connection got the rebuilt offer with the host's credentials.
    expect(pcs[1].remoteDescription?.sdp).toContain(`a=ice-ufrag:${pcs[0].ufrag}`);
    expect(pcs[1].remoteDescription?.sdp).toContain(`a=ice-pwd:${pcs[0].pwd}`);

    const rh = record(host.transport);
    const rg = record(guest.transport);
    await run(host.acceptAnswer(guest.link));
    await settle(50);
    expect(host.transport.state).toBe('open');
    expect(guest.transport.state).toBe('open');
    expect(rh.states).toEqual(['connecting', 'open']);

    host.transport.send({ t: 'ping', v: 1 });
    guest.transport.send({ t: 'pong', v: 1 });
    await settle(5);
    expect(rg.msgs).toEqual([{ t: 'ping', v: 1 }]);
    expect(rh.msgs).toEqual([{ t: 'pong', v: 1 }]);
    host.transport.close();
    guest.transport.close();
  });

  it('accepts the bare answer value and the offer value too', async () => {
    const host = await run(startManualHost(CODE, opts()));
    const guest = await run(answerManualOffer(CODE, host.offer, opts()));
    await run(host.acceptAnswer(guest.answer));
    await settle(50);
    expect(host.transport.state).toBe('open');
  });

  it('drops frames that are not messages', async () => {
    const host = await run(startManualHost(CODE, opts()));
    const guest = await run(answerManualOffer(CODE, host.link, opts()));
    await run(host.acceptAnswer(guest.link));
    await settle(50);
    const rg = record(guest.transport);
    const dc = pcs[1].channels[0];
    dc.dispatchEvent(new MessageEvent('message', { data: 'nope' }));
    dc.dispatchEvent(new MessageEvent('message', { data: '{"x":1}' }));
    dc.dispatchEvent(new MessageEvent('message', { data: '{"t":"ping","v":1}' }));
    expect(rg.msgs).toEqual([{ t: 'ping', v: 1 }]);
  });

  it('paste errors: invalid, wrong kind, other room, mismatch, used', async () => {
    const host = await run(startManualHost(CODE, opts()));
    const other = await run(startManualHost(CODE, opts()));
    const guest = await run(answerManualOffer(CODE, host.link, opts()));
    const guestOfOther = await run(answerManualOffer(CODE, other.link, opts()));

    const reason = async (p: Promise<unknown>) => {
      try {
        await run(p);
        return 'ok';
      } catch (e) {
        expect(e).toBeInstanceOf(ManualError);
        return (e as ManualError).reason;
      }
    };
    expect(await reason(host.acceptAnswer('hello'))).toBe('invalid');
    expect(await reason(host.acceptAnswer(`${BASE}#/?s=K7QW2M&o=r&y=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`))).toBe('invalid');
    expect(await reason(host.acceptAnswer(host.link))).toBe('wrong-kind');
    expect(await reason(host.acceptAnswer(host.offer))).toBe('wrong-kind');
    expect(await reason(host.acceptAnswer(answerLink('OTHER1', guest.answer, BASE)))).toBe('other-room');
    expect(await reason(host.acceptAnswer(guestOfOther.link))).toBe('mismatch');
    expect(await reason(host.acceptAnswer(guest.link))).toBe('ok');
    expect(await reason(host.acceptAnswer(guest.link))).toBe('used');
    host.transport.close();
    expect(await reason(host.acceptAnswer(guest.link))).toBe('used');
  });

  it('guest errors: an answer instead of an offer, garbage, another room', async () => {
    const host = await run(startManualHost(CODE, opts()));
    const guest = await run(answerManualOffer(CODE, host.link, opts()));
    await expect(run(answerManualOffer(CODE, guest.link, opts()))).rejects.toMatchObject({ reason: 'wrong-kind' });
    await expect(run(answerManualOffer(CODE, 'garbage', opts()))).rejects.toMatchObject({ reason: 'invalid' });
    await expect(run(answerManualOffer('OTHER1', host.link, opts()))).rejects.toMatchObject({ reason: 'other-room' });
  });

  it('missing WebRTC rejects with webrtc', async () => {
    const g = globalThis as { RTCPeerConnection?: unknown };
    const saved = g.RTCPeerConnection;
    delete g.RTCPeerConnection;
    try {
      await expect(startManualHost(CODE, { base: BASE })).rejects.toMatchObject({ reason: 'webrtc' });
    } finally {
      if (saved) g.RTCPeerConnection = saved;
    }
  });

  it('ICE gathering that never completes is cut off by the timeout', async () => {
    pcMode = 'never-gathers';
    const p = startManualHost(CODE, opts({ gatherTimeoutMs: 3000 }));
    let done = false;
    void p.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(2990);
    expect(done).toBe(false);
    const host = await run(p);
    const offer = await decodeSignal(host.offer);
    expect(offer.candidates).toHaveLength(1);
  });

  it('ICE failure after the answer: failed with ice-failed on both sides', async () => {
    pcMode = 'ice-fails';
    const host = await run(startManualHost(CODE, opts()));
    const guest = await run(answerManualOffer(CODE, host.link, opts()));
    const rh = record(host.transport);
    const rg = record(guest.transport);
    await run(host.acceptAnswer(guest.link));
    await settle(50);
    expect(host.transport.state).toBe('failed');
    expect(rh.failures).toEqual(['ice-failed']);
    expect(guest.transport.state).toBe('failed');
    expect(rg.failures).toEqual(['ice-failed']);
    expect(pcs[0].closed).toBe(true);
  });

  it('no connection within the connect timeout: ice-failed', async () => {
    pcMode = 'never-connects';
    const host = await run(startManualHost(CODE, opts({ connectTimeoutMs: 5000 })));
    const guest = await run(answerManualOffer(CODE, host.link, opts()));
    await run(host.acceptAnswer(guest.link));
    await settle(4900);
    expect(host.transport.state).toBe('connecting');
    await settle(200);
    expect(host.transport.state).toBe('failed');
    expect(host.transport.failure).toBe('ice-failed');
  });

  it('the channel closing after open: peer-gone, then closed (single use)', async () => {
    const host = await run(startManualHost(CODE, opts()));
    const guest = await run(answerManualOffer(CODE, host.link, opts()));
    await run(host.acceptAnswer(guest.link));
    await settle(50);
    const rh = record(host.transport);
    guest.transport.close();
    expect(guest.transport.state).toBe('closed');
    expect(host.transport.state).toBe('closed');
    expect(rh.failures).toEqual(['peer-gone']);
    expect(rh.states).toEqual(['open', 'closed']);
    expect(() => host.transport.send({ t: 'ping', v: 1 })).not.toThrow();
    host.transport.reconnect(); // no-op
    expect(host.transport.state).toBe('closed');
  });
});

describe('waitForGathering', () => {
  function fakePc(sdp = '') {
    const pc = Object.assign(new EventTarget(), {
      iceGatheringState: 'gathering' as RTCIceGatheringState,
      localDescription: { type: 'offer', sdp } as RTCSessionDescriptionInit,
    });
    return pc;
  }
  const endOfCandidates = () => Object.assign(new Event('icecandidate'), { candidate: null });

  it('resolves at once when gathering is already complete', async () => {
    const pc = fakePc();
    pc.iceGatheringState = 'complete';
    await expect(waitForGathering(pc as unknown as RTCPeerConnection, 1000)).resolves.toBeUndefined();
  });

  it('resolves on the end-of-candidates event once the description holds a candidate', async () => {
    const pc = fakePc('v=0\r\na=candidate:1 1 udp 1 192.0.2.1 5000 typ host\r\n');
    let done = false;
    void waitForGathering(pc as unknown as RTCPeerConnection, 5000).then(() => (done = true));
    pc.dispatchEvent(endOfCandidates());
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it('an early end-of-candidates without candidates waits for the complete state', async () => {
    const pc = fakePc('v=0\r\n');
    let done = false;
    void waitForGathering(pc as unknown as RTCPeerConnection, 5000).then(() => (done = true));
    pc.dispatchEvent(endOfCandidates());
    await vi.advanceTimersByTimeAsync(10);
    expect(done).toBe(false);
    pc.iceGatheringState = 'complete';
    pc.dispatchEvent(new Event('icegatheringstatechange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it('gives up after the timeout', async () => {
    const pc = fakePc();
    let done = false;
    void waitForGathering(pc as unknown as RTCPeerConnection, 2000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });
});

describe('BroadcastChannel hand-over (answer link opened on the host device)', () => {
  it('the answer tab hands the answer to the waiting host tab, which connects', async () => {
    const host = await run(startManualHost(CODE, opts()));
    const guest = await run(answerManualOffer(CODE, host.link, opts()));
    const ok = await run(handOverAnswer(CODE, guest.link, { BroadcastChannel: BC }));
    expect(ok).toBe(true);
    await until(() => host.transport.state === 'open' && guest.transport.state === 'open');
    expect(host.transport.state).toBe('open');
    expect(guest.transport.state).toBe('open');
    // The paste path then reports the offer as used.
    await expect(run(host.acceptAnswer(guest.link))).rejects.toMatchObject({ reason: 'used' });
  });

  it('no waiting tab: false after the timeout', async () => {
    const host = await run(startManualHost(CODE, opts({ BroadcastChannel: null })));
    const guest = await run(answerManualOffer(CODE, host.link, opts()));
    const p = handOverAnswer(CODE, guest.link, { BroadcastChannel: BC, timeoutMs: 1500 });
    let res: boolean | undefined;
    void p.then((v) => (res = v));
    await vi.advanceTimersByTimeAsync(1490);
    expect(res).toBeUndefined();
    await vi.advanceTimersByTimeAsync(20);
    expect(res).toBe(false);
    expect(bcBus.get(handOverChannelName(CODE))?.size ?? 0).toBe(0);
  });

  it('a host tab with another offer does not take the answer', async () => {
    const other = await run(startManualHost(CODE, opts()));
    const host = await run(startManualHost(CODE, opts({ BroadcastChannel: null })));
    const guest = await run(answerManualOffer(CODE, host.link, opts()));
    expect(await run(handOverAnswer(CODE, guest.link, { BroadcastChannel: BC }))).toBe(false);
    await settle(50);
    expect(other.transport.state).toBe('connecting');
  });

  it('a host tab of another room does not hear it', async () => {
    await run(startManualHost('OTHER1', opts()));
    const host = await run(startManualHost(CODE, opts({ BroadcastChannel: null })));
    const guest = await run(answerManualOffer(CODE, host.link, opts()));
    expect(await run(handOverAnswer(CODE, guest.link, { BroadcastChannel: BC }))).toBe(false);
  });

  it('bad input or no BroadcastChannel: false at once', async () => {
    expect(await handOverAnswer(CODE, 'nonsense', { BroadcastChannel: BC })).toBe(false);
    expect(await handOverAnswer(CODE, 'y=ABCDEFGHIJKLMNOP', { BroadcastChannel: null })).toBe(false);
  });

  it('closing the host transport closes its channel', async () => {
    const host = await run(startManualHost(CODE, opts()));
    expect(bcBus.get(handOverChannelName(CODE))?.size).toBe(1);
    host.transport.close();
    expect(bcBus.get(handOverChannelName(CODE))?.size).toBe(0);
    expect(pcs[0].closed).toBe(true);
  });

  it('works with the real BroadcastChannel of the platform', async () => {
    vi.useRealTimers();
    const host = await startManualHost(CODE, { RTCPeerConnection: PC, base: BASE });
    const guest = await answerManualOffer(CODE, host.link, { RTCPeerConnection: PC, base: BASE });
    expect(await handOverAnswer(CODE, guest.answer, { timeoutMs: 2000 })).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(host.transport.state).toBe('open');
    host.transport.close();
    guest.transport.close();
  });
});
