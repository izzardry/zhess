import { describe, expect, it, vi } from 'vitest';
import type { GameEnd } from '@/lib/types';
import {
  figurineParts,
  formatPoints,
  fullMoves,
  groupCaptured,
  movePairs,
  plyNumber,
  stripPair,
} from './notation';
import { endTexts, outcomeFor, tintClass, tintFor, winner } from './outcome';
import { copyText, shareOrCopy } from './share';

describe('notation', () => {
  it('splits SAN into figurine parts', () => {
    expect(figurineParts('Nf3')).toEqual([{ piece: 'n' }, 'f3']);
    expect(figurineParts('Qxe7+')).toEqual([{ piece: 'q' }, 'xe7+']);
    expect(figurineParts('e4')).toEqual(['e4']);
    expect(figurineParts('bxc3')).toEqual(['bxc3']); // a b-pawn, not a bishop
    expect(figurineParts('O-O-O')).toEqual(['O-O-O']);
    expect(figurineParts('e8=N+')).toEqual(['e8=', { piece: 'n' }, '+']);
    expect(figurineParts('axb1=Q#')).toEqual(['axb1=', { piece: 'q' }, '#']);
    expect(figurineParts('Kh1')).toEqual([{ piece: 'k' }, 'h1']);
  });

  it('numbers plies from white or from black', () => {
    expect(plyNumber(0)).toEqual({ number: 1, color: 'w' });
    expect(plyNumber(1)).toEqual({ number: 1, color: 'b' });
    expect(plyNumber(2)).toEqual({ number: 2, color: 'w' });
    expect(plyNumber(0, 20, 'b')).toEqual({ number: 20, color: 'b' });
    expect(plyNumber(1, 20, 'b')).toEqual({ number: 21, color: 'w' });
  });

  it('groups plies into move pairs', () => {
    expect(movePairs(['e4', 'e5', 'Nf3'])).toEqual([
      { number: 1, w: { san: 'e4', ply: 0 }, b: { san: 'e5', ply: 1 } },
      { number: 2, w: { san: 'Nf3', ply: 2 } },
    ]);
    expect(movePairs(['Kd7', 'Ke2'], 30, 'b')).toEqual([
      { number: 30, b: { san: 'Kd7', ply: 0 } },
      { number: 31, w: { san: 'Ke2', ply: 1 } },
    ]);
  });

  it('builds the strip up to the cursor', () => {
    const sans = ['e4', 'e5', 'Nf3', 'Nc6'];
    expect(stripPair(sans, 0)).toBeNull();
    expect(stripPair(sans, 1)).toEqual({ number: 1, w: { san: 'e4', ply: 0 } });
    expect(stripPair(sans, 2)).toEqual({ number: 1, w: { san: 'e4', ply: 0 }, b: { san: 'e5', ply: 1 } });
    expect(stripPair(sans, 3)).toEqual({ number: 2, w: { san: 'Nf3', ply: 2 } });
    expect(stripPair(sans, 99)).toEqual({ number: 2, w: { san: 'Nf3', ply: 2 }, b: { san: 'Nc6', ply: 3 } });
    // a game starting with black: the first strip has no white move
    expect(stripPair(['Kd7'], 1, 30, 'b')).toEqual({ number: 30, b: { san: 'Kd7', ply: 0 } });
  });

  it('counts full moves, formats points and groups captures', () => {
    expect(fullMoves(0)).toBe(0);
    expect(fullMoves(67)).toBe(34);
    expect(fullMoves(68)).toBe(34);
    expect(formatPoints(2)).toBe('2');
    expect(formatPoints(1.5)).toBe('1½');
    expect(formatPoints(0.5)).toBe('½');
    expect(groupCaptured(['q', 'p', 'n', 'p'])).toEqual([
      { type: 'p', count: 2 },
      { type: 'n', count: 1 },
      { type: 'q', count: 1 },
    ]);
  });
});

describe('outcome', () => {
  const e = (result: GameEnd['result'], by: GameEnd['by']): GameEnd => ({ result, by });

  it('finds the winner and the outcome per mode', () => {
    expect(winner(e('1-0', 'mate'))).toBe('w');
    expect(winner(e('0-1', 'resign'))).toBe('b');
    expect(winner(e('1/2-1/2', 'stalemate'))).toBeNull();
    expect(outcomeFor(e('1-0', 'mate'), 'computer', 'w')).toBe('win');
    expect(outcomeFor(e('1-0', 'mate'), 'room', 'b')).toBe('loss');
    expect(outcomeFor(e('1-0', 'mate'), 'local', 'w')).toBe('local');
    expect(outcomeFor(e('1/2-1/2', 'agreed'), 'room', 'w')).toBe('draw');
  });

  it('tints green for a win, red for a loss, nothing otherwise (DESIGN 8.4)', () => {
    expect(tintFor(e('0-1', 'mate'), 'computer', 'b')).toBe('success');
    expect(tintFor(e('0-1', 'time'), 'computer', 'w')).toBe('destructive');
    expect(tintFor(e('0-1', 'mate'), 'local', 'w')).toBeNull();
    expect(tintFor(e('1/2-1/2', 'repetition'), 'computer', 'w')).toBeNull();
    expect(tintClass('success')).toBe('page-tint completion-success');
    expect(tintClass('destructive')).toBe('page-tint completion-failure');
    expect(tintClass(null)).toBe('page-tint');
  });

  it('picks glyph, title and reason per the table of DESIGN 8.4', () => {
    expect(endTexts(e('1-0', 'mate'), 'computer', 'w')).toEqual({ glyph: true, title: 'game.title.checkmateWin' });
    expect(endTexts(e('1-0', 'resign'), 'room', 'w')).toEqual({
      glyph: true,
      title: 'game.title.youWon',
      reason: 'game.reason.opponentResigned',
    });
    expect(endTexts(e('1-0', 'time'), 'room', 'w').reason).toBe('game.reason.opponentTime');
    expect(endTexts(e('1-0', 'mate'), 'computer', 'b')).toEqual({ glyph: false, title: 'game.title.checkmateLoss' });
    expect(endTexts(e('1-0', 'time'), 'computer', 'b')).toEqual({ glyph: false, title: 'game.title.outOfTime' });
    expect(endTexts(e('0-1', 'resign'), 'computer', 'w')).toEqual({ glyph: false, title: 'game.title.resigned' });
    expect(endTexts(e('1/2-1/2', 'stalemate'), 'computer', 'w')).toEqual({
      glyph: false,
      title: 'game.title.draw',
      reason: 'game.reason.stalemate',
    });
    expect(endTexts(e('1/2-1/2', 'time'), 'room', 'w').reason).toBe('game.reason.timeNoMate');
    expect(endTexts(e('1-0', 'mate'), 'local', 'w')).toEqual({
      glyph: true,
      title: 'game.title.whiteWins',
      reason: 'game.reason.mate',
    });
    expect(endTexts(e('0-1', 'resign'), 'local', 'w')).toEqual({
      glyph: true,
      title: 'game.title.blackWins',
      reason: 'game.reason.whiteResigned',
    });
    expect(endTexts(e('1-0', 'time'), 'local', 'w').reason).toBe('game.reason.blackTime');
    expect(endTexts(e('1/2-1/2', 'material'), 'local', 'w').title).toBe('game.title.draw');
  });
});

describe('share', () => {
  const data = { title: 'Zhess', text: 'Look', url: 'https://x/#/?s=ABC' };

  it('uses the share sheet when there is one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    expect(await shareOrCopy(data, { share, clipboard: { writeText } })).toBe('shared');
    expect(share).toHaveBeenCalledWith(data);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies nothing when the user closes the sheet', async () => {
    const abort = Object.assign(new Error('cancel'), { name: 'AbortError' });
    const writeText = vi.fn();
    expect(await shareOrCopy(data, { share: vi.fn().mockRejectedValue(abort), clipboard: { writeText } })).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to copying the URL when sharing fails or is missing', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareOrCopy(data, { share: vi.fn().mockRejectedValue(new Error('nope')), clipboard: { writeText } })).toBe('copied');
    expect(await shareOrCopy(data, { clipboard: { writeText } })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(data.url);
  });

  it('falls back to execCommand when the clipboard API fails, and reports failure', async () => {
    const exec = vi.fn().mockReturnValue(true);
    const original = document.execCommand;
    document.execCommand = exec;
    try {
      expect(await copyText('pgn', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })).toBe(true);
      expect(exec).toHaveBeenCalledWith('copy');
      exec.mockReturnValue(false);
      expect(await shareOrCopy(data, {})).toBe('failed');
    } finally {
      document.execCommand = original;
    }
    expect(document.querySelector('textarea')).toBeNull();
  });
});
