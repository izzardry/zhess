import { describe, expect, it } from 'vitest';
import { NO_PREMOVE, cancel, legalPremove, premoveAllowed, queue, queuedUci, settle } from './premove';
import type { Game } from './types';
import zhess from './zhess';

function playAll(moves: string[], g: Game = zhess.newGame()): Game {
  return moves.reduce((acc, m) => zhess.play(acc, m, 0), g);
}

describe('premoveAllowed (DESIGN 6.3)', () => {
  it('only timed games against the computer or in a room', () => {
    expect(premoveAllowed({ mode: 'computer', tc: '5+0' })).toBe(true);
    expect(premoveAllowed({ mode: 'room', tc: { baseMs: 60_000, incMs: 0 } })).toBe(true);
    expect(premoveAllowed({ mode: 'computer', tc: null })).toBe(false);
    expect(premoveAllowed({ mode: 'room', tc: 'off' })).toBe(false);
    expect(premoveAllowed({ mode: 'local', tc: '5+0' })).toBe(false);
    expect(premoveAllowed({ mode: 'computer', tc: '5+0', live: false })).toBe(false);
  });
});

describe('premove machine', () => {
  // White (the player) has moved; the computer (black) is thinking.
  const waiting = playAll(['e2e4']);

  it('queues only during the opponent turn', () => {
    const s = queue(NO_PREMOVE, waiting, 'w', { from: 'g1', to: 'f3' });
    expect(s.move).toEqual({ from: 'g1', to: 'f3' });
    expect(s.at).toBe(1);
    // White to move: no premove, play normally.
    const own = zhess.newGame();
    expect(queue(NO_PREMOVE, own, 'w', { from: 'g1', to: 'f3' })).toBe(NO_PREMOVE);
    // Game over: nothing.
    expect(queue(NO_PREMOVE, zhess.end(waiting, '1-0', 'resign'), 'w', { from: 'g1', to: 'f3' })).toBe(NO_PREMOVE);
  });

  it('a new premove replaces the old one; cancel clears it', () => {
    let s = queue(NO_PREMOVE, waiting, 'w', { from: 'g1', to: 'f3' });
    s = queue(s, waiting, 'w', { from: 'd2', to: 'd4' });
    expect(s.move).toEqual({ from: 'd2', to: 'd4' });
    expect(cancel()).toEqual(NO_PREMOVE);
  });

  it('waits while nothing changed', () => {
    const s = queue(NO_PREMOVE, waiting, 'w', { from: 'g1', to: 'f3' });
    expect(settle(s, waiting, 'w')).toEqual({ state: s, fire: null, outcome: 'wait' });
    expect(settle(NO_PREMOVE, waiting, 'w')).toEqual({ state: NO_PREMOVE, fire: null, outcome: 'idle' });
  });

  it('fires when the opponent moved and the move is legal', () => {
    const s = queue(NO_PREMOVE, waiting, 'w', { from: 'g1', to: 'f3' });
    const r = settle(s, zhess.play(waiting, 'e7e5', 900), 'w');
    expect(r).toEqual({ state: NO_PREMOVE, fire: 'g1f3', outcome: 'fire' });
  });

  it('drops silently when the opponent made it illegal', () => {
    // 1.e4 d5: premove e4-e5 is still legal; e4xd5 premove before d5 is a capture that only works after d5.
    const s = queue(NO_PREMOVE, waiting, 'w', { from: 'e4', to: 'e5' });
    const blocked = zhess.play(waiting, 'e7e5', 0);
    expect(settle(s, blocked, 'w')).toEqual({ state: NO_PREMOVE, fire: null, outcome: 'drop' });
  });

  it('a capture premove fires once the target is there', () => {
    const s = queue(NO_PREMOVE, waiting, 'w', { from: 'e4', to: 'd5' });
    expect(settle(s, zhess.play(waiting, 'd7d5', 0), 'w').fire).toBe('e4d5');
    expect(settle(s, zhess.play(waiting, 'c7c5', 0), 'w').outcome).toBe('drop');
  });

  it('drops on undo, on a different game, on a session change and at game over', () => {
    const s = queue(NO_PREMOVE, waiting, 'w', { from: 'g1', to: 'f3' }, 'K7QW2M');
    expect(settle(s, zhess.undo(waiting, 1), 'w', 'K7QW2M').outcome).toBe('drop');
    expect(settle(s, playAll(['d2d4', 'd7d5']), 'w', 'K7QW2M').outcome).toBe('drop');
    expect(settle(s, playAll(['d2d4']), 'w', 'K7QW2M').outcome).toBe('drop');
    expect(settle(s, zhess.play(waiting, 'e7e5', 0), 'w', 'OTHER1').outcome).toBe('drop');
    expect(settle(s, zhess.end(waiting, '1-0', 'resign'), 'w', 'K7QW2M').outcome).toBe('drop');
    // Two plies at once (e.g. a sync) is not "the opponent has moved": drop.
    expect(settle(s, playAll(['e7e5', 'g1f3'], waiting), 'w', 'K7QW2M').outcome).toBe('drop');
  });

  it('works for black, and promotions default to a queen', () => {
    // A position where black has a pawn on a2 about to promote, white to move.
    const g = zhess.newGame('7k/8/8/8/8/8/p7/7K w - - 0 1');
    const s = queue(NO_PREMOVE, g, 'b', { from: 'a2', to: 'a1' });
    const r = settle(s, zhess.play(g, 'h1g1', 0), 'b');
    expect(r.fire).toBe('a2a1q');
    const knight = queue(NO_PREMOVE, g, 'b', { from: 'a2', to: 'a1', promotion: 'n' });
    expect(settle(knight, zhess.play(g, 'h1g1', 0), 'b').fire).toBe('a2a1n');
    expect(queuedUci({ from: 'a2', to: 'a1', promotion: 'n' })).toBe('a2a1n');
    expect(queuedUci({ from: 'g1', to: 'f3' })).toBe('g1f3');
  });

  it('legalPremove checks against the current position', () => {
    const g = playAll(['e2e4', 'e7e5']);
    expect(legalPremove(g, { from: 'g1', to: 'f3' })).toBe('g1f3');
    expect(legalPremove(g, { from: 'g1', to: 'g3' })).toBeNull();
    // A sliding piece through a blocker.
    expect(legalPremove(g, { from: 'f1', to: 'a6' })).toBe('f1a6');
    expect(legalPremove(g, { from: 'd1', to: 'd5' })).toBeNull();
  });
});
