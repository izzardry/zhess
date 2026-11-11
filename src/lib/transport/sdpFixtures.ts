/**
 * Real-looking data-channel SDPs as browsers produce them after ICE gathering completed
 * (non-trickle). Addresses are documentation ranges; mDNS names are random UUIDs. Test-only.
 */
const crlf = (lines: string[]) => lines.join('\r\n') + '\r\n';

/** Chrome 13x offer: mDNS host, srflx, ICE-TCP (dropped), session-level extras. */
export const CHROME_OFFER = crlf([
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 54400 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 203.0.113.7',
  'a=candidate:2999745851 1 udp 2113937151 4f1b5d8a-9f0e-4b7e-9c1e-3d2a1b0c9e8f.local 54400 typ host generation 0 network-cost 999',
  'a=candidate:842163049 1 udp 1677729535 203.0.113.7 54400 typ srflx raddr 0.0.0.0 rport 0 generation 0 network-cost 999',
  'a=candidate:1467250027 1 tcp 1518280447 4f1b5d8a-9f0e-4b7e-9c1e-3d2a1b0c9e8f.local 9 typ host tcptype active generation 0 network-cost 999',
  'a=ice-ufrag:Cyyg',
  'a=ice-pwd:8Jz4rLZGBLSmFpFnHOZbUeq7',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 7B:8B:F0:65:5F:78:E2:51:3B:AC:6F:F3:3F:46:1B:35:DC:B8:5F:64:1A:24:C2:43:F0:A1:58:D0:A1:2C:19:08',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
]);

/** Chrome answer to a Chrome offer, with an IPv6 host candidate. */
export const CHROME_ANSWER = crlf([
  'v=0',
  'o=- 2117458820471638254 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 61322 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 198.51.100.23',
  'b=AS:30',
  'a=candidate:3711021478 1 udp 2122260223 0d6c3a9e-1b2f-4c5d-8e7f-a0b1c2d3e4f5.local 61322 typ host generation 0 network-id 1 network-cost 10',
  'a=candidate:1958281990 1 udp 2122194687 2001:db8::1c2:3ff:fe4a:5b6c 49152 typ host generation 0 network-id 2 network-cost 10',
  'a=candidate:3058743434 1 udp 1686052607 198.51.100.23 61322 typ srflx raddr 0.0.0.0 rport 0 generation 0 network-id 1 network-cost 10',
  'a=ice-ufrag:Xq9P',
  'a=ice-pwd:mE8x0rG+2zXKp/1cVsQwLw9u',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 0A:4C:2E:91:5D:7F:B3:68:12:AF:C0:EE:44:19:8B:D2:73:5A:06:3C:9E:B1:28:F4:6D:E7:50:A9:31:CB:84:1F',
  'a=setup:active',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
]);

/** Safari 18 offer (iOS): mDNS host, srflx with real raddr, network-cost 999. */
export const SAFARI_OFFER = crlf([
  'v=0',
  'o=- 6386367394420034318 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 59384 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 192.0.2.41',
  'a=candidate:3245561390 1 udp 2113937151 7c3f2e1d-0a9b-4c8d-b7e6-f5a4d3c2b1a0.local 59384 typ host generation 0 network-cost 999',
  'a=candidate:1803254798 1 udp 1677729535 192.0.2.41 59384 typ srflx raddr 10.0.0.12 rport 59384 generation 0 network-cost 999',
  'a=ice-ufrag:9s7K',
  'a=ice-pwd:Wq0b8J3vT1nYcXk5Lr2pHs6d',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 E2:9A:47:10:6B:3D:C8:F1:55:0E:9C:A2:7B:64:D9:83:1F:A7:3E:C5:28:91:B6:0D:4A:F8:72:E3:15:9C:60:BD',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
]);

/** Safari answer: no srflx (behind a symmetric NAT the STUN answer may be missing). */
export const SAFARI_ANSWER = crlf([
  'v=0',
  'o=- 3399571042551873231 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:1052310233 1 udp 2113937151 9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d.local 64012 typ host generation 0 network-cost 999',
  'a=ice-ufrag:t2Rw',
  'a=ice-pwd:Lk3Zc8QmN0rB5vXy7Pq1Ws4e',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 51:C2:8E:03:F7:6A:BD:94:2E:11:D8:7C:A5:39:60:EF:42:9B:0D:C6:73:18:E5:AA:2F:84:B9:56:07:DC:31:9E',
  'a=setup:active',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
]);

/** Firefox offer: session-level fingerprint, hex credentials, upper-case UDP, end-of-candidates. */
export const FIREFOX_OFFER = crlf([
  'v=0',
  'o=mozilla...THIS_IS_SDPARTA-99.0 7351648214503213785 0 IN IP4 0.0.0.0',
  's=-',
  't=0 0',
  'a=sendrecv',
  'a=fingerprint:sha-256 3C:5E:0B:8D:A1:F4:27:96:C3:6A:1E:D0:85:72:BF:49:E8:13:5C:A7:0F:D2:64:9B:31:CE:78:06:AB:F5:12:83',
  'a=group:BUNDLE 0',
  'a=ice-options:trickle',
  'a=msid-semantic:WMS *',
  'm=application 52941 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 203.0.113.99',
  'a=candidate:0 1 UDP 2122252543 b5e1c0a2-3d4f-4e6a-8b7c-9d0e1f2a3b4c.local 52941 typ host',
  'a=candidate:2 1 TCP 2105524479 b5e1c0a2-3d4f-4e6a-8b7c-9d0e1f2a3b4c.local 9 typ host tcptype active',
  'a=candidate:1 1 UDP 1685987327 203.0.113.99 52941 typ srflx raddr 0.0.0.0 rport 0',
  'a=sendrecv',
  'a=end-of-candidates',
  'a=ice-pwd:6f1a2b3c4d5e6f708192a3b4c5d6e7f8',
  'a=ice-ufrag:a1b2c3d4',
  'a=mid:0',
  'a=setup:actpass',
  'a=sctp-port:5000',
  'a=max-message-size:1073741823',
]);
