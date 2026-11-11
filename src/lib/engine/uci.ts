/**
 * Pure UCI text handling for the Stockfish worker (DESIGN 10.1).
 *
 * No DOM, no React, no timers: parsing of the engine's output lines, building of the commands we
 * send, score helpers, and a collector that turns a stream of `info` lines into MultiPV results.
 *
 * Imports carry explicit `.ts` extensions so that Node (type stripping) can load this file directly
 * from `scripts/selfplay.mjs`.
 */
import type { Eval, Uci } from '../types';

/* ------------------------------------------------------------------------------------------------
 * Lines
 * --------------------------------------------------------------------------------------------- */

/**
 * Split one message from the engine into trimmed, non-empty lines. The worker usually posts one
 * line per message, but a message may hold several; anything that is not a string yields nothing.
 */
export function splitLines(data: unknown): string[] {
  if (typeof data !== 'string') return [];
  return data
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** True for the line that ends the `uci` handshake (tolerates text glued in front of it). */
export function isUciOk(line: string): boolean {
  return line.includes('uciok');
}

/** True for the answer to `isready`. */
export function isReadyOk(line: string): boolean {
  return line.includes('readyok');
}

/* ------------------------------------------------------------------------------------------------
 * info
 * --------------------------------------------------------------------------------------------- */

/** One parsed `info` line that carries a search depth. */
export interface InfoLine {
  readonly depth: number;
  readonly seldepth?: number;
  /** 1-based MultiPV index; 1 when the engine does not say. */
  readonly multipv: number;
  /** Score from the side to move; absent on lines without `score`. */
  readonly eval?: Eval;
  /** Set when the score is only a bound (aspiration window fail-high / fail-low). */
  readonly bound?: 'lower' | 'upper';
  readonly nodes?: number;
  readonly timeMs?: number;
  /** Principal variation in UCI; empty when absent. */
  readonly pv: readonly Uci[];
}

/**
 * Parse an `info` line. Returns null for anything that is not an `info` line with a `depth`
 * (for example `info string …` or `info currmove …`).
 *
 * Text glued in front of `info` (seen when output is flushed mid-line) is skipped.
 */
export function parseInfo(line: string): InfoLine | null {
  const at = line.indexOf('info ');
  if (at < 0) return null;
  const tokens = line.slice(at + 5).trim().split(/\s+/);
  if (tokens[0] === 'string') return null;

  let depth: number | undefined;
  let seldepth: number | undefined;
  let multipv = 1;
  let ev: Eval | undefined;
  let bound: 'lower' | 'upper' | undefined;
  let nodes: number | undefined;
  let timeMs: number | undefined;
  let pv: Uci[] = [];

  const int = (s: string | undefined): number | undefined => {
    if (s === undefined || !/^-?\d+$/.test(s)) return undefined;
    return Number(s);
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t) {
      case 'depth':
        depth = int(tokens[++i]);
        break;
      case 'seldepth':
        seldepth = int(tokens[++i]);
        break;
      case 'multipv':
        multipv = int(tokens[++i]) ?? 1;
        break;
      case 'nodes':
        nodes = int(tokens[++i]);
        break;
      case 'time':
        timeMs = int(tokens[++i]);
        break;
      case 'score': {
        const kind = tokens[i + 1];
        const v = int(tokens[i + 2]);
        if ((kind === 'cp' || kind === 'mate') && v !== undefined) {
          ev = kind === 'cp' ? { cp: v } : { mate: v };
          i += 2;
        } else {
          i += 1;
        }
        if (tokens[i + 1] === 'lowerbound') {
          bound = 'lower';
          i++;
        } else if (tokens[i + 1] === 'upperbound') {
          bound = 'upper';
          i++;
        }
        break;
      }
      case 'pv':
        pv = tokens.slice(i + 1).filter((m) => isUciMove(m));
        i = tokens.length;
        break;
      case 'string':
        // `string` swallows the rest of the line.
        i = tokens.length;
        break;
      default:
        break;
    }
  }
  if (depth === undefined) return null;
  const out: { -readonly [K in keyof InfoLine]: InfoLine[K] } = { depth, multipv, pv };
  if (seldepth !== undefined) out.seldepth = seldepth;
  if (ev) out.eval = ev;
  if (bound) out.bound = bound;
  if (nodes !== undefined) out.nodes = nodes;
  if (timeMs !== undefined) out.timeMs = timeMs;
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * bestmove
 * --------------------------------------------------------------------------------------------- */

/** `bestmove e2e4 ponder e7e5` → `{ move: 'e2e4', ponder: 'e7e5' }`; `bestmove (none)` → `{ move: null }`. */
export function parseBestMove(line: string): { move: Uci | null; ponder?: Uci } | null {
  const m = /bestmove\s+(\S+)(?:\s+ponder\s+(\S+))?/.exec(line);
  if (!m) return null;
  const move = isUciMove(m[1]) ? m[1] : null;
  const out: { move: Uci | null; ponder?: Uci } = { move };
  if (m[2] && isUciMove(m[2])) out.ponder = m[2];
  return out;
}

/** `e2e4`, `e7e8q`: a syntactically valid UCI move. */
export function isUciMove(s: string): boolean {
  return /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(s);
}

/* ------------------------------------------------------------------------------------------------
 * option
 * --------------------------------------------------------------------------------------------- */

/** One `option name … type …` line from the `uci` handshake. */
export interface UciOption {
  readonly name: string;
  readonly type: string;
  readonly default?: string;
  readonly min?: number;
  readonly max?: number;
  readonly vars?: readonly string[];
}

/** Parse `option name Skill Level type spin default 20 min 0 max 20`. Names may contain spaces. */
export function parseOption(line: string): UciOption | null {
  const at = line.indexOf('option name ');
  if (at < 0) return null;
  const rest = line.slice(at + 'option name '.length);
  const typeAt = rest.indexOf(' type ');
  if (typeAt < 0) return null;
  const name = rest.slice(0, typeAt).trim();
  const tokens = rest.slice(typeAt + 6).trim().split(/\s+/);
  const type = tokens[0];
  let def: string | undefined;
  let min: number | undefined;
  let max: number | undefined;
  const vars: string[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'default') {
      // A string default may be empty (`default <empty>`); take the next token unless it is a keyword.
      const next = tokens[i + 1];
      if (next !== undefined && !['min', 'max', 'var'].includes(next)) {
        def = next;
        i++;
      } else {
        def = '';
      }
    } else if (t === 'min') {
      min = Number(tokens[++i]);
    } else if (t === 'max') {
      max = Number(tokens[++i]);
    } else if (t === 'var') {
      vars.push(tokens[++i]);
    }
  }
  const out: { -readonly [K in keyof UciOption]: UciOption[K] } = { name, type };
  if (def !== undefined) out.default = def;
  if (min !== undefined && Number.isFinite(min)) out.min = min;
  if (max !== undefined && Number.isFinite(max)) out.max = max;
  if (vars.length) out.vars = vars;
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Commands
 * --------------------------------------------------------------------------------------------- */

/** Parameters of a `go` command. Undefined fields are left out. */
export interface GoParams {
  readonly depth?: number;
  readonly movetime?: number;
  readonly nodes?: number;
  readonly wtime?: number;
  readonly btime?: number;
  readonly winc?: number;
  readonly binc?: number;
}

/** `go depth 8`, `go movetime 500`, … Times are rounded to whole milliseconds. A bare `go` is never built. */
export function goCommand(p: GoParams): string {
  const parts = ['go'];
  const add = (k: keyof GoParams) => {
    const v = p[k];
    if (v !== undefined && Number.isFinite(v)) parts.push(k, String(Math.max(k === 'depth' ? 1 : 0, Math.round(v))));
  };
  (['depth', 'nodes', 'movetime', 'wtime', 'btime', 'winc', 'binc'] as const).forEach(add);
  if (parts.length === 1) parts.push('depth', '1');
  return parts.join(' ');
}

/** `position fen <fen>`. FEN whitespace is normalized. */
export function positionCommand(fen: string): string {
  return `position fen ${fen.trim().split(/\s+/).join(' ')}`;
}

/** `setoption name <name> value <value>`. */
export function setOptionCommand(name: string, value: string | number | boolean): string {
  return `setoption name ${name} value ${String(value)}`;
}

/* ------------------------------------------------------------------------------------------------
 * Scores
 * --------------------------------------------------------------------------------------------- */

/** Centipawn stand-in for a mate score. Mate in n maps to ±(MATE_CP − |n|), so shorter mates rank higher. */
export const MATE_CP = 100_000;

/**
 * One number per evaluation, from the side to move, for sorting and budgets:
 * `cp` as is; `mate n` (n > 0) → MATE_CP − n; `mate −n` → −(MATE_CP − n); `mate 0` (mated) → −MATE_CP.
 * An empty Eval counts as 0.
 */
export function scoreCp(e: Eval): number {
  if (e.mate !== undefined) {
    if (e.mate > 0) return MATE_CP - e.mate;
    return -MATE_CP - e.mate;
  }
  return e.cp ?? 0;
}

/** The same evaluation seen from the other side (cp negated; mate n ↔ mate −n). */
export function negateEval(e: Eval): Eval {
  if (e.mate !== undefined) return { mate: -e.mate };
  return { cp: -(e.cp ?? 0) };
}

/* ------------------------------------------------------------------------------------------------
 * Collecting a search
 * --------------------------------------------------------------------------------------------- */

/** One MultiPV line at the end of a search. */
export interface PvLine {
  readonly uci: Uci;
  readonly eval: Eval;
  readonly depth: number;
  readonly pv: readonly Uci[];
}

/**
 * Collects `info` lines of one search and keeps, per MultiPV index, the deepest line with a score.
 * An exact score replaces a bound at the same depth; a bound never replaces an exact score at the
 * same depth. Lines without a PV (for example `info depth 0 score mate 0`) still count for the
 * evaluation of a position with no legal moves.
 */
export class SearchCollector {
  private readonly byPv = new Map<number, InfoLine>();

  add(info: InfoLine): void {
    if (!info.eval) return;
    const prev = this.byPv.get(info.multipv);
    if (!prev) {
      this.byPv.set(info.multipv, info);
      return;
    }
    if (info.depth > prev.depth) {
      this.byPv.set(info.multipv, info);
    } else if (info.depth === prev.depth && (!info.bound || prev.bound)) {
      this.byPv.set(info.multipv, info);
    }
  }

  /** Evaluation of the position: the score of MultiPV line 1, or null when none arrived. */
  eval(): Eval | null {
    return this.byPv.get(1)?.eval ?? null;
  }

  /** Deepest depth seen on line 1 (0 when none). */
  depth(): number {
    return this.byPv.get(1)?.depth ?? 0;
  }

  /**
   * MultiPV lines that have a move, in MultiPV order. The engine starts a new search depth line by
   * line, so a lower-ranked line may lag one depth behind; that is accepted.
   */
  lines(): PvLine[] {
    return [...this.byPv.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(([, l]) => l.pv.length > 0 && l.eval)
      .map(([, l]) => ({ uci: l.pv[0], eval: l.eval as Eval, depth: l.depth, pv: l.pv }));
  }
}

/** Side to move of a FEN (`w` when the field is missing). */
export function fenTurn(fen: string): 'w' | 'b' {
  return fen.trim().split(/\s+/)[1] === 'b' ? 'b' : 'w';
}
