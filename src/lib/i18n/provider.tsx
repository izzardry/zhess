/** The i18n provider component (index.ts re-exports it with the rest of the i18n API). */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { store as defaultStore } from '../storage';
import type { Language, Store } from '../types';
import { I18nContext, type I18nContextValue } from './context';
import { getInitialLanguage, translate, type TranslationKey, type TranslationVars } from './core';

export interface I18nProviderProps {
  children: ReactNode;
  /** Start in this language instead of detecting one (tests). */
  language?: Language;
  /** Where the choice is persisted; defaults to the app store. */
  store?: Store;
}

export function I18nProvider({ children, language: initial, store = defaultStore }: I18nProviderProps) {
  const [language, setLanguageState] = useState<Language>(() => initial ?? getInitialLanguage(store));

  const setLanguage = useCallback(
    (lang: Language) => {
      setLanguageState(lang);
      store.setPref('lang', lang);
    },
    [store],
  );

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = language;
  }, [language]);

  const t = useCallback(
    (key: TranslationKey, vars?: TranslationVars) => translate(language, key, vars),
    [language],
  );

  const value = useMemo<I18nContextValue>(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
