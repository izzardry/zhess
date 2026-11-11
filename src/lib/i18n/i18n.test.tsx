import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createStore, memoryStorage } from '../storage';
import * as tables from './tables';
import {
  BRAND,
  I18nProvider,
  LANGUAGES,
  detectBrowserLanguage,
  dictionaries,
  getInitialLanguage,
  interpolate,
  levelKey,
  translate,
  useI18n,
  useLevelLabel,
  type Language,
} from './index';

const LANGS: Language[] = ['en', 'de', 'fr', 'es'];

describe('string tables', () => {
  const all = Object.entries(tables) as [string, Record<Language, Record<string, string>>][];

  it('every table has the same keys and placeholders in all four languages', () => {
    for (const [name, table] of all) {
      const en = table.en;
      for (const lang of LANGS) {
        expect(Object.keys(table[lang]).sort(), `${name}.${lang} keys`).toEqual(Object.keys(en).sort());
        for (const key of Object.keys(en)) {
          const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
          expect(ph(table[lang][key]), `${name}.${lang}.${key} placeholders`).toEqual(ph(en[key]));
          expect(table[lang][key].trim(), `${name}.${lang}.${key} is empty`).not.toBe('');
        }
      }
    }
  });

  it('no key is defined by two tables', () => {
    const owner = new Map<string, string>();
    const dupes: string[] = [];
    for (const [name, table] of all) {
      for (const key of Object.keys(table.en)) {
        if (owner.has(key)) dupes.push(`${key} (${owner.get(key)} and ${name})`);
        owner.set(key, name);
      }
    }
    expect(dupes).toEqual([]);
  });

  it('merges every table into one dictionary per language', () => {
    for (const lang of LANGS) expect(dictionaries[lang].start).toBeTruthy();
    expect(dictionaries.fr.start).toBe('Jouer');
  });

  it('keeps the brand untranslated', () => {
    expect(BRAND.tagline).toBe('Zero Distractions. Just Chess.');
    for (const lang of LANGS) expect(Object.values(dictionaries[lang])).not.toContain(BRAND.tagline);
  });
});

describe('translate', () => {
  it('translates, interpolates and falls back', () => {
    expect(translate('de', 'undo')).toBe('Rückgängig');
    expect(translate('en', 'removed', { subject: 'K7QW2M' })).toBe('K7QW2M removed');
    expect(translate('es', 'removed', { subject: 'K7QW2M' })).toBe('K7QW2M eliminado');
    expect(interpolate('{a} and {a}, {b}', { a: 1 })).toBe('1 and 1, {b}');
    expect(translate('en', 'no.such.key' as never)).toBe('no.such.key');
  });

  it('names the twelve levels', () => {
    expect(translate('en', levelKey(1))).toBe('Beginner');
    expect(translate('en', levelKey(5))).toBe('Medium');
    expect(translate('de', levelKey(12))).toBe('Wahnsinn');
    expect(translate('fr', levelKey(7))).toBe('Rusé');
    expect(levelKey(0)).toBe('difficulty.beginner');
    expect(levelKey(99)).toBe('difficulty.insane');
  });
});

describe('language detection', () => {
  it('uses the stored choice, then the browser, then English', () => {
    expect(getInitialLanguage(createStore(memoryStorage({ 'zhess:lang': '"fr"' })))).toBe('fr');
    expect(getInitialLanguage(createStore(memoryStorage({ 'zhess:lang': '"xx"' })))).toBe(detectBrowserLanguage());
    expect(detectBrowserLanguage({ language: 'de-AT', languages: ['de-AT', 'en'] })).toBe('de');
    expect(detectBrowserLanguage({ language: 'pt-BR', languages: ['pt-BR', 'es-ES'] })).toBe('es');
    expect(detectBrowserLanguage({ language: 'ja', languages: ['ja'] })).toBe('en');
    expect(LANGUAGES.map((l) => l.code)).toEqual(LANGS);
  });
});

function Probe() {
  const { t, language, setLanguage } = useI18n();
  const level = useLevelLabel(5);
  return (
    <div>
      <span data-testid="lang">{language}</span>
      <span data-testid="undo">{t('undo')}</span>
      <span data-testid="level">{level}</span>
      <button onClick={() => setLanguage('es')}>es</button>
    </div>
  );
}

describe('I18nProvider', () => {
  it('provides t(), syncs <html lang> and persists the choice', () => {
    const mem = memoryStorage({ 'zhess:lang': '"de"' });
    render(
      <I18nProvider store={createStore(mem)}>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('lang').textContent).toBe('de');
    expect(screen.getByTestId('undo').textContent).toBe('Rückgängig');
    expect(screen.getByTestId('level').textContent).toBe('Mittel');
    expect(document.documentElement.lang).toBe('de');
    act(() => screen.getByText('es').click());
    expect(screen.getByTestId('undo').textContent).toBe('Deshacer');
    expect(document.documentElement.lang).toBe('es');
    expect(mem.getItem('zhess:lang')).toBe('"es"');
  });

  it('accepts a fixed language for tests', () => {
    render(
      <I18nProvider language="fr" store={createStore(memoryStorage())}>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('undo').textContent).toBe('Annuler');
  });

  it('useI18n outside the provider throws', () => {
    const err = console.error;
    console.error = () => {};
    expect(() => render(<Probe />)).toThrow(/I18nProvider/);
    console.error = err;
  });
});
