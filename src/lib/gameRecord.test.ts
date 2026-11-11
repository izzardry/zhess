import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPPONENT,
  applyEnd,
  applyGoto,
  applyMove,
  applyRedo,
  applyReopen,
  applyResign,
  applyTimeout,
  applyTouch,
  applyUndo,
  continueSpec,
  createSession,
  findSolo,
  freshCode,
  gameFromSaved,
  groupByTime,
  parseClockPref,
  parseColorChoice,
  parseOpponent,
  redoTarget,
  resolveColor,
  sessionFromSaved,
  startPillFor,
  toSavedGame,
  undoRuleFor,
  undoTarget,
  viewOf,
  type GameSession,
} from './gameRecord';
import type { Game, SavedGame } from './types';
import zhess from './zhess';

const SCHOLAR = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'];

function playAll(g: Game, ucis: string[]): Game {
  return ucis.reduce((acc, m) => zhess.play(acc, m, 100), g);
}

function session(over: Partial<Parameters<typeof createSession>[0]> = {}, at = 1000): GameSession {
  return createSession({ code: 'ABC123', mode: 'local', color: 'w', tc: null, ...over }, at);
}

function saved(id: string, extra: Partial<SavedGame> = {}): SavedGame {
  return {
    id,
    code: id.split('.')[0],
    mode: 'local',
    color: 'w',
    tc: null,
    moves: '',
    ms: [],
    assisted: false,
    createdAt: 1,
    lastPlayedAt: 1,
    ...extra,
  };
}

/** Sequence rng for deterministic codes. */
function seq(...values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('settings parsing', () => {
  it('reads opponents defensively', () => {
    expect(parseOpponent(null)).toEqual(DEFAULT_OPPONENT);
    expect(parseOpponent('nonsense')).toEqual(DEFAULT_OPPONENT);
    expect(parseOpponent({ mode: 'room' })).toEqual({ mode: 'room' });
    expect(parseOpponent({ mode: 'local' })).toEqual({ mode: 'local' });
    expect(parseOpponent({ mode: 'computer', level: 9 })).toEqual({ mode: 'computer', level: 9 });
    expect(parseOpponent({ mode: 'computer', level: 40 })).toEqual({ mode: 'computer', level: 5 });
  });

  it('reads color and clock prefs', () => {
    expect(parseColorChoice('w')).toBe('w');
    expect(parseColorChoice('b')).toBe('b');
    expect(parseColorChoice('x')).toBe('random');
    expect(parseClockPref('off')).toBeNull();
    expect(parseClockPref('5+0')).toBe('5+0');
    expect(parseClockPref('15+10')).toBe('15+10');
    expect(parseClockPref(5)).toBeNull();
  });

  it('resolves colors: pass-and-play is white, random flips a coin', () => {
    expect(resolveColor('b', 'local', () => 0.9)).toBe('w');
    expect(resolveColor('b', 'computer', () => 0.1)).toBe('b');
    expect(resolveColor('random', 'computer', () => 0.1)).toBe('w');
    expect(resolveColor('random', 'computer', () => 0.9)).toBe('b');
  });

  it('generates codes no stored game uses', () => {
    // rng 0 → "000000", then 0.5 → "IIIIII"
    const games = [saved('000000')];
    const rng = seq(0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5);
    expect(freshCode(games, rng)).toBe('IIIIII');
  });
});

describe('undo and redo rules', () => {
  it('maps modes to rules', () => {
    expect(undoRuleFor('local')).toBe('ply');
    expect(undoRuleFor('computer')).toBe('turn');
    expect(undoRuleFor('room')).toBe('request');
  });

  it('pass-and-play steps one ply', () => {
    const g = playAll(zhess.newGame(), ['e2e4', 'e7e5', 'g1f3']);
    expect(undoTarget(g, 'ply', 'w')).toBe(2);
    const back = zhess.undo(g, 1);
    expect(redoTarget(back, 'ply', 'w')).toBe(3);
    expect(undoTarget(zhess.newGame(), 'ply', 'w')).toBe(0);
  });

  it('computer: one full turn back when the player is to move', () => {
    const g = playAll(zhess.newGame(), ['e2e4', 'e7e5', 'g1f3', 'b8c6']);
    expect(undoTarget(g, 'turn', 'w')).toBe(2);
    const back = zhess.undo(g, 2);
    // Redo replays both plies.
    expect(redoTarget(back, 'turn', 'w')).toBe(4);
  });

  it('computer: only the player move while the computer is thinking', () => {
    const g = playAll(zhess.newGame(), ['e2e4', 'e7e5', 'g1f3']);
    expect(undoTarget(g, 'turn', 'w')).toBe(2);
  });

  it('computer: black undoing the first turn goes to the start (the computer moves again)', () => {
    const g1 = playAll(zhess.newGame(), ['e2e4']);
    expect(undoTarget(g1, 'turn', 'b')).toBe(0);
    const g3 = playAll(zhess.newGame(), ['e2e4', 'e7e5', 'g1f3']);
    expect(undoTarget(g3, 'turn', 'b')).toBe(1);
  });

  it('redo to the end of a tail that stops on the computer turn', () => {
    const g = zhess.undo(playAll(zhess.newGame(), ['e2e4', 'e7e5', 'g1f3']), 3);
    expect(redoTarget(g, 'turn', 'w')).toBe(2);
    expect(redoTarget(zhess.redo(g, 2), 'turn', 'w')).toBe(3);
  });

  it('rooms have no local undo', () => {
    const g = playAll(zhess.newGame(), ['e2e4']);
    expect(undoTarget(g, 'request', 'w')).toBe(1);
    expect(redoTarget(zhess.undo(g, 1), 'request', 'w')).toBe(0);
  });
});

describe('session transitions', () => {
  it('a new session counts as played and has no review', () => {
    const s = session({}, 5000);
    expect(s.touched).toBe(true);
    expect(s.createdAt).toBe(5000);
    expect(s.lastPlayedAt).toBe(5000);
    expect(s.review).toBeNull();
    expect(s.level).toBeUndefined();
    expect(session({ mode: 'computer' }).level).toBe(5);
    expect(session({ mode: 'local', color: 'b' }).color).toBe('w');
  });

  it('moves record ms and bump lastPlayedAt; illegal moves are refused', () => {
    const s = session({}, 1000);
    const a = applyMove(s, 'e2e4', 1234, 2000)!;
    expect(a.game.plies).toEqual([{ m: 'e2e4', ms: 1234 }]);
    expect(a.lastPlayedAt).toBe(2000);
    expect(applyMove(a, 'e2e4', 0, 3000)).toBeNull();
  });

  it('undo marks assisted and keeps a session-only redo tail', () => {
    let s = session();
    for (const m of ['e2e4', 'e7e5', 'g1f3']) s = applyMove(s, m, 10, 1)!;
    const u = applyUndo(s, 50)!;
    expect(u.assisted).toBe(true);
    expect(u.game.cursor).toBe(2);
    expect(u.lastPlayedAt).toBe(50);
    const rec = toSavedGame(u);
    expect(zhess.decodeMoves(rec.moves)).toEqual(['e2e4', 'e7e5']);
    expect(rec.ms).toEqual([10, 10]);
    const r = applyRedo(u, 60)!;
    expect(r.game.cursor).toBe(3);
    expect(applyRedo(r, 70)).toBeNull();
    expect(applyUndo(session(), 1)).toBeNull();
  });

  it('computer undo takes back a full turn', () => {
    let s = session({ mode: 'computer', color: 'w', level: 3 });
    for (const m of ['e2e4', 'e7e5', 'g1f3', 'b8c6']) s = applyMove(s, m, 10, 1)!;
    const u = applyUndo(s, 2)!;
    expect(u.game.cursor).toBe(2);
    expect(applyRedo(u, 3)!.game.cursor).toBe(4);
  });

  it('a move after undo drops the redo tail', () => {
    let s = session();
    for (const m of ['e2e4', 'e7e5']) s = applyMove(s, m, 10, 1)!;
    s = applyMove(applyUndo(s, 2)!, 'c7c5', 5, 3)!;
    expect(s.game.plies.map((p) => p.m)).toEqual(['e2e4', 'c7c5']);
    expect(applyRedo(s, 4)).toBeNull();
  });

  it('resign: the side to move in pass-and-play, the player against the computer; reopen takes it back', () => {
    let local = applyMove(session(), 'e2e4', 1, 1)!;
    local = applyResign(local, 2)!;
    expect(local.game.end).toEqual({ result: '1-0', by: 'resign' });
    expect(applyMove(local, 'e7e5', 1, 3)).toBeNull();
    expect(applyResign(local, 3)).toBeNull();
    const back = applyReopen(local, 4)!;
    expect(back.game.end).toBeUndefined();
    expect(applyReopen(back, 5)).toBeNull();

    const comp = applyResign(session({ mode: 'computer', color: 'b' }), 2)!;
    expect(comp.game.end).toEqual({ result: '1-0', by: 'resign' });
  });

  it('automatic endings cannot be reopened', () => {
    let s = session();
    for (const m of SCHOLAR) s = applyMove(s, m, 1, 1)!;
    expect(s.game.end).toEqual({ result: '1-0', by: 'mate' });
    expect(applyReopen(s, 2)).toBeNull();
  });

  it('finish and timeout end the game', () => {
    const agreed = applyEnd(session(), { result: '1/2-1/2', by: 'agreed' }, 2)!;
    expect(agreed.game.end?.by).toBe('agreed');
    const flagged = applyTimeout(applyMove(session(), 'e2e4', 1, 1)!, 'b', 3)!;
    expect(flagged.game.end).toEqual({ result: '1-0', by: 'time' });
  });

  it('the 15-second touch moves lastPlayedAt once', () => {
    const s = sessionFromSaved(saved('K7QW2M', { lastPlayedAt: 10 }), 100);
    expect(s.touched).toBe(false);
    expect(s.lastPlayedAt).toBe(10);
    const t = applyTouch(s, 15100);
    expect(t.touched).toBe(true);
    expect(t.lastPlayedAt).toBe(15100);
    expect(applyTouch(t, 99999)).toBe(t);
  });
});

describe('stored games', () => {
  it('round-trips a session through SavedGame', () => {
    let s = session({ code: 'K7QW2M', mode: 'computer', level: 7, color: 'b', tc: '5+0' }, 100);
    for (const m of ['e2e4', 'e7e5']) s = applyMove(s, m, 700, 200)!;
    const rec = toSavedGame(s);
    expect(rec).toMatchObject({
      id: 'K7QW2M',
      code: 'K7QW2M',
      mode: 'computer',
      level: 7,
      color: 'b',
      tc: '5+0',
      ms: [700, 700],
      assisted: false,
      createdAt: 100,
      lastPlayedAt: 200,
    });
    expect(rec.result).toBeUndefined();
    const back = sessionFromSaved(rec, 300);
    expect(back.game.fen).toBe(s.game.fen);
    expect(back.game.cursor).toBe(2);
    expect(back.review).toBeNull();
    expect(back.openedAt).toBe(300);
  });

  it('finished games carry their result and open in review at the end', () => {
    let s = session();
    for (const m of ['e2e4', 'e7e5']) s = applyMove(s, m, 1, 1)!;
    s = applyResign(s, 2)!;
    const rec = toSavedGame(s);
    expect(rec.result).toBe('0-1');
    expect(rec.by).toBe('resign');
    const back = sessionFromSaved(rec, 3);
    expect(back.game.end).toEqual({ result: '0-1', by: 'resign' });
    expect(back.review).toBe(2);
  });

  it('survives a corrupt move string', () => {
    const g = gameFromSaved(saved('X', { moves: '!!!!' }));
    expect(g.cursor).toBe(0);
  });
});

describe('review', () => {
  function finished(): GameSession {
    let s = session();
    for (const m of SCHOLAR) s = applyMove(s, m, 1, 1)!;
    return sessionFromSaved(toSavedGame(s), 2);
  }

  it('steps through a finished game and stays in review at the end', () => {
    const s = finished();
    expect(s.review).toBe(7);
    const a = applyGoto(s, 3);
    expect(a.review).toBe(3);
    expect(viewOf(a).cursor).toBe(3);
    expect(viewOf(a).end).toEqual({ result: '1-0', by: 'mate' });
    expect(applyGoto(a, -5).review).toBe(0);
    expect(applyGoto(a, 99).review).toBe(7);
    expect(applyMove(a, 'e2e4', 1, 1)).toBeNull();
    expect(applyUndo(a, 1)).toBeNull();
  });

  it('reaching the live position of an unfinished game leaves review', () => {
    let s = session();
    for (const m of ['e2e4', 'e7e5', 'g1f3']) s = applyMove(s, m, 1, 1)!;
    const r = applyGoto(s, 1);
    expect(r.review).toBe(1);
    expect(applyGoto(r, 3).review).toBeNull();
    expect(applyGoto(s, 3)).toBe(s);
  });

  it('continue from here: a new game with the shown plies, ms zeroed, side to move for the player', () => {
    const s = applyGoto(finished(), 3);
    const spec = continueSpec(viewOf(s), { mode: 'computer', level: 8 }, 'NEW123', null)!;
    expect(spec.mode).toBe('computer');
    expect(spec.level).toBe(8);
    expect(spec.color).toBe('b');
    expect(spec.game!.cursor).toBe(3);
    expect(spec.game!.plies.every((p) => p.ms === 0)).toBe(true);
    const local = continueSpec(viewOf(s), { mode: 'local' }, 'NEW123', '5+0')!;
    expect(local.mode).toBe('local');
    expect(local.color).toBe('w');
    expect(local.tc).toBe('5+0');
    // The mated end position cannot be continued.
    expect(continueSpec(viewOf(finished()), { mode: 'local' }, 'X', null)).toBeNull();
    const fresh = createSession(spec, 9);
    expect(fresh.review).toBeNull();
    expect(fresh.touched).toBe(true);
  });
});

describe('start pill', () => {
  const games = [
    saved('AAAAAA'),
    saved('BBBBBB', { result: '1-0', by: 'mate' }),
    saved('CCCCCC.1', { mode: 'room' }),
  ];

  it('labels per DESIGN 4.1', () => {
    expect(startPillFor('ZZZZZZ', { mode: 'local' }, games).label).toBe('start');
    expect(startPillFor('AAAAAA', { mode: 'computer', level: 3 }, games)).toEqual({ label: 'resume', saved: games[0] });
    expect(startPillFor('BBBBBB', { mode: 'local' }, games).label).toBe('review');
    expect(startPillFor('AAAAAA', { mode: 'room' }, games)).toEqual({ label: 'start', saved: null });
    // Room games do not make a solo code "known".
    expect(startPillFor('CCCCCC', { mode: 'local' }, games).label).toBe('start');
    expect(findSolo(games, 'CCCCCC.1')).toBeNull();
  });
});

describe('time groups', () => {
  it('groups like Zudoku and drops empty groups', () => {
    const now = new Date(2026, 10, 11, 15, 0, 0).getTime();
    const day = 86_400_000;
    const g = (id: string, at: number) => saved(id, { lastPlayedAt: at });
    const list = [
      g('OLD', now - 400 * day),
      g('TODAY', now - 60_000),
      g('WEEK', now - 3 * day),
      g('MONTH', now - 20 * day),
      g('YEAR', now - 100 * day),
    ];
    const groups = groupByTime(list, now);
    expect(groups.map((x) => x.key)).toEqual(['today', 'week', 'month', 'year', 'older']);
    expect(groups.map((x) => x.games[0].id)).toEqual(['TODAY', 'WEEK', 'MONTH', 'YEAR', 'OLD']);
    expect(groupByTime([g('A', now - 2 * day)], now).map((x) => x.key)).toEqual(['week']);
    expect(groupByTime([], now)).toEqual([]);
  });
});
