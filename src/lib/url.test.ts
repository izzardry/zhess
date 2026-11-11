import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  appBaseUrl,
  buildUrl,
  finishedShareUrl,
  formatEnd,
  gameParams,
  parseEnd,
  parseUrl,
  roomShareUrl,
  serializeUrl,
  shareUrl,
  soloShareUrl,
  urlQuery,
  useUrlParams,
  type ShareableGame,
} from './url';
import zhess from './zhess';

const BASE = 'https://izzardry.github.io/zhess/';

describe('parseUrl', () => {
  it('reads every parameter of DESIGN 13.2', () => {
    const p = parseUrl('?s=k7qw2m&d=7&p=1&o=c&w=b&t=5%2B0&m=MceU&r=1-0.resign&x=OFFER&y=ANSWER');
    expect(p).toEqual({
      code: 'K7QW2M',
      level: 7,
      playing: true,
      mode: 'computer',
      color: 'b',
      tc: '5+0',
      moves: 'MceU',
      end: { result: '1-0', by: 'resign' },
      offer: 'OFFER',
      answer: 'ANSWER',
    });
  });

  it('accepts URLSearchParams and a raw "+" in t', () => {
    expect(parseUrl(new URLSearchParams('o=l')).mode).toBe('local');
    expect(parseUrl('o=r').mode).toBe('room');
    // A literal + in a query decodes to a space; parseTc trims it away only if it is a valid tc.
    expect(parseUrl('t=15%2B10').tc).toBe('15+10');
  });

  it('drops invalid values instead of throwing', () => {
    const p = parseUrl('s=!!!&d=13&p=0&o=z&w=x&t=fast&m=%25%25&r=win');
    expect(p).toEqual({});
    expect(parseUrl('d=0').level).toBeUndefined();
    expect(parseUrl('d=12').level).toBe(12);
    expect(parseUrl('s=abc-def').code).toBe('ABCDEF');
    expect(parseUrl('s=TOOLONGCODE').code).toBe('TOOLONGC');
  });

  it('keeps an empty move list (a game at its start)', () => {
    expect(parseUrl('s=A&p=1&m=').moves).toBe('');
  });
});

describe('serializeUrl', () => {
  it('writes in the fixed order s d p o w t m r x y', () => {
    const q = urlQuery({
      answer: 'Y',
      offer: 'X',
      end: { result: '1/2-1/2', by: 'agreed' },
      moves: 'MceU',
      tc: '3+2',
      color: 'w',
      mode: 'computer',
      playing: true,
      level: 5,
      code: 'K7QW2M',
    });
    expect(q).toBe('s=K7QW2M&d=5&p=1&o=c&w=w&t=3%2B2&m=MceU&r=draw.agreed&x=X&y=Y');
  });

  it('never writes moves or a result for room games', () => {
    const q = serializeUrl({ code: 'K7QW2M', playing: true, mode: 'room', moves: 'MceU', end: { result: '1-0', by: 'mate' } });
    expect(q.has('m')).toBe(false);
    expect(q.has('r')).toBe(false);
  });

  it('round-trips', () => {
    const plies = ['e2e4', 'e7e5', 'g1f3'].map((m) => ({ m, ms: 0 }));
    const p = {
      code: 'ZZ9',
      level: 12,
      playing: true,
      mode: 'computer' as const,
      color: 'b' as const,
      tc: '15+10',
      moves: zhess.encodeMoves(plies),
      end: { result: '0-1' as const, by: 'time' as const },
    };
    expect(parseUrl(serializeUrl(p))).toEqual(p);
  });

  it('formats and parses endings', () => {
    expect(formatEnd({ result: '1/2-1/2', by: 'stalemate' })).toBe('draw.stalemate');
    expect(parseEnd('0-1.mate')).toEqual({ result: '0-1', by: 'mate' });
    expect(parseEnd('0-1.bogus')).toBeUndefined();
    expect(parseEnd(null)).toBeUndefined();
  });
});

describe('share links', () => {
  const solo: ShareableGame = {
    code: 'K7QW2M',
    mode: 'computer',
    level: 5,
    color: 'w',
    tc: '5+0',
    moves: zhess.encodeMoves([{ m: 'e2e4', ms: 0 }]),
  };

  it('builds hash URLs on a base', () => {
    expect(buildUrl({ code: 'A' }, BASE)).toBe(`${BASE}#/?s=A`);
    expect(buildUrl({}, BASE)).toBe(`${BASE}#/`);
    expect(appBaseUrl({ origin: 'https://x.y', pathname: '/zhess/' })).toBe('https://x.y/zhess/');
  });

  it('room invites carry the code only', () => {
    expect(roomShareUrl('K7QW2M', BASE)).toBe(`${BASE}#/?s=K7QW2M&o=r`);
    expect(shareUrl({ ...solo, mode: 'room' }, BASE)).toBe(`${BASE}#/?s=K7QW2M&o=r`);
  });

  it('solo games carry the full state', () => {
    const url = soloShareUrl(solo, BASE);
    expect(url).toBe(`${BASE}#/?s=K7QW2M&d=5&p=1&o=c&w=w&t=5%2B0&m=${solo.moves}`);
    expect(shareUrl(solo, BASE)).toBe(url);
  });

  it('finished games carry their result and so open in review', () => {
    const url = finishedShareUrl({ ...solo, result: '0-1', by: 'resign' }, BASE);
    expect(parseUrl(url.split('#/?')[1]).end).toEqual({ result: '0-1', by: 'resign' });
  });

  it('pass-and-play links leave out w and d', () => {
    const p = gameParams({ ...solo, mode: 'local', level: 5 });
    expect(p.color).toBeUndefined();
    expect(p.level).toBeUndefined();
  });
});

describe('useUrlParams', () => {
  function setup(initial: string) {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(MemoryRouter, { initialEntries: [initial] }, children);
    return renderHook(() => ({ url: useUrlParams(), loc: useLocation(), nav: useNavigationType() }), { wrapper });
  }

  it('writes with replace, keeps x and y, and recognizes its own writes', () => {
    const { result } = setup('/?s=OLD&x=OFFER');
    expect(result.current.url.params.code).toBe('OLD');
    act(() => result.current.url.write({ code: 'NEW', playing: true, mode: 'local', moves: '' }));
    expect(result.current.loc.search).toBe('?s=NEW&p=1&o=l&m=&x=OFFER');
    expect(result.current.url.isOwnWrite(result.current.url.search)).toBe(true);
    expect(result.current.url.isOwnWrite('s=ELSE')).toBe(false);
    // replace: true — no new history entry.
    expect(result.current.nav).toBe('REPLACE');
  });

  it('does not navigate when nothing changes', () => {
    const { result } = setup('/?s=SAME');
    const before = result.current.loc;
    act(() => result.current.url.write({ code: 'SAME' }));
    expect(result.current.loc).toBe(before);
  });
});
