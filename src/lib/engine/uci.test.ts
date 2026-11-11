import {
  MATE_CP,
  SearchCollector,
  fenTurn,
  goCommand,
  isReadyOk,
  isUciMove,
  isUciOk,
  negateEval,
  parseBestMove,
  parseInfo,
  parseOption,
  positionCommand,
  scoreCp,
  setOptionCommand,
  splitLines,
} from './uci';

describe('splitLines', () => {
  it('splits, trims and drops empty lines', () => {
    expect(splitLines('a\nb\r\n\n  c  ')).toEqual(['a', 'b', 'c']);
  });
  it('ignores non-strings', () => {
    expect(splitLines({ percent: 0.5 })).toEqual([]);
    expect(splitLines(undefined)).toEqual([]);
  });
});

describe('handshake lines', () => {
  it('recognizes uciok and readyok, also glued to other text', () => {
    expect(isUciOk('uciok')).toBe(true);
    expect(isUciOk('uciokuciokinfo string Network replica 1')).toBe(true);
    expect(isUciOk('id name Stockfish')).toBe(false);
    expect(isReadyOk('readyok')).toBe(true);
    expect(isReadyOk('info string x')).toBe(false);
  });
});

describe('parseInfo', () => {
  it('parses a full MultiPV line (real stockfish.js 19 output)', () => {
    const l = parseInfo(
      'info depth 10 seldepth 14 multipv 2 score cp 25 nodes 27686 nps 922866 hashfull 8 time 30 pv d2d4 g8f6 c2c4',
    );
    expect(l).toEqual({
      depth: 10,
      seldepth: 14,
      multipv: 2,
      eval: { cp: 25 },
      nodes: 27686,
      timeMs: 30,
      pv: ['d2d4', 'g8f6', 'c2c4'],
    });
  });

  it('defaults multipv to 1 and reads negative cp', () => {
    const l = parseInfo('info depth 3 score cp -48 pv e7e5');
    expect(l?.multipv).toBe(1);
    expect(l?.eval).toEqual({ cp: -48 });
  });

  it('parses mate scores, including mate 0 and negative mates', () => {
    expect(parseInfo('info depth 0 score mate 0')?.eval).toEqual({ mate: 0 });
    expect(parseInfo('info depth 0 score mate 0')?.pv).toEqual([]);
    expect(parseInfo('info depth 5 score mate -2 pv a1a2')?.eval).toEqual({ mate: -2 });
    expect(parseInfo('info depth 5 score mate 3 pv h5f7')?.eval).toEqual({ mate: 3 });
  });

  it('marks bounds', () => {
    expect(parseInfo('info depth 12 score cp 40 lowerbound nodes 1 pv e2e4')?.bound).toBe('lower');
    expect(parseInfo('info depth 12 score cp 40 upperbound pv e2e4')?.bound).toBe('upper');
    expect(parseInfo('info depth 12 score cp 40 pv e2e4')?.bound).toBeUndefined();
  });

  it('keeps promotions in the PV and drops junk tokens', () => {
    expect(parseInfo('info depth 4 score cp 900 pv e7e8q d8e8 junk')?.pv).toEqual(['e7e8q', 'd8e8']);
  });

  it('returns null for info string, currmove-only lines and non-info lines', () => {
    expect(parseInfo('info string NNUE evaluation using nn-61e7af4bb97d.nnue')).toBeNull();
    expect(parseInfo('info currmove e2e4 currmovenumber 1')).toBeNull();
    expect(parseInfo('bestmove e2e4')).toBeNull();
    expect(parseInfo('readyok')).toBeNull();
  });

  it('skips text glued in front of info', () => {
    expect(parseInfo('uciokinfo depth 2 score cp 5 pv e2e4')?.depth).toBe(2);
  });

  it('tolerates a malformed score', () => {
    const l = parseInfo('info depth 2 score wdl 1 2 3 pv e2e4');
    expect(l?.eval).toBeUndefined();
    expect(l?.pv).toEqual(['e2e4']);
  });
});

describe('parseBestMove', () => {
  it('parses move and ponder', () => {
    expect(parseBestMove('bestmove e2e4 ponder c7c5')).toEqual({ move: 'e2e4', ponder: 'c7c5' });
    expect(parseBestMove('bestmove e7e8q')).toEqual({ move: 'e7e8q' });
  });
  it('maps (none) to a null move', () => {
    expect(parseBestMove('bestmove (none)')).toEqual({ move: null });
  });
  it('ignores other lines', () => {
    expect(parseBestMove('info depth 1 score cp 0 pv e2e4')).toBeNull();
  });
});

describe('isUciMove', () => {
  it('accepts moves and promotions only', () => {
    expect(isUciMove('e2e4')).toBe(true);
    expect(isUciMove('a7a8n')).toBe(true);
    expect(isUciMove('e2e9')).toBe(false);
    expect(isUciMove('e2e4k')).toBe(false);
    expect(isUciMove('(none)')).toBe(false);
  });
});

describe('parseOption', () => {
  it('parses spin options with spaces in the name', () => {
    expect(parseOption('option name Skill Level type spin default 20 min 0 max 20')).toEqual({
      name: 'Skill Level',
      type: 'spin',
      default: '20',
      min: 0,
      max: 20,
    });
    expect(parseOption('option name MultiPV type spin default 1 min 1 max 256')?.max).toBe(256);
  });
  it('parses check, button, string and combo options', () => {
    expect(parseOption('option name UCI_LimitStrength type check default false')).toEqual({
      name: 'UCI_LimitStrength',
      type: 'check',
      default: 'false',
    });
    expect(parseOption('option name Clear Hash type button')).toEqual({ name: 'Clear Hash', type: 'button' });
    expect(parseOption('option name EvalFile type string default nn-61e7af4bb97d.nnue')?.default).toBe(
      'nn-61e7af4bb97d.nnue',
    );
    expect(parseOption('option name Style type combo default Normal var Solid var Normal')?.vars).toEqual([
      'Solid',
      'Normal',
    ]);
  });
  it('returns null for other lines', () => {
    expect(parseOption('id name Stockfish 19 Lite WASM')).toBeNull();
    expect(parseOption('option name Broken')).toBeNull();
  });
});

describe('commands', () => {
  it('builds go commands in a fixed order and rounds times', () => {
    expect(goCommand({ depth: 8 })).toBe('go depth 8');
    expect(goCommand({ movetime: 199.6 })).toBe('go movetime 200');
    expect(goCommand({ depth: 4, movetime: 1500 })).toBe('go depth 4 movetime 1500');
    expect(goCommand({ wtime: 60000, btime: 59000, winc: 0, binc: 0 })).toBe(
      'go wtime 60000 btime 59000 winc 0 binc 0',
    );
  });
  it('never sends a bare go (which would search forever)', () => {
    expect(goCommand({})).toBe('go depth 1');
    expect(goCommand({ depth: Infinity })).toBe('go depth 1');
    expect(goCommand({ depth: 0 })).toBe('go depth 1');
  });
  it('builds position and setoption commands', () => {
    expect(positionCommand('  8/8/8/8/8/8/8/K6k   w - - 0 1 ')).toBe('position fen 8/8/8/8/8/8/8/K6k w - - 0 1');
    expect(setOptionCommand('Skill Level', 3)).toBe('setoption name Skill Level value 3');
    expect(setOptionCommand('UCI_ShowWDL', false)).toBe('setoption name UCI_ShowWDL value false');
  });
  it('reads the side to move from a FEN', () => {
    expect(fenTurn('8/8/8/8/8/8/8/K6k b - - 0 1')).toBe('b');
    expect(fenTurn('8/8/8/8/8/8/8/K6k w - - 0 1')).toBe('w');
    expect(fenTurn('garbage')).toBe('w');
  });
});

describe('scores', () => {
  it('orders mates around centipawns', () => {
    const order = [{ mate: 1 }, { mate: 5 }, { cp: 300 }, { cp: -300 }, { mate: -5 }, { mate: -1 }, { mate: 0 }];
    const scores = order.map(scoreCp);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(scoreCp({ mate: 1 })).toBe(MATE_CP - 1);
    expect(scoreCp({ mate: 0 })).toBe(-MATE_CP);
    expect(scoreCp({})).toBe(0);
  });
  it('negates evaluations', () => {
    expect(negateEval({ cp: 35 })).toEqual({ cp: -35 });
    expect(negateEval({ mate: 2 })).toEqual({ mate: -2 });
    expect(negateEval({ mate: -3 })).toEqual({ mate: 3 });
  });
});

describe('SearchCollector', () => {
  const add = (c: SearchCollector, line: string) => {
    const info = parseInfo(line);
    if (info) c.add(info);
  };

  it('keeps the deepest line per MultiPV index, in MultiPV order', () => {
    const c = new SearchCollector();
    add(c, 'info depth 1 multipv 1 score cp 29 pv e2e4');
    add(c, 'info depth 1 multipv 2 score cp 6 pv e2e3');
    add(c, 'info depth 2 multipv 2 score cp 19 pv d2d4');
    add(c, 'info depth 2 multipv 1 score cp 40 pv e2e4 e7e5');
    add(c, 'info depth 1 multipv 3 score cp 4 pv g1f3');
    expect(c.lines()).toEqual([
      { uci: 'e2e4', eval: { cp: 40 }, depth: 2, pv: ['e2e4', 'e7e5'] },
      { uci: 'd2d4', eval: { cp: 19 }, depth: 2, pv: ['d2d4'] },
      { uci: 'g1f3', eval: { cp: 4 }, depth: 1, pv: ['g1f3'] },
    ]);
    expect(c.eval()).toEqual({ cp: 40 });
    expect(c.depth()).toBe(2);
  });

  it('prefers an exact score over a bound at the same depth, and a deeper bound over a shallower exact one', () => {
    const c = new SearchCollector();
    add(c, 'info depth 5 score cp 30 pv e2e4');
    add(c, 'info depth 5 score cp 80 lowerbound pv d2d4');
    expect(c.eval()).toEqual({ cp: 30 });
    add(c, 'info depth 6 score cp 90 upperbound pv d2d4');
    expect(c.eval()).toEqual({ cp: 90 });
    add(c, 'info depth 6 score cp 35 pv e2e4');
    expect(c.eval()).toEqual({ cp: 35 });
  });

  it('ignores lines without a score and keeps PV-less evals out of lines()', () => {
    const c = new SearchCollector();
    add(c, 'info depth 3 nodes 100 pv e2e4');
    expect(c.eval()).toBeNull();
    add(c, 'info depth 0 score mate 0');
    expect(c.eval()).toEqual({ mate: 0 });
    expect(c.lines()).toEqual([]);
  });
});
