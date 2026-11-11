import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { createStore, memoryStorage } from '@/lib/storage';
import { UPDATE_CHECK_INTERVAL_MS, useSWUpdate, type UseSWUpdateOptions } from './useSWUpdate';

type Listener = () => void;

/** A minimal fake of ServiceWorkerContainer / Registration / ServiceWorker. */
class FakeTarget {
  private l = new Map<string, Set<Listener>>();
  addEventListener(type: string, cb: Listener) {
    if (!this.l.has(type)) this.l.set(type, new Set());
    this.l.get(type)!.add(cb);
  }
  removeEventListener(type: string, cb: Listener) {
    this.l.get(type)?.delete(cb);
  }
  emit(type: string) {
    for (const cb of [...(this.l.get(type) ?? [])]) cb();
  }
  count(type: string) {
    return this.l.get(type)?.size ?? 0;
  }
}

class FakeWorker extends FakeTarget {
  state = 'installing';
  postMessage = vi.fn();
}

class FakeRegistration extends FakeTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  update = vi.fn(async () => {});
}

class FakeContainer extends FakeTarget {
  controller: object | null = {};
  registration: FakeRegistration | undefined = new FakeRegistration();
  getRegistration = vi.fn(async () => this.registration);
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nProvider language="en" store={createStore(memoryStorage())}>
    {children}
  </I18nProvider>
);

function setup(container: FakeContainer, extra: Partial<UseSWUpdateOptions> = {}) {
  const notify = vi.fn<(message: string, label: string, onReload: () => void) => void>();
  const reload = vi.fn();
  const hook = renderHook(
    () => useSWUpdate({ container: container as unknown as ServiceWorkerContainer, notify, reload, ...extra }),
    { wrapper },
  );
  return { notify, reload, ...hook };
}

const flush = () => act(async () => {});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useSWUpdate', () => {
  it('prompts at once when a worker is already waiting; Reload skips waiting', async () => {
    const c = new FakeContainer();
    const waiting = new FakeWorker();
    c.registration!.waiting = waiting;
    const { notify, reload } = setup(c);
    await flush();
    expect(notify).toHaveBeenCalledWith('A new version is available', 'Reload', expect.any(Function));

    notify.mock.calls[0][2]();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    act(() => c.emit('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
    // The fallback reload after 3 s does not reload twice.
    act(() => vi.advanceTimersByTime(3000));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('prompts when an update finishes installing', async () => {
    const c = new FakeContainer();
    const { notify } = setup(c);
    await flush();
    const w = new FakeWorker();
    c.registration!.installing = w;
    act(() => c.registration!.emit('updatefound'));
    expect(notify).not.toHaveBeenCalled();
    w.state = 'installed';
    act(() => w.emit('statechange'));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('checks for an update every hour and stops on unmount', async () => {
    const c = new FakeContainer();
    const { unmount } = setup(c);
    await flush();
    expect(c.registration!.update).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS));
    expect(c.registration!.update).toHaveBeenCalledTimes(1);
    unmount();
    act(() => vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS * 3));
    expect(c.registration!.update).toHaveBeenCalledTimes(1);
    expect(c.count('controllerchange')).toBe(0);
    expect(c.registration!.count('updatefound')).toBe(0);
  });

  it('reloads when an auto-updated worker takes over', async () => {
    const c = new FakeContainer();
    const { reload } = setup(c);
    await flush();
    act(() => c.emit('controllerchange'));
    act(() => c.emit('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('shows the Reload toast instead while reloading would interrupt a game', async () => {
    const c = new FakeContainer();
    const { reload, notify } = setup(c, { shouldAutoReload: () => false });
    await flush();
    act(() => c.emit('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    notify.mock.calls[0][2]();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload when the first worker claims an uncontrolled page', async () => {
    const c = new FakeContainer();
    c.controller = null;
    const { reload } = setup(c);
    await flush();
    c.controller = {};
    act(() => c.emit('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
  });

  it('manual check: available, none, unsupported', async () => {
    const c = new FakeContainer();
    const { result, notify } = setup(c);
    await flush();
    let r = await act(() => result.current.checkForUpdate());
    expect(r).toBe('none');
    expect(c.registration!.update).toHaveBeenCalled();

    c.registration!.update.mockImplementationOnce(async () => {
      c.registration!.waiting = new FakeWorker();
    });
    r = await act(() => result.current.checkForUpdate());
    expect(r).toBe('available');
    expect(notify).toHaveBeenCalledTimes(1);

    c.registration = undefined;
    r = await act(() => result.current.checkForUpdate());
    expect(r).toBe('unsupported');
  });

  it('is inert without service worker support', async () => {
    const { result, notify } = setup(null as unknown as FakeContainer, { container: null });
    await flush();
    expect(await act(() => result.current.checkForUpdate())).toBe('unsupported');
    expect(notify).not.toHaveBeenCalled();
  });
});
