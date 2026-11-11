/**
 * i18n core without React: merged dictionaries, `translate`, language detection.
 * Ported from Zudoku's `src/lib/i18n.tsx` with the Ztyle audit fixes (#13 storage key
 * `zhess:lang`, #16 `<html lang>` — see index.tsx) and per-package tables (PLAN 3.2).
 */
import { store as defaultStore } from '../storage';
import type { Language, Store } from '../types';
import type { Strings } from './define';
import * as tables from './tables';

export type { Language } from '../types';

/** Languages in menu order; labels are in their own language (Ztyle chapter 14). */
export const LANGUAGES: readonly { code: Language; label: string; flag: string }[] = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
];

type Tables = typeof tables;

/** Every key of every registered table. English is the source of truth. */
export type TranslationKey = { [K in keyof Tables]: keyof Tables[K]['en'] & string }[keyof Tables];

/** Placeholder values for `{name}` in a string. */
export type TranslationVars = Record<string, string | number>;

const CODES: readonly Language[] = ['en', 'de', 'fr', 'es'];

export function isLanguage(v: unknown): v is Language {
  return typeof v === 'string' && (CODES as readonly string[]).includes(v);
}

/** One merged dictionary per language, in registry order. */
export const dictionaries: Record<Language, Strings> = (() => {
  const out = { en: {}, de: {}, fr: {}, es: {} } as Record<Language, Strings>;
  for (const table of Object.values(tables) as unknown as Record<Language, Strings>[]) {
    for (const lang of CODES) Object.assign(out[lang], table[lang]);
  }
  return out;
})();

/** `{name}` → vars.name; unknown placeholders stay as they are. */
export function interpolate(text: string, vars?: TranslationVars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

/** Translates outside React: the language's string, else English, else the key itself. */
export function translate(lang: Language, key: TranslationKey, vars?: TranslationVars): string {
  const text = dictionaries[lang][key] ?? dictionaries.en[key] ?? key;
  return interpolate(text, vars);
}

/** First supported language among the browser's preferences, else `en`. */
export function detectBrowserLanguage(nav: Pick<Navigator, 'language' | 'languages'> | undefined = globalThis.navigator): Language {
  const prefs = [...(nav?.languages ?? []), nav?.language ?? ''];
  for (const p of prefs) {
    const code = p.slice(0, 2).toLowerCase();
    if (isLanguage(code)) return code;
  }
  return 'en';
}

/** Stored choice (`zhess:lang`) → browser language → `en` (Ztyle chapter 14). */
export function getInitialLanguage(s: Store = defaultStore): Language {
  const stored = s.pref<string | null>('lang', null);
  return isLanguage(stored) ? stored : detectBrowserLanguage();
}

const LEVEL_KEYS = [
  'difficulty.beginner',
  'difficulty.novice',
  'difficulty.easy',
  'difficulty.casual',
  'difficulty.medium',
  'difficulty.moderate',
  'difficulty.tricky',
  'difficulty.hard',
  'difficulty.tough',
  'difficulty.expert',
  'difficulty.master',
  'difficulty.insane',
] as const satisfies readonly TranslationKey[];

/** Key of a level's name (1 = Beginner … 12 = Insane), clamped to 1–12. */
export function levelKey(level: number): TranslationKey {
  const i = Math.min(12, Math.max(1, Math.round(level || 1))) - 1;
  return LEVEL_KEYS[i];
}
