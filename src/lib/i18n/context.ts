/** React context and hooks of the i18n provider (kept apart from index.tsx for fast refresh). */
import { createContext, useContext } from 'react';
import type { Language } from '../types';
import { levelKey, type TranslationKey, type TranslationVars } from './core';

export interface I18nContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey, vars?: TranslationVars) => string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

/** The active language, its setter and `t(key, vars)`. Must be used inside `I18nProvider`. */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

/** Translated level name, e.g. `Medium` for 5. */
export function useLevelLabel(level: number): string {
  return useI18n().t(levelKey(level));
}
