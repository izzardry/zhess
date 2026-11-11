/**
 * Smoke test against the real engine: the exact `public/engine/stockfish-19-lite-single.js` the app
 * ships, loaded in-process (the Node branch of the engine file runs under jsdom too, because
 * `process.versions.node` is set). Skipped when the files are missing or the engine cannot start here.
 */
import { Chess } from 'chess.js';
import { createNodeEngine, engineFileAvailable } from './node';
import type { EngineDriver } from './driver';
import { legalUci } from '../levels';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** Black to move can mate with Qh4 (fool's mate). */
const FOOL = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2';

let engine: EngineDriver | null = null;
let available = engineFileAvailable();

beforeAll(async () => {
  if (!available) return;
  try {
    engine = createNodeEngine({ rng: () => 0.5, initTimeoutMs: 15_000 });
    await engine.load();
  } catch (e) {
    console.warn('Engine smoke test skipped: could not start the engine in Node:', e);
    available = false;
  }
}, 30_000);

afterAll(() => engine?.dispose());

describe.skipIf(!engineFileAvailable())('real engine (stockfish.js 19.0.1 lite single)', () => {
  it('announces the options the level table relies on', (ctx) => {
    if (!available || !engine) return ctx.skip();
    expect(engine.hasSkillLevel).toBe(true);
    expect(engine.engineOptions.get('MultiPV')?.max).toBeGreaterThanOrEqual(6);
    expect(engine.engineOptions.get('Skill Level')).toMatchObject({ min: 0, max: 20 });
  });

  it('returns a legal best move for the start position', async (ctx) => {
    if (!available || !engine) return ctx.skip();
    const m = await engine.bestMove(START, 12, { wMs: 20_000, bMs: 20_000, incMs: 0 });
    expect(legalUci(START)).toContain(m);
  }, 20_000);

  it('plays legal moves at humanized and skill levels', async (ctx) => {
    if (!available || !engine) return ctx.skip();
    for (const level of [1, 3, 5]) {
      const m = await engine.bestMove(START, level);
      expect(legalUci(START)).toContain(m);
    }
  }, 20_000);

  it('evaluates from the side to move and finds a mate in one', async (ctx) => {
    if (!available || !engine) return ctx.skip();
    const start = await engine.evaluate(START, 8);
    expect(start?.cp).toBeGreaterThan(-100);
    expect(start?.cp).toBeLessThan(100);
    expect(await engine.evaluate(FOOL, 6)).toEqual({ mate: 1 });
    const mated = new Chess(FOOL);
    mated.move('Qh4');
    expect(await engine.evaluate(mated.fen(), 4)).toEqual({ mate: 0 });
    const lines = await engine.multiPv(FOOL, 3, 6);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({ uci: 'd8h4', eval: { mate: 1 } });
  }, 20_000);
});
