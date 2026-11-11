import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS, useLongPress, type LongPressOptions } from './useLongPress';

function Btn(props: Partial<LongPressOptions> & { ms?: number }) {
  const handlers = useLongPress({
    ms: props.ms ?? 500,
    onLongPress: props.onLongPress ?? (() => {}),
    onLongPressEnd: props.onLongPressEnd,
    onClick: props.onClick,
    disabled: props.disabled,
  });
  return <button {...handlers}>hold</button>;
}

// jsdom has no PointerEvent, so fireEvent.pointerDown drops `button`; a MouseEvent named pointerdown keeps it.
const down = (el: Element, button = 0) =>
  fireEvent(el, new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button }));

describe('useLongPress', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a short press is a click', () => {
    const onClick = vi.fn();
    const onLongPress = vi.fn();
    render(<Btn onClick={onClick} onLongPress={onLongPress} />);
    const b = screen.getByRole('button');
    down(b);
    act(() => void vi.advanceTimersByTime(200));
    fireEvent.pointerUp(b);
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('holding fires the long press once and suppresses the trailing click', () => {
    const onClick = vi.fn();
    const onLongPress = vi.fn();
    render(<Btn onClick={onClick} onLongPress={onLongPress} />);
    const b = screen.getByRole('button');
    down(b);
    act(() => void vi.advanceTimersByTime(499));
    expect(onLongPress).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onLongPress).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(b);
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
    // the next ordinary tap works again
    down(b);
    fireEvent.pointerUp(b);
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('resets the suppression 50 ms after release when no click arrives', () => {
    const onClick = vi.fn();
    render(<Btn onClick={onClick} />);
    const b = screen.getByRole('button');
    down(b);
    act(() => void vi.advanceTimersByTime(500));
    fireEvent.pointerUp(b);
    act(() => void vi.advanceTimersByTime(60));
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('leaving the element cancels a pending hold', () => {
    const onLongPress = vi.fn();
    render(<Btn onLongPress={onLongPress} />);
    const b = screen.getByRole('button');
    down(b);
    act(() => void vi.advanceTimersByTime(300));
    fireEvent.pointerLeave(b);
    act(() => void vi.advanceTimersByTime(1000));
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('a cancelled pointer cancels too', () => {
    const onLongPress = vi.fn();
    render(<Btn onLongPress={onLongPress} />);
    const b = screen.getByRole('button');
    down(b);
    fireEvent.pointerCancel(b);
    act(() => void vi.advanceTimersByTime(1000));
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('calls onLongPressEnd when a fired hold is released (peek while held)', () => {
    const onLongPressEnd = vi.fn();
    render(<Btn ms={HOLD_MS.hint} onLongPressEnd={onLongPressEnd} />);
    const b = screen.getByRole('button');
    down(b);
    fireEvent.pointerUp(b);
    expect(onLongPressEnd).not.toHaveBeenCalled(); // never fired
    down(b);
    act(() => void vi.advanceTimersByTime(1000));
    expect(onLongPressEnd).not.toHaveBeenCalled();
    fireEvent.pointerLeave(b);
    expect(onLongPressEnd).toHaveBeenCalledTimes(1);
  });

  it('ignores secondary buttons and suppresses the context menu', () => {
    const onLongPress = vi.fn();
    render(<Btn onLongPress={onLongPress} />);
    const b = screen.getByRole('button');
    down(b, 2);
    act(() => void vi.advanceTimersByTime(1000));
    expect(onLongPress).not.toHaveBeenCalled();
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    b.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('holding Space is a long press; repeats are ignored', () => {
    const onClick = vi.fn();
    const onLongPress = vi.fn();
    render(<Btn onClick={onClick} onLongPress={onLongPress} />);
    const b = screen.getByRole('button');
    fireEvent.keyDown(b, { key: ' ' });
    act(() => void vi.advanceTimersByTime(300));
    fireEvent.keyDown(b, { key: ' ', repeat: true });
    act(() => void vi.advanceTimersByTime(200));
    expect(onLongPress).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(b, { key: ' ' });
    fireEvent.click(b); // the browser's Space activation
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disabled: no hold, clicks pass through', () => {
    const onClick = vi.fn();
    const onLongPress = vi.fn();
    render(<Btn disabled onClick={onClick} onLongPress={onLongPress} />);
    const b = screen.getByRole('button');
    down(b);
    act(() => void vi.advanceTimersByTime(1000));
    fireEvent.pointerUp(b);
    fireEvent.click(b);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('clears its timer on unmount', () => {
    const onLongPress = vi.fn();
    const { unmount } = render(<Btn onLongPress={onLongPress} />);
    down(screen.getByRole('button'));
    unmount();
    act(() => void vi.advanceTimersByTime(1000));
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('uses the latest callbacks', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Btn onLongPress={first} />);
    const b = screen.getByRole('button');
    down(b);
    rerender(<Btn onLongPress={second} />);
    act(() => void vi.advanceTimersByTime(500));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
