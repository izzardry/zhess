/**
 * SDP reduction and the manual signalling codec (DESIGN 9.9, PLAN 7 "Manual offer size").
 *
 * A data-channel-only offer or answer needs very little of its SDP: the ICE credentials, the DTLS
 * fingerprint, the DTLS setup role, the media id and the candidates. `reduceSdp` keeps exactly
 * that; `rebuildSdp` writes a complete SDP from it that Chrome, Safari and Firefox accept.
 *
 * Wire form (`encodeSignal` / `decodeSignal`): a compact text line, deflated with
 * `CompressionStream('deflate-raw')` and written as base64url.
 *
 *   1|<o|a>|<setup>|<mid>|<ufrag>|<pwd>|<alg>:<fingerprint b64url>|<re>|<cand>;<cand>…
 *
 * - `setup`: `A` actpass, `a` active, `p` passive.
 * - `alg` is empty for `sha-256`.
 * - `re`: in an answer, the ufrag of the offer it answers (lets the host reject a stale answer);
 *   empty in an offer.
 * - `cand`: `<type><priority base36>,<address>,<port base36>` with type `h` host, `s` srflx,
 *   `p` prflx, `r` relay. An mDNS host name `<uuid>.local` is written `~<uuid as 22 b64url chars>`.
 *
 * Only UDP candidates of component 1 are kept (browsers do not connect to each other over ICE-TCP
 * without TURN). Related address and port are dropped (privacy; ICE does not need them). Up to
 * `MAX_CANDIDATES` candidates, highest priority first.
 */

export type SignalKind = 'offer' | 'answer';
export type DtlsSetup = 'actpass' | 'active' | 'passive';
export type CandidateType = 'host' | 'srflx' | 'prflx' | 'relay';

export interface ReducedCandidate {
  type: CandidateType;
  priority: number;
  address: string;
  port: number;
}

/** The essential part of a data-channel SDP. */
export interface ReducedSdp {
  kind: SignalKind;
  ufrag: string;
  pwd: string;
  /** Fingerprint hash function, e.g. `sha-256`. */
  fpAlg: string;
  /** Fingerprint as upper-case hex pairs joined by `:`. */
  fp: string;
  setup: DtlsSetup;
  mid: string;
  candidates: ReducedCandidate[];
  /** Answer only: the ufrag of the offer it answers. */
  re?: string;
}

export const MAX_CANDIDATES = 10;
const FORMAT_VERSION = '1';

export class SdpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SdpError';
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Reduce                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

const CAND_TYPES: readonly CandidateType[] = ['host', 'srflx', 'prflx', 'relay'];

/** Parses one `candidate:` attribute value (with or without the `a=` prefix). Null if unusable. */
export function parseCandidate(line: string): ReducedCandidate | null {
  const v = line.replace(/^a=/, '').replace(/^candidate:/, '');
  const f = v.trim().split(/\s+/);
  // foundation component transport priority address port "typ" type …
  if (f.length < 8 || f[6] !== 'typ') return null;
  if (f[1] !== '1') return null;
  if (f[2].toLowerCase() !== 'udp') return null;
  const priority = Number(f[3]);
  const port = Number(f[5]);
  const type = f[7] as CandidateType;
  if (!Number.isFinite(priority) || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  if (!CAND_TYPES.includes(type)) return null;
  const address = f[4];
  if (!address || /[|;,\s]/.test(address)) return null;
  return { type, priority, address, port };
}

/** Keeps the essential lines of a data-channel SDP. Throws `SdpError` if one is missing. */
export function reduceSdp(sdp: string, kind: SignalKind): ReducedSdp {
  const lines = sdp.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let ufrag = '';
  let pwd = '';
  let fpAlg = '';
  let fp = '';
  let setup: DtlsSetup | '' = '';
  let mid = '';
  const cands: ReducedCandidate[] = [];
  let inApplication = false;
  let seenMedia = false;
  for (const l of lines) {
    if (l.startsWith('m=')) {
      // Only the first application section counts (a data channel has exactly one).
      inApplication = !seenMedia && l.startsWith('m=application');
      seenMedia = true;
      continue;
    }
    if (seenMedia && !inApplication) continue;
    if (l.startsWith('a=ice-ufrag:') && !ufrag) ufrag = l.slice(12);
    else if (l.startsWith('a=ice-pwd:') && !pwd) pwd = l.slice(10);
    else if (l.startsWith('a=fingerprint:') && !fp) {
      const [alg, val] = l.slice(14).split(/\s+/);
      fpAlg = (alg ?? '').toLowerCase();
      fp = (val ?? '').toUpperCase();
    } else if (l.startsWith('a=setup:') && !setup) {
      const s = l.slice(8);
      if (s === 'actpass' || s === 'active' || s === 'passive') setup = s;
    } else if (l.startsWith('a=mid:') && !mid && inApplication) mid = l.slice(6);
    else if (l.startsWith('a=candidate:')) {
      const c = parseCandidate(l);
      if (c && !cands.some((o) => o.address === c.address && o.port === c.port)) cands.push(c);
    }
  }
  if (!seenMedia) throw new SdpError('no media section');
  if (!ufrag || !pwd) throw new SdpError('no ICE credentials');
  if (!fp || !fpAlg || !/^[0-9A-F]{2}(:[0-9A-F]{2})+$/.test(fp)) throw new SdpError('no fingerprint');
  if (!setup) setup = kind === 'offer' ? 'actpass' : 'active';
  if (!mid) mid = '0';
  const candidates = cands
    .map((c, i) => ({ c, i }))
    .sort((x, y) => y.c.priority - x.c.priority || x.i - y.i)
    .slice(0, MAX_CANDIDATES)
    .map((x) => x.c);
  return { kind, ufrag, pwd, fpAlg, fp, setup, mid, candidates };
}

/* ---------------------------------------------------------------------------------------------- */
/* Rebuild                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

/** Small stable hash for a session id (digits only, no leading zero). */
function sessionId(r: ReducedSdp): string {
  let h = 2166136261;
  for (const ch of r.ufrag + r.pwd) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return String(1_000_000_000 + (h % 1_000_000_000));
}

/** A complete data-channel SDP from its reduced form. Lines end in CRLF. */
export function rebuildSdp(r: ReducedSdp): string {
  const out = [
    'v=0',
    `o=- ${sessionId(r)} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    `a=group:BUNDLE ${r.mid}`,
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
  ];
  r.candidates.forEach((c, i) => {
    const rel = c.type === 'host' ? '' : ' raddr 0.0.0.0 rport 0';
    out.push(`a=candidate:${i + 1} 1 udp ${c.priority} ${c.address} ${c.port} typ ${c.type}${rel} generation 0`);
  });
  out.push(
    'a=end-of-candidates',
    `a=ice-ufrag:${r.ufrag}`,
    `a=ice-pwd:${r.pwd}`,
    `a=fingerprint:${r.fpAlg} ${r.fp}`,
    `a=setup:${r.setup}`,
    `a=mid:${r.mid}`,
    'a=sctp-port:5000',
    'a=max-message-size:262144',
  );
  return out.join('\r\n') + '\r\n';
}

/* ---------------------------------------------------------------------------------------------- */
/* base64url                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

export function bytesToBase64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlToBytes(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new SdpError('not base64url');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new SdpError('not base64url');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------------------------------------------------------------------------------------------- */
/* Compact text form                                                                                */
/* ---------------------------------------------------------------------------------------------- */

const UUID_LOCAL = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;

function packAddress(a: string): string {
  const m = UUID_LOCAL.exec(a);
  if (!m) return a;
  const hex = m.slice(1).join('');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return '~' + bytesToBase64url(bytes);
}

function unpackAddress(a: string): string {
  if (!a.startsWith('~')) return a;
  const b = base64urlToBytes(a.slice(1));
  if (b.length !== 16) throw new SdpError('bad mDNS name');
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`;
}

const SETUP_TO: Record<DtlsSetup, string> = { actpass: 'A', active: 'a', passive: 'p' };
const SETUP_FROM: Record<string, DtlsSetup> = { A: 'actpass', a: 'active', p: 'passive' };
const TYPE_TO: Record<CandidateType, string> = { host: 'h', srflx: 's', prflx: 'p', relay: 'r' };
const TYPE_FROM: Record<string, CandidateType> = { h: 'host', s: 'srflx', p: 'prflx', r: 'relay' };

function hexToBytes(fp: string): Uint8Array {
  const parts = fp.split(':');
  return Uint8Array.from(parts.map((p) => parseInt(p, 16)));
}
function bytesToHex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

const ICE_CHARS = /^[A-Za-z0-9+/]+$/;

/** The compact text line (before deflate). */
export function packSignal(r: ReducedSdp): string {
  if (!ICE_CHARS.test(r.ufrag) || !ICE_CHARS.test(r.pwd)) throw new SdpError('bad ICE credentials');
  if (r.re !== undefined && r.re !== '' && !ICE_CHARS.test(r.re)) throw new SdpError('bad ICE credentials');
  if (/[|;,:\s]/.test(r.mid) || /[|:\s]/.test(r.fpAlg)) throw new SdpError('bad field');
  const alg = r.fpAlg === 'sha-256' ? '' : r.fpAlg;
  const cands = r.candidates
    .map((c) => `${TYPE_TO[c.type]}${c.priority.toString(36)},${packAddress(c.address)},${c.port.toString(36)}`)
    .join(';');
  return [
    FORMAT_VERSION,
    r.kind === 'offer' ? 'o' : 'a',
    SETUP_TO[r.setup],
    r.mid,
    r.ufrag,
    r.pwd,
    `${alg}:${bytesToBase64url(hexToBytes(r.fp))}`,
    r.re ?? '',
    cands,
  ].join('|');
}

/** Inverse of `packSignal`. Throws `SdpError` on anything malformed. */
export function unpackSignal(s: string): ReducedSdp {
  const f = s.split('|');
  if (f.length !== 9 || f[0] !== FORMAT_VERSION) throw new SdpError('unknown format');
  const kind: SignalKind | undefined = f[1] === 'o' ? 'offer' : f[1] === 'a' ? 'answer' : undefined;
  const setup = SETUP_FROM[f[2]];
  if (!kind || !setup) throw new SdpError('bad header');
  const [mid, ufrag, pwd] = [f[3], f[4], f[5]];
  if (!mid || !ICE_CHARS.test(ufrag) || !ICE_CHARS.test(pwd)) throw new SdpError('bad ICE credentials');
  const colon = f[6].indexOf(':');
  if (colon < 0) throw new SdpError('bad fingerprint');
  const fpAlg = f[6].slice(0, colon) || 'sha-256';
  const fpBytes = base64urlToBytes(f[6].slice(colon + 1));
  if (fpBytes.length < 16) throw new SdpError('bad fingerprint');
  const candidates: ReducedCandidate[] = [];
  if (f[8]) {
    for (const c of f[8].split(';')) {
      const [tp, addr, port36] = c.split(',');
      const type = TYPE_FROM[tp?.[0] ?? ''];
      const priority = parseInt(tp?.slice(1) ?? '', 36);
      const port = parseInt(port36 ?? '', 36);
      if (!type || !Number.isFinite(priority) || !addr || !Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new SdpError('bad candidate');
      }
      candidates.push({ type, priority, address: unpackAddress(addr), port });
    }
  }
  const out: ReducedSdp = { kind, ufrag, pwd, fpAlg, fp: bytesToHex(fpBytes), setup, mid, candidates };
  if (f[7]) {
    if (!ICE_CHARS.test(f[7])) throw new SdpError('bad re');
    out.re = f[7];
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------- */
/* Deflate + base64url                                                                              */
/* ---------------------------------------------------------------------------------------------- */

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  const chunks: Uint8Array[] = [];
  const reading = (async () => {
    const reader = stream.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  })();
  // Errors surface through the reader; the writer's promises are awaited to avoid unhandled rejections.
  const writing = writer.write(bytes as Uint8Array<ArrayBuffer>).then(() => writer.close());
  await Promise.all([reading, writing]);
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Upper bound for an inflated signal (a sane compact line is a few hundred bytes). */
const MAX_INFLATED = 8192;

/** Text → deflate-raw → base64url. */
export async function deflateToBase64url(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  return bytesToBase64url(await pipe(bytes, new CompressionStream('deflate-raw')));
}

/** base64url → inflate-raw → text. Throws `SdpError` if it is not a deflated text. */
export async function inflateFromBase64url(s: string): Promise<string> {
  const bytes = base64urlToBytes(s);
  let out: Uint8Array;
  try {
    out = await pipe(bytes, new DecompressionStream('deflate-raw'));
  } catch {
    throw new SdpError('not deflated');
  }
  if (out.length > MAX_INFLATED) throw new SdpError('too large');
  return new TextDecoder().decode(out);
}

/** Reduced SDP → wire form. */
export async function encodeSignal(r: ReducedSdp): Promise<string> {
  return deflateToBase64url(packSignal(r));
}

/** Wire form → reduced SDP. Throws `SdpError` on anything malformed. */
export async function decodeSignal(s: string): Promise<ReducedSdp> {
  return unpackSignal(await inflateFromBase64url(s.trim()));
}

/** Full SDP → wire form (reduce, then encode). `re` is set on answers. */
export async function encodeSdp(sdp: string, kind: SignalKind, re?: string): Promise<string> {
  const r = reduceSdp(sdp, kind);
  if (re) r.re = re;
  return encodeSignal(r);
}
