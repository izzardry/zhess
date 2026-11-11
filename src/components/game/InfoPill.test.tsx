import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InfoPill, type InfoPillProps } from './InfoPill';
import { MoveList } from './MoveList';
import { PieceRenderProvider } from './PieceGlyph';
import { renderWithI18n } from './testUtils';

const MOVES = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'];

function props(over: Partial<InfoPillProps> = {}): InfoPillProps {
  return { code: 'K7QW2M', opponent: { kind: 'computer', level: 5 }, moves: MOVES, cursor: 6, ...over };
}

const cell = (name: string) => document.querySelector(`[data-cell="${name}"]`) as HTMLElement;

describe('InfoPill', () => {
  it('shows code, level and the last move pair (eyebrow over value)', () => {
    renderWithI18n(<InfoPill {...props()} />);
    expect(screen.getByRole('group', { name: 'Game info' })).toBeInTheDocument();
    expect(cell('code')).toHaveTextContent('Game');
    expect(cell('code')).toHaveTextContent('K7QW2M');
    expect(cell('opponent')).toHaveTextContent('Level');
    expect(cell('opponent')).toHaveTextContent('5');
    // 3. Bb5 a6 — the bishop drawn as a figurine, the SAN kept for screen readers
    expect(cell('moves')).toHaveTextContent('3.');
    expect(within(cell('moves')).getByText('Bb5')).toHaveClass('sr-only');
    expect(cell('moves').querySelector('[data-san="a6"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Show all moves' })).toHaveAccessibleDescription(/3\.\s*Bb5\s*a6/);
    expect(cell('moves').querySelector('[data-piece="wb"]')).not.toBeNull();
  });

  it('keeps all three cells at every width; below 360 px they fold into two rows (DESIGN 4.2)', () => {
    renderWithI18n(<InfoPill {...props({ opponent: { kind: 'room', score: [1, 0] } })} />);
    const pill = screen.getByRole('group', { name: 'Game info' });
    // No cell is hidden on narrow phones (the room score is the only one on screen in a room).
    for (const name of ['code', 'opponent', 'moves']) {
      expect(cell(name).className).not.toMatch(/hidden/);
      expect(cell(name).parentElement!.className).not.toMatch(/hidden/);
    }
    expect(cell('opponent')).toHaveTextContent('1 – 0');
    expect(pill.className).toContain('max-[359px]:inline-grid');
    expect(cell('moves').className).toContain('max-[359px]:col-span-3');
  });

  it('gives every cell the same eyebrow-over-value structure, so the rows line up', () => {
    renderWithI18n(<InfoPill {...props({ presence: <span data-testid="dot" /> })} />);
    const eyebrows = new Set<string>();
    for (const name of ['code', 'opponent', 'moves']) {
      const el = cell(name);
      expect(el.className).toContain('flex-col');
      const [eyebrow, value] = Array.from(el.children) as HTMLElement[];
      eyebrows.add(eyebrow.className);
      // A fixed-height value line, so the presence dot and figurines do not shift the baseline.
      expect(value.className).toContain('h-5');
      expect(value.className).toContain('items-center');
    }
    expect(eyebrows.size).toBe(1);
  });

  it('the move strip button scales when pressed (Ztyle 08)', () => {
    renderWithI18n(<InfoPill {...props()} />);
    expect(cell('moves').className).toContain('active:scale-95');
  });

  it('follows the cursor and shows only white’s move when it was last', () => {
    renderWithI18n(<InfoPill {...props({ cursor: 3 })} />);
    expect(cell('moves')).toHaveTextContent('2.');
    expect(within(cell('moves')).getByText('Nf3')).toBeInTheDocument();
    expect(within(cell('moves')).queryByText('Nc6')).toBeNull();
  });

  it('shows a dash and cannot open the list before the first move', () => {
    renderWithI18n(<InfoPill {...props({ moves: [], cursor: 0 })} />);
    expect(cell('moves')).toHaveTextContent('–');
    expect(screen.getByRole('button', { name: 'Show all moves' })).toBeDisabled();
  });

  it('opponent cell: two players and the room score', () => {
    const { rerender } = renderWithI18n(<InfoPill {...props({ opponent: { kind: 'local' } })} />);
    expect(cell('opponent')).toHaveTextContent('Players');
    expect(cell('opponent')).toHaveTextContent('2');
    rerender(<InfoPill {...props({ opponent: { kind: 'room', score: [2, 1.5] } })} />);
    expect(cell('opponent')).toHaveTextContent('Score');
    expect(cell('opponent')).toHaveTextContent('2 – 1½');
  });

  it('renders the presence slot next to the code', () => {
    renderWithI18n(<InfoPill {...props({ presence: <span data-testid="dot" /> })} />);
    expect(within(cell('code')).getByTestId('dot')).toBeInTheDocument();
  });

  it('tapping the strip opens the move list; a move jumps and closes it', async () => {
    const onJump = vi.fn();
    renderWithI18n(<InfoPill {...props({ onJump })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show all moves' }));
    const list = await screen.findByRole('list', { name: 'Moves' });
    fireEvent.click(within(list).getByRole('button', { name: 'Go to move 2. Nf3' }));
    expect(onJump).toHaveBeenCalledWith(3);
    expect(screen.queryByRole('list', { name: 'Moves' })).toBeNull();
  });

  it('uses the piece set from the provider', () => {
    renderWithI18n(
      <PieceRenderProvider render={(type, color) => <svg data-testid={`svg-${color}${type}`} />}>
        <InfoPill {...props()} />
      </PieceRenderProvider>,
    );
    expect(screen.getByTestId('svg-wb')).toBeInTheDocument();
  });

  it('positions itself as a top pill or a left rail, or not at all inline', () => {
    const { rerender, container } = renderWithI18n(<InfoPill {...props()} />);
    expect((container.firstChild as HTMLElement).className).toContain('top-[max(1rem');
    rerender(<InfoPill {...props()} landscape />);
    expect((container.firstChild as HTMLElement).className).toContain('left-[max(1rem');
    expect(screen.getByRole('group').className).toContain('flex-col');
    rerender(<InfoPill {...props()} placement="inline" className="extra" />);
    expect(container.firstChild).toBe(screen.getByRole('group'));
    expect(screen.getByRole('group').className).toContain('extra');
  });

  it('hides toward the top and becomes inert', () => {
    const { container } = renderWithI18n(<InfoPill {...props()} visible={false} />);
    const wrap = container.firstChild as HTMLElement & { inert?: boolean };
    expect(wrap).toHaveAttribute('aria-hidden', 'true');
    expect(wrap.className).toContain('-translate-y-8');
    expect(wrap.inert).toBe(true);
  });
});

describe('MoveList', () => {
  it('numbers all moves and marks the current one', () => {
    renderWithI18n(<MoveList moves={MOVES} cursor={4} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('1.');
    const current = document.querySelector('[aria-current="step"]')!;
    expect(current).toHaveAttribute('data-ply', '3');
    // plies after the cursor (review, redo tail) are dimmed
    expect(document.querySelector('[data-ply="4"]')!.className).toContain('text-foreground/50');
    expect(document.querySelector('[data-ply="2"]')!.className).not.toContain('text-foreground/50');
  });

  it('is read-only without onJump', () => {
    renderWithI18n(<MoveList moves={MOVES} cursor={6} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('jumps to a move (cursor = ply + 1) or to the start position', () => {
    const onJump = vi.fn();
    renderWithI18n(<MoveList moves={MOVES} cursor={6} onJump={onJump} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to move 3… a6' }));
    expect(onJump).toHaveBeenLastCalledWith(6);
    fireEvent.click(screen.getByRole('button', { name: 'Go to move 1. e4' }));
    expect(onJump).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Start position' }));
    expect(onJump).toHaveBeenLastCalledWith(0);
  });

  it('starts with black when the game began with black to move', () => {
    renderWithI18n(<MoveList moves={['Kd7', 'Ke2']} cursor={2} firstMoveNumber={30} firstColor="b" onJump={vi.fn()} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('30.');
    expect(rows[0]).toHaveTextContent('…');
    expect(rows[1]).toHaveTextContent('31.');
    expect(screen.getByRole('button', { name: 'Go to move 30… Kd7' })).toBeInTheDocument();
  });

  it('draws figurines in the mover’s color', () => {
    renderWithI18n(<MoveList moves={['Nf3', 'Nf6']} cursor={2} />);
    expect(document.querySelector('[data-ply="0"] [data-piece="wn"]')).not.toBeNull();
    expect(document.querySelector('[data-ply="1"] [data-piece="bn"]')).not.toBeNull();
  });
});
