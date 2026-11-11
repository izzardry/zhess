/**
 * i18n: `I18nProvider`, `useI18n`, `t(key, vars)`, EN / DE / FR / ES.
 *
 * Strings live in per-package tables registered in `tables.ts`. The provider detects the
 * language (stored → browser → en), persists the choice under `zhess:lang` and keeps
 * `<html lang>` in sync.
 */
export { I18nProvider, type I18nProviderProps } from './provider';
export { useI18n, useLevelLabel, type I18nContextValue } from './context';
export {
  LANGUAGES,
  detectBrowserLanguage,
  dictionaries,
  getInitialLanguage,
  interpolate,
  isLanguage,
  levelKey,
  translate,
  type Language,
  type TranslationKey,
  type TranslationVars,
} from './core';
export { defineTable, type Strings, type Table } from './define';
export { BRAND } from './common';
