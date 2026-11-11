/** Test helpers for the game chrome (not shipped: only imported by *.test.tsx). */
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { I18nProvider } from '@/lib/i18n';
import { createStore, memoryStorage } from '@/lib/storage';
import type { Language } from '@/lib/types';

// Radix Popper measures with ResizeObserver, which jsdom lacks.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

export function renderWithI18n(ui: ReactElement, lang: Language = 'en', options?: RenderOptions) {
  const store = createStore(memoryStorage());
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider language={lang} store={store}>
      {children}
    </I18nProvider>
  );
  return render(ui, { wrapper: Wrapper, ...options });
}
