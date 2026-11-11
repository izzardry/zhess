import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResignUndoToast } from './ResignUndoToast';
import { renderWithI18n } from './testUtils';

describe('ResignUndoToast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('names who resigned', () => {
    const { rerender } = renderWithI18n(<ResignUndoToast open who="you" onUndo={vi.fn()} onExpire={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('You resigned');
    rerender(<ResignUndoToast open who="b" onUndo={vi.fn()} onExpire={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Black resigned');
  });

  it('Undo takes the resignation back, once', () => {
    const onUndo = vi.fn();
    const onExpire = vi.fn();
    renderWithI18n(<ResignUndoToast open who="you" onUndo={onUndo} onExpire={onExpire} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    act(() => void vi.advanceTimersByTime(6000));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('expires after 5 s', () => {
    const onExpire = vi.fn();
    renderWithI18n(<ResignUndoToast open who="w" onUndo={vi.fn()} onExpire={onExpire} />);
    act(() => void vi.advanceTimersByTime(4999));
    expect(onExpire).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('× dismisses: the resignation becomes final (Ztyle audit #12)', () => {
    const onExpire = vi.fn();
    const onUndo = vi.fn();
    renderWithI18n(<ResignUndoToast open who="you" onUndo={onUndo} onExpire={onExpire} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    act(() => void vi.advanceTimersByTime(6000));
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('restarts its timer when opened again', () => {
    const onExpire = vi.fn();
    const { rerender } = renderWithI18n(<ResignUndoToast open who="you" onUndo={vi.fn()} onExpire={onExpire} />);
    act(() => void vi.advanceTimersByTime(3000));
    rerender(<ResignUndoToast open={false} who="you" onUndo={vi.fn()} onExpire={onExpire} />);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<ResignUndoToast open who="you" onUndo={vi.fn()} onExpire={onExpire} />);
    act(() => void vi.advanceTimersByTime(3000));
    expect(onExpire).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(2000));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('is translated', () => {
    renderWithI18n(<ResignUndoToast open who="you" onUndo={vi.fn()} onExpire={vi.fn()} />, 'es');
    expect(screen.getByRole('status')).toHaveTextContent('Has abandonado');
    expect(screen.getByRole('button', { name: 'Deshacer' })).toBeInTheDocument();
  });
});
