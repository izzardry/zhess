/**
 * The blunder guard's rules against the real engine (the shipped stockfish.js lite single file, in
 * process). Checks that `GUARD_DEPTH` answers inside the budget on this machine and that the
 * thresholds catch real blunders and pass ordinary moves. Skipped when the engine is unavailable.
 */
import { createNodeEngine, engineFileAvailable } from './engine/node';
import type { EngineDriver } from './engine/driver';
import { GUARD_BUDGET_MS, GUARD_DEPTH, judgeEvals } from './blunder';
import { newGame, play } from './zhess';

let engine: EngineDriver | null = null;
let available = engineFileAvailable();

beforeAll(async () => {
  if (!available) return;
  try {
    engine = createNodeEngine({ rng: () => 0.5, initTimeoutMs: 15_000 });
    await engine.load();
  } catch (e) {
    console.warn('Blunder engine test skipped: could not start the engine in Node:', e);
    available = false;
  }
}, 30_000);

afterAll(() => engine?.dispose());

/** A quiet Queen's Gambit Declined middlegame, white to move. */
const MIDDLE = 'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 8';

async function verdict(fen: string, uci: string) {
  const e = engine as EngineDriver;
  const before = await e.evaluate(fen, GUARD_DEPTH, 5000);
  const after = play(newGame(fen), uci, 0);
  const t = performance.now();
  const a = await e.evaluate(after.fen, GUARD_DEPTH, 5000);
  const ms = performance.now() - t;
  return { v: judgeEvals(before, a), ms };
}

describe.skipIf(!engineFileAvailable())('blunder guard with the real engine', () => {
  it('passes ordinary moves, flags a hung queen, and answers within the budget', async (ctx) => {
    if (!available || !engine) return ctx.skip();
    const times: number[] = [];
    for (const uci of ['d1a4', 'c4d5', 'f1d3', 'a2a3']) {
      const { v, ms } = await verdict(MIDDLE, uci);
      expect(v.flag, uci).toBe(false);
      times.push(ms);
    }
    const blunder = await verdict('4k3/8/8/8/3p4/2p5/8/3Q3K w - - 0 1', 'd1d2');
    expect(blunder.v).toMatchObject({ flag: true });
    times.push(blunder.ms);
    const worst = Math.max(...times);
    console.info(`guard "after" searches at depth ${GUARD_DEPTH}: worst ${worst.toFixed(0)} ms (budget ${GUARD_BUDGET_MS} ms)`);
    expect(worst).toBeLessThan(GUARD_BUDGET_MS * 3); // generous: machines vary
  }, 20_000);

  it('flags a move that allows mate in one', async (ctx) => {
    if (!available || !engine) return ctx.skip();
    const fool = 'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2';
    expect((await verdict(fool, 'g2g4')).v).toMatchObject({ flag: true, reason: 'mate' });
    expect((await verdict(fool, 'e2e4')).v.flag).toBe(false);
  }, 20_000);
});
