/**
 * Manual connection fallback (DESIGN 9.9): offer and answer travel as links or QR codes instead of
 * through the broker.
 *
 * 1. Host: `startManualHost(code)` creates a plain `RTCPeerConnection` and a data channel, waits for
 *    ICE gathering to finish (non-trickle, with a timeout), reduces and packs the offer and returns
 *    the invite link `…/#/?s=<CODE>&o=r&x=<offer>`. It listens on a `BroadcastChannel` for the answer.
 * 2. Guest: `answerManualOffer(code, x)` builds the answer the same way and returns the answer link
 *    `…/#/?s=<CODE>&o=r&y=<answer>`.
 * 3. Host: either the answer link is opened on the host's device — that new tab calls
 *    `handOverAnswer(code, y)`, which passes the answer to the waiting tab through the channel — or
 *    the user pastes the answer link into the waiting tab, which calls `host.acceptAnswer(text)`.
 *
 * The resulting `ManualTransport` is single-use: when its channel closes it reports `peer-gone` and
 * goes `closed`; an ICE failure reports `ice-failed` and stays `failed`. Reconnecting is the room
 * UI's job (through the broker when it is back, or a new manual exchange).
 */
import { buildUrl, parseUrl } from '../url';
import type { Message, TransportState } from '../types';
import {
  defaultTimers,
  ICE_SERVERS,
  parseMessage,
  TransportCore,
  type RoomTransport,
  type Timers,
  type TransportFailureKind,
  type TransportRole,
} from './common';
import { decodeSignal, encodeSdp, rebuildSdp, SdpError, type ReducedSdp } from './sdp';

/** Data channel label. */
export const MANUAL_CHANNEL_LABEL = 'zhess';

export type ManualErrorReason =
  /** Not a Zhess link or signal, or damaged. */
  | 'invalid'
  /** A valid signal of the wrong kind (an offer where an answer was expected, or the reverse). */
  | 'wrong-kind'
  /** An answer to another offer (an older invite). */
  | 'mismatch'
  /** An answer was already applied to this offer. */
  | 'used'
  /** The link is for another room code. */
  | 'other-room'
  /** The browser rejected the description, or WebRTC is missing. */
  | 'webrtc';

export class ManualError extends Error {
  constructor(
    readonly reason: ManualErrorReason,
    message?: string,
  ) {
    super(message ?? reason);
    this.name = 'ManualError';
  }
}

export interface ManualOptions {
  /** `RTCPeerConnection` constructor. Default: the global one. */
  RTCPeerConnection?: new (config?: RTCConfiguration) => RTCPeerConnection;
  /** `BroadcastChannel` constructor, or null to disable the hand-over. Default: the global one. */
  BroadcastChannel?: (new (name: string) => BroadcastChannel) | null;
  /** STUN servers. Default `ICE_SERVERS` (no TURN). */
  iceServers?: RTCIceServer[];
  /** Longest wait for ICE gathering before the description is used as it is. Default 5000 ms. */
  gatherTimeoutMs?: number;
  /** Host: longest wait from applying the answer to an open channel. Default 20000 ms. */
  connectTimeoutMs?: number;
  /** App base URL for links. Default: the current page's (`appBaseUrl()`). */
  base?: string;
  timers?: Timers;
}

/** The manual transport. `role` is `anchor` for the host, `dialer` for the guest. */
export interface ManualTransport extends RoomTransport {
  readonly kind: 'manual';
}

export interface ManualHost {
  readonly transport: ManualTransport;
  /** The packed offer (the `x` parameter). */
  readonly offer: string;
  /** The invite link `…/#/?s=<CODE>&o=r&x=<offer>`. */
  readonly link: string;
  /**
   * Paste path: takes the pasted text (an answer link, a query string, or the bare `y` value) and
   * applies the answer. Rejects with `ManualError` (`invalid`, `wrong-kind`, `mismatch`, `used`,
   * `other-room`, `webrtc`).
   */
  acceptAnswer(input: string): Promise<void>;
}

export interface ManualGuest {
  readonly transport: ManualTransport;
  /** The packed answer (the `y` parameter). */
  readonly answer: string;
  /** The answer link `…/#/?s=<CODE>&o=r&y=<answer>`. */
  readonly link: string;
}

/* ---------------------------------------------------------------------------------------------- */
/* Links                                                                                            */
/* ---------------------------------------------------------------------------------------------- */

/** `…/#/?s=<CODE>&o=r&x=<offer>`. */
export function offerLink(code: string, offer: string, base?: string): string {
  return buildUrl({ code, mode: 'room', offer }, base);
}

/** `…/#/?s=<CODE>&o=r&y=<answer>`. */
export function answerLink(code: string, answer: string, base?: string): string {
  return buildUrl({ code, mode: 'room', answer }, base);
}

export interface ManualInput {
  code?: string;
  offer?: string;
  answer?: string;
  /** A bare signal without parameter name (kind unknown until decoded). */
  raw?: string;
}

/**
 * Reads what a user pasted or scanned: a full link (`…#/?s=…&x=…`), a query string (`s=…&y=…`), or
 * a bare signal. Returns null for empty or unusable text. Pure and synchronous; decoding happens
 * when the signal is applied.
 */
export function parseManualInput(input: string): ManualInput | null {
  const text = input.trim();
  if (!text) return null;
  const q = text.indexOf('?');
  if (q >= 0 || /(^|&)[xys]=/.test(text)) {
    const p = parseUrl(q >= 0 ? text.slice(q + 1).split('#')[0] : text);
    const out: ManualInput = {};
    if (p.code) out.code = p.code;
    if (p.offer && /^[A-Za-z0-9_-]+$/.test(p.offer)) out.offer = p.offer;
    if (p.answer && /^[A-Za-z0-9_-]+$/.test(p.answer)) out.answer = p.answer;
    return out.offer || out.answer ? out : null;
  }
  return /^[A-Za-z0-9_-]{16,}$/.test(text) ? { raw: text } : null;
}

/* ---------------------------------------------------------------------------------------------- */
/* Transport                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

class ManualTransportImpl implements ManualTransport {
  readonly kind = 'manual' as const;
  readonly core: TransportCore;
  private channel: RTCDataChannel | null = null;
  private connectTimer: unknown = undefined;
  private cleanups: (() => void)[] = [];

  constructor(
    role: TransportRole,
    readonly pc: RTCPeerConnection,
    private timers: Timers,
  ) {
    this.core = new TransportCore(role);
    const onIce = () => {
      const s = pc.iceConnectionState;
      if (s === 'failed') this.iceFailed();
    };
    const onConn = () => {
      if (pc.connectionState === 'failed') this.iceFailed();
    };
    pc.addEventListener('iceconnectionstatechange', onIce);
    pc.addEventListener('connectionstatechange', onConn);
    this.cleanups.push(() => {
      pc.removeEventListener('iceconnectionstatechange', onIce);
      pc.removeEventListener('connectionstatechange', onConn);
    });
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

  attach(ch: RTCDataChannel): void {
    if (this.channel || this.core.state === 'closed') {
      ch.close();
      return;
    }
    this.channel = ch;
    const onOpen = () => {
      this.clearConnectTimer();
      this.core.setState('open');
    };
    const onMessage = (e: MessageEvent) => {
      const m = parseMessage(e.data);
      if (m) this.core.deliver(m);
    };
    const onClose = () => {
      if (this.core.state === 'closed') return;
      const wasOpen = this.core.state === 'open';
      this.core.fail(wasOpen ? 'peer-gone' : 'ice-failed');
      this.shutdown();
      if (wasOpen) this.core.close();
      else this.core.setState('failed');
    };
    ch.addEventListener('open', onOpen);
    ch.addEventListener('message', onMessage);
    ch.addEventListener('close', onClose);
    this.cleanups.push(() => {
      ch.removeEventListener('open', onOpen);
      ch.removeEventListener('message', onMessage);
      ch.removeEventListener('close', onClose);
    });
    if (ch.readyState === 'open') onOpen();
  }

  /** Host: start the connect timer once the answer is applied. */
  armConnectTimer(ms: number): void {
    this.clearConnectTimer();
    this.connectTimer = this.timers.setTimeout(() => {
      this.connectTimer = undefined;
      if (this.core.state === 'connecting') this.iceFailed();
    }, ms);
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== undefined) this.timers.clearTimeout(this.connectTimer);
    this.connectTimer = undefined;
  }

  private iceFailed(): void {
    if (this.core.state === 'closed' || this.core.state === 'failed') return;
    const wasOpen = this.core.state === 'open';
    this.core.fail(wasOpen ? 'peer-gone' : 'ice-failed');
    this.shutdown();
    if (wasOpen) this.core.close();
    else this.core.setState('failed');
  }

  /** Extra cleanup run on close (the host's BroadcastChannel). */
  addCleanup(fn: () => void): void {
    this.cleanups.push(fn);
  }

  private shutdown(): void {
    this.clearConnectTimer();
    for (const fn of this.cleanups.splice(0)) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    try {
      this.channel?.close();
    } catch {
      /* ignore */
    }
    try {
      this.pc.close();
    } catch {
      /* ignore */
    }
  }

  send(msg: Message): void {
    if (this.core.state !== 'open' || !this.channel || this.channel.readyState !== 'open') return;
    try {
      this.channel.send(JSON.stringify(msg));
    } catch {
      /* channel closing; the close event follows */
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
  /** A manual connection cannot be re-established without a new exchange. */
  reconnect(): void {}
  close(): void {
    if (this.core.state === 'closed') return;
    this.shutdown();
    this.core.close();
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Helpers                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

function pcCtor(opts: ManualOptions): new (config?: RTCConfiguration) => RTCPeerConnection {
  const C = opts.RTCPeerConnection ?? (globalThis as { RTCPeerConnection?: typeof RTCPeerConnection }).RTCPeerConnection;
  if (!C) throw new ManualError('webrtc', 'RTCPeerConnection is not available');
  return C;
}

function bcCtor(opts: ManualOptions): (new (name: string) => BroadcastChannel) | null {
  if (opts.BroadcastChannel !== undefined) return opts.BroadcastChannel;
  return (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel ?? null;
}

/** Resolves when ICE gathering is complete, or after `timeoutMs` (whatever was gathered is used). */
export function waitForGathering(pc: RTCPeerConnection, timeoutMs: number, timers: Timers = defaultTimers): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    let timer: unknown = undefined;
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', onState);
      pc.removeEventListener('icecandidate', onCandidate);
      if (timer !== undefined) timers.clearTimeout(timer);
      resolve();
    };
    const onState = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const onCandidate = (e: RTCPeerConnectionIceEvent) => {
      // End of candidates. Some engines signal it before the description holds a candidate: then
      // wait for the gathering state (or the timeout) instead.
      if (!e.candidate && /\ra=candidate:|\na=candidate:/.test(pc.localDescription?.sdp ?? '')) done();
    };
    pc.addEventListener('icegatheringstatechange', onState);
    pc.addEventListener('icecandidate', onCandidate);
    timer = timers.setTimeout(done, timeoutMs);
  });
}

/** Channel name of the answer hand-over for `code`. */
export function handOverChannelName(code: string): string {
  return `zhess:manual:${code}`;
}

type HandOverMsg = { t: 'answer'; id: string; answer: string } | { t: 'took'; id: string };

async function decodeExpecting(value: string, kind: 'offer' | 'answer'): Promise<ReducedSdp> {
  let r: ReducedSdp;
  try {
    r = await decodeSignal(value);
  } catch (e) {
    if (e instanceof SdpError) throw new ManualError('invalid', e.message);
    throw e;
  }
  if (r.kind !== kind) throw new ManualError('wrong-kind');
  return r;
}

/** Picks the signal of `kind` out of pasted text, checking the room code when the text has one. */
function pickSignal(input: string, kind: 'offer' | 'answer', code: string): string {
  const p = parseManualInput(input);
  if (!p) throw new ManualError('invalid');
  if (p.code && p.code !== code) throw new ManualError('other-room');
  const v = kind === 'offer' ? (p.offer ?? p.raw) : (p.answer ?? p.raw);
  if (!v) throw new ManualError(kind === 'offer' ? (p.answer ? 'wrong-kind' : 'invalid') : p.offer ? 'wrong-kind' : 'invalid');
  return v;
}

/* ---------------------------------------------------------------------------------------------- */
/* Host                                                                                             */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Host side: creates the connection and the offer, and starts listening for the answer on the
 * `BroadcastChannel`. Rejects with `ManualError('webrtc')` when WebRTC is unavailable.
 */
export async function startManualHost(code: string, opts: ManualOptions = {}): Promise<ManualHost> {
  const timers = opts.timers ?? defaultTimers;
  const PC = pcCtor(opts);
  const pc = new PC({ iceServers: opts.iceServers ?? ICE_SERVERS });
  const transport = new ManualTransportImpl('anchor', pc, timers);
  const ch = pc.createDataChannel(MANUAL_CHANNEL_LABEL, { ordered: true });
  transport.attach(ch);

  let offerSdp: string;
  let ufrag: string;
  let offer: string;
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await waitForGathering(pc, opts.gatherTimeoutMs ?? 5000, timers);
    offerSdp = pc.localDescription?.sdp ?? '';
    offer = await encodeSdp(offerSdp, 'offer');
    ufrag = (await decodeSignal(offer)).ufrag;
  } catch (e) {
    transport.close();
    if (e instanceof ManualError) throw e;
    throw new ManualError('webrtc', e instanceof Error ? e.message : String(e));
  }

  let applying: Promise<void> | null = null;

  const apply = async (answerValue: string): Promise<void> => {
    if (transport.state === 'closed') throw new ManualError('used');
    const r = await decodeExpecting(answerValue, 'answer');
    if (r.re !== ufrag) throw new ManualError('mismatch');
    if (applying) throw new ManualError('used');
    applying = (async () => {
      try {
        await pc.setRemoteDescription({ type: 'answer', sdp: rebuildSdp(r) });
      } catch (e) {
        applying = null;
        throw new ManualError('webrtc', e instanceof Error ? e.message : String(e));
      }
      transport.armConnectTimer(opts.connectTimeoutMs ?? 20_000);
    })();
    return applying;
  };

  // Hand-over from a tab that opened the answer link on this device.
  const BC = bcCtor(opts);
  if (BC) {
    try {
      const bc = new BC(handOverChannelName(code));
      bc.onmessage = (e: MessageEvent) => {
        const m = e.data as HandOverMsg | null;
        if (!m || m.t !== 'answer' || typeof m.answer !== 'string' || typeof m.id !== 'string') return;
        // Answer the hand-over tab only if this offer is the one answered.
        void decodeSignal(m.answer)
          .then((r) => {
            if (r.kind !== 'answer' || r.re !== ufrag || applying) return;
            bc.postMessage({ t: 'took', id: m.id } satisfies HandOverMsg);
            return apply(m.answer);
          })
          .catch(() => {
            /* a broken or foreign answer: ignore; the paste path stays available */
          });
      };
      transport.addCleanup(() => bc.close());
    } catch {
      /* no channel: the paste path remains */
    }
  }

  return {
    transport,
    offer,
    link: offerLink(code, offer, opts.base),
    acceptAnswer: async (input: string) => apply(pickSignal(input, 'answer', code)),
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* Guest                                                                                            */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Guest side: takes the offer (the `x` value, or a pasted link) and builds the answer. The
 * transport opens when the host applies the answer. Rejects with `ManualError`.
 */
export async function answerManualOffer(code: string, offerInput: string, opts: ManualOptions = {}): Promise<ManualGuest> {
  const timers = opts.timers ?? defaultTimers;
  const r = await decodeExpecting(pickSignal(offerInput, 'offer', code), 'offer');
  const PC = pcCtor(opts);
  const pc = new PC({ iceServers: opts.iceServers ?? ICE_SERVERS });
  const transport = new ManualTransportImpl('dialer', pc, timers);
  const onChannel = (e: RTCDataChannelEvent) => transport.attach(e.channel);
  pc.addEventListener('datachannel', onChannel);
  transport.addCleanup(() => pc.removeEventListener('datachannel', onChannel));
  try {
    await pc.setRemoteDescription({ type: 'offer', sdp: rebuildSdp(r) });
    await pc.setLocalDescription(await pc.createAnswer());
    await waitForGathering(pc, opts.gatherTimeoutMs ?? 5000, timers);
    const answer = await encodeSdp(pc.localDescription?.sdp ?? '', 'answer', r.ufrag);
    return { transport, answer, link: answerLink(code, answer, opts.base) };
  } catch (e) {
    transport.close();
    if (e instanceof ManualError) throw e;
    throw new ManualError('webrtc', e instanceof Error ? e.message : String(e));
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Hand-over                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

export interface HandOverOptions {
  BroadcastChannel?: (new (name: string) => BroadcastChannel) | null;
  /** How long to wait for the host tab to take the answer. Default 1500 ms. */
  timeoutMs?: number;
  timers?: Timers;
  /** Random id source. Default `Math.random`. */
  rng?: () => number;
}

/**
 * Answer tab: the host opened the answer link on the same device. Passes the answer (the `y` value
 * or the whole link) to the waiting host tab. Resolves true when that tab took it (the UI then says
 * "return to the game"), false when no tab took it in time (the UI shows the paste instructions).
 */
export function handOverAnswer(code: string, answerInput: string, opts: HandOverOptions = {}): Promise<boolean> {
  const timers = opts.timers ?? defaultTimers;
  const BC =
    opts.BroadcastChannel !== undefined
      ? opts.BroadcastChannel
      : ((globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel ?? null);
  let answer: string;
  try {
    answer = pickSignal(answerInput, 'answer', code);
  } catch {
    return Promise.resolve(false);
  }
  if (!BC) return Promise.resolve(false);
  return new Promise((resolve) => {
    let bc: BroadcastChannel;
    try {
      bc = new BC(handOverChannelName(code));
    } catch {
      resolve(false);
      return;
    }
    const rng = opts.rng ?? Math.random;
    const id = Math.floor(rng() * 2 ** 32).toString(36) + Math.floor(rng() * 2 ** 32).toString(36);
    let timer: unknown = undefined;
    const finish = (ok: boolean) => {
      if (timer !== undefined) timers.clearTimeout(timer);
      timer = undefined;
      bc.onmessage = null;
      try {
        bc.close();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    bc.onmessage = (e: MessageEvent) => {
      const m = e.data as HandOverMsg | null;
      if (m && m.t === 'took' && m.id === id) finish(true);
    };
    timer = timers.setTimeout(() => finish(false), opts.timeoutMs ?? 1500);
    bc.postMessage({ t: 'answer', id, answer } satisfies HandOverMsg);
  });
}
