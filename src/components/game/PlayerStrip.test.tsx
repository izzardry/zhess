import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlayerStrip, type PlayerStripProps } from './PlayerStrip';
import { renderWithI18n } from './testUtils';

function props(over: Partial<PlayerStripProps> = {}): PlayerStripProps {
  return { color: 'w', captured: [], advantage: 0, active: true, ...over };
}

const strip = () => document.querySelector('[data-color]') as HTMLElement;

describe('PlayerStrip', () => {
  it('groups captured pieces by type in the opponent’s color', () => {
    renderWithI18n(<PlayerStrip {...props({ captured: ['n', 'p', 'p', 'q'], advantage: 11 })} />);
    const groups = Array.from(document.querySelectorAll('[data-group]')).map((g) => [
      g.getAttribute('data-group'),
      g.children.length,
    ]);
    expect(groups).toEqual([
      ['p', 2],
      ['n', 1],
      ['q', 1],
    ]);
    expect(document.querySelectorAll('[data-piece^="b"]')).toHaveLength(4);
    expect(screen.getByRole('img', { name: 'Captured by White: 2× pawn, knight, queen' })).toBeInTheDocument();
  });

  it('shows +N only on the side that is ahead', () => {
    const { rerender } = renderWithI18n(<PlayerStrip {...props({ advantage: 2 })} />);
    expect(screen.getByLabelText('2 ahead')).toHaveTextContent('+2');
    rerender(<PlayerStrip {...props({ advantage: 0 })} />);
    expect(document.querySelector('[data-part="advantage"]')).toBeNull();
    rerender(<PlayerStrip {...props({ advantage: -3 })} />);
    expect(document.querySelector('[data-part="advantage"]')).toBeNull();
  });

  it('active at full opacity, inactive at 50 %', () => {
    const { rerender } = renderWithI18n(<PlayerStrip {...props()} />);
    expect(strip().className).toContain('opacity-100');
    rerender(<PlayerStrip {...props({ active: false })} />);
    expect(strip().className).toContain('opacity-50');
  });

  it('the clock is a timer with states: running, low, flagged, untimed', () => {
    const { rerender } = renderWithI18n(<PlayerStrip {...props({ color: 'b', clock: { text: '4:31', running: true } })} />);
    const timer = screen.getByRole('timer', { name: 'Black clock' });
    expect(timer).toHaveTextContent('4:31');
    expect(timer).toHaveAttribute('data-running', 'true');
    expect(timer.className).toContain('bg-foreground/10');

    rerender(<PlayerStrip {...props({ color: 'b', clock: { text: '9.7', running: true, low: true } })} />);
    expect(screen.getByRole('timer').className).toContain('font-bold');

    rerender(<PlayerStrip {...props({ color: 'b', clock: { text: '0.0', flagged: true } })} />);
    expect(screen.getByRole('timer').className).toContain('text-destructive');
    expect(screen.getByRole('timer').className).toContain('font-bold');

    rerender(<PlayerStrip {...props({ color: 'b', clock: { text: '12:08', untimed: true, running: true } })} />);
    const used = screen.getByRole('timer', { name: 'Black time used' });
    expect(used.className).toContain('text-muted-foreground');
    expect(used.className).not.toContain('bg-foreground/10');
  });

  it('has no clock slot without a clock', () => {
    renderWithI18n(<PlayerStrip {...props()} />);
    expect(screen.queryByRole('timer')).toBeNull();
  });

  it('is drawn upside down when rotated (face to face)', () => {
    const { rerender } = renderWithI18n(<PlayerStrip {...props({ rotated: true })} />);
    expect(strip().className).toContain('rotate-180');
    rerender(<PlayerStrip {...props()} />);
    expect(strip().className).not.toContain('rotate-180');
  });

  it('hides details but keeps the clock while the UI is hidden', () => {
    renderWithI18n(<PlayerStrip {...props({ captured: ['p'], advantage: 1, details: false, clock: { text: '1:00' } })} />);
    const material = document.querySelector('[data-part="material"]')!;
    expect(material.className).toContain('opacity-0');
    expect(material).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('timer')).toBeVisible();
  });

  it('rail layout stacks clock over material', () => {
    renderWithI18n(<PlayerStrip {...props({ layout: 'rail', captured: ['p'], clock: { text: '1:00' } })} />);
    expect(strip().className).toContain('flex-col');
    expect(strip().firstElementChild).toHaveAttribute('data-part', 'clock');
  });

  it('is translated', () => {
    renderWithI18n(<PlayerStrip {...props({ captured: ['b', 'b'], clock: { text: '1:00' } })} />, 'fr');
    expect(screen.getByRole('img', { name: 'Pris par les Blancs : 2× fou' })).toBeInTheDocument();
    expect(screen.getByRole('timer', { name: 'Pendule Blancs' })).toBeInTheDocument();
  });
});
