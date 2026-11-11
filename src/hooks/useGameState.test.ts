import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, memoryStorage } from '@/lib/storage';
import type { SavedGame, Store } from '@/lib/types';
import { parseUrl } from '@/lib/url';
import zhess from '@/lib/zhess';
import { useGameState } from './useGameState';

const SCHOLAR = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'];
const BASE = 'https://example.test/zhess/';

let t = 0;
const now = () => t;
let store: Store;

/** rng cycling through values; 0 → code "000000" and color white. */
function seq(...values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

function setup(initial = '/', rng = seq(0.1)) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(MemoryRouter, { initialEntries: [initial] }, children);
  return renderHook(
    () => ({
      gs: useGameState({ store, now, rng, baseUrl: BASE }),
      loc: useLocation(),
      navigate: useNavigate(),
    }),
    { wrapper },
  );
}

type R = ReturnType<typeof setup>['result'];

function url(result: R) {
  return parseUrl(result.current.loc.search);
}

function play(result: R, moves: string[], step = 1000) {
  for (const m of moves) {
    t += step;
    act(() => {
      expect(result.current.gs.move(m)).toBe(true);
    });
  }
}

function stored(id: string): SavedGame | undefined {
  return store.games().find((g) => g.id === id);
}

beforeEach(() => {
  t = 1_000_000;
  store = createStore(memoryStorage());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('start screen', () => {
  it('starts with a generated code, the first-run opponent, and writes the URL', () => {
    const { result } = setup('/', seq(0.1));
    const gs = result.current.gs;
    expect(gs.phase).toBe('start');
    expect(gs.code).toBe('333333');
    expect(gs.opponent).toEqual({ mode: 'computer', level: 5 });
    expect(gs.colorChoice).toBe('random');
    expect(gs.tc).toBeNull();
    expect(gs.startPill).toEqual({ label: 'start', saved: null });
    expect(gs.preview.cursor).toBe(0);
    expect(result.current.loc.search).toBe('?s=333333&d=5&o=c');
  });

  it('remembers settings in the store and reflects them in the URL', () => {
    const { result } = setup();
    act(() => result.current.gs.setOpponent({ mode: 'computer', level: 9 }));
    act(() => result.current.gs.setColorChoice('b'));
    act(() => result.current.gs.setTc('5+0'));
    expect(store.pref('opponent', null)).toEqual({ mode: 'computer', level: 9 });
    expect(store.pref('color', 'random')).toBe('b');
    expect(store.pref('clock', 'off')).toBe('5+0');
    expect(url(result)).toMatchObject({ level: 9, mode: 'computer', color: 'b', tc: '5+0' });
    act(() => result.current.gs.setTc(null));
    expect(store.pref('clock', 'x')).toBe('off');
    expect(url(result).tc).toBeUndefined();

    // A second mount reads them back.
    const again = setup();
    expect(again.result.current.gs.opponent).toEqual({ mode: 'computer', level: 9 });
    expect(again.result.current.gs.colorChoice).toBe('b');
  });

  it('normalizes typed codes and refuses empty ones', () => {
    const { result } = setup();
    act(() => {
      expect(result.current.gs.setCode('k7-qw2m')).toBe(true);
    });
    expect(result.current.gs.code).toBe('K7QW2M');
    act(() => {
      expect(result.current.gs.setCode('---')).toBe(false);
    });
    expect(result.current.gs.code).toBe('K7QW2M');
    let fresh = '';
    act(() => {
      fresh = result.current.gs.regenerateCode();
    });
    expect(result.current.gs.code).toBe(fresh);
  });

  it('start-screen links preselect settings', () => {
    const { result } = setup('/?s=ab12&o=l&w=b&t=3%2B2');
    expect(result.current.gs.code).toBe('AB12');
    expect(result.current.gs.opponent).toEqual({ mode: 'local' });
    expect(result.current.gs.colorChoice).toBe('b');
    expect(result.current.gs.tc).toBe('3+2');
    expect(result.current.gs.phase).toBe('start');
  });
});

describe('pass-and-play', () => {
  it('starts, records ms per ply from now(), autosaves and writes moves to the URL', () => {
    const { result } = setup('/?s=GAME01&o=l');
    act(() => {
      expect(result.current.gs.start()).toBe(true);
    });
    expect(result.current.gs.phase).toBe('playing');
    expect(result.current.gs.undoRule).toBe('ply');
    expect(stored('GAME01')).toMatchObject({ mode: 'local', color: 'w', moves: '', createdAt: t, lastPlayedAt: t });
    expect(url(result)).toMatchObject({ code: 'GAME01', playing: true, mode: 'local', moves: '' });

    play(result, ['e2e4'], 1500);
    play(result, ['e7e5'], 2500);
    const rec = stored('GAME01')!;
    expect(rec.ms).toEqual([1500, 2500]);
    expect(rec.lastPlayedAt).toBe(t);
    expect(zhess.decodeMoves(rec.moves)).toEqual(['e2e4', 'e7e5']);
    expect(url(result).moves).toBe(rec.moves);
    expect(result.current.gs.isPlayerTurn).toBe(true);
    expect(result.current.gs.isComputerTurn).toBe(false);
  });

  it('accepts an explicit ms and refuses illegal moves', () => {
    const { result } = setup('/?s=GAME02&o=l');
    act(() => void result.current.gs.start());
    act(() => {
      expect(result.current.gs.move('e2e4', 42)).toBe(true);
      expect(result.current.gs.move('e2e4', 1)).toBe(false);
    });
    expect(stored('GAME02')!.ms).toEqual([42]);
  });

  it('undo steps one ply, marks assisted, saves; redo replays', () => {
    const { result } = setup('/?s=GAME03&o=l');
    act(() => void result.current.gs.start());
    play(result, ['e2e4', 'e7e5', 'g1f3']);
    expect(result.current.gs.canUndo).toBe(true);
    expect(result.current.gs.canRedo).toBe(false);
    act(() => void result.current.gs.undo());
    act(() => void result.current.gs.undo());
    expect(result.current.gs.view!.cursor).toBe(1);
    expect(result.current.gs.canRedo).toBe(true);
    expect(stored('GAME03')).toMatchObject({ assisted: true });
    expect(zhess.decodeMoves(stored('GAME03')!.moves)).toEqual(['e2e4']);
    act(() => void result.current.gs.redo());
    expect(result.current.gs.view!.cursor).toBe(2);
    expect(zhess.decodeMoves(url(result).moves!)).toEqual(['e2e4', 'e7e5']);
  });

  it('resign ends for the side to move; reopen takes it back', () => {
    const { result } = setup('/?s=GAME04&o=l');
    act(() => void result.current.gs.start());
    play(result, ['e2e4']);
    act(() => void result.current.gs.resign());
    expect(result.current.gs.isOver).toBe(true);
    expect(stored('GAME04')).toMatchObject({ result: '1-0', by: 'resign' });
    expect(url(result).end).toEqual({ result: '1-0', by: 'resign' });
    act(() => void result.current.gs.reopen());
    expect(result.current.gs.isOver).toBe(false);
    expect(stored('GAME04')!.result).toBeUndefined();
    expect(url(result).end).toBeUndefined();
  });

  it('timeout and finish end the game', () => {
    const { result } = setup('/?s=GAME05&o=l&t=1%2B0');
    act(() => void result.current.gs.start());
    play(result, ['e2e4']);
    act(() => void result.current.gs.timeout('b'));
    expect(stored('GAME05')).toMatchObject({ result: '1-0', by: 'time', tc: '1+0' });
    act(() => void result.current.gs.reopen());
    act(() => void result.current.gs.finish({ result: '1/2-1/2', by: 'agreed' }));
    expect(stored('GAME05')).toMatchObject({ result: '1/2-1/2', by: 'agreed' });
  });

  it('the turn timer pauses while the tab is hidden', () => {
    const { result } = setup('/?s=GAME06&o=l');
    act(() => void result.current.gs.start());
    t += 1000;
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    t += 60_000;
    vis.mockReturnValue('visible');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    t += 500;
    expect(result.current.gs.turnElapsed()).toBe(1500);
    act(() => void result.current.gs.move('e2e4'));
    expect(stored('GAME06')!.ms).toEqual([1500]);
    vis.mockRestore();
  });
});

describe('against the computer', () => {
  it('undo takes back a full turn and exposes whose turn it is', () => {
    const { result } = setup('/?s=COMP01&o=c&d=3&w=w');
    act(() => void result.current.gs.start());
    expect(result.current.gs.session).toMatchObject({ mode: 'computer', level: 3, color: 'w' });
    expect(result.current.gs.undoRule).toBe('turn');
    expect(result.current.gs.isPlayerTurn).toBe(true);
    play(result, ['e2e4']);
    expect(result.current.gs.isComputerTurn).toBe(true);
    expect(result.current.gs.isPlayerTurn).toBe(false);
    play(result, ['e7e5', 'g1f3', 'b8c6']);
    act(() => void result.current.gs.undo());
    expect(result.current.gs.view!.cursor).toBe(2);
    act(() => void result.current.gs.redo());
    expect(result.current.gs.view!.cursor).toBe(4);
  });

  it('a black player sees the computer to move first; undoing the first turn returns to the start', () => {
    const { result } = setup('/?s=COMP02&o=c&w=b');
    act(() => void result.current.gs.start());
    expect(result.current.gs.session!.color).toBe('b');
    expect(result.current.gs.isComputerTurn).toBe(true);
    expect(result.current.gs.canUndo).toBe(false);
    play(result, ['e2e4']);
    expect(result.current.gs.isPlayerTurn).toBe(true);
    act(() => void result.current.gs.undo());
    expect(result.current.gs.view!.cursor).toBe(0);
    expect(result.current.gs.isComputerTurn).toBe(true);
  });

  it('resign: the player loses', () => {
    const { result } = setup('/?s=COMP03&o=c&w=b');
    act(() => void result.current.gs.start());
    act(() => void result.current.gs.resign());
    expect(stored('COMP03')).toMatchObject({ result: '1-0', by: 'resign' });
  });

  it('markAssisted is saved', () => {
    const { result } = setup('/?s=COMP04&o=c&w=w');
    act(() => void result.current.gs.start());
    act(() => result.current.gs.markAssisted());
    expect(stored('COMP04')!.assisted).toBe(true);
  });

  it('a random color uses the rng', () => {
    const { result } = setup('/?s=COMP05&o=c', seq(0.9));
    act(() => void result.current.gs.start());
    expect(result.current.gs.session!.color).toBe('b');
  });
});

describe('resume, reload and the 15-second rule', () => {
  it('Back keeps the code; the Start pill says resume with the stored settings; redo is empty after resume', () => {
    const { result } = setup('/?s=RES001&o=l');
    act(() => void result.current.gs.start());
    play(result, ['e2e4', 'e7e5']);
    act(() => void result.current.gs.undo());
    expect(result.current.gs.canRedo).toBe(true);
    act(() => result.current.gs.exit());
    expect(result.current.gs.phase).toBe('start');
    expect(result.current.gs.code).toBe('RES001');
    expect(url(result).playing).toBeUndefined();
    expect(url(result).moves).toBeUndefined();
    expect(result.current.gs.startPill.label).toBe('resume');
    expect(result.current.gs.startPill.saved!.mode).toBe('local');
    expect(result.current.gs.preview.cursor).toBe(1);

    // Changing the opponent does not hide the stored game; ROOM always says start.
    act(() => result.current.gs.setOpponent({ mode: 'computer', level: 2 }));
    expect(result.current.gs.startPill.label).toBe('resume');
    act(() => result.current.gs.setOpponent({ mode: 'room' }));
    expect(result.current.gs.startPill.label).toBe('start');
    act(() => {
      expect(result.current.gs.start()).toBe(false);
    });
    act(() => result.current.gs.setOpponent({ mode: 'local' }));

    act(() => void result.current.gs.start());
    expect(result.current.gs.phase).toBe('playing');
    expect(result.current.gs.view!.cursor).toBe(1);
    expect(result.current.gs.canRedo).toBe(false);
  });

  it('a resumed game keeps its lastPlayedAt until a change or 15 seconds', () => {
    vi.useFakeTimers();
    const { result } = setup('/?s=RES002&o=l');
    act(() => void result.current.gs.start());
    play(result, ['e2e4']);
    const playedAt = t;
    act(() => result.current.gs.exit());

    t += 3_600_000;
    act(() => void result.current.gs.start());
    expect(stored('RES002')!.lastPlayedAt).toBe(playedAt);
    t += 10_000;
    act(() => void vi.advanceTimersByTime(10_000));
    expect(stored('RES002')!.lastPlayedAt).toBe(playedAt);
    t += 5_000;
    act(() => void vi.advanceTimersByTime(5_000));
    expect(stored('RES002')!.lastPlayedAt).toBe(t);

    // A quick peek that ends before 15 s leaves it alone.
    act(() => result.current.gs.exit());
    const before = t;
    t += 3_600_000;
    act(() => void result.current.gs.start());
    t += 3_000;
    act(() => void vi.advanceTimersByTime(3_000));
    act(() => result.current.gs.exit());
    act(() => void vi.advanceTimersByTime(30_000));
    expect(stored('RES002')!.lastPlayedAt).toBe(before);

    // A move counts at once.
    act(() => void result.current.gs.start());
    play(result, ['e7e5']);
    expect(stored('RES002')!.lastPlayedAt).toBe(t);
  });

  it('a reload with the game URL resumes the stored game instead of making a new one', () => {
    const first = setup('/?s=REL001&o=l');
    act(() => void first.result.current.gs.start());
    play(first.result, ['e2e4', 'e7e5', 'g1f3']);
    const address = `/${first.result.current.loc.search}`;
    first.unmount();

    const second = setup(address);
    expect(second.result.current.gs.phase).toBe('playing');
    expect(second.result.current.gs.code).toBe('REL001');
    expect(second.result.current.gs.view!.cursor).toBe(3);
    expect(store.games()).toHaveLength(1);
    expect(stored('REL001')!.ms).toEqual([1000, 1000, 1000]);
  });

  it('open() resumes unfinished and reviews finished games from history', () => {
    const { result } = setup('/?s=HIS001&o=l');
    act(() => void result.current.gs.start());
    play(result, SCHOLAR);
    expect(result.current.gs.isOver).toBe(true);
    act(() => result.current.gs.exit());
    expect(result.current.gs.startPill.label).toBe('review');

    const rec = stored('HIS001')!;
    act(() => {
      expect(result.current.gs.open(rec)).toBe(true);
    });
    expect(result.current.gs.phase).toBe('review');
    expect(result.current.gs.reviewCursor).toBe(7);

    const roomGame: SavedGame = { ...rec, id: 'ROOM01.1', code: 'ROOM01', mode: 'room', result: undefined, by: undefined };
    act(() => {
      expect(result.current.gs.open(roomGame)).toBe(false);
    });
  });
});

describe('review and continue from here', () => {
  function finishedGame() {
    const r = setup('/?s=REV001&o=l');
    act(() => void r.result.current.gs.start());
    play(r.result, SCHOLAR);
    act(() => r.result.current.gs.exit());
    act(() => void r.result.current.gs.start());
    return r;
  }

  it('steps, jumps and stays read-only', () => {
    const { result } = finishedGame();
    const gs = () => result.current.gs;
    expect(gs().phase).toBe('review');
    expect(gs().canStepForward).toBe(false);
    act(() => gs().step(-1));
    expect(gs().view!.cursor).toBe(6);
    act(() => gs().toStart());
    expect(gs().view!.cursor).toBe(0);
    expect(gs().canStepBack).toBe(false);
    act(() => gs().goto(4));
    expect(gs().view!.cursor).toBe(4);
    act(() => gs().toEnd());
    expect(gs().view!.cursor).toBe(7);
    expect(gs().phase).toBe('review');
    act(() => {
      expect(gs().move('e2e4')).toBe(false);
      expect(gs().undo()).toBe(false);
    });
    expect(gs().canUndo).toBe(false);
    // Stepping does not save or touch the URL's moves.
    expect(url(result).moves).toBe(stored('REV001')!.moves);
    expect(url(result).end).toEqual({ result: '1-0', by: 'mate' });
  });

  it('continue from here starts a new game with a new code from the shown position', () => {
    const { result } = finishedGame();
    act(() => result.current.gs.goto(4));
    act(() => {
      expect(result.current.gs.continueFromHere()).toBe(true);
    });
    const gs = result.current.gs;
    expect(gs.phase).toBe('playing');
    expect(gs.code).not.toBe('REV001');
    // The opponent selector was set to pass-and-play by the link (?o=l): that is the last solo setting.
    expect(gs.session).toMatchObject({ mode: 'local', color: 'w' });
    expect(gs.view!.cursor).toBe(4);
    const rec = stored(gs.code)!;
    expect(rec.ms).toEqual([0, 0, 0, 0]);
    expect(stored('REV001')!.result).toBe('1-0');
    expect(url(result).code).toBe(gs.code);
  });

  it('continue from here against the computer when that was the last solo setting', () => {
    const { result } = finishedGame();
    act(() => result.current.gs.setOpponent({ mode: 'computer', level: 8 }));
    act(() => result.current.gs.setOpponent({ mode: 'room' }));
    act(() => result.current.gs.goto(3));
    act(() => void result.current.gs.continueFromHere());
    expect(result.current.gs.session).toMatchObject({ mode: 'computer', level: 8, color: 'b' });
  });

  it('the mated end position cannot be continued', () => {
    const { result } = finishedGame();
    act(() => {
      expect(result.current.gs.continueFromHere()).toBe(false);
    });
  });

  it('a move-list jump in a live game enters review; reaching the live position leaves it', () => {
    const { result } = setup('/?s=LIVE01&o=l');
    act(() => void result.current.gs.start());
    play(result, ['e2e4', 'e7e5', 'g1f3']);
    act(() => result.current.gs.goto(1));
    expect(result.current.gs.phase).toBe('review');
    expect(result.current.gs.session!.game.cursor).toBe(3);
    expect(result.current.gs.isPlayerTurn).toBe(false);
    act(() => result.current.gs.step(1));
    expect(result.current.gs.reviewCursor).toBe(2);
    act(() => result.current.gs.step(1));
    expect(result.current.gs.phase).toBe('playing');
    act(() => result.current.gs.enterReview());
    expect(result.current.gs.reviewCursor).toBe(3);
    act(() => result.current.gs.exitReview());
    expect(result.current.gs.phase).toBe('playing');
  });

  it('newGame starts a fresh code with the same mode', () => {
    const { result } = finishedGame();
    act(() => {
      expect(result.current.gs.newGame()).toBe(true);
    });
    expect(result.current.gs.phase).toBe('playing');
    expect(result.current.gs.code).not.toBe('REV001');
    expect(result.current.gs.session!.mode).toBe('local');
    expect(result.current.gs.view!.cursor).toBe(0);
  });
});

describe('shared links', () => {
  const moves = zhess.encodeMoves(['e2e4', 'e7e5', 'g1f3'].map((m) => ({ m, ms: 0 })));

  it('open as a new game on this device with the link settings, times not carried', () => {
    const { result } = setup(`/?s=SHR001&d=4&p=1&o=c&w=b&t=5%2B0&m=${moves}`);
    const gs = result.current.gs;
    expect(gs.phase).toBe('playing');
    expect(gs.session).toMatchObject({ code: 'SHR001', mode: 'computer', level: 4, color: 'b', tc: '5+0' });
    expect(gs.view!.cursor).toBe(3);
    expect(stored('SHR001')).toMatchObject({ moves, ms: [0, 0, 0] });
  });

  it('never overwrite a different stored game with the same code', () => {
    const mine = setup('/?s=SHR002&o=l');
    act(() => void mine.result.current.gs.start());
    play(mine.result, ['d2d4']);
    mine.unmount();
    const myMoves = stored('SHR002')!.moves;

    const { result } = setup(`/?s=SHR002&p=1&o=l&m=${moves}`, seq(0.5));
    const gs = result.current.gs;
    expect(gs.phase).toBe('playing');
    expect(gs.code).not.toBe('SHR002');
    expect(gs.view!.cursor).toBe(3);
    expect(stored('SHR002')!.moves).toBe(myMoves);
    expect(stored(gs.code)!.moves).toBe(moves);
    expect(url(result).code).toBe(gs.code);
  });

  it('finished links open in review', () => {
    const { result } = setup(`/?s=SHR003&p=1&o=l&m=${moves}&r=0-1.resign`);
    expect(result.current.gs.phase).toBe('review');
    expect(result.current.gs.session!.game.end).toEqual({ result: '0-1', by: 'resign' });
    expect(stored('SHR003')).toMatchObject({ result: '0-1', by: 'resign' });
  });

  it('a link pasted into a running tab is applied', () => {
    const { result } = setup('/?s=SHR004&o=l');
    act(() => void result.current.gs.start());
    play(result, ['e2e4']);
    act(() => result.current.navigate(`/?s=SHR005&p=1&o=l&m=${moves}`, { replace: true }));
    expect(result.current.gs.code).toBe('SHR005');
    expect(result.current.gs.view!.cursor).toBe(3);
    expect(stored('SHR004')).toBeDefined();
  });

  it('a room invite preselects ROOM and the code and waits to be started', () => {
    const { result } = setup('/?s=room42&o=r&p=1');
    const gs = result.current.gs;
    expect(gs.phase).toBe('start');
    expect(gs.opponent).toEqual({ mode: 'room' });
    expect(gs.code).toBe('ROOM42');
    expect(gs.invite).toBe('ROOM42');
    act(() => result.current.gs.consumeInvite());
    expect(result.current.gs.invite).toBeNull();
    expect(url(result)).toEqual({ code: 'ROOM42', mode: 'room' });
  });

  it('shareUrl gives the full URL in a game and the settings on the start screen', () => {
    const { result } = setup('/?s=SHR006&o=l');
    expect(result.current.gs.shareUrl()).toBe(`${BASE}#/?s=SHR006&o=l`);
    act(() => void result.current.gs.start());
    play(result, ['e2e4']);
    const link = result.current.gs.shareUrl();
    expect(link.startsWith(`${BASE}#/?s=SHR006&p=1&o=l&m=`)).toBe(true);
    act(() => result.current.gs.setOpponent({ mode: 'room' }));
    act(() => result.current.gs.exit());
    expect(result.current.gs.shareUrl()).toBe(`${BASE}#/?s=SHR006&o=r`);
  });

  it('keeps transient x/y parameters written by others', () => {
    const { result } = setup('/?s=SHR007&o=l');
    act(() => result.current.navigate('/?s=SHR007&o=l&x=OFFER', { replace: true }));
    expect(result.current.gs.phase).toBe('start');
    act(() => void result.current.gs.start());
    expect(url(result).offer).toBe('OFFER');
    expect(url(result).playing).toBe(true);
  });
});
