import { describe, expect, it } from 'vitest';
import type { Game, Ply } from './types';
import zhess, {
  START_FEN,
  SQUARES,
  decodeMoves,
  encodeMoves,
  formatTc,
  isSquare,
  parseTc,
  squareIndex,
  squareName,
} from './zhess';

const {
  newGame,
  play,
  undo,
  redo,
  goto,
  end,
  reopen,
  legalMoves,
  attacked,
  inCheck,
  material,
  san,
  pgn,
  clocks,
  replay,
  fromRecord,
  timeout,
  timeoutResult,
  canMate,
  clockRunning,
  timeUsed,
  board,
  lastMove,
  history,
  colorOfPly,
  sanToUci,
  moveNumber,
} = zhess;

/** Plays UCI moves with 1 ms each (or the given ms list). */
function playAll(g: Game, ucis: string[], ms: number[] = []): Game {
  return ucis.reduce((acc, m, i) => play(acc, m, ms[i] ?? 1), g);
}

const SCHOLAR = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'];

describe('squares', () => {
  it('indexes a1 = 0 … h8 = 63 and back', () => {
    expect(squareIndex('a1')).toBe(0);
    expect(squareIndex('h1')).toBe(7);
    expect(squareIndex('a2')).toBe(8);
    expect(squareIndex('h8')).toBe(63);
    expect(SQUARES).toHaveLength(64);
    for (let i = 0; i < 64; i++) expect(squareIndex(squareName(i))).toBe(i);
    expect(() => squareName(64)).toThrow();
    expect(isSquare('e4')).toBe(true);
    expect(isSquare('i9')).toBe(false);
  });
});

describe('newGame', () => {
  it('starts from the standard position', () => {
    const g = newGame();
    expect(g.fen).toBe(START_FEN);
    expect(g.start).toBe(START_FEN);
    expect(g.turn).toBe('w');
    expect(g.cursor).toBe(0);
    expect(g.plies).toEqual([]);
    expect(g.end).toBeUndefined();
    expect(Object.isFrozen(g)).toBe(true);
    expect(legalMoves(g)).toHaveLength(20);
  });

  it('starts from a FEN and rejects invalid FEN', () => {
    const fen = '4k3/8/8/8/8/8/8/R3K3 b - - 0 1';
    const g = newGame(fen);
    expect(g.fen).toBe(fen);
    expect(g.turn).toBe('b');
    expect(() => newGame('not a fen')).toThrow(/Invalid FEN/);
  });

  it('is a plain JSON value that still works after a round trip', () => {
    const g = playAll(newGame(), ['e2e4', 'e7e5']);
    const copy = JSON.parse(JSON.stringify(g)) as Game;
    const next = play(copy, 'g1f3', 5);
    expect(next.cursor).toBe(3);
    expect(san(next)).toEqual(['e4', 'e5', 'Nf3']);
  });
});

describe('play', () => {
  it('returns a new value and leaves the old one unchanged', () => {
    const a = newGame();
    const b = play(a, 'e2e4', 1200);
    expect(a.cursor).toBe(0);
    expect(a.fen).toBe(START_FEN);
    expect(b.cursor).toBe(1);
    expect(b.turn).toBe('b');
    expect(b.plies).toEqual([{ m: 'e2e4', ms: 1200 }]);
    expect(Object.isFrozen(b.plies)).toBe(true);
    // The old value can still be played on after the cache moved on.
    const c = play(a, 'd2d4', 1);
    expect(san(c)).toEqual(['d4']);
    expect(san(b)).toEqual(['e4']);
  });

  it('throws on illegal moves and bad input', () => {
    const g = newGame();
    expect(() => play(g, 'e2e5', 1)).toThrow(/Illegal/);
    expect(() => play(g, 'xyz', 1)).toThrow(/Illegal/);
    expect(() => play(g, 'e2e4q', 1)).toThrow(/Illegal/);
    expect(() => play(g, 'e7e5', 1)).toThrow(/Illegal/);
  });

  it('drops the redo tail', () => {
    const g = playAll(newGame(), ['e2e4', 'e7e5', 'g1f3']);
    const back = undo(g, 2);
    expect(back.plies).toHaveLength(3);
    const branched = play(back, 'c7c5', 1);
    expect(branched.plies.map((p) => p.m)).toEqual(['e2e4', 'c7c5']);
    expect(branched.cursor).toBe(2);
  });

  it('promotes to a queen when no piece is given, and to the chosen piece otherwise', () => {
    const fen = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
    const q = play(newGame(fen), 'a7a8', 1);
    expect(q.plies[0].m).toBe('a7a8q');
    expect(board(q)[squareIndex('a8')]).toEqual({ color: 'w', type: 'q' });
    const n = play(newGame(fen), 'a7a8n', 1);
    expect(n.plies[0].m).toBe('a7a8n');
    expect(board(n)[squareIndex('a8')]).toEqual({ color: 'w', type: 'n' });
    const upper = play(newGame(fen), 'a7a8R', 1);
    expect(upper.plies[0].m).toBe('a7a8r');
  });

  it('castles by moving the king two squares or onto its own rook', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    expect(play(newGame(fen), 'e1g1', 1).plies[0].m).toBe('e1g1');
    expect(play(newGame(fen), 'e1h1', 1).plies[0].m).toBe('e1g1');
    expect(play(newGame(fen), 'e1a1', 1).plies[0].m).toBe('e1c1');
    const b = play(play(newGame(fen), 'a1a2', 1), 'e8h8', 1);
    expect(b.plies[1].m).toBe('e8g8');
    expect(san(b)[1]).toBe('O-O');
  });

  it('records en passant as an ordinary move', () => {
    const g = playAll(newGame(), ['e2e4', 'a7a6', 'e4e5', 'd7d5']);
    const ep = legalMoves(g, 'e5').find((m) => m.to === 'd6');
    expect(ep?.enPassant).toBe(true);
    expect(ep?.captured).toBe('p');
    const after = play(g, 'e5d6', 1);
    expect(board(after)[squareIndex('d5')]).toBeNull();
    expect(material(after).captured.w).toEqual(['p']);
  });

  it('rounds ms and never stores negative time', () => {
    const g = play(newGame(), 'e2e4', -5);
    expect(g.plies[0].ms).toBe(0);
    expect(play(newGame(), 'e2e4', 12.6).plies[0].ms).toBe(13);
  });
});

describe('automatic endings (DESIGN 8.2)', () => {
  it('checkmate, white wins', () => {
    const g = playAll(newGame(), SCHOLAR);
    expect(g.end).toEqual({ result: '1-0', by: 'mate' });
    expect(legalMoves(g)).toEqual([]);
    expect(() => play(g, 'a7a6', 1)).toThrow(/over/);
  });

  it("checkmate, black wins (fool's mate)", () => {
    const g = playAll(newGame(), ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
    expect(g.end).toEqual({ result: '0-1', by: 'mate' });
    expect(inCheck(g)).toBe('e1');
  });

  it('stalemate', () => {
    const g = play(newGame('7k/8/8/6Q1/8/8/8/K7 w - - 0 1'), 'g5g6', 1);
    expect(g.end).toEqual({ result: '1/2-1/2', by: 'stalemate' });
  });

  it('insufficient material', () => {
    const g = play(newGame('4k3/8/8/8/8/8/3r4/4K3 w - - 0 1'), 'e1d2', 1);
    expect(g.end).toEqual({ result: '1/2-1/2', by: 'material' });
  });

  it('threefold repetition', () => {
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    const once = playAll(newGame(), shuffle);
    expect(once.end).toBeUndefined();
    const twice = playAll(once, shuffle);
    expect(twice.end).toEqual({ result: '1/2-1/2', by: 'repetition' });
  });

  it('fifty-move rule', () => {
    const g = play(newGame('4k3/8/8/8/8/8/8/R3K3 w - - 99 80'), 'a1a2', 1);
    expect(g.end).toEqual({ result: '1/2-1/2', by: 'fifty' });
  });

  it('mate on the hundredth half-move is mate, not a fifty-move draw', () => {
    const g = play(newGame('k7/8/1K6/8/8/8/8/7R w - - 99 80'), 'h1h8', 1);
    expect(g.end).toEqual({ result: '1-0', by: 'mate' });
  });

  it('detects an ending already present in the start position', () => {
    expect(newGame('7k/8/6Q1/8/8/8/8/K7 b - - 0 1').end).toEqual({ result: '1/2-1/2', by: 'stalemate' });
  });
});

describe('undo, redo, goto', () => {
  const moves = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'];

  it('steps back and forward along the same record', () => {
    const g = playAll(newGame(), moves);
    const fens: string[] = [];
    let walk = newGame();
    fens.push(walk.fen);
    for (const m of moves) {
      walk = play(walk, m, 1);
      fens.push(walk.fen);
    }
    const u2 = undo(g, 2);
    expect(u2.cursor).toBe(3);
    expect(u2.fen).toBe(fens[3]);
    expect(u2.plies).toHaveLength(5);
    expect(u2.turn).toBe('b');
    const r1 = redo(u2, 1);
    expect(r1.cursor).toBe(4);
    expect(r1.fen).toBe(fens[4]);
    expect(redo(r1, 99).cursor).toBe(5);
    expect(undo(g, 99).cursor).toBe(0);
    expect(undo(g, 99).fen).toBe(START_FEN);
    expect(undo(g, 0)).toBe(g);
    expect(redo(g, 1)).toBe(g);
    for (let i = 0; i <= 5; i++) expect(goto(g, i).fen).toBe(fens[i]);
    expect(goto(g, -3).cursor).toBe(0);
    expect(goto(g, 50).cursor).toBe(5);
  });

  it('undo after mate reopens the game; redo re-detects the mate', () => {
    const g = playAll(newGame(), SCHOLAR);
    const back = undo(g, 1);
    expect(back.end).toBeUndefined();
    expect(legalMoves(back).length).toBeGreaterThan(0);
    expect(redo(back, 1).end).toEqual({ result: '1-0', by: 'mate' });
  });

  it('goto keeps the ending for review', () => {
    const g = playAll(newGame(), SCHOLAR);
    const mid = goto(g, 3);
    expect(mid.end).toEqual({ result: '1-0', by: 'mate' });
    expect(mid.cursor).toBe(3);
    expect(san(mid)).toEqual(['e4', 'e5', 'Bc4']);
    expect(goto(mid, 7).fen).toBe(g.fen);
  });

  it('undo drops a manual ending', () => {
    const resigned = end(playAll(newGame(), ['e2e4', 'e7e5']), '0-1', 'resign');
    expect(undo(resigned, 1).end).toBeUndefined();
  });

  it('stays consistent over a long game (cache hand-over vs fresh replay)', () => {
    let g = newGame();
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 300 && !g.end; i++) {
      const moves = legalMoves(g);
      g = play(g, moves[Math.floor(rnd() * moves.length)].uci, i);
      if (i % 37 === 0) g = redo(undo(g, 3), 3);
    }
    expect(g.cursor).toBeGreaterThan(20);
    const fresh = replay(g.plies);
    expect(fresh.fen).toBe(g.fen);
    expect(fresh.end).toEqual(g.end);
    expect(goto(g, 10).fen).toBe(goto(fresh, 10).fen);
  });
});

describe('end and reopen', () => {
  it('ends at the cursor, drops the redo tail, and keeps the first ending', () => {
    const g = undo(playAll(newGame(), ['e2e4', 'e7e5', 'g1f3']), 1);
    const r = end(g, '1-0', 'resign');
    expect(r.end).toEqual({ result: '1-0', by: 'resign' });
    expect(r.plies).toHaveLength(2);
    expect(end(r, '0-1', 'time')).toBe(r);
    expect(legalMoves(r)).toEqual([]);
  });

  it('reopen removes resign, time and agreed endings only', () => {
    const g = playAll(newGame(), ['e2e4', 'e7e5']);
    expect(reopen(end(g, '0-1', 'resign')).end).toBeUndefined();
    expect(reopen(end(g, '1/2-1/2', 'agreed')).end).toBeUndefined();
    const mated = playAll(newGame(), SCHOLAR);
    expect(reopen(mated)).toBe(mated);
    expect(reopen(g)).toBe(g);
    const back = reopen(end(g, '0-1', 'resign'));
    expect(play(back, 'g1f3', 1).cursor).toBe(3);
  });
});

describe('move codec (DESIGN 13.2)', () => {
  it('encodes two base64url characters per ply', () => {
    expect(encodeMoves([{ m: 'e2e4', ms: 0 }])).toBe('Mc');
    expect(encodeMoves([{ m: 'a1a1', ms: 0 }])).toBe('AA');
    expect(encodeMoves([{ m: 'h8h8', ms: 0 }])).toBe('__');
    expect(encodeMoves([])).toBe('');
    const g = playAll(newGame(), SCHOLAR);
    const s = encodeMoves(g.plies);
    expect(s).toHaveLength(14);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeMoves(s)).toEqual(SCHOLAR);
  });

  it('adds .r .b .n for underpromotion and nothing for a queen', () => {
    const plies: Ply[] = [
      { m: 'a7a8n', ms: 0 },
      { m: 'b2b1q', ms: 0 },
      { m: 'c7c8r', ms: 0 },
      { m: 'd2d1b', ms: 0 },
    ];
    const s = encodeMoves(plies);
    expect(s).toBe(
      'w4.n' + 'JB' + 'y6.r' + 'LD.b',
    );
    expect(decodeMoves(s)).toEqual(['a7a8n', 'b2b1', 'c7c8r', 'd2d1b']);
  });

  it('round-trips a game with castling, en passant and underpromotion through replay', () => {
    const ucis = [
      'e2e4', 'd7d5', 'e4e5', 'f7f5', 'e5f6', 'g8h6', 'f6g7', 'b8c6', 'g7h8n', 'c8g4',
      'g1f3', 'd8d6', 'f1e2', 'e8c8', 'e1g1',
    ];
    const g = playAll(newGame(), ucis, ucis.map((_, i) => i * 100));
    const line = san(g).join(' ');
    expect(line).toContain('exf6');
    expect(line).toContain('gxh8=N');
    expect(line).toContain('O-O-O');
    expect(san(g).at(-1)).toBe('O-O');
    const s = encodeMoves(g.plies);
    expect(s).toHaveLength(15 * 2 + 2);
    expect(s).toContain('.n');
    expect(decodeMoves(s)).toEqual(ucis);
    const back = fromRecord(s, g.plies.map((p) => p.ms));
    expect(back.plies).toEqual(g.plies);
    expect(back.fen).toBe(g.fen);
  });

  it('round-trips queen promotion and queen-side castling', () => {
    const fen = 'r3k3/6P1/8/8/8/8/8/4K2R w Kq - 0 1';
    const g = playAll(newGame(fen), ['e1h1', 'e8a8', 'g7g8']);
    expect(g.plies.map((p) => p.m)).toEqual(['e1g1', 'e8c8', 'g7g8q']);
    expect(san(g)).toEqual(['O-O', 'O-O-O', 'g8=Q']);
    const s = encodeMoves(g.plies);
    expect(s).not.toContain('.');
    const back = fromRecord(s, [1, 1, 1], undefined, { startFen: fen });
    expect(back.plies).toEqual(g.plies);
    expect(back.fen).toBe(g.fen);
  });

  it('throws on malformed input', () => {
    expect(() => decodeMoves('M')).toThrow();
    expect(() => decodeMoves('M!')).toThrow();
    expect(() => decodeMoves('Mc.q')).toThrow();
    expect(() => decodeMoves('Mc.')).toThrow();
    expect(() => encodeMoves([{ m: 'zz', ms: 0 }])).toThrow();
  });
});

describe('replay and fromRecord', () => {
  it('replays plies with their times', () => {
    const plies = [
      { m: 'e2e4', ms: 10 },
      { m: 'e7e5', ms: 20 },
    ];
    const g = replay(plies);
    expect(g.plies).toEqual(plies);
    expect(g.cursor).toBe(2);
    expect(() => replay([{ m: 'e2e5', ms: 0 }])).toThrow();
  });

  it('applies a stored manual ending and keeps automatic ones', () => {
    const moves = encodeMoves(replay([{ m: 'e2e4', ms: 1 }, { m: 'e7e5', ms: 1 }]).plies);
    const r = fromRecord(moves, [1, 1], { result: '1-0', by: 'resign' });
    expect(r.end).toEqual({ result: '1-0', by: 'resign' });
    const mate = playAll(newGame(), SCHOLAR);
    const m = fromRecord(encodeMoves(mate.plies), [], { result: '1-0', by: 'mate' });
    expect(m.end).toEqual({ result: '1-0', by: 'mate' });
    expect(m.plies.every((p) => p.ms === 0)).toBe(true);
  });

  it('is strict by default and stops at the first bad ply when lenient', () => {
    const good = encodeMoves([{ m: 'e2e4', ms: 0 }, { m: 'e7e5', ms: 0 }]);
    const illegal = good + encodeMoves([{ m: 'e1e8', ms: 0 }]);
    expect(() => fromRecord(illegal, [])).toThrow();
    expect(fromRecord(illegal, [], undefined, { lenient: true }).cursor).toBe(2);
    expect(() => fromRecord(good + '!', [])).toThrow();
    expect(fromRecord(good + '!x', [], undefined, { lenient: true }).cursor).toBe(2);
    expect(fromRecord(good + 'A', [], undefined, { lenient: true }).cursor).toBe(2);
  });
});

describe('reading the position', () => {
  it('lists legal moves with details', () => {
    const g = newGame();
    const e2 = legalMoves(g, 'e2');
    expect(e2.map((m) => m.uci).sort()).toEqual(['e2e3', 'e2e4']);
    expect(e2[0]).toMatchObject({ from: 'e2', piece: 'p', color: 'w' });
    expect(legalMoves(g, 'e4')).toEqual([]);
    const promo = legalMoves(newGame('4k3/P7/8/8/8/8/8/4K3 w - - 0 1'), 'a7');
    expect(promo.map((m) => m.promotion).sort()).toEqual(['b', 'n', 'q', 'r']);
    const castle = legalMoves(newGame('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), 'e1');
    expect(castle.find((m) => m.uci === 'e1g1')?.castle).toBe('k');
    expect(castle.find((m) => m.uci === 'e1c1')?.castle).toBe('q');
  });

  it('finds attacked squares and the checked king', () => {
    const g = newGame();
    const byBlack = attacked(g, 'b');
    expect(byBlack).toContain('f6');
    expect(byBlack).toContain('a6');
    expect(byBlack).not.toContain('e4');
    expect(inCheck(g)).toBeNull();
    const check = playAll(newGame(), ['e2e4', 'f7f6', 'd1h5']);
    expect(inCheck(check)).toBe('e8');
    expect(san(check)[2]).toBe('Qh5+');
  });

  it('counts captured pieces and material', () => {
    expect(material(newGame())).toEqual({ captured: { w: [], b: [] }, diff: 0 });
    // 1. e4 d5 2. exd5 Qxd5 3. Nc3 Qxa2 4. Rxa2
    const g = playAll(newGame(), ['e2e4', 'd7d5', 'e4d5', 'd8d5', 'b1c3', 'd5a2', 'a1a2']);
    const mat = material(g);
    expect(mat.captured.w).toEqual(['p', 'q']);
    expect(mat.captured.b).toEqual(['p', 'p']);
    expect(mat.diff).toBe(8);
    // Promotion changes material: a new queen counts 9, the pawn is gone.
    const promo = play(newGame('4k3/P7/8/8/8/8/8/4K3 w - - 0 1'), 'a7a8', 1);
    expect(material(promo).diff).toBe(9);
    expect(material(undo(g, 1)).diff).toBe(-1);
    expect(material(undo(g, 1)).captured.w).toEqual(['p']);
  });

  it('gives board, last move, history, move number and ply colors', () => {
    const g = playAll(newGame(), ['e2e4', 'e7e5', 'g1f3']);
    const b = board(g);
    expect(b).toHaveLength(64);
    expect(b[squareIndex('f3')]).toEqual({ color: 'w', type: 'n' });
    expect(b[squareIndex('g1')]).toBeNull();
    expect(b[squareIndex('e8')]).toEqual({ color: 'b', type: 'k' });
    expect(lastMove(g)).toEqual({ from: 'g1', to: 'f3' });
    expect(lastMove(newGame())).toBeNull();
    expect(history(g).map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3']);
    expect(history(g)[1].color).toBe('b');
    expect(moveNumber(g)).toBe(2);
    expect(colorOfPly(g, 0)).toBe('w');
    expect(colorOfPly(g, 1)).toBe('b');
    const fromBlack = newGame('4k3/8/8/8/8/8/8/R3K3 b - - 0 1');
    expect(colorOfPly(fromBlack, 0)).toBe('b');
    expect(colorOfPly(fromBlack, 1)).toBe('w');
  });

  it('converts typed SAN and UCI to canonical UCI', () => {
    const g = newGame();
    expect(sanToUci(g, 'Nf3')).toBe('g1f3');
    expect(sanToUci(g, 'nf3')).toBe('g1f3');
    expect(sanToUci(g, 'e4')).toBe('e2e4');
    expect(sanToUci(g, 'e2e4')).toBe('e2e4');
    expect(sanToUci(g, ' d4 ')).toBe('d2d4');
    expect(sanToUci(g, 'Nf6')).toBeNull();
    expect(sanToUci(g, '')).toBeNull();
    expect(sanToUci(g, 'hello')).toBeNull();
    const castle = newGame('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(sanToUci(castle, 'O-O')).toBe('e1g1');
    expect(sanToUci(castle, '0-0-0')).toBe('e1c1');
    const ex = playAll(newGame(), ['e2e4', 'd7d5']);
    expect(sanToUci(ex, 'exd5')).toBe('e4d5');
    const bishop = playAll(newGame(), ['e2e4', 'e7e5']);
    expect(sanToUci(bishop, 'bc4')).toBe('f1c4');
    expect(sanToUci(bishop, 'b3')).toBe('b2b3');
    const promo = newGame('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    expect(sanToUci(promo, 'a8=N')).toBe('a7a8n');
    expect(sanToUci(promo, 'a8')).toBe('a7a8q');
    expect(sanToUci(playAll(newGame(), SCHOLAR), 'a6')).toBeNull();
  });
});

describe('pgn', () => {
  it('exports moves, headers and the result', () => {
    const g = playAll(newGame(), SCHOLAR);
    const text = pgn(g, { event: 'Zhess K7QW2M', site: 'zhess', date: '2026.11.11', white: 'You', black: 'Level 5' });
    expect(text).toContain('[Event "Zhess K7QW2M"]');
    expect(text).toContain('[Date "2026.11.11"]');
    expect(text).toContain('[White "You"]');
    expect(text).toContain('[Black "Level 5"]');
    expect(text).toContain('[Result "1-0"]');
    expect(text).toContain('[Termination "normal"]');
    expect(text).toContain('1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0');
  });

  it('writes * while running, the clock tag, a time forfeit, and the start FEN', () => {
    const running = playAll(newGame(), ['e2e4']);
    expect(pgn(running, {})).toContain('[Result "*"]');
    expect(pgn(running, {})).toMatch(/1\. e4 \*$/);
    expect(pgn(running, { timeControl: { baseMs: 300000, incMs: 3000 } })).toContain('[TimeControl "300+3"]');
    const flagged = timeout(running, 'b');
    expect(pgn(flagged, {})).toContain('[Termination "time forfeit"]');
    expect(pgn(flagged, {})).toContain('[Result "1-0"]');
    const fen = '4k3/P7/8/8/8/8/7P/4K3 w - - 0 1';
    const p = pgn(play(newGame(fen), 'a7a8n', 1), { tags: { Annotator: 'Zhess' } });
    expect(p).toContain(`[FEN "${fen}"]`);
    expect(p).toContain('[SetUp "1"]');
    expect(p).toContain('[Annotator "Zhess"]');
    expect(p).toContain('1. a8=N *');
  });

  it('exports the whole finished game in review but only up to the cursor while playing', () => {
    const g = playAll(newGame(), SCHOLAR);
    expect(pgn(goto(g, 2), {})).toContain('4. Qxf7# 1-0');
    const running = undo(playAll(newGame(), ['e2e4', 'e7e5', 'g1f3']), 1);
    expect(pgn(running, {})).toMatch(/1\. e4 e5 \*$/);
  });
});

describe('clocks (DESIGN 11, 9.8)', () => {
  const tc = { baseMs: 180_000, incMs: 2_000 };
  const g = playAll(newGame(), ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'], [1000, 2000, 5000, 1000, 3000]);

  it('subtracts time used and adds the increment; each side’s first move is untimed', () => {
    expect(clocks(g, tc)).toEqual({ w: 180_000 + 2_000 - 5_000 + 2_000 - 3_000, b: 180_000 + 2_000 - 1_000 });
    expect(clocks(newGame(), tc)).toEqual({ w: 180_000, b: 180_000 });
    expect(clocks(playAll(newGame(), ['e2e4', 'e7e5'], [9000, 9000]), tc)).toEqual({ w: 180_000, b: 180_000 });
  });

  it('works without increment', () => {
    expect(clocks(g, { baseMs: 60_000, incMs: 0 })).toEqual({ w: 60_000 - 8_000, b: 60_000 - 1_000 });
  });

  it('restores the stamps of the position after undo and redo', () => {
    expect(clocks(undo(g, 1), tc)).toEqual({ w: 177_000, b: 181_000 });
    expect(clocks(undo(g, 3), tc)).toEqual({ w: 180_000, b: 180_000 });
    expect(clocks(redo(undo(g, 3), 3), tc)).toEqual(clocks(g, tc));
    expect(clocks(goto(g, 3), tc)).toEqual({ w: 177_000, b: 180_000 });
  });

  it('returns time used per side with the clock off', () => {
    expect(clocks(g, null)).toEqual({ w: 9000, b: 3000 });
    expect(timeUsed(g)).toEqual({ w: 9000, b: 3000 });
    expect(timeUsed(undo(g, 1))).toEqual({ w: 6000, b: 3000 });
  });

  it('knows when the side to move has started its clock', () => {
    expect(clockRunning(newGame())).toBe(false);
    expect(clockRunning(playAll(newGame(), ['e2e4']))).toBe(false);
    expect(clockRunning(playAll(newGame(), ['e2e4', 'e7e5']))).toBe(true);
    expect(clockRunning(playAll(newGame(), ['e2e4', 'e7e5', 'g1f3']))).toBe(true);
  });

  it('formats and parses time controls', () => {
    expect(formatTc({ baseMs: 300_000, incMs: 0 })).toBe('5+0');
    expect(formatTc({ baseMs: 900_000, incMs: 10_000 })).toBe('15+10');
    expect(formatTc({ baseMs: 30_000, incMs: 1_000 })).toBe('0.5+1');
    expect(formatTc(null)).toBeNull();
    expect(parseTc('3+2')).toEqual({ baseMs: 180_000, incMs: 2_000 });
    expect(parseTc('0.5+1')).toEqual({ baseMs: 30_000, incMs: 1_000 });
    expect(parseTc('off')).toBeNull();
    expect(parseTc(null)).toBeNull();
    expect(parseTc('0+5')).toBeNull();
    expect(parseTc('5')).toBeNull();
    for (const s of ['1+0', '3+2', '5+0', '10+0', '15+10', '30+0']) expect(formatTc(parseTc(s))).toBe(s);
  });
});

describe('time-outs (DESIGN 8.2)', () => {
  it('flag fall loses when the opponent can mate', () => {
    const g = playAll(newGame(), ['e2e4', 'e7e5']);
    expect(timeoutResult(g, 'w')).toEqual({ result: '0-1', by: 'time' });
    expect(timeout(g, 'b').end).toEqual({ result: '1-0', by: 'time' });
  });

  it('flag fall against a bare king is a draw', () => {
    const g = newGame('4k3/8/8/8/8/8/8/Q3K3 w - - 0 1');
    expect(timeout(g, 'w').end).toEqual({ result: '1/2-1/2', by: 'time' });
    expect(timeout(g, 'b').end).toEqual({ result: '1-0', by: 'time' });
  });

  it('a lone knight or same-colored bishops cannot mate a bare king', () => {
    expect(canMate(newGame('4k3/8/8/8/8/8/8/1N2K3 w - - 0 1'), 'w')).toBe(false);
    expect(canMate(newGame('4k3/8/8/8/8/8/8/2B1K3 w - - 0 1'), 'w')).toBe(false);
    expect(timeoutResult(newGame('4k2r/8/8/8/8/8/8/1N2K3 w - - 0 1'), 'b')).toEqual({ result: '1-0', by: 'time' });
    expect(timeoutResult(newGame('4k3/8/8/8/8/8/8/1N2K3 w - - 0 1'), 'b')).toEqual({ result: '1/2-1/2', by: 'time' });
  });

  it('counts material that can mate with help', () => {
    // Knight vs a king with a pawn: a helpmate exists.
    expect(canMate(newGame('4k3/4p3/8/8/8/8/8/1N2K3 w - - 0 1'), 'w')).toBe(true);
    // Bishops on both colors, two knights, knight + bishop, any pawn, rook or queen.
    expect(canMate(newGame('4k3/8/8/8/8/8/8/2B1KB2 w - - 0 1'), 'w')).toBe(true);
    expect(canMate(newGame('4k3/8/8/8/8/8/8/1N2K1N1 w - - 0 1'), 'w')).toBe(true);
    expect(canMate(newGame('4k3/8/8/8/8/8/8/1NB1K3 w - - 0 1'), 'w')).toBe(true);
    expect(canMate(newGame('4k3/8/8/8/8/8/P7/4K3 w - - 0 1'), 'w')).toBe(true);
    // Same-colored bishop vs a bishop on the other color: mate is possible.
    expect(canMate(newGame('4k1b1/8/8/8/8/8/8/2B1K3 w - - 0 1'), 'w')).toBe(true);
    // Same-colored bishop vs a bishop on the same color: no mate possible.
    expect(canMate(newGame('3bk3/8/8/8/8/8/8/2B1K3 w - - 0 1'), 'w')).toBe(false);
    expect(canMate(newGame('4k3/8/8/8/8/8/8/4K3 w - - 0 1'), 'b')).toBe(false);
  });

  it('does not change a game that is already over', () => {
    const mate = playAll(newGame(), SCHOLAR);
    expect(timeout(mate, 'w')).toBe(mate);
  });
});
