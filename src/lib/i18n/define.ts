/**
 * String table shape. Each package exports one table from `src/lib/i18n/<package>.ts`:
 *
 *   export default defineTable({ en: { … }, de: { … }, fr: { … }, es: { … } });
 *
 * English is the source of truth and the type: German, French and Spanish must have exactly
 * the same keys (a missing or extra key is a type error). Placeholders are `{name}`.
 * Ztyle chapter 14: camelCase keys, dot keys for enumerations, aria-labels in the same table,
 * brand strings (wordmark, tagline) not translated.
 */
import type { Language } from '../types';

export type Strings = Record<string, string>;

export type Table<E extends Strings> = { en: E } & { [L in Exclude<Language, 'en'>]: Record<keyof E, string> };

/** Identity function that checks a table's four languages have the same keys. */
export function defineTable<E extends Strings>(table: Table<E>): Table<E> {
  return table;
}
