/**
 * Time formatting (DESIGN 11, 8.4).
 */

/** Below this the clock shows tenths and turns bold (DESIGN 11). */
export const LOW_TIME_MS = 10_000;

/**
 * A chess clock reading: `m:ss` (minutes are not wrapped into hours, e.g. `90:00`), and
 * `s.t` with tenths below 10 seconds. Rounds down, so a clock never shows more than is left.
 * Zero and negative values show `0.0`.
 */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0.0';
  if (ms < LOW_TIME_MS) {
    const tenths = Math.floor(ms / 100);
    return `${Math.floor(tenths / 10)}.${tenths % 10}`;
  }
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** True when the clock should show tenths and bold weight. */
export function isLowTime(ms: number): boolean {
  return ms < LOW_TIME_MS;
}

/**
 * Elapsed time (time used, game duration): `m:ss`, or `h:mm:ss` from one hour, as in Zudoku.
 * Takes milliseconds, rounds down to whole seconds.
 */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
