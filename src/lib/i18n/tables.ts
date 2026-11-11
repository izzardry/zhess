/**
 * Registry of string tables — the single shared edit point of i18n.
 *
 * Each package owns `src/lib/i18n/<package>.ts` and adds exactly ONE line here:
 *
 *   export { default as <package> } from './<package>';
 *
 * Keys must be unique across all tables; `i18n.test.ts` fails on a duplicate. Read `common.ts`
 * before adding a key so shared words are not defined twice.
 */
export { default as common } from './common';
