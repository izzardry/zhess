/**
 * Transports (DESIGN 9.1): one reliable, ordered data channel behind the `Transport` interface.
 *
 * - `createPeerJsFactory` — primary: the public PeerJS broker, anchor-or-dial (DESIGN 9.2).
 * - `startManualHost` / `answerManualOffer` / `handOverAnswer` — the manual fallback (DESIGN 9.9).
 * - `createMemoryPair` / `createMemoryNetwork` — in-memory, for tests (PLAN 7).
 *
 * The room logic above does not know which one is in use. See `RoomTransport` in common.ts for the
 * shared semantics.
 */
export {
  backoffMs,
  ICE_SERVERS,
  isMessage,
  parseMessage,
  type RoomTransport,
  type Timers,
  type TransportFailureKind,
  type TransportRole,
} from './common';
export {
  createMemoryNetwork,
  createMemoryPair,
  type DropRule,
  type MemoryLinkControls,
  type MemoryLogEntry,
  type MemoryNetwork,
  type MemoryOptions,
  type MemoryPair,
  type MemoryTransport,
} from './memory';
export {
  anchorPeerId,
  classifyPeerError,
  createPeerJsFactory,
  type DataConnectionLike,
  type PeerCtor,
  type PeerErrorAction,
  type PeerJsOptions,
  type PeerJsTransport,
  type PeerLike,
} from './peerjs';
export {
  answerLink,
  answerManualOffer,
  handOverAnswer,
  handOverChannelName,
  MANUAL_CHANNEL_LABEL,
  ManualError,
  offerLink,
  parseManualInput,
  startManualHost,
  waitForGathering,
  type HandOverOptions,
  type ManualErrorReason,
  type ManualGuest,
  type ManualHost,
  type ManualInput,
  type ManualOptions,
  type ManualTransport,
} from './manual';
export {
  decodeSignal,
  encodeSdp,
  encodeSignal,
  rebuildSdp,
  reduceSdp,
  SdpError,
  type ReducedCandidate,
  type ReducedSdp,
  type SignalKind,
} from './sdp';
