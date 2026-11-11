import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { createStore, memoryStorage } from '@/lib/storage';
import type { Language } from '@/lib/types';
import type { ShareNavigator } from './share';
import { useShare } from './useShare';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

const wrapper =
  (lang: Language = 'en') =>
  ({ children }: { children: ReactNode }) => (
    <I18nProvider language={lang} store={createStore(memoryStorage())}>
      {children}
    </I18nProvider>
  );

beforeEach(() => {
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

describe('useShare', () => {
  it('shares with the text for each kind (DESIGN 13.2)', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const nav: ShareNavigator = { share };
    const { result } = renderHook(() => useShare(nav), { wrapper: wrapper() });
    await act(() => result.current.shareLink('u1', 'room'));
    await act(() => result.current.shareLink('u2', 'solo'));
    await act(() => result.current.shareLink('u3', 'win', 7));
    expect(share.mock.calls.map((c) => [c[0].text, c[0].url, c[0].title])).toEqual([
      ['Join my chess game!', 'u1', 'Zhess'],
      ['Look at this chess game.', 'u2', 'Zhess'],
      ['I beat Level 7! Can you?', 'u3', 'Zhess'],
    ]);
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('copies the link with a toast when there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useShare({ clipboard: { writeText } }), { wrapper: wrapper() });
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.shareLink('https://zhess/#/?s=ABC', 'solo');
    });
    expect(outcome).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('https://zhess/#/?s=ABC');
    expect(toastMock.success).toHaveBeenCalledWith('Link copied to clipboard!');
  });

  it('copies PGN with a toast, or reports failure', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useShare({ clipboard: { writeText } }), { wrapper: wrapper('de') });
    await act(() => result.current.copyPgn('1. e4 *'));
    expect(writeText).toHaveBeenCalledWith('1. e4 *');
    expect(toastMock.success).toHaveBeenCalledWith('PGN kopiert!');

    writeText.mockRejectedValue(new Error('denied'));
    const original = document.execCommand;
    document.execCommand = vi.fn().mockReturnValue(false);
    try {
      let ok: boolean | undefined;
      await act(async () => {
        ok = await result.current.copyPgn('x');
      });
      expect(ok).toBe(false);
      expect(toastMock.error).toHaveBeenCalledWith('Kopieren fehlgeschlagen');
    } finally {
      document.execCommand = original;
    }
  });

  it('a cancelled share sheet shows no toast', async () => {
    const abort = Object.assign(new Error('x'), { name: 'AbortError' });
    const { result } = renderHook(() => useShare({ share: vi.fn().mockRejectedValue(abort) }), { wrapper: wrapper() });
    await act(() => result.current.shareLink('u', 'solo'));
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});
