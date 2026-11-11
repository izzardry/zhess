import {
  DEFAULT_LEVEL,
  EMULATED_SKILL,
  HANGING_QUEEN_TAKE_RATE,
  LEVELS,
  MIN_MOVETIME_MS,
  MIN_REPLY_MS,
  NEVER_MATE_IN_1_FROM,
  allowsMateIn1,
  capturesHangingQueen,
  clockCapMs,
  engineMovetime,
  humanizedPlan,
  legalUci,
  levelSpec,
  normalizeLevel,
  pickMove,
  pickMoveTrace,
} from './levels';
import { scoreCp, type PvLine } from './engine/uci';
import type { Eval } from './types';

/** Deterministic PRNG (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns the given values in turn, then repeats the last one. */
function seq(...xs: number[]): () => number {
  let i = 0;
  return () => xs[Math.min(i++, xs.length - 1)];
}

const line = (uci: string, ev: Eval): PvLine => ({ uci, eval: ev, depth: 4, pv: [uci] });

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** White: Kg1, pawns f2 g2 h2, rook d1. Black: Kg8, pawns f7 g7 h7, rook e8. Rd7?? allows Re1#. */
const BACK_RANK = '4r1k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
/** White knight e3 can take the undefended black queen on d5. */
const HANGING_Q = '4k3/8/8/3q4/8/4N3/8/4K3 w - - 0 1';
/** White queen d3 can take the black queen on d5, which the c6 pawn defends. */
const DEFENDED_Q = '4k3/8/2p5/3q4/8/3Q4/8/4K3 w - - 0 1';
/** Same without the c6 pawn: Qxd5 wins it for nothing. */
const UNDEFENDED_Q = '4k3/8/8/3q4/8/3Q4/8/4K3 w - - 0 1';

describe('level table (DESIGN 10.2)', () => {
  it('has twelve levels with the design values', () => {
    expect(LEVELS.map((l) => l.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(LEVELS.map((l) => l.name)).toEqual([
      'Beginner', 'Novice', 'Easy', 'Casual', 'Medium', 'Moderate',
      'Tricky', 'Hard', 'Tough', 'Expert', 'Master', 'Insane',
    ]);
    const humanized = LEVELS.slice(0, 4).map((l) => [l.multiPv, l.depth, l.budgetCp]);
    expect(humanized).toEqual([
      [6, 4, 400],
      [5, 5, 300],
      [4, 6, 200],
      [3, 7, 120],
    ]);
    const skill = LEVELS.slice(4).map((l) => [l.skill, l.movetimeMs]);
    expect(skill).toEqual([
      [3, 200], [6, 300], [9, 400], [12, 500], [15, 700], [18, 1000], [20, 1500], [20, 3000],
    ]);
    expect(LEVELS[11].clockFraction).toBeCloseTo(1 / 30);
    expect(DEFAULT_LEVEL).toBe(5);
    expect(MIN_REPLY_MS).toBe(400);
    expect(NEVER_MATE_IN_1_FROM).toBe(3);
    expect(HANGING_QUEEN_TAKE_RATE).toBe(0.5);
  });

  it('normalizes levels', () => {
    expect(normalizeLevel(0)).toBe(1);
    expect(normalizeLevel(99)).toBe(12);
    expect(normalizeLevel(4.6)).toBe(5);
    expect(normalizeLevel(NaN)).toBe(DEFAULT_LEVEL);
    expect(levelSpec(-3).level).toBe(1);
  });
});

describe('humanizedPlan', () => {
  it('returns the MultiPV plan for levels 1–4 and nothing for skill levels', () => {
    expect(humanizedPlan(1)).toEqual({ multiPv: 6, depth: 4, budgetCp: 400 });
    expect(humanizedPlan(4)).toEqual({ multiPv: 3, depth: 7, budgetCp: 120 });
    for (let lv = 5; lv <= 12; lv++) expect(humanizedPlan(lv, true)).toBeNull();
  });

  it('emulates levels 5–11 with shrinking budgets when Skill Level is missing; 12 stays full strength', () => {
    const budgets = [5, 6, 7, 8, 9, 10, 11].map((lv) => humanizedPlan(lv, false)?.budgetCp ?? -1);
    for (let i = 1; i < budgets.length; i++) expect(budgets[i]).toBeLessThan(budgets[i - 1]);
    expect(budgets[0]).toBeLessThan(120); // below level 4's budget
    const depths = [5, 6, 7, 8, 9, 10, 11].map((lv) => humanizedPlan(lv, false)?.depth ?? -1);
    for (let i = 1; i < depths.length; i++) expect(depths[i]).toBeGreaterThan(depths[i - 1]);
    expect(depths[0]).toBeGreaterThan(7); // deeper than level 4
    expect(humanizedPlan(12, false)).toBeNull();
    expect(humanizedPlan(5, false)).toEqual(EMULATED_SKILL[5]);
  });
});

describe('move time and the engine clock', () => {
  it('uses the table time without a clock; 0 for humanized levels', () => {
    expect(engineMovetime(5, 'w')).toBe(200);
    expect(engineMovetime(11, 'b')).toBe(1500);
    expect(engineMovetime(12, 'w')).toBe(3000);
    expect(engineMovetime(1, 'w')).toBe(0);
    expect(engineMovetime(4, 'w', { wMs: 1000, bMs: 1000, incMs: 0 })).toBe(0);
    expect(clockCapMs('w')).toBe(Infinity);
  });

  it('level 12 thinks 1/30 of its remaining clock when that is longer than 3 s', () => {
    expect(engineMovetime(12, 'w', { wMs: 300_000, bMs: 1000, incMs: 0 })).toBe(10_000);
    expect(engineMovetime(12, 'b', { wMs: 300_000, bMs: 120_000, incMs: 0 })).toBe(4000);
    expect(engineMovetime(12, 'w', { wMs: 90_000, bMs: 90_000, incMs: 0 })).toBe(3000);
  });

  it('never thinks more than 1/20 of its own remaining time plus half the increment', () => {
    expect(engineMovetime(12, 'w', { wMs: 30_000, bMs: 300_000, incMs: 0 })).toBe(1500);
    expect(engineMovetime(11, 'b', { wMs: 300_000, bMs: 10_000, incMs: 0 })).toBe(500);
    expect(engineMovetime(11, 'b', { wMs: 300_000, bMs: 10_000, incMs: 2000 })).toBe(1500);
    expect(engineMovetime(5, 'w', { wMs: 60_000, bMs: 60_000, incMs: 0 })).toBe(200);
    expect(clockCapMs('w', { wMs: 20_000, bMs: 0, incMs: 0 })).toBe(1000);
  });

  it('keeps a floor when the clock is nearly out (or negative)', () => {
    expect(engineMovetime(8, 'w', { wMs: 100, bMs: 60_000, incMs: 0 })).toBe(MIN_MOVETIME_MS);
    expect(engineMovetime(12, 'b', { wMs: 100, bMs: -50, incMs: 0 })).toBe(MIN_MOVETIME_MS);
  });
});

describe('position checks', () => {
  it('allowsMateIn1 finds a back-rank mate and ignores safe moves', () => {
    expect(allowsMateIn1(BACK_RANK, 'd1d7')).toBe(true);
    expect(allowsMateIn1(BACK_RANK, 'h2h3')).toBe(false);
    expect(allowsMateIn1(BACK_RANK, 'd1e1')).toBe(true); // Rxe1#
    expect(allowsMateIn1(BACK_RANK, 'g2g3')).toBe(false);
    expect(allowsMateIn1(START, 'e2e4')).toBe(false);
  });

  it('a move that mates is not "into mate"; illegal moves and bad FENs are false', () => {
    // Fool's mate: Black's Qh4 mates.
    const fool = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2';
    expect(allowsMateIn1(fool, 'd8h4')).toBe(false);
    expect(allowsMateIn1(START, 'e2e5')).toBe(false);
    expect(allowsMateIn1('nonsense', 'e2e4')).toBe(false);
  });

  it('capturesHangingQueen', () => {
    expect(capturesHangingQueen(HANGING_Q, 'e3d5')).toBe(true);
    expect(capturesHangingQueen(HANGING_Q, 'e1d2')).toBe(false);
    expect(capturesHangingQueen(UNDEFENDED_Q, 'd3d5')).toBe(true);
    expect(capturesHangingQueen(DEFENDED_Q, 'd3d5')).toBe(false); // an even trade is not a gift
    expect(capturesHangingQueen(START, 'e2e4')).toBe(false);
    expect(capturesHangingQueen('nonsense', 'e2e4')).toBe(false);
  });

  it('legalUci lists the moves in UCI', () => {
    expect(legalUci(START)).toHaveLength(20);
    expect(legalUci(START)).toContain('g1f3');
    expect(legalUci('nonsense')).toEqual([]);
  });
});

describe('pickMove', () => {
  const startLines = [
    line('e2e4', { cp: 40 }),
    line('d2d4', { cp: 35 }),
    line('g1f3', { cp: 20 }),
    line('c2c4', { cp: -80 }),
    line('b1c3', { cp: -190 }),
    line('g2g4', { cp: -390 }),
  ];

  it('throws without candidates', () => {
    expect(() => pickMove(START, [], 1, () => 0)).toThrow();
  });

  it('stays inside the error budget of every humanized level (many seeds)', () => {
    for (let lv = 1; lv <= 4; lv++) {
      const budget = humanizedPlan(lv)!.budgetCp;
      const rng = seeded(lv * 7919);
      const best = scoreCp(startLines[0].eval);
      const seen = new Set<string>();
      for (let i = 0; i < 400; i++) {
        const m = pickMove(START, startLines, lv, rng);
        const picked = startLines.find((l) => l.uci === m)!;
        expect(best - scoreCp(picked.eval)).toBeLessThanOrEqual(budget);
        seen.add(m);
      }
      // Every line inside the budget is actually played sometimes.
      const allowed = startLines.filter((l) => best - scoreCp(l.eval) <= budget).map((l) => l.uci);
      expect([...seen].sort()).toEqual([...allowed].sort());
    }
  });

  it('chooses uniformly by rng among the lines within budget (sorted best first)', () => {
    const shuffled = [startLines[2], startLines[0], startLines[1]];
    expect(pickMove(START, shuffled, 4, () => 0)).toBe('e2e4');
    expect(pickMove(START, shuffled, 4, () => 0.5)).toBe('d2d4');
    expect(pickMove(START, shuffled, 4, () => 0.999)).toBe('g1f3');
    expect(pickMove(START, shuffled, 4, () => 1)).toBe('g1f3'); // out-of-range rng is clamped
    expect(pickMove(START, shuffled, 4, () => NaN)).toBe('e2e4');
  });

  it('respects an explicit budget (emulated skill levels)', () => {
    const t = pickMoveTrace(START, startLines, 5, () => 0.99, 10);
    expect(t.pool).toEqual(['e2e4', 'd2d4']);
    expect(pickMoveTrace(START, startLines, 11, () => 0.99, 0).pool).toEqual(['e2e4']);
  });

  it('treats mate scores as far outside any budget', () => {
    const lines = [line('e2e4', { mate: 3 }), line('d2d4', { cp: 900 })];
    for (const r of [0, 0.5, 0.99]) expect(pickMove(START, lines, 1, () => r)).toBe('e2e4');
    const losing = [line('e2e4', { cp: -50 }), line('d2d4', { mate: -4 })];
    for (const r of [0, 0.5, 0.99]) expect(pickMove(START, losing, 1, () => r)).toBe('e2e4');
  });

  describe('never walks into mate in 1 from level 3', () => {
    // Shallow search scored the blunder well: the safety rule must still catch it.
    const lines = [line('d1d7', { cp: 60 }), line('h2h3', { cp: 0 }), line('g2g3', { cp: -10 })];

    it('levels 3–12 never pick the mating blunder', () => {
      for (let lv = 3; lv <= 12; lv++) {
        const rng = seeded(lv);
        for (let i = 0; i < 50; i++) {
          expect(pickMove(BACK_RANK, lines, lv, rng, 400)).not.toBe('d1d7');
        }
      }
    });

    it('levels 1–2 are allowed to', () => {
      expect(pickMove(BACK_RANK, lines, 1, () => 0)).toBe('d1d7');
      expect(pickMove(BACK_RANK, lines, 2, () => 0)).toBe('d1d7');
    });

    it('if every listed line walks into mate, a safe legal move is played instead', () => {
      const t = pickMoveTrace(BACK_RANK, [line('d1d7', { cp: 60 })], 3, () => 0);
      expect(t.reason).toBe('only-safe');
      expect(t.move).not.toBe('d1d7');
      expect(allowsMateIn1(BACK_RANK, t.move)).toBe(false);
      expect(legalUci(BACK_RANK)).toContain(t.move);
    });

    it('if every legal move walks into mate, it plays the best line', () => {
      // White Kh1, Pa3; Black Kf2, Rb8. Both a4 and Kh2 allow Rh8#.
      const fen = '1r6/8/8/8/8/P7/5k2/7K w - - 0 1';
      expect(legalUci(fen).every((m) => allowsMateIn1(fen, m))).toBe(true);
      const t = pickMoveTrace(fen, [line('a3a4', { mate: -1 }), line('h1h2', { mate: -1 })], 3, () => 0.7);
      expect(t.reason).toBe('all-lose');
      expect(t.move).toBe('a3a4');
    });
  });

  describe('level 1 takes a hanging queen only half the time', () => {
    const lines = [
      line('e3d5', { cp: 900 }),
      line('e1d2', { cp: -880 }),
      line('e1e2', { cp: -890 }),
      line('e3c4', { cp: -1300 }),
    ];

    it('takes it when the first draw is below 1/2, otherwise leaves the queen alone', () => {
      expect(pickMoveTrace(HANGING_Q, lines, 1, seq(0.2)).reason).toBe('hanging-queen');
      expect(pickMove(HANGING_Q, lines, 1, seq(0.2))).toBe('e3d5');
      const t = pickMoveTrace(HANGING_Q, lines, 1, seq(0.7, 0.9));
      expect(t.move).not.toBe('e3d5');
      // The budget then applies to the best remaining move.
      expect(t.pool).toEqual(['e1d2', 'e1e2']);
    });

    it('is about 50 % over many games', () => {
      const rng = seeded(42);
      let took = 0;
      const n = 2000;
      for (let i = 0; i < n; i++) if (pickMove(HANGING_Q, lines, 1, rng) === 'e3d5') took++;
      expect(took / n).toBeGreaterThan(0.45);
      expect(took / n).toBeLessThan(0.55);
    });

    it('levels 2+ always take it (it is far ahead of anything else)', () => {
      for (let lv = 2; lv <= 4; lv++) {
        const rng = seeded(lv);
        for (let i = 0; i < 30; i++) expect(pickMove(HANGING_Q, lines, lv, rng)).toBe('e3d5');
      }
    });

    it('takes it when it is the only line', () => {
      expect(pickMove(HANGING_Q, [lines[0]], 1, seq(0.9))).toBe('e3d5');
    });
  });
});
