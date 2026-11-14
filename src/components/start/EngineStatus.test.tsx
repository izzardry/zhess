import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { I18nProvider } from '@/lib/i18n';
import { useEngineOffline } from '@/hooks/useEngineOffline';
import { EngineStatus } from './EngineStatus';

const wrap = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>;

function fakeCaches(cached: boolean) {
  const m = new Map<string, Response>();
  const cache = {
    match: async (url: string) => (cached ? new Response('x') : m.get(url)),
    put: async (url: string, r: Response) => void m.set(url, r),
  };
  return { open: async () => cache } as unknown as CacheStorage;
}

/** fetch whose responses finish only when `release` is called. */
function gatedFetch() {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const fetch = vi.fn(async (url: string) => {
    await gate;
    return new Response(new Uint8Array(10), { status: 200, headers: { 'content-type': url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, release: () => release() };
}

const base = 'https://example.test/zhess/';

describe('useEngineOffline', () => {
  it('is ready at once when the engine is cached, without downloading', async () => {
    const fetch = vi.fn();
    const { result } = renderHook(() => useEngineOffline({ supported: true, base, caches: fakeCaches(true), fetch: fetch as never, delayMs: 0 }));
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready' }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('downloads on launch when missing, then is ready', async () => {
    const { fetch, release } = gatedFetch();
    const { result } = renderHook(() => useEngineOffline({ supported: true, base, caches: fakeCaches(false), fetch, delayMs: 0, online: () => true }));
    await waitFor(() => expect(result.current.state.status).toBe('downloading'));
    act(() => release());
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready' }));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('offline: waits, and downloads when the device comes back online', async () => {
    let online = false;
    const { fetch, release } = gatedFetch();
    const { result } = renderHook(() => useEngineOffline({ supported: true, base, caches: fakeCaches(false), fetch, delayMs: 0, online: () => online }));
    await waitFor(() => expect(result.current.state).toEqual({ status: 'missing', reason: 'offline' }));
    expect(fetch).not.toHaveBeenCalled();
    online = true;
    act(() => void window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(result.current.state.status).toBe('downloading'));
    act(() => release());
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready' }));
  });

  it('Save-Data: waits for a tap; a failure offers a retry', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() =>
      useEngineOffline({ supported: true, base, caches: fakeCaches(false), fetch, delayMs: 0, online: () => true, saveData: () => true }),
    );
    await waitFor(() => expect(result.current.state).toEqual({ status: 'missing', reason: 'saveData' }));
    expect(fetch).not.toHaveBeenCalled();
    act(() => result.current.download());
    await waitFor(() => expect(result.current.state).toEqual({ status: 'missing', reason: 'failed' }));
  });

  it('shows nothing where offline caching is unsupported', () => {
    const { result } = renderHook(() => useEngineOffline({ supported: false }));
    expect(result.current.state).toEqual({ status: 'unsupported' });
  });
});

describe('EngineStatus', () => {
  it('renders progress, ready, offline and the retry button', () => {
    const onDownload = vi.fn();
    const { rerender, container } = render(<EngineStatus state={{ status: 'unsupported' }} onDownload={onDownload} />, { wrapper: wrap });
    expect(container).toBeEmptyDOMElement();

    // While checking, an empty line of the same height holds the place, so the answer doesn't shift the footer.
    rerender(<EngineStatus state={{ status: 'checking' }} onDownload={onDownload} />);
    const placeholder = screen.getByTestId('engine-status');
    expect(placeholder).toHaveAttribute('data-status', 'checking');
    expect(placeholder).toBeEmptyDOMElement();
    expect(placeholder).toHaveAttribute('aria-hidden');
    expect(placeholder.className).toContain('h-6');

    rerender(<EngineStatus state={{ status: 'downloading', percent: 43 }} onDownload={onDownload} />);
    expect(screen.getByText('Computer 43%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Downloading the computer for offline play' })).toHaveAttribute('aria-valuenow', '43');

    rerender(<EngineStatus state={{ status: 'ready' }} onDownload={onDownload} />);
    expect(screen.getByRole('status')).toHaveTextContent('Computer ready offline');
    expect(screen.getByTestId('engine-status').className).toMatch(/\bh-6\b.*animate-fade-in|animate-fade-in.*\bh-6\b/);

    rerender(<EngineStatus state={{ status: 'missing', reason: 'offline' }} onDownload={onDownload} />);
    expect(screen.getByRole('status')).toHaveTextContent('Computer needs a connection');

    rerender(<EngineStatus state={{ status: 'missing', reason: 'failed' }} onDownload={onDownload} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download failed · Retry' }));
    expect(onDownload).toHaveBeenCalledTimes(1);

    rerender(<EngineStatus state={{ status: 'missing', reason: 'saveData' }} onDownload={onDownload} />);
    expect(screen.getByRole('button', { name: 'Download the computer' })).toBeInTheDocument();
  });
});
