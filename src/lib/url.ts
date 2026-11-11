/**
 * The URL is the save (DESIGN 13.2, Ztyle chapter 11).
 *
 * `HashRouter`, state in the query string, always written with `replace: true`. This module holds
 * the pure codec for the query parameters, the share-link builders, and `useUrlParams`, a thin
 * wrapper over react-router's `useSearchParams` that writes only when something changed and keeps
 * the transient manual-signalling parameters `x` and `y` (owned by the room UI) untouched.
 *
 * | Param | Meaning                                              |
 * |-------|------------------------------------------------------|
 * | `s`   | game code                                            |
 * | `d`   | computer level 1–12                                  |
 * | `p`   | `1` = playing                                        |
 * | `o`   | opponent: `c` computer, `l` local, `r` room          |
 * | `w`   | this side: `w` or `b`                                |
 * | `t`   | time control, e.g. `5+0`                             |
 * | `m`   | moves (compact encoding, `zhess.encodeMoves`)        |
 * | `r`   | result of a finished game, e.g. `1-0.resign` (addition, see below) |
 * | `x`,`y` | manual signalling offer and answer (transient, reserved) |
 *
 * `r` is an addition to the design's table: a game ended by resignation, time or agreement cannot
 * be told apart from a running one by its moves, yet a shared finished game must open in review.
 * Values: `1-0.<by>`, `0-1.<by>`, `draw.<by>` with `by` a `Termination`.
 */
import { useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isValidCode, normalizeCode } from './codes';
import type { Color, GameEnd, Mode, Result, TcString, Termination } from './types';
import { formatTc, parseTc } from './zhess';

/** Parsed query parameters. Absent or invalid values are `undefined`. */
export interface UrlParams {
  /** `s`: game code, normalized (uppercase `0-9A-Z`, 1–8 characters). */
  code?: string;
  /** `d`: computer level 1–12. */
  level?: number;
  /** `p=1`: a game is open (vs. the start screen). */
  playing?: boolean;
  /** `o`: opponent mode. */
  mode?: Mode;
  /** `w`: this device's side (in game), or the color pill's fixed choice (start screen). */
  color?: Color;
  /** `t`: time control in its normalized text form, e.g. `5+0`. Absent = clock off. */
  tc?: TcString;
  /** `m`: compact move list (DESIGN 13.2). Never written for room games. */
  moves?: string;
  /** `r`: the ending of a finished game. */
  end?: GameEnd;
  /** `x`: manual signalling offer (transient; owned by the room UI). */
  offer?: string;
  /** `y`: manual signalling answer (transient; owned by the room UI). */
  answer?: string;
}

/** Parameter letters in the order they are written. */
export const PARAM_ORDER = ['s', 'd', 'p', 'o', 'w', 't', 'm', 'r', 'x', 'y'] as const;

const MODE_TO_PARAM: Record<Mode, string> = { computer: 'c', local: 'l', room: 'r' };
const PARAM_TO_MODE: Record<string, Mode> = { c: 'computer', l: 'local', r: 'room' };

const TERMINATIONS: readonly Termination[] = [
  'mate',
  'resign',
  'time',
  'stalemate',
  'repetition',
  'fifty',
  'material',
  'agreed',
];

/** Characters of the move encoding: base64url plus `.` for promotions. */
const MOVES_RE = /^[A-Za-z0-9_.-]*$/;

/** `1-0.resign` ← `{ result: '1-0', by: 'resign' }`. */
export function formatEnd(end: GameEnd): string {
  const r = end.result === '1/2-1/2' ? 'draw' : end.result;
  return `${r}.${end.by}`;
}

/** Inverse of `formatEnd`; undefined for anything else. */
export function parseEnd(s: string | null | undefined): GameEnd | undefined {
  if (!s) return undefined;
  const m = /^(1-0|0-1|draw)\.([a-z]+)$/.exec(s.trim());
  if (!m) return undefined;
  const by = m[2] as Termination;
  if (!TERMINATIONS.includes(by)) return undefined;
  const result: Result = m[1] === 'draw' ? '1/2-1/2' : (m[1] as Result);
  return { result, by };
}

/** Normalizes a time-control string (`5+0`, `15+10`); undefined if it is not one. */
export function normalizeTc(s: string | null | undefined): TcString | undefined {
  const tc = parseTc(s ?? null);
  return tc ? (formatTc(tc) ?? undefined) : undefined;
}

/** Reads the query parameters. Invalid values are dropped, never thrown. */
export function parseUrl(search: URLSearchParams | string): UrlParams {
  const q = typeof search === 'string' ? new URLSearchParams(search.replace(/^\?/, '')) : search;
  const out: UrlParams = {};

  const s = q.get('s');
  if (s !== null) {
    const code = normalizeCode(s);
    if (isValidCode(code)) out.code = code;
  }

  const d = q.get('d');
  if (d !== null && /^\d{1,2}$/.test(d.trim())) {
    const level = Number(d.trim());
    if (level >= 1 && level <= 12) out.level = level;
  }

  if (q.get('p') === '1') out.playing = true;

  const o = q.get('o');
  if (o !== null && PARAM_TO_MODE[o.trim().toLowerCase()]) out.mode = PARAM_TO_MODE[o.trim().toLowerCase()];

  const w = q.get('w');
  if (w === 'w' || w === 'b') out.color = w;

  const tc = normalizeTc(q.get('t'));
  if (tc) out.tc = tc;

  const m = q.get('m');
  if (m !== null && MOVES_RE.test(m)) out.moves = m;

  const end = parseEnd(q.get('r'));
  if (end) out.end = end;

  const x = q.get('x');
  if (x) out.offer = x;
  const y = q.get('y');
  if (y) out.answer = y;

  return out;
}

/** Writes the query parameters in the fixed order `s d p o w t m r x y`. Undefined values are left out. */
export function serializeUrl(p: UrlParams): URLSearchParams {
  const q = new URLSearchParams();
  if (p.code) q.set('s', p.code);
  if (p.level !== undefined) q.set('d', String(p.level));
  if (p.playing) q.set('p', '1');
  if (p.mode) q.set('o', MODE_TO_PARAM[p.mode]);
  if (p.color) q.set('w', p.color);
  if (p.tc) q.set('t', p.tc);
  // Room games never carry their moves (DESIGN 13.2).
  if (p.moves !== undefined && p.mode !== 'room') q.set('m', p.moves);
  if (p.end && p.mode !== 'room') q.set('r', formatEnd(p.end));
  if (p.offer) q.set('x', p.offer);
  if (p.answer) q.set('y', p.answer);
  return q;
}

/** `serializeUrl` as a string without the leading `?`. */
export function urlQuery(p: UrlParams): string {
  return serializeUrl(p).toString();
}

/* ---------------------------------------------------------------------------------------------- */
/* Share links                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

/**
 * The app's base address without hash or query, e.g. `https://izzardry.github.io/zhess/`.
 * Pass a location for tests; defaults to `window.location`.
 */
export function appBaseUrl(loc?: Pick<Location, 'origin' | 'pathname'>): string {
  const l = loc ?? (typeof window !== 'undefined' ? window.location : undefined);
  if (!l) return '';
  return `${l.origin}${l.pathname}`;
}

/** A full HashRouter link: `<base>#/?<query>`. */
export function buildUrl(p: UrlParams, base: string = appBaseUrl()): string {
  const q = urlQuery(p);
  return q ? `${base}#/?${q}` : `${base}#/`;
}

/** The fields of a game that a share link carries. Matches `SavedGame` (DESIGN 12.1). */
export interface ShareableGame {
  code: string;
  mode: Mode;
  level?: number;
  color: Color;
  tc: TcString | null;
  /** Compact move list. */
  moves: string;
  result?: Result;
  by?: Termination;
}

/** Room invite: `?s=<CODE>&o=r` and nothing else, never moves or the key (DESIGN 13.2). */
export function roomShareUrl(code: string, base?: string): string {
  return buildUrl({ code, mode: 'room' }, base);
}

/**
 * A solo game, running or finished: the full state (code, level, side, clock, moves, and the
 * ending of a finished game) so the receiver gets it as a new game on their device. A finished
 * game opens in review. Clock times are not carried (the per-ply ms stay home).
 */
export function soloShareUrl(g: ShareableGame, base?: string): string {
  return buildUrl(gameParams(g), base);
}

/** Alias of `soloShareUrl` for a finished game; it opens in review because it carries `r`. */
export const finishedShareUrl = soloShareUrl;

/** Share link for any stored or running game: room invite for rooms, the full URL otherwise. */
export function shareUrl(g: ShareableGame, base?: string): string {
  return g.mode === 'room' ? roomShareUrl(g.code, base) : soloShareUrl(g, base);
}

/** The address-bar parameters of an open game. Room games get no `m` and no `r`. */
export function gameParams(g: ShareableGame): UrlParams {
  const end: GameEnd | undefined = g.result && g.by ? { result: g.result, by: g.by } : undefined;
  return {
    code: g.code,
    level: g.mode === 'computer' ? g.level : undefined,
    playing: true,
    mode: g.mode,
    color: g.mode === 'local' ? undefined : g.color,
    tc: g.tc ?? undefined,
    moves: g.mode === 'room' ? undefined : g.moves,
    end: g.mode === 'room' ? undefined : end,
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* React binding                                                                                    */
/* ---------------------------------------------------------------------------------------------- */

/**
 * `useSearchParams` with Zhess's rules: `write(p)` serializes `p`, keeps the current `x` and `y`
 * unless `p` sets them, and navigates with `replace: true` only when the query actually changes.
 * `isOwnWrite(search)` tells a query this hook wrote itself from one that arrived from outside
 * (a pasted link, the back button).
 */
export function useUrlParams(): {
  params: UrlParams;
  search: string;
  write: (p: UrlParams) => void;
  isOwnWrite: (search: string) => boolean;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.toString();
  const searchRef = useRef(search);
  searchRef.current = search;
  /** The most recent queries this hook wrote (several can be in flight before the router re-renders). */
  const written = useRef<string[]>([]);

  const write = useCallback(
    (p: UrlParams) => {
      const current = parseUrl(searchRef.current);
      const next = urlQuery({
        ...p,
        offer: p.offer ?? current.offer,
        answer: p.answer ?? current.answer,
      });
      written.current = [...written.current.filter((w) => w !== next), next].slice(-16);
      if (next === searchRef.current) return;
      searchRef.current = next;
      setSearchParams(new URLSearchParams(next), { replace: true });
    },
    [setSearchParams],
  );

  const isOwnWrite = useCallback((s: string) => written.current.includes(s), []);

  return { params: parseUrl(searchParams), search, write, isOwnWrite };
}
