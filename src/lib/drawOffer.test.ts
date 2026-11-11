import { FakeEngine } from './engine/fake';
import { DRAW_EVAL_DEPTH, DRAW_MAX_CP, askComputerDraw, drawAnswer, pastDrawMove } from './drawOffer';
import { newGame, play } from './zhess';

/** Rook endgame at move 31, white to move (30 full moves completed). */
const AT_31 = '4k3/8/8/8/8/8/4r3/R3K3 w - - 0 31';
/** Move 30, black to move: white has played its 30th move, black has not. */
const AT_30_BLACK = '4k3/8/8/8/8/8/4r3/R3K3 b - - 0 30';

describe('pastDrawMove', () => {
  it('needs 30 completed full moves', () => {
    expect(pastDrawMove(newGame())).toBe(false);
    expect(pastDrawMove(newGame(AT_30_BLACK))).toBe(false);
    expect(pastDrawMove(newGame(AT_31))).toBe(true);
    // Black completes move 30.
    expect(pastDrawMove(play(newGame(AT_30_BLACK), 'e8d8', 0))).toBe(true);
  });
});

describe('drawAnswer', () => {
  const g = newGame(AT_31);
  it('accepts within ±0.3 pawns past move 30', () => {
    expect(drawAnswer(g, { cp: 0 })).toBe('accept');
    expect(drawAnswer(g, { cp: DRAW_MAX_CP })).toBe('accept');
    expect(drawAnswer(g, { cp: -DRAW_MAX_CP })).toBe('accept');
  });
  it('declines outside the window, on mate, without an eval, early, or when over', () => {
    expect(drawAnswer(g, { cp: 31 })).toBe('decline');
    expect(drawAnswer(g, { cp: -31 })).toBe('decline');
    expect(drawAnswer(g, { mate: 5 })).toBe('decline');
    expect(drawAnswer(g, { mate: -5 })).toBe('decline');
    expect(drawAnswer(g, null)).toBe('decline');
    expect(drawAnswer(newGame(), { cp: 0 })).toBe('decline');
    expect(drawAnswer({ ...g, end: { result: '1-0', by: 'resign' } }, { cp: 0 })).toBe('decline');
  });
});

describe('askComputerDraw', () => {
  it('asks the engine past move 30', async () => {
    const fake = new FakeEngine({ evals: { [AT_31]: { cp: 12 } } });
    await expect(askComputerDraw(fake, newGame(AT_31))).resolves.toBe('accept');
    expect(fake.calls).toEqual([{ method: 'evaluate', args: [AT_31, DRAW_EVAL_DEPTH, 3000] }]);
  });

  it('declines a clear advantage', async () => {
    const fake = new FakeEngine({ evals: { [AT_31]: { cp: -150 } } });
    await expect(askComputerDraw(fake, newGame(AT_31))).resolves.toBe('decline');
  });

  it('does not ask the engine before move 30', async () => {
    const fake = new FakeEngine();
    await expect(askComputerDraw(fake, newGame())).resolves.toBe('decline');
    expect(fake.calls).toEqual([]);
  });

  it('declines when the engine fails, times out or throws', async () => {
    const failing = new FakeEngine({ loadResult: 'fail' });
    await expect(askComputerDraw(failing, newGame(AT_31))).resolves.toBe('decline');
    const silent = new FakeEngine({ evals: { [AT_31]: null } });
    await expect(askComputerDraw(silent, newGame(AT_31))).resolves.toBe('decline');
    const throwing = { evaluate: () => Promise.reject(new Error('boom')) };
    await expect(askComputerDraw(throwing, newGame(AT_31))).resolves.toBe('decline');
  });

  it('passes depth and timeout options', async () => {
    const fake = new FakeEngine({ delayMs: 50, evals: { [AT_31]: { cp: 0 } } });
    await expect(askComputerDraw(fake, newGame(AT_31), { depth: 6, timeoutMs: 10 })).resolves.toBe('decline');
    expect(fake.calls[0]).toEqual({ method: 'evaluate', args: [AT_31, 6, 10] });
  });
});
