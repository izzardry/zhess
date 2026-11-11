/**
 * Feature flags.
 *
 * The overnight build switches a non-foundational feature off here when it still fails its
 * tests after three fix rounds (PLAN.md section 1, rule 4). Every flag set to `false` must
 * have a matching entry under "Open items" in docs/BUILD-LOG.md. Code that renders or runs
 * a flagged feature checks the flag and hides the feature cleanly when it is off.
 */
const defaults = {
  /** Milestone 2: the computer opponent (Stockfish in a worker). */
  computer: true,
  /** Milestone 2: the chess clock. */
  clock: true,
  /** Milestone 2: premoves while the opponent is thinking. */
  premove: true,
  /** Milestone 2: the hint bulb (tap: best move, hold: threat peek). */
  hint: true,
  /** Milestone 2: the blunder guard inside the helpers shield. */
  blunderGuard: true,
  /** Milestone 3: peer-to-peer rooms. */
  rooms: true,
  /** Milestone 3: rooms through the public PeerJS broker. */
  peerjsBroker: true,
  /** Milestone 3: manual link + QR signalling fallback. */
  manualSignalling: true,
  /** Platform: coach-mark tutorial on the first game. */
  tutorial: true,
  /** Platform: once-only donation prompt after the first win. */
  donationPrompt: true,
  /** Platform: install bottom sheet and pill. */
  installPrompt: true,
};

export type FeatureFlag = keyof typeof defaults;

/** Typed as plain booleans so code can test a flag either way without literal-type errors. */
export const flags: Readonly<Record<FeatureFlag, boolean>> = defaults;
