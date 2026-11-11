/** useRoom: the session wired to React (useSyncExternalStore), with a fake controller. */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeController, type FakeController } from '@/components/room/testUtils';
import type { RoomControllerOptions } from '@/lib/room';
import type { RoomNotice } from '@/lib/types';
import { IDLE_ROOM_VIEW, useRoom, type ManualApi, type UseRoomOptions } from './useRoom';

function setup(extra: Partial<UseRoomOptions> = {}) {
  const made: FakeController[] = [];
  const opts: UseRoomOptions = {
    broker: null,
    locks: null,
    turnStorage: null,
    window: null,
    document: null,
    createController: (o: RoomControllerOptions) => {
      const c = createFakeController(o);
      made.push(c);
      return c;
    },
    ...extra,
  };
  return { made, opts };
}

describe('useRoom', () => {
  it('runs a session for a valid code and follows the controller snapshot', () => {
    const { made, opts } = setup();
    const { result } = renderHook(() => useRoom('K7QW2M', opts));
    expect(made).toHaveLength(1);
    expect(made[0].opts.code).toBe('K7QW2M');
    expect(made[0].opts.readOnly).toBe(false);
    expect(result.current.tab).toBe('owner');
    expect(result.current.code).toBe('K7QW2M');
    expect(result.current.state?.presence).toBe('waiting');
    expect(result.current.controller).toBe(made[0]);
    expect(result.current.manualCause).toBe('no-broker');

    act(() => made[0].set({ presence: 'connected', live: true, phase: 'live', seat: 1, score: [3, 1] }));
    expect(result.current.state?.presence).toBe('connected');
    expect(result.current.manualCause).toBeNull();
    expect(result.current.score).toEqual([0.5, 1.5]);
  });

  it('delegates the actions to the current controller', () => {
    const { made, opts } = setup();
    const { result } = renderHook(() => useRoom('K7QW2M', opts));
    const c = made[0];
    expect(result.current.move('e2e4', 12)).toBe(true);
    expect(c.move).toHaveBeenCalledWith('e2e4', 12);
    result.current.ask('draw');
    expect(c.ask).toHaveBeenCalledWith('draw');
    result.current.reply('rejoin', false);
    expect(c.reply).toHaveBeenCalledWith('rejoin', false);
    result.current.resign();
    expect(c.resign).toHaveBeenCalled();
    expect(result.current.flag()).toBe(false);
    expect(result.current.elapsed()).toBe(1234);
  });

  it('keeps the actions stable while the view changes, and delivers notices', () => {
    const onNotice = vi.fn();
    const { made, opts } = setup({ onNotice });
    const { result } = renderHook(() => useRoom('K7QW2M', opts));
    const sub = result.current.onNotice;
    const seen: RoomNotice[] = [];
    const off = result.current.onNotice((n) => seen.push(n));
    act(() => made[0].set({ presence: 'connected' }));
    expect(result.current.onNotice).toBe(sub);
    act(() => made[0].notify('opponent-connected'));
    expect(seen.map((n) => n.kind)).toEqual(['opponent-connected']);
    expect(onNotice).toHaveBeenCalledWith(expect.objectContaining({ kind: 'opponent-connected' }));
    off();
  });

  it('disposes the session when the code changes, when disabled and on unmount', () => {
    const { made, opts } = setup();
    const { result, rerender, unmount } = renderHook(({ code, enabled }) => useRoom(code, { ...opts, enabled }), {
      initialProps: { code: 'K7QW2M' as string | null, enabled: true },
    });
    rerender({ code: 'ABC123', enabled: true });
    expect(made[0].leave).toHaveBeenCalled();
    expect(made[1].opts.code).toBe('ABC123');
    expect(result.current.code).toBe('ABC123');

    rerender({ code: 'ABC123', enabled: false });
    expect(made[1].leave).toHaveBeenCalled();
    expect(result.current).toMatchObject({ ...IDLE_ROOM_VIEW, controller: null });
    expect(result.current.move('e2e4')).toBe(false);

    rerender({ code: 'not a code!', enabled: true });
    expect(made).toHaveLength(2);
    expect(result.current.state).toBeNull();

    rerender({ code: null, enabled: true });
    expect(result.current.state).toBeNull();

    rerender({ code: 'ZZ9', enabled: true });
    expect(made).toHaveLength(3);
    unmount();
    expect(made[2].leave).toHaveBeenCalled();
  });

  it('passes create to the owner controller only', () => {
    const { made, opts } = setup({ create: { tc: '5+0', color: 'b' } });
    renderHook(() => useRoom('K7QW2M', opts));
    expect(made[0].opts.create).toEqual({ tc: '5+0', color: 'b' });
  });

  it('follows x and y from the address bar and reports when they were used', async () => {
    const answerOffer = vi.fn(async (code: string, offer: string) => ({
      transport: { role: 'dialer', state: 'connecting', send() {}, onMessage: () => () => {}, onState: () => () => {}, close() {} } as never,
      answer: `A-${offer}`,
      link: `L#/?s=${code}&o=r&y=A-${offer}`,
    }));
    const handOver = vi.fn(async () => true);
    const onSignalUsed = vi.fn();
    const { opts } = setup({ manualApi: { answerOffer, handOver } as Partial<ManualApi>, onSignalUsed });
    const { result, rerender } = renderHook(({ offer }) => useRoom('K7QW2M', { ...opts, offer }), {
      initialProps: { offer: null as string | null },
    });
    expect(answerOffer).not.toHaveBeenCalled();
    await act(async () => rerender({ offer: 'XYZ' }));
    expect(answerOffer).toHaveBeenCalledTimes(1);
    expect(answerOffer).toHaveBeenCalledWith('K7QW2M', 'XYZ');
    expect(onSignalUsed).toHaveBeenCalledTimes(1);
    expect(result.current.manual.step).toBe('answer');
    expect(result.current.manual.link).toContain('y=A-XYZ');
    await act(async () => rerender({ offer: 'XYZ' }));
    expect(answerOffer).toHaveBeenCalledTimes(1);
  });

  it('starts a passive hand-over session for an answer link', async () => {
    const handOver = vi.fn(async () => false);
    const { made, opts } = setup({ manualApi: { handOver } as Partial<ManualApi>, answer: 'Y1' });
    const { result } = renderHook(() => useRoom('K7QW2M', opts));
    await act(async () => {});
    expect(result.current.tab).toBe('handover');
    expect(result.current.manual).toMatchObject({ step: 'handover', handedOver: false });
    expect(made.every((c) => c.opts.readOnly)).toBe(true);
    expect(handOver).toHaveBeenCalledTimes(1);
  });

  it('exposes the manual actions', async () => {
    const startHost = vi.fn(async (code: string) => ({
      transport: { role: 'anchor', state: 'connecting', send() {}, onMessage: () => () => {}, onState: () => () => {}, close: vi.fn() } as never,
      offer: 'O',
      link: `L#/?s=${code}&o=r&x=O`,
      acceptAnswer: vi.fn(async () => {}),
    }));
    const { opts } = setup({ manualApi: { startHost } as Partial<ManualApi> });
    const { result } = renderHook(() => useRoom('K7QW2M', opts));
    await act(async () => result.current.openManual());
    expect(result.current.manual.step).toBe('offer');
    let issue: unknown = 'unset';
    await act(async () => {
      issue = await result.current.acceptAnswer('y=1');
    });
    expect(issue).toBeNull();
    expect(result.current.manual.step).toBe('connecting');
    await act(async () => result.current.restartManual());
    expect(startHost).toHaveBeenCalledTimes(2);
    act(() => result.current.closeManual());
    expect(result.current.manual.step).toBe('idle');
  });
});
