import {
  BLUNDER_DROP_CP,
  CONFIRM_WINDOW_MS,
  DECISIVE_CP,
  clampScore,
  fallbackVerdict,
  isConfirmation,
  judgeEvals,
  materialRisk,
  refusedSquare,
} from './blunder';

/** White: Qd1, Kh1. Black: Ke8, pawns d4 and c3. Qd2?? hangs the queen to c3; Qxd4 wins a pawn. */
const HANG = '4k3/8/8/8/3p4/2p5/8/3Q3K w - - 0 1';
/** After 1.f3 e5: 2.g4?? allows Qh4#. */
const FOOL = 'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2';
/** Black pawns d5 (defended by e6); white Nc3, Rd1. Nxd5 is a fair trade, Rxd5 loses the exchange. */
const TRADE = '4k3/8/4p3/3p4/8/2N5/8/3RK3 w - - 0 1';
/** Fool's mate pending: black to move can play Qh4#. */
const MATING = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2';

describe('judgeEvals', () => {
  it('flags a drop of 3 pawns or more', () => {
    // after is from the opponent's side: +300 for them = −300 for the player.
    expect(judgeEvals({ cp: 50 }, { cp: 250 })).toMatchObject({ flag: true, reason: 'drop', dropCp: 300 });
    expect(judgeEvals({ cp: 50 }, { cp: 249 })).toMatchObject({ flag: false, dropCp: 299 });
    expect(judgeEvals({ cp: -100 }, { cp: 100 })).toMatchObject({ flag: false });
    expect(BLUNDER_DROP_CP).toBe(300);
  });

  it('allows when the engine gave no "after" answer', () => {
    expect(judgeEvals({ cp: 0 }, null)).toEqual({ flag: false });
    expect(judgeEvals(null, null)).toEqual({ flag: false });
  });

  it('never flags a mating move', () => {
    expect(judgeEvals({ cp: 0 }, { mate: 0 })).toEqual({ flag: false });
  });

  it('flags a new forced mate within 2 moves', () => {
    expect(judgeEvals({ cp: 0 }, { mate: 1 })).toMatchObject({ flag: true, reason: 'mate' });
    expect(judgeEvals({ cp: 0 }, { mate: 2 })).toMatchObject({ flag: true, reason: 'mate' });
    expect(judgeEvals(null, { mate: 2 })).toMatchObject({ flag: true, reason: 'mate' });
  });

  it('does not flag a mate that was already there', () => {
    expect(judgeEvals({ mate: -3 }, { mate: 2 })).toMatchObject({ flag: false });
    expect(judgeEvals({ mate: -1 }, { mate: 1 })).toMatchObject({ flag: false });
  });

  it('treats a longer new mate as a decisive drop', () => {
    expect(judgeEvals({ cp: 0 }, { mate: 3 })).toMatchObject({ flag: true, reason: 'drop', dropCp: DECISIVE_CP });
  });

  it('clamps scores so a still-winning player is not nagged', () => {
    // From mate in 3 to +8: still winning, drop 200 after clamping.
    expect(judgeEvals({ mate: 3 }, { cp: -800 })).toMatchObject({ flag: false });
    // +20 to +6 (gives away a queen while far ahead): flagged.
    expect(judgeEvals({ cp: 2000 }, { cp: -600 })).toMatchObject({ flag: true, reason: 'drop' });
    // Without "before", only the mate rule applies.
    expect(judgeEvals(null, { cp: 900 })).toEqual({ flag: false });
  });

  it('clampScore', () => {
    expect(clampScore({ cp: 50 })).toBe(50);
    expect(clampScore({ cp: 5000 })).toBe(DECISIVE_CP);
    expect(clampScore({ mate: 2 })).toBe(DECISIVE_CP);
    expect(clampScore({ mate: -2 })).toBe(-DECISIVE_CP);
    expect(clampScore({ mate: 0 })).toBe(-DECISIVE_CP);
  });
});

describe('fallbackVerdict (chess.js only)', () => {
  it('flags a move that hangs the queen', () => {
    expect(fallbackVerdict(HANG, 'd1d2')).toMatchObject({ flag: true, reason: 'hanging' });
    expect(materialRisk(HANG, 'd1d2')).toBe(9);
  });

  it('allows safe moves and winning captures', () => {
    expect(fallbackVerdict(HANG, 'd1d3')).toMatchObject({ flag: false });
    expect(fallbackVerdict(HANG, 'd1d4')).toMatchObject({ flag: false });
    expect(materialRisk(HANG, 'd1d4')).toBe(-1);
  });

  it('flags a move that allows mate in 1', () => {
    expect(fallbackVerdict(FOOL, 'g2g4')).toMatchObject({ flag: true, reason: 'mate-in-1' });
    expect(fallbackVerdict(FOOL, 'e2e4')).toMatchObject({ flag: false });
  });

  it('allows an even trade but flags losing a rook for a pawn', () => {
    // Nxd5 exd5 Rxd5: d5 is defended by the rook, so the knight costs 3 − 1 for a pawn.
    expect(materialRisk(TRADE, 'c3d5')).toBe(1);
    expect(fallbackVerdict(TRADE, 'c3d5')).toMatchObject({ flag: false });
    // Rxd5 exd5: the rook (5) for a pawn, less the pawn won back by Nxd5.
    expect(materialRisk(TRADE, 'd1d5')).toBe(3);
    expect(fallbackVerdict(TRADE, 'd1d5')).toMatchObject({ flag: true, reason: 'hanging' });
  });

  it('never flags a mating move or an illegal one', () => {
    expect(fallbackVerdict(MATING, 'd8h4')).toEqual({ flag: false });
    expect(fallbackVerdict(HANG, 'd1h8')).toEqual({ flag: false });
    expect(materialRisk(HANG, 'd1h8')).toBeNull();
    expect(fallbackVerdict('not a fen', 'e2e4')).toEqual({ flag: false });
  });

  it('does not flag when every move loses the same', () => {
    // White king in check by an undefended queen: Kxb2 is the only legal move.
    const forced = '4k3/8/8/8/8/8/1q6/K7 w - - 0 1';
    // Only Kxb2 is legal (queen undefended) — a capture, not a blunder.
    expect(fallbackVerdict(forced, 'a1b2')).toMatchObject({ flag: false });
  });

  it('is fast enough for a drop', () => {
    const middle = 'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 8';
    const t = performance.now();
    for (let i = 0; i < 5; i++) fallbackVerdict(middle, 'd1a4');
    expect((performance.now() - t) / 5).toBeLessThan(150);
  });
});

describe('confirm window', () => {
  const r = { fen: HANG, uci: 'd1d2', at: 1000 };
  it('commits the same move in the same position within 5 s', () => {
    expect(isConfirmation(r, HANG, 'd1d2', 1000)).toBe(true);
    expect(isConfirmation(r, HANG, 'd1d2', 1000 + CONFIRM_WINDOW_MS)).toBe(true);
  });
  it('not after 5 s, not another move, not another position, not without a refusal', () => {
    expect(isConfirmation(r, HANG, 'd1d2', 1001 + CONFIRM_WINDOW_MS)).toBe(false);
    expect(isConfirmation(r, HANG, 'd1b3', 1500)).toBe(false);
    expect(isConfirmation(r, FOOL, 'd1d2', 1500)).toBe(false);
    expect(isConfirmation(null, HANG, 'd1d2', 1500)).toBe(false);
    expect(isConfirmation(r, HANG, 'd1d2', 999)).toBe(false);
  });
  it('refusedSquare is the from-square', () => {
    expect(refusedSquare('d1d2')).toBe('d1');
    expect(refusedSquare('e7e8n')).toBe('e7');
  });
});
