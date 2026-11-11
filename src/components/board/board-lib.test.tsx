import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { translate } from '@/lib/i18n';
import { history, newGame, play, START_FEN } from '@/lib/zhess';
import type { Game, Language } from '@/lib/types';
import { BoardThumbnail } from './BoardThumbnail';
import { describeMove, describeSquare, type Translate } from './describe';
import { clampDialCenter, dialPick } from './dial';
import {
  cellToSquare,
  drawOrder,
  isLightSquare,
  parseFenBoard,
  premoveTargets,
  premoveUci,
  squareAt,
  squareCenter,
  squareToCell,
  stepSquare,
} from './geometry';
import { PieceIcon } from './PieceIcon';
import { PIECE_SHAPES, pieceSvgMarkup, strokeForSize } from './pieceShapes';
import { BoardSquare } from './Square';
import { readFileSync } from 'node:fs';

const tr = (lang: Language): Translate => (key, vars) => translate(lang, key, vars);
const t = tr('en');

const lastMove = (moves: string[], start?: string) => {
  const g: Game = moves.reduce((acc, m) => play(acc, m, 0), newGame(start));
  const h = history(g);
  return h[h.length - 1];
};

describe('geometry', () => {
  it('maps squares to cells both ways for both orientations', () => {
    expect(squareToCell('a8', 'w')).toEqual({ col: 0, row: 0 });
    expect(squareToCell('h1', 'w')).toEqual({ col: 7, row: 7 });
    expect(squareToCell('h1', 'b')).toEqual({ col: 0, row: 0 });
    for (const o of ['w', 'b'] as const) {
      for (const sq of ['a1', 'e4', 'h8', 'c6'] as const) {
        const { col, row } = squareToCell(sq, o);
        expect(cellToSquare(col, row, o)).toBe(sq);
      }
    }
    expect(cellToSquare(8, 0, 'w')).toBeNull();
    expect(drawOrder('w')[7][0]).toBe('a1');
    expect(drawOrder('b')[0][0]).toBe('h1');
  });

  it('colors squares (a1 dark, h1 light)', () => {
    expect(isLightSquare('a1')).toBe(false);
    expect(isLightSquare('h1')).toBe(true);
    expect(isLightSquare('d4')).toBe(false);
  });

  it('hit-tests points against the board box', () => {
    const box = { left: 10, top: 20, width: 400, height: 400 };
    expect(squareAt(15, 25, box, 'w')).toBe('a8');
    expect(squareAt(409, 419, box, 'w')).toBe('h1');
    expect(squareAt(15, 25, box, 'b')).toBe('h1');
    expect(squareAt(5, 25, box, 'w')).toBeNull();
    expect(squareAt(15, 25, null, 'w')).toBeNull();
    expect(squareAt(15, 25, { left: 0, top: 0, width: 0, height: 0 }, 'w')).toBeNull();
    expect(squareCenter('a8', box, 'w')).toEqual({ x: 35, y: 45 });
  });

  it('steps squares in screen directions and clamps at the edge', () => {
    expect(stepSquare('e2', 0, -1, 'w')).toBe('e3');
    expect(stepSquare('e2', 0, -1, 'b')).toBe('e1');
    expect(stepSquare('a1', -1, 0, 'w')).toBe('a1');
  });

  it('parses the placement field of a FEN, leniently', () => {
    const b = parseFenBoard(START_FEN);
    expect(b[0]).toEqual({ color: 'w', type: 'r' });
    expect(b[4]).toEqual({ color: 'w', type: 'k' });
    expect(b[60]).toEqual({ color: 'b', type: 'k' });
    expect(b.filter(Boolean)).toHaveLength(32);
    expect(parseFenBoard('garbage').filter(Boolean)).toHaveLength(0);
    expect(parseFenBoard('').filter(Boolean)).toHaveLength(0);
  });

  it('lists premove targets Lichess style', () => {
    const fen = play(newGame(), 'e2e4', 0).fen;
    expect(premoveTargets(fen, 'd2').sort()).toEqual(['c3', 'd3', 'd4', 'e3']);
    expect(premoveTargets(fen, 'g1').sort()).toEqual(['e2', 'f3', 'h3']);
    expect(premoveTargets(fen, 'd1')).toContain('d8');
    expect(premoveTargets(fen, 'e1').sort()).toEqual(['c1', 'd1', 'd2', 'e2', 'f1', 'f2', 'g1']);
    expect(premoveTargets(fen, 'e5')).toEqual([]);
    expect(premoveUci({ from: 'e7', to: 'e8', promotion: 'n' })).toBe('e7e8n');
    expect(premoveUci({ from: 'e2', to: 'e4' })).toBe('e2e4');
  });
});

describe('dial', () => {
  it('maps offsets to zones and pieces (Q top, R right, B bottom, N left)', () => {
    expect(dialPick(0, 0)).toEqual({ zone: 'center', piece: null });
    expect(dialPick(30, 0)).toEqual({ zone: 'none', piece: null });
    expect(dialPick(0, -45)).toEqual({ zone: 'aim', piece: 'q' });
    expect(dialPick(70, 0)).toEqual({ zone: 'commit', piece: 'r' });
    expect(dialPick(0, 70)).toEqual({ zone: 'commit', piece: 'b' });
    expect(dialPick(-70, 0)).toEqual({ zone: 'commit', piece: 'n' });
    expect(dialPick(40, -45).piece).toBe('q');
    expect(dialPick(50, -45).piece).toBe('r');
  });

  it('keeps the dial 80 px inside the viewport', () => {
    expect(clampDialCenter(10, 10, 390, 844)).toEqual({ x: 80, y: 80 });
    expect(clampDialCenter(385, 840, 390, 844)).toEqual({ x: 310, y: 764 });
    expect(clampDialCenter(200, 400, 390, 844)).toEqual({ x: 200, y: 400 });
  });
});

describe('describe', () => {
  it('labels cells like "white knight, g1"', () => {
    expect(describeSquare('g1', { color: 'w', type: 'n' }, t)).toBe('white knight, g1');
    expect(describeSquare('e4', null, t, { target: true })).toBe('e4, possible move');
    expect(describeSquare('e8', { color: 'b', type: 'k' }, t, { check: true })).toBe('black king, e8, in check');
    expect(describeSquare('g1', { color: 'w', type: 'n' }, tr('de'))).toBe('weißer Springer, g1');
    expect(describeSquare('d8', { color: 'b', type: 'q' }, tr('fr'))).toBe('dame noire, d8');
  });

  it('describes moves in words for the live region', () => {
    expect(describeMove(lastMove(['e2e4', 'g8f6']), t)).toBe('Black: knight to f6');
    expect(describeMove(lastMove(['e2e4', 'd7d5', 'e4d5']), t)).toBe('White: pawn takes pawn on d5');
    expect(describeMove(lastMove(['f2f3', 'e7e5', 'g2g4', 'd8h4']), t)).toBe('Black: queen to h4, checkmate');
    expect(describeMove(lastMove(['e2e4', 'f7f6', 'd1h5']), t)).toBe('White: queen to h5, check');
    expect(describeMove(lastMove(['e1g1'], 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), t)).toBe('White: castles kingside');
    expect(describeMove(lastMove(['e8c8'], 'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1'), t)).toBe('Black: castles queenside');
    expect(describeMove(lastMove(['e7e8n'], '7k/4P3/8/8/8/8/8/K7 w - - 0 1'), t)).toBe('White: pawn to e8, promotes to knight');
    expect(describeMove(lastMove(['e5d6'], '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1'), t)).toBe(
      'White: pawn takes pawn on d6, en passant',
    );
    expect(describeMove(lastMove(['e2e4', 'g8f6']), tr('de'))).toBe('Schwarz: Springer nach f6');
    expect(describeMove(lastMove(['e2e4', 'g8f6']), tr('es'))).toBe('Negras: caballo a f6');
  });
});

describe('pieces', () => {
  it('has six shapes, white filled light and black filled dark in both themes, outlined in foreground', () => {
    expect(Object.keys(PIECE_SHAPES).sort()).toEqual(['b', 'k', 'n', 'p', 'q', 'r']);
    const { container, rerender } = render(<PieceIcon type="n" color="w" />);
    const body = container.querySelector('path')!;
    expect(body.getAttribute('fill')).toBe('hsl(var(--zhess-ink-light))');
    expect(body.getAttribute('stroke')).toBe('hsl(var(--foreground))');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    rerender(<PieceIcon type="n" color="b" title="black knight" />);
    expect(container.querySelector('path')!.getAttribute('fill')).toBe('hsl(var(--zhess-ink-dark))');
    expect(container.querySelector('path')!.getAttribute('stroke')).toBe('hsl(var(--foreground))');
    expect(screen.getByRole('img', { name: 'black knight' })).toBeInTheDocument();
  });

  it('thickens strokes for small sizes and exports standalone markup', () => {
    expect(strokeForSize(undefined)).toBe(3.5);
    expect(strokeForSize(76)).toBe(3.5);
    expect(strokeForSize(9)).toBe(10);
    expect(strokeForSize(18)).toBeCloseTo(5);
    const svg = pieceSvgMarkup('k', 'b', { size: 64, fg: '#0d0d0d', bg: '#fafafa' });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(svg).toContain('fill="#0d0d0d"');
    expect(svg).toContain('width="64"');
  });
});

describe('square tones', () => {
  const css = readFileSync('src/index.css', 'utf8');
  const block = (selector: string) => css.slice(css.indexOf(`${selector} {`), css.indexOf('}', css.indexOf(`${selector} {`)));

  it('light squares are the lighter ones in both themes: the foreground step moves to the light squares in dark', () => {
    expect(block(':root, .light')).toMatch(/--zhess-sq-light: transparent;[\s\S]*--zhess-sq-dark: hsl\(var\(--foreground\) \/ 0\.1\);/);
    expect(block('.dark')).toMatch(/--zhess-sq-light: hsl\(var\(--foreground\) \/ 0\.1\);[\s\S]*--zhess-sq-dark: transparent;/);
    expect(block(':root, .light')).toMatch(/--zhess-ink-light: var\(--background\)/);
    expect(block('.dark')).toMatch(/--zhess-ink-light: var\(--foreground\)/);
  });

  it('the last-move and selection fills are half the checker step, so a highlighted square never matches the other color', () => {
    const tones = (light: boolean, state: { lastMove?: boolean; selected?: boolean }) => {
      const { container, unmount } = render(<BoardSquare square="e2" piece={null} light={light} label="e2" focusable={false} {...state} />);
      const bg = (container.firstElementChild as HTMLElement).style.backgroundImage;
      unmount();
      return bg;
    };
    for (const light of [true, false]) {
      expect(tones(light, {})).toContain(`var(--zhess-sq-${light ? 'light' : 'dark'})`);
      for (const state of [{ lastMove: true }, { selected: true }]) {
        const bg = tones(light, state);
        expect(bg).toContain('hsl(var(--foreground) / 0.05)');
        expect(bg).not.toMatch(/--foreground\) \/ 0\.(1|15)\)/);
      }
    }
  });
});

describe('BoardThumbnail', () => {
  it('draws the pieces of a FEN as one decorative SVG', () => {
    render(<BoardThumbnail fen={START_FEN} />);
    const svg = screen.getByTestId('board-thumbnail');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg.querySelectorAll('[data-piece]')).toHaveLength(32);
    expect(svg.querySelector('[data-thumb-square="e1"]')).toHaveAttribute('data-piece', 'wk');
  });

  it('can be labelled, flipped and sized', () => {
    render(<BoardThumbnail fen={START_FEN} size={48} orientation="b" label="Game K7QW2M" lastMove={{ from: 'e2', to: 'e4' }} />);
    const svg = screen.getByRole('img', { name: 'Game K7QW2M' });
    expect(svg).toHaveAttribute('width', '48');
    // Oriented for black: the white king's group sits on the top row.
    expect(svg.querySelector('[data-thumb-square="e1"]')?.getAttribute('transform')).toBe('translate(300 0)');
  });

  it('survives a malformed FEN', () => {
    render(<BoardThumbnail fen="!!! not a position" />);
    expect(screen.getByTestId('board-thumbnail').querySelectorAll('[data-piece]')).toHaveLength(0);
  });
});
