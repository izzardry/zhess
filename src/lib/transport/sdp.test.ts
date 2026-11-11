import { describe, expect, it } from 'vitest';
import {
  base64urlToBytes,
  bytesToBase64url,
  decodeSignal,
  deflateToBase64url,
  encodeSdp,
  encodeSignal,
  inflateFromBase64url,
  MAX_CANDIDATES,
  packSignal,
  parseCandidate,
  rebuildSdp,
  reduceSdp,
  SdpError,
  unpackSignal,
  type ReducedSdp,
} from './sdp';
import { CHROME_ANSWER, CHROME_OFFER, FIREFOX_OFFER, SAFARI_ANSWER, SAFARI_OFFER } from './sdpFixtures';

const FIXTURES: [string, string, 'offer' | 'answer'][] = [
  ['Chrome offer', CHROME_OFFER, 'offer'],
  ['Chrome answer', CHROME_ANSWER, 'answer'],
  ['Safari offer', SAFARI_OFFER, 'offer'],
  ['Safari answer', SAFARI_ANSWER, 'answer'],
  ['Firefox offer', FIREFOX_OFFER, 'offer'],
];

describe('reduceSdp', () => {
  it('keeps credentials, fingerprint, setup, mid and UDP candidates of a Chrome offer', () => {
    const r = reduceSdp(CHROME_OFFER, 'offer');
    expect(r).toEqual({
      kind: 'offer',
      ufrag: 'Cyyg',
      pwd: '8Jz4rLZGBLSmFpFnHOZbUeq7',
      fpAlg: 'sha-256',
      fp: '7B:8B:F0:65:5F:78:E2:51:3B:AC:6F:F3:3F:46:1B:35:DC:B8:5F:64:1A:24:C2:43:F0:A1:58:D0:A1:2C:19:08',
      setup: 'actpass',
      mid: '0',
      candidates: [
        { type: 'host', priority: 2113937151, address: '4f1b5d8a-9f0e-4b7e-9c1e-3d2a1b0c9e8f.local', port: 54400 },
        { type: 'srflx', priority: 1677729535, address: '203.0.113.7', port: 54400 },
      ],
    });
  });

  it('reads Chrome answers with IPv6 and the active role', () => {
    const r = reduceSdp(CHROME_ANSWER, 'answer');
    expect(r.setup).toBe('active');
    expect(r.pwd).toBe('mE8x0rG+2zXKp/1cVsQwLw9u');
    expect(r.candidates.map((c) => c.address)).toEqual([
      '0d6c3a9e-1b2f-4c5d-8e7f-a0b1c2d3e4f5.local',
      '2001:db8::1c2:3ff:fe4a:5b6c',
      '198.51.100.23',
    ]);
  });

  it('reads Safari SDPs and drops the related address', () => {
    const r = reduceSdp(SAFARI_OFFER, 'offer');
    expect(r.ufrag).toBe('9s7K');
    expect(r.candidates).toHaveLength(2);
    expect(JSON.stringify(r)).not.toContain('10.0.0.12');
    expect(reduceSdp(SAFARI_ANSWER, 'answer').candidates).toHaveLength(1);
  });

  it('reads Firefox SDPs: session fingerprint, hex credentials, upper-case UDP, no TCP', () => {
    const r = reduceSdp(FIREFOX_OFFER, 'offer');
    expect(r.ufrag).toBe('a1b2c3d4');
    expect(r.pwd).toBe('6f1a2b3c4d5e6f708192a3b4c5d6e7f8');
    expect(r.fp.startsWith('3C:5E:0B')).toBe(true);
    expect(r.candidates.map((c) => c.type)).toEqual(['host', 'srflx']);
  });

  it('throws SdpError when essentials are missing', () => {
    expect(() => reduceSdp('', 'offer')).toThrow(SdpError);
    expect(() => reduceSdp(CHROME_OFFER.replace(/a=ice-pwd:.*\r\n/, ''), 'offer')).toThrow(/credentials/);
    expect(() => reduceSdp(CHROME_OFFER.replace(/a=fingerprint:.*\r\n/, ''), 'offer')).toThrow(/fingerprint/);
  });

  it('defaults the setup role and mid when absent', () => {
    const r = reduceSdp(CHROME_ANSWER.replace('a=setup:active\r\n', '').replace('a=mid:0\r\n', ''), 'answer');
    expect(r.setup).toBe('active');
    expect(r.mid).toBe('0');
  });

  it('keeps at most MAX_CANDIDATES, highest priority first, without duplicates', () => {
    const extra = Array.from({ length: 14 }, (_, i) => `a=candidate:${i} 1 udp ${1000 + i} 192.0.2.${i + 1} ${40000 + i} typ host`);
    const dup = 'a=candidate:99 1 udp 5 192.0.2.1 40000 typ host';
    const sdp = CHROME_OFFER.replace('a=ice-ufrag', [...extra, dup, 'a=ice-ufrag'].join('\r\n'));
    const r = reduceSdp(sdp, 'offer');
    expect(r.candidates).toHaveLength(MAX_CANDIDATES);
    const prios = r.candidates.map((c) => c.priority);
    expect([...prios].sort((a, b) => b - a)).toEqual(prios);
    expect(r.candidates[0].priority).toBe(2113937151);
  });

  it('ignores lines of a second media section', () => {
    const sdp = CHROME_OFFER + 'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=ice-ufrag:ZZZZ\r\na=mid:1\r\n';
    expect(reduceSdp(sdp, 'offer').ufrag).toBe('Cyyg');
  });
});

describe('parseCandidate', () => {
  it('rejects TCP, RTCP components, bad ports and odd addresses', () => {
    expect(parseCandidate('candidate:1 1 tcp 1 192.0.2.1 9 typ host tcptype active')).toBeNull();
    expect(parseCandidate('candidate:1 2 udp 1 192.0.2.1 5000 typ host')).toBeNull();
    expect(parseCandidate('candidate:1 1 udp 1 192.0.2.1 70000 typ host')).toBeNull();
    expect(parseCandidate('candidate:1 1 udp 1 a|b 5000 typ host')).toBeNull();
    expect(parseCandidate('candidate:1 1 udp 1 192.0.2.1 5000 typ weird')).toBeNull();
    expect(parseCandidate('garbage')).toBeNull();
    expect(parseCandidate('a=candidate:1 1 udp 7 192.0.2.1 5000 typ relay raddr 1.2.3.4 rport 1')).toEqual({
      type: 'relay',
      priority: 7,
      address: '192.0.2.1',
      port: 5000,
    });
  });
});

describe('rebuildSdp', () => {
  it.each(FIXTURES)('%s: reduce → rebuild → reduce is stable', (_n, sdp, kind) => {
    const r = reduceSdp(sdp, kind);
    const rebuilt = rebuildSdp(r);
    expect(reduceSdp(rebuilt, kind)).toEqual(r);
  });

  it('writes a complete data-channel SDP with CRLF line ends', () => {
    const s = rebuildSdp(reduceSdp(CHROME_OFFER, 'offer'));
    expect(s.endsWith('\r\n')).toBe(true);
    expect(s.split('\r\n').filter(Boolean)).toEqual([
      'v=0',
      expect.stringMatching(/^o=- \d{10} 2 IN IP4 127\.0\.0\.1$/),
      's=-',
      't=0 0',
      'a=group:BUNDLE 0',
      'a=msid-semantic: WMS',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 0.0.0.0',
      'a=candidate:1 1 udp 2113937151 4f1b5d8a-9f0e-4b7e-9c1e-3d2a1b0c9e8f.local 54400 typ host generation 0',
      'a=candidate:2 1 udp 1677729535 203.0.113.7 54400 typ srflx raddr 0.0.0.0 rport 0 generation 0',
      'a=end-of-candidates',
      'a=ice-ufrag:Cyyg',
      'a=ice-pwd:8Jz4rLZGBLSmFpFnHOZbUeq7',
      'a=fingerprint:sha-256 7B:8B:F0:65:5F:78:E2:51:3B:AC:6F:F3:3F:46:1B:35:DC:B8:5F:64:1A:24:C2:43:F0:A1:58:D0:A1:2C:19:08',
      'a=setup:actpass',
      'a=mid:0',
      'a=sctp-port:5000',
      'a=max-message-size:262144',
    ]);
  });

  it('keeps a Firefox answer role and its own mid', () => {
    const r: ReducedSdp = { ...reduceSdp(FIREFOX_OFFER, 'offer'), kind: 'answer', setup: 'passive', mid: 'data' };
    const s = rebuildSdp(r);
    expect(s).toContain('a=group:BUNDLE data\r\n');
    expect(s).toContain('a=mid:data\r\n');
    expect(s).toContain('a=setup:passive\r\n');
  });
});

describe('compact form', () => {
  it.each(FIXTURES)('%s: pack → unpack round trip', (_n, sdp, kind) => {
    const r = reduceSdp(sdp, kind);
    if (kind === 'answer') r.re = 'Cyyg';
    expect(unpackSignal(packSignal(r))).toEqual(r);
  });

  it('packs mDNS names and the sha-256 fingerprint compactly', () => {
    const line = packSignal(reduceSdp(CHROME_OFFER, 'offer'));
    expect(line).not.toContain('.local');
    expect(line).not.toContain('sha-256');
    expect(line.length).toBeLessThan(170);
    expect(line.startsWith('1|o|A|0|Cyyg|8Jz4rLZGBLSmFpFnHOZbUeq7|:')).toBe(true);
  });

  it('keeps a non-default fingerprint algorithm', () => {
    const r = { ...reduceSdp(CHROME_OFFER, 'offer'), fpAlg: 'sha-384', fp: Array(48).fill('AB').join(':') };
    expect(unpackSignal(packSignal(r))).toEqual(r);
  });

  it('keeps an offer with no candidates', () => {
    const r = { ...reduceSdp(CHROME_OFFER, 'offer'), candidates: [] };
    expect(unpackSignal(packSignal(r))).toEqual(r);
  });

  it.each([
    '',
    '2|o|A|0|u|p|:AAAAAAAAAAAAAAAAAAAAAA||',
    '1|x|A|0|u|p|:AAAAAAAAAAAAAAAAAAAAAA||',
    '1|o|Z|0|u|p|:AAAAAAAAAAAAAAAAAAAAAA||',
    '1|o|A|0|u u|p|:AAAAAAAAAAAAAAAAAAAAAA||',
    '1|o|A|0|u|p|AAAA||',
    '1|o|A|0|u|p|:AAAA||',
    '1|o|A|0|u|p|:AAAAAAAAAAAAAAAAAAAAAA||q1,1.2.3.4,1',
    '1|o|A|0|u|p|:AAAAAAAAAAAAAAAAAAAAAA||h1,1.2.3.4,zzzz',
    '1|o|A|0|u|p|:AAAAAAAAAAAAAAAAAAAAAA||h1,~AAAA,1',
    '1|o|A|0|u|p|:AAAAAAAAAAAAAAAAAAAAAA|bad re|',
  ])('rejects malformed line %#', (line) => {
    expect(() => unpackSignal(line)).toThrow(SdpError);
  });

  it('refuses fields that would break the format', () => {
    const r = reduceSdp(CHROME_OFFER, 'offer');
    expect(() => packSignal({ ...r, ufrag: 'a|b' })).toThrow(SdpError);
    expect(() => packSignal({ ...r, mid: 'a b' })).toThrow(SdpError);
  });
});

describe('base64url and deflate', () => {
  it('round-trips bytes through base64url without padding', () => {
    for (const n of [0, 1, 2, 3, 31, 32, 33]) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 250) & 255);
      const s = bytesToBase64url(b);
      expect(s).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(base64urlToBytes(s)).toEqual(b);
    }
    expect(() => base64urlToBytes('a+b')).toThrow(SdpError);
  });

  it('deflate-raw round trip', async () => {
    const text = 'hello hello hello hello ' + 'é✓'.repeat(5);
    const enc = await deflateToBase64url(text);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await inflateFromBase64url(enc)).toBe(text);
  });

  it('rejects data that is not deflated', async () => {
    await expect(inflateFromBase64url('____________')).rejects.toBeInstanceOf(SdpError);
    await expect(decodeSignal('not base64!')).rejects.toBeInstanceOf(SdpError);
  });

  it('rejects a deflated text that is not a signal', async () => {
    await expect(decodeSignal(await deflateToBase64url('hello'))).rejects.toBeInstanceOf(SdpError);
  });
});

describe('encodeSignal / decodeSignal', () => {
  it.each(FIXTURES)('%s: full codec round trip', async (_n, sdp, kind) => {
    const enc = await encodeSdp(sdp, kind, kind === 'answer' ? 'Cyyg' : undefined);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
    const dec = await decodeSignal(enc);
    const expected = reduceSdp(sdp, kind);
    if (kind === 'answer') expected.re = 'Cyyg';
    expect(dec).toEqual(expected);
    // The rebuilt SDP carries the same essentials as the original.
    const { re: _re, ...essentials } = expected;
    expect(reduceSdp(rebuildSdp(dec), kind)).toEqual(essentials);
  });

  it('keeps a typical offer short enough for a small QR code', async () => {
    for (const sdp of [CHROME_OFFER, SAFARI_OFFER, FIREFOX_OFFER]) {
      const enc = await encodeSignal(reduceSdp(sdp, 'offer'));
      expect(enc.length).toBeLessThan(260);
    }
  });

  it('tolerates surrounding whitespace', async () => {
    const enc = await encodeSdp(SAFARI_OFFER, 'offer');
    expect((await decodeSignal(`  ${enc}\n`)).ufrag).toBe('9s7K');
  });
});
