/**
 * `lib/room` — the framework-free room state machine (DESIGN 9, PLAN milestone 3, package 3C).
 *
 * `createRoomController` implements `RoomController` (types.ts) over any `Transport`. The
 * implementation lives in `lib/room/`; this module is the public entry point.
 */
export { createRoomController, DEFAULTS as ROOM_DEFAULTS } from './room/controller';
export type {
  InitialTurn,
  RoomControllerApi,
  RoomControllerOptions,
  RoomCreateSettings,
  RoomPhase,
  RoomState,
} from './room/types';
