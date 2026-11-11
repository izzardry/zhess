/** Test helpers for the platform package (not shipped: only imported by *.test.tsx). */
import type { ReactNode } from 'react';
import { render, renderHook, type RenderOptions } from '@testing-library/react';
import { I18nProvider } from '@/lib/i18n';
import { createStore, memoryStorage } from '@/lib/storage';
import { encodeMoves } from '@/lib/zhess';
import type { Language, SavedGame, Store } from '@/lib/types';

export function memStore(initial: Record<string, string> = {}): Store & { raw: ReturnType<typeof memoryStorage> } {
  const raw = memoryStorage(initial);
  return Object.assign(createStore(raw), { raw });
}

export function wrapperFor(language: Language = 'en') {
  const store = memStore();
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <I18nProvider language={language} store={store}>
        {children}
      </I18nProvider>
    );
  };
}

export function renderWithI18n(ui: React.ReactElement, language: Language = 'en', options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, { wrapper: wrapperFor(language), ...options });
}

export function renderHookWithI18n<R>(hook: () => R, language: Language = 'en') {
  return renderHook(hook, { wrapper: wrapperFor(language) });
}

/** A saved game with the given UCI moves (standard start). */
export function savedGame(over: Partial<SavedGame> & { uci?: string[] } = {}): SavedGame {
  const { uci = [], ...rest } = over;
  return {
    id: rest.code ?? 'K7QW2M',
    code: 'K7QW2M',
    mode: 'computer',
    level: 5,
    color: 'w',
    tc: null,
    moves: encodeMoves(uci.map((m) => ({ m, ms: 1000 }))),
    ms: uci.map(() => 1000),
    assisted: false,
    createdAt: 0,
    lastPlayedAt: 0,
    ...rest,
  };
}
