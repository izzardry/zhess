import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { GameHistory } from './GameHistory';
import { COLLAPSE_MS } from './useSwipeToDelete';
import { UNDO_TOAST_MS } from './DeleteUndoToasts';
import { renderWithI18n, savedGame } from './test-utils';
import type { Room, SavedGame } from '@/lib/types';

const NOW = new Date(2026, 10, 11, 15, 0, 0).getTime();
const now = () => NOW;
const MIN = 60_000;

function games(n: number): SavedGame[] {
  return Array.from({ length: n }, (_, i) =>
    savedGame({ id: `G${i}`, code: `G${i}`, lastPlayedAt: NOW - (i + 1) * MIN * 60 * 30 }),
  );
}

/** A GameHistory over local state, like the integrator wires it to the store. */
function Harness({
  initial,
  onOpen = () => {},
  rooms,
  renderThumbnail,
}: {
  initial: SavedGame[];
  onOpen?: (g: SavedGame) => void;
  rooms?: Room[];
  renderThumbnail?: (g: SavedGame, size: number) => React.ReactNode;
}) {
  const [list, setList] = useState(initial);
  return (
    <GameHistory
      games={list}
      now={now}
      rooms={rooms}
      renderThumbnail={renderThumbnail}
      onOpen={onOpen}
      onDelete={(g) => setList((l) => l.filter((x) => x.id !== g.id))}
      onRestore={(g) => setList((l) => [...l, g])}
    />
  );
}

const cards = () => screen.queryAllByTestId('history-card');

// jsdom has no PointerEvent; a MouseEvent subclass carries clientX/Y plus the pointer fields.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  Object.defineProperty(window, 'PointerEvent', { value: PointerEventPolyfill, configurable: true, writable: true });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('GameHistory', () => {
  it('renders nothing without games', () => {
    const { container } = renderWithI18n(
      <GameHistory games={[]} onOpen={() => {}} onDelete={() => {}} onRestore={() => {}} now={now} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Previous games')).toBeNull();
  });

  it('shows the five most recent cards and "N more games"', () => {
    renderWithI18n(<Harness initial={games(8)} />);
    expect(screen.getByRole('heading', { name: 'Previous games' })).toBeInTheDocument();
    expect(cards()).toHaveLength(5);
    expect(cards()[0]).toHaveTextContent('G0');
    expect(screen.getByRole('button', { name: '3 more games' })).toBeInTheDocument();
  });

  it('says "1 more game" for one', () => {
    renderWithI18n(<Harness initial={games(6)} />);
    expect(screen.getByRole('button', { name: '1 more game' })).toBeInTheDocument();
  });

  it('shows the facts of DESIGN 12.2 on a card', () => {
    const thumb = vi.fn((g: SavedGame, size: number) => <div data-testid="thumb">{`${g.code}@${size}`}</div>);
    renderWithI18n(
      <Harness
        renderThumbnail={thumb}
        initial={[
          savedGame({ uci: ['e2e4', 'e7e5'], tc: '5+0', assisted: true, lastPlayedAt: NOW - 5 * MIN, level: 5 }),
        ]}
      />,
    );
    const card = cards()[0];
    expect(card).toHaveTextContent('K7QW2M');
    expect(card).toHaveTextContent('Level 5 Medium');
    expect(card).toHaveTextContent('Your move');
    expect(card).toHaveTextContent('1 move');
    expect(card).toHaveTextContent('5+0');
    expect(card).toHaveTextContent(/5 min/);
    expect(within(card).getByRole('img', { name: 'Assisted' })).toBeInTheDocument();
    expect(screen.getByTestId('thumb')).toHaveTextContent('K7QW2M@96');
    expect(thumb).toHaveBeenCalled();
  });

  it('shows the game number and room score for room games', () => {
    const room: Room = { code: 'ROOM1', key: 'k', seat: 1, createdAt: 0, lastSeenAt: 0, score: [2, 4], games: ['ROOM1.3'] };
    renderWithI18n(
      <Harness
        rooms={[room]}
        initial={[savedGame({ id: 'ROOM1.3', code: 'ROOM1', mode: 'room', room: { n: 3, epoch: 0 }, result: '0-1', color: 'b' })]}
      />,
    );
    const card = cards()[0];
    expect(card).toHaveTextContent('Game 3');
    expect(card).toHaveTextContent('2 – 1');
    expect(card).toHaveTextContent('Room');
    expect(card).toHaveTextContent('Won');
    // The code keeps its full width; the game number and score sit on the opponent line, not
    // between the code and the time (they squeezed the code to `R…` and overlapped the time).
    const code = card.querySelector('[data-part="code"]')!;
    expect(code).toHaveTextContent('ROOM1');
    expect(code.className).toContain('shrink-0');
    expect(code.className).not.toContain('truncate');
    const codeRow = code.parentElement!;
    expect(codeRow.querySelector('[data-part="time"]')).not.toBeNull();
    expect(codeRow.querySelector('[data-part="game-number"]')).toBeNull();
    expect(codeRow.querySelector('[data-part="room-score"]')).toBeNull();
    expect(card.querySelector('[data-part="room-score"]')).toHaveTextContent('2 – 1');
  });

  it('shows pass-and-play opponent and results', () => {
    renderWithI18n(<Harness initial={[savedGame({ mode: 'local', result: '1-0' })]} />);
    expect(cards()[0]).toHaveTextContent('2 players');
    expect(cards()[0]).toHaveTextContent('1–0');
  });

  it('opens a game on tap', () => {
    const onOpen = vi.fn();
    const g = savedGame();
    renderWithI18n(<Harness initial={[g]} onOpen={onOpen} />);
    fireEvent.click(cards()[0]);
    expect(onOpen).toHaveBeenCalledWith(g);
  });

  it('deletes with the hover × after the collapse, then undo restores', () => {
    renderWithI18n(<Harness initial={games(2)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete game G0' }));
    expect(cards()).toHaveLength(2); // still collapsing
    act(() => vi.advanceTimersByTime(COLLAPSE_MS));
    expect(cards()).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('G0 removed');

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(cards()).toHaveLength(2);
    expect(screen.getByRole('status')).not.toHaveTextContent('removed');
  });

  it('deletes with the Delete key on a focused card', () => {
    renderWithI18n(<Harness initial={games(2)} />);
    fireEvent.keyDown(cards()[1], { key: 'Delete' });
    act(() => vi.advanceTimersByTime(COLLAPSE_MS));
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toHaveTextContent('G0');
  });

  it('removes at once with reduced motion', () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ ...mm(q), matches: q.includes('reduced-motion') })) as typeof window.matchMedia;
    try {
      renderWithI18n(<Harness initial={games(2)} />);
      fireEvent.click(screen.getByRole('button', { name: 'Delete game G1' }));
      expect(cards()).toHaveLength(1);
    } finally {
      window.matchMedia = mm;
    }
  });

  describe('swipe left', () => {
    const swipe = (el: Element, dx: number, dy = 0) => {
      const card = el.parentElement!; // the swipe surface wraps the card button
      fireEvent.pointerDown(card, { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 100 });
      fireEvent.pointerMove(card, { pointerId: 1, pointerType: 'touch', clientX: 200 + dx / 2, clientY: 100 + dy / 2 });
      fireEvent.pointerMove(card, { pointerId: 1, pointerType: 'touch', clientX: 200 + dx, clientY: 100 + dy });
      fireEvent.pointerUp(card, { pointerId: 1, pointerType: 'touch', clientX: 200 + dx, clientY: 100 + dy });
    };

    it('past 40 % of the width deletes', () => {
      renderWithI18n(<Harness initial={games(2)} />);
      swipe(cards()[0], -150); // jsdom has no layout: width falls back to 300, threshold 120
      act(() => vi.advanceTimersByTime(COLLAPSE_MS * 2));
      expect(cards()).toHaveLength(1);
      expect(screen.getByRole('status')).toHaveTextContent('G0 removed');
    });

    it('a short swipe snaps back, and its click is swallowed', () => {
      const onOpen = vi.fn();
      renderWithI18n(<Harness initial={games(2)} onOpen={onOpen} />);
      swipe(cards()[0], -60);
      fireEvent.click(cards()[0]);
      act(() => vi.advanceTimersByTime(COLLAPSE_MS * 2));
      expect(cards()).toHaveLength(2);
      expect(onOpen).not.toHaveBeenCalled();
    });

    it('a vertical drag is a scroll, not a swipe', () => {
      const onOpen = vi.fn();
      renderWithI18n(<Harness initial={games(2)} onOpen={onOpen} />);
      swipe(cards()[0], -30, 200);
      act(() => vi.advanceTimersByTime(COLLAPSE_MS * 2));
      expect(cards()).toHaveLength(2);
    });

    it('rightward drags and mouse drags do nothing', () => {
      renderWithI18n(<Harness initial={games(2)} />);
      swipe(cards()[0], 200);
      const card = cards()[0].parentElement!;
      fireEvent.pointerDown(card, { pointerId: 2, pointerType: 'mouse', clientX: 300, clientY: 0 });
      fireEvent.pointerMove(card, { pointerId: 2, pointerType: 'mouse', clientX: 0, clientY: 0 });
      fireEvent.pointerUp(card, { pointerId: 2, pointerType: 'mouse', clientX: 0, clientY: 0 });
      act(() => vi.advanceTimersByTime(COLLAPSE_MS * 2));
      expect(cards()).toHaveLength(2);
    });
  });

  describe('undo toasts', () => {
    const del = (code: string) => {
      fireEvent.click(screen.getByRole('button', { name: `Delete game ${code}` }));
      act(() => vi.advanceTimersByTime(COLLAPSE_MS));
    };

    it('stack, offer Undo all, and restore everything', () => {
      renderWithI18n(<Harness initial={games(3)} />);
      del('G0');
      del('G1');
      expect(cards()).toHaveLength(1);
      fireEvent.click(screen.getByRole('button', { name: 'Undo all' }));
      expect(cards()).toHaveLength(3);
      expect(screen.queryByRole('button', { name: 'Undo all' })).toBeNull();
    });

    it('× dismisses one toast and keeps its deletion', () => {
      renderWithI18n(<Harness initial={games(3)} />);
      del('G0');
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(screen.getByRole('status')).not.toHaveTextContent('removed');
      expect(cards()).toHaveLength(2);
    });

    it('expire after 5 s; a new deletion restarts the timer for the stack', () => {
      renderWithI18n(<Harness initial={games(3)} />);
      del('G0');
      act(() => vi.advanceTimersByTime(UNDO_TOAST_MS - 1000));
      del('G1');
      act(() => vi.advanceTimersByTime(UNDO_TOAST_MS - 1000));
      expect(screen.getByRole('status')).toHaveTextContent('G0 removed');
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.getByRole('status')).not.toHaveTextContent('removed');
      expect(cards()).toHaveLength(1);
    });

    it('stay visible when the last game is deleted', () => {
      renderWithI18n(<Harness initial={games(1)} />);
      del('G0');
      expect(screen.queryByText('Previous games')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      expect(cards()).toHaveLength(1);
    });
  });

  describe('full list', () => {
    it('lists all games grouped by time and closes with Escape', () => {
      const list = [
        ...games(5).map((g, i) => ({ ...g, lastPlayedAt: NOW - (i + 1) * MIN })),
        savedGame({ id: 'OLD', code: 'OLD', lastPlayedAt: NOW - 400 * 24 * 60 * MIN }),
      ];
      renderWithI18n(<Harness initial={list} />);
      fireEvent.click(screen.getByRole('button', { name: '1 more game' }));
      const dialog = screen.getByRole('dialog', { name: 'All games' });
      expect(within(dialog).getByRole('heading', { name: 'Today' })).toBeInTheDocument();
      expect(within(dialog).getByRole('heading', { name: 'Older' })).toBeInTheDocument();
      expect(within(dialog).getAllByTestId('history-card')).toHaveLength(6);
      expect(within(dialog).getByRole('button', { name: 'Back' })).toHaveFocus();

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('opening a game from it closes it', () => {
      const onOpen = vi.fn();
      renderWithI18n(<Harness initial={games(7)} onOpen={onOpen} />);
      fireEvent.click(screen.getByRole('button', { name: '2 more games' }));
      const dialog = screen.getByRole('dialog');
      fireEvent.click(within(dialog).getAllByTestId('history-card')[6]);
      expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'G6' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('translates', () => {
    renderWithI18n(<Harness initial={[savedGame({ color: 'b' })]} />, 'de');
    expect(screen.getByText('Vorherige Spiele')).toBeInTheDocument();
    expect(cards()[0]).toHaveTextContent('Gegner am Zug');
  });
});
