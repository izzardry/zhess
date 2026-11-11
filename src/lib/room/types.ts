/**
 * Public types of the room controller (DESIGN 9). The contract types (`RoomController`,
 * `RoomSnapshot`, messages) live in `lib/types.ts`; this file adds the controller's options and
 * the extra snapshot fields the room UI needs.
 */
import type {
  ColorChoice,
  GameLog,
  Now,
  RequestKind,
  RoomController,
  RoomNotice,
  RoomSnapshot,
  Rng,
  Store,
  TcString,
  Transport,
  TransportFactory,
  ZhessApi,
} from '../types';
import type { Timers, TransportFailureKind } from '../transport/common';

/** Settings a device uses when it creates the room (DESIGN 4.1: clock and color of the start screen). */
export interface RoomCreateSettings {
  /** Time control of game 1, e.g. `5+0`, or null for no clock. */
  readonly tc: TcString | null;
  /** The creator's color in game 1. `random` is resolved with the injected `rng`. */
  readonly color: ColorChoice;
}

/** Time already spent on this device's own running turn, e.g. restored after a reload (DESIGN 9.8). */
export interface InitialTurn {
  readonly n: number;
  readonly epoch: number;
  /** Plies in the game at that turn. */
  readonly len: number;
  readonly ms: number;
}

export interface RoomControllerOptions {
  /** Room code, e.g. `K7QW2M`. */
  readonly code: string;
  /** Where the room record and the room's games are kept. */
  readonly store: Store;
  /** An existing transport (e.g. a manual one). Takes precedence over `factory`. */
  readonly transport?: Transport | null;
  /** Creates the transport for `code` (PeerJS in the app, the memory network in tests). */
  readonly factory?: TransportFactory | null;
  /** Rules API. Default: the `zhess` singleton. */
  readonly zhess?: ZhessApi;
  /**
   * Monotonic clock for the running turn (DESIGN 9.8). Default `performance.now()`. Pass the same
   * function to `useClock({ now, external: snapshot.clock })`.
   */
  readonly now?: Now;
  /** Wall clock for stored stamps (`createdAt`, `lastSeenAt`, `lastPlayedAt`). Default `Date.now`. */
  readonly wallNow?: Now;
  /** Randomness for the key, nonces and a random color. Default: WebCrypto (`Math.random` for the color). */
  readonly rng?: Rng;
  /** Timer functions (ping, resend, flag, retry). Default: the global ones. */
  readonly timers?: Timers;
  /**
   * Create intent (Start with ROOM). A device without a room record creates an open room at once
   * with these settings (seat 0) and shows it in its history. Leave unset for an invite link:
   * the device then only joins (or rejoins) and never creates, unless both devices are newcomers,
   * where the anchor creates with these settings or the defaults (no clock, random color).
   */
  readonly create?: RoomCreateSettings | null;
  /** The room is open in another tab (DESIGN 9.12): load it, never connect, lock the board. */
  readonly readOnly?: boolean;
  /** Time already spent on this device's running turn, applied when the position matches. */
  readonly initialTurn?: InitialTurn | null;
  /** Ping interval (DESIGN 9.11). Default 5000 ms. */
  readonly pingMs?: number;
  /** Missed ping intervals that mark the peer disconnected. Default 3. */
  readonly missLimit?: number;
  /** How long the opponent's clock must read zero before this device may claim it. Default 2000 ms. */
  readonly graceMs?: number;
  /** Unacknowledged moves and unanswered requests are sent again after this. Default 3000 ms. */
  readonly resendMs?: number;
  /** First delay before reconnecting after a failed challenge or a declined rejoin. Default 5000 ms, doubling to 30 s. */
  readonly retryMs?: number;
  /** Largest JSON message the controller sends; bigger `logs` / `grant` payloads are split. Default 200 000. */
  readonly maxMessageBytes?: number;
}

/**
 * Where the connection stands, for the room UI.
 * - `connecting`: no open channel (waiting for the opponent or reconnecting; see `presence`).
 * - `handshake`: a channel is open; hello and the key challenge are running.
 * - `joining`: this device asked for a seat (join or rejoin) and waits for `welcome`, `grant` or `deny`.
 * - `approving`: a device without the key asks for a seat; `requests.incoming` is `rejoin`.
 * - `syncing`: authenticated, waiting for the opponent's `head`.
 * - `live`: connected, synced, playing.
 * - `stranger`: the other device failed the key challenge (or was declined); retrying later.
 * - `version`: the other device runs another protocol version.
 * - `denied`: the opponent declined this device's rejoin.
 * - `read-only`: the room is open in another tab.
 * - `closed`: `leave()` was called.
 */
export type RoomPhase =
  | 'connecting'
  | 'handshake'
  | 'joining'
  | 'approving'
  | 'syncing'
  | 'live'
  | 'stranger'
  | 'version'
  | 'denied'
  | 'read-only'
  | 'closed';

/** `RoomSnapshot` plus what the room UI needs beyond the contract. Immutable; a new object per change. */
export interface RoomState extends RoomSnapshot {
  readonly phase: RoomPhase;
  /** Connected and synced with the opponent (presence `connected`). */
  readonly live: boolean;
  /** Every game of the room this device holds, oldest first; the last one is the current game. */
  readonly logs: readonly GameLog[];
  /** This device's seat is to move in the current, unfinished game. */
  readonly myTurn: boolean;
  /** `move()` would be accepted now (seated, my turn, not locked, not over). */
  readonly canMove: boolean;
  /** Which requests `ask()` would send now. */
  readonly canAsk: Readonly<Record<RequestKind, boolean>>;
  /** Transport failure including `peer-gone` (a lost channel), which `failure` leaves out. */
  readonly failureKind: TransportFailureKind | null;
  /** The room record's `lastSeenAt` (last successful sync, wall clock), 0 = never. */
  readonly lastSeenAt: number;
}

/** The room controller: `RoomController` with a richer snapshot and a few extras for the UI and tests. */
export interface RoomControllerApi extends RoomController {
  readonly snapshot: RoomState;
  subscribe(cb: (s: RoomState) => void): () => void;
  /** Called once per notice, in order (a snapshot subscriber may see only the latest). */
  onNotice(cb: (n: RoomNotice) => void): () => void;
  /** Plays this device's move; `ms` defaults to `elapsed()`. False if not allowed or illegal. */
  move(uci: string, ms?: number): boolean;
  ask(kind: RequestKind): boolean;
  reply(kind: RequestKind | 'rejoin', ok: boolean): boolean;
  resign(): boolean;
  /** Ends the game on time if the running clock allows it (own clock at zero, the opponent's 2 s past zero). */
  flag(): boolean;
  /** Stops everything and closes the transport. The controller is inert afterwards. */
  leave(): void;
  /** Uses another transport from now on (e.g. a manual connection, or back to the broker). */
  attach(t: Transport): void;
  /** Ms the side to move has spent on the running turn, read now with `now()`. */
  elapsed(): number;
  /** Resolves when every received message has been handled (tests). */
  idle(): Promise<void>;
  /** The attached transport, if any. */
  readonly transport: Transport | null;
}

export type { RoomNotice };
