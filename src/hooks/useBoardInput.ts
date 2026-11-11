/**
 * Board input (DESIGN 6): tap-tap, drag with pointer events, keyboard focus ring, typed SAN, the
 * 300 ms hold that opens the promotion dial, and premoves. Used by `ChessBoard`; the board is
 * controlled, so this hook never changes the game, it only calls `onMove` / `onPremove`.
 *
 * Interaction state that changes on every pointer move (the press, the drag, the dial) lives in
 * refs and a render tick, so handlers never read a stale value between renders.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { board as boardOf, legalMoves, sanToUci } from '@/lib/zhess';
import type { Color, Game, Piece, PromotionPiece, Square, Uci } from '@/lib/types';
import { isPromotionRank, premoveTargets, squareAt, squareCenter, stepSquare, type Box } from '@/components/board/geometry';
import { clampDialCenter, DIAL_HOLD_MS, dialPick, type DialZone } from '@/components/board/dial';
import type { Movable, Premove } from '@/components/board/types';

/** A square the selected piece can go to. */
export interface TargetInfo {
  /** UCI without promotion letter for a legal move; null for a premove target. */
  readonly uci: Uci | null;
  readonly capture: boolean;
  readonly promotion: boolean;
  /** Accepted as a drop but not drawn: the own rook for castling (DESIGN 6.1). */
  readonly hidden: boolean;
}

export interface DragState {
  readonly from: Square;
  readonly piece: Piece;
  /** Pointer position (client px). */
  readonly x: number;
  readonly y: number;
  readonly pointerType: string;
  /** Square under the pointer. */
  readonly over: Square | null;
}

export interface DialState {
  readonly from: Square;
  readonly to: Square;
  readonly color: Color;
  /** Dial center (clamped, client px). */
  readonly x: number;
  readonly y: number;
  /** Pointer offset from the center, for the rubber band. */
  readonly dx: number;
  readonly dy: number;
  readonly aim: PromotionPiece | null;
  readonly zone: DialZone;
  readonly mode: 'pointer' | 'keyboard';
}

/** How the last move or premove was entered; the board skips the slide animation after a drag. */
export type InputKind = 'tap' | 'drag' | 'key' | 'san';

export interface BoardInputOptions {
  readonly game: Game;
  readonly orientation: Color;
  readonly interactive: boolean;
  readonly movable: Movable;
  readonly premove: Premove | null;
  readonly onMove: (uci: Uci) => void;
  readonly onPremove?: (premove: Premove | null) => void;
  /** The 8×8 grid's client rect, for hit tests. */
  readonly getBox: () => Box | null;
  /** Listen for typed SAN on the window. */
  readonly captureKeys: boolean;
  /** The board's outer element: a press outside it clears the selection. */
  readonly rootRef?: RefObject<HTMLElement>;
}

export interface BoardInput {
  readonly selected: Square | null;
  readonly targets: ReadonlyMap<Square, TargetInfo>;
  /** Keyboard focus square (roving tabindex). */
  readonly cursor: Square;
  readonly setCursor: (sq: Square) => void;
  readonly drag: DragState | null;
  readonly dial: DialState | null;
  /** SAN typed so far. */
  readonly typed: string;
  /** The last rejected typed move, shown briefly. */
  readonly typedError: string | null;
  /** How the last move was entered and its UCI. */
  readonly lastInput: { readonly kind: InputKind; readonly uci: Uci } | null;
  readonly gridHandlers: {
    readonly onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    readonly onPointerMove: (e: PointerEvent<HTMLElement>) => void;
    readonly onPointerUp: (e: PointerEvent<HTMLElement>) => void;
    readonly onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
    readonly onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  };
  readonly dialKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  /** Choose a dial item (null = cancel). */
  readonly chooseDial: (piece: PromotionPiece | null) => void;
  /** Clear selection, typed text and dial. */
  readonly clear: () => void;
}

/** Characters that can be part of typed SAN. `z` is never one (undo / redo belong to the page). */
const SAN_CHAR = /^[a-h1-8xNBRQKnrqkOo0=+#-]$/;
export function isSanChar(key: string): boolean {
  return SAN_CHAR.test(key);
}

/** Normalizes typed SAN before parsing: lower-case `o-o` castles. */
export function normalizeTyped(text: string): string {
  const t = text.trim();
  if (/^[oO0]-[oO0](-[oO0])?[+#]?$/.test(t)) return t.replace(/[o0]/g, 'O');
  return t;
}

const MAX_TYPED = 8;
const DRAG_THRESHOLD: Record<string, number> = { mouse: 3, pen: 4, touch: 6 };

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

function squareFromTarget(target: EventTarget | null): Square | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest('[data-square]');
  return (el?.getAttribute('data-square') as Square | null) ?? null;
}

const sqIndex = (sq: Square) => 'abcdefgh'.indexOf(sq[0]) + 8 * (Number(sq[1]) - 1);

interface Press {
  kind: 'piece' | 'target' | 'void';
  from: Square;
  to: Square | null;
  pointerId: number;
  pointerType: string;
  x: number;
  y: number;
  wasSelected: boolean;
  dragging: boolean;
}

export function useBoardInput(options: BoardInputOptions): BoardInput {
  const opts = useRef(options);
  opts.current = options;
  const { game, orientation, interactive, movable, onPremove } = options;

  const [selected, setSelected] = useState<Square | null>(null);
  const selRef = useRef<Square | null>(null);
  const [cursor, setCursorState] = useState<Square>(orientation === 'w' ? 'e2' : 'e7');
  const [typed, setTyped] = useState('');
  const typedRef = useRef('');
  const [typedError, setTypedError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const tick = useCallback(() => setTick((n) => n + 1), []);

  const press = useRef<Press | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dialRef = useRef<DialState | null>(null);
  const dialOrigin = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const holdTimer = useRef<number | null>(null);
  const holdSquare = useRef<Square | null>(null);
  const lastPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const errorTimer = useRef<number | null>(null);
  const lastInputRef = useRef<{ kind: InputKind; uci: Uci } | null>(null);

  /* ---- rules, always from the latest options ---- */

  const pieces = useMemo(() => boardOf(game), [game]);
  const piecesRef = useRef(pieces);
  piecesRef.current = pieces;

  const canMoveNow = useCallback((color: Color) => {
    const o = opts.current;
    return o.interactive && !o.game.end && o.game.turn === color && (o.movable === 'both' || o.movable === color);
  }, []);

  const canPremove = useCallback((color: Color) => {
    const o = opts.current;
    return o.interactive && !o.game.end && !!o.onPremove && o.movable === color && o.game.turn !== color;
  }, []);

  const pieceAt = useCallback((sq: Square) => piecesRef.current[sqIndex(sq)] ?? null, []);

  const selectable = useCallback(
    (sq: Square) => {
      const p = pieceAt(sq);
      return !!p && (canMoveNow(p.color) || canPremove(p.color));
    },
    [pieceAt, canMoveNow, canPremove],
  );

  const targetsFor = useCallback(
    (from: Square | null): Map<Square, TargetInfo> => {
      const out = new Map<Square, TargetInfo>();
      if (!from) return out;
      const p = pieceAt(from);
      if (!p) return out;
      const g = opts.current.game;
      if (canMoveNow(p.color)) {
        for (const m of legalMoves(g, from)) {
          if (!out.has(m.to)) {
            out.set(m.to, { uci: `${m.from}${m.to}`, capture: !!m.captured, promotion: !!m.promotion, hidden: false });
          }
          if (m.castle) {
            const rook = `${m.castle === 'k' ? 'h' : 'a'}${m.from[1]}` as Square;
            const rp = pieceAt(rook);
            if (rp?.type === 'r' && rp.color === p.color && !out.has(rook)) {
              out.set(rook, { uci: m.uci, capture: false, promotion: false, hidden: true });
            }
          }
        }
      } else if (canPremove(p.color)) {
        for (const to of premoveTargets(g.fen, from)) {
          const q = pieceAt(to);
          out.set(to, {
            uci: null,
            capture: !!q && q.color !== p.color,
            promotion: p.type === 'p' && isPromotionRank(p.color, to),
            hidden: false,
          });
        }
      }
      return out;
    },
    [pieceAt, canMoveNow, canPremove],
  );

  /* ---- small state helpers ---- */

  const select = useCallback((sq: Square | null) => {
    selRef.current = sq;
    setSelected(sq);
  }, []);

  const setTypedText = useCallback((text: string) => {
    typedRef.current = text;
    setTyped(text);
  }, []);

  const cancelHold = useCallback(() => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    holdSquare.current = null;
  }, []);

  const closeDial = useCallback(() => {
    dialRef.current = null;
    tick();
  }, [tick]);

  const clear = useCallback(() => {
    cancelHold();
    press.current = null;
    dragRef.current = null;
    dialRef.current = null;
    select(null);
    setTypedText('');
    tick();
  }, [cancelHold, select, setTypedText, tick]);

  const setCursor = useCallback((sq: Square) => setCursorState(sq), []);

  /** Plays or queues the move from → to. Returns true when something was sent. */
  const commit = useCallback(
    (from: Square, to: Square, promo: PromotionPiece | undefined, kind: InputKind): boolean => {
      const info = targetsFor(from).get(to);
      const p = pieceAt(from);
      if (!info || !p) return false;
      const o = opts.current;
      if (info.uci) {
        const uci = info.hidden ? info.uci : `${from}${to}${info.promotion ? (promo ?? 'q') : ''}`;
        lastInputRef.current = { kind, uci };
        select(null);
        o.onMove(uci);
        return true;
      }
      if (o.onPremove) {
        select(null);
        o.onPremove(info.promotion ? { from, to, promotion: promo ?? 'q' } : { from, to });
        return true;
      }
      return false;
    },
    [targetsFor, pieceAt, select],
  );

  const openDial = useCallback(
    (from: Square, to: Square, x: number, y: number, mode: DialState['mode']) => {
      const p = pieceAt(from);
      if (!p) return;
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
      const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
      const c = clampDialCenter(x, y, vw, vh);
      dialOrigin.current = { x, y };
      dialRef.current = {
        from,
        to,
        color: p.color,
        x: c.x,
        y: c.y,
        dx: 0,
        dy: 0,
        aim: mode === 'keyboard' ? 'q' : null,
        zone: mode === 'keyboard' ? 'aim' : 'center',
        mode,
      };
      tick();
    },
    [pieceAt, tick],
  );

  const chooseDial = useCallback(
    (piece: PromotionPiece | null) => {
      const d = dialRef.current;
      cancelHold();
      press.current = null;
      dragRef.current = null;
      dialRef.current = null;
      if (d && piece) commit(d.from, d.to, piece, d.mode === 'keyboard' ? 'key' : 'drag');
      tick();
    },
    [cancelHold, commit, tick],
  );

  const cancelPremove = useCallback((): boolean => {
    const o = opts.current;
    if (o.premove && o.onPremove) {
      o.onPremove(null);
      return true;
    }
    return false;
  }, []);

  /* ---- pointer ---- */

  const capture = (e: PointerEvent<HTMLElement>) => {
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* not supported (jsdom) or pointer already gone */
    }
  };
  const release = (e: PointerEvent<HTMLElement>) => {
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    const o = opts.current;
    if (!o.interactive) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (press.current) return; // a second finger
    const sq = squareFromTarget(e.target) ?? squareAt(e.clientX, e.clientY, o.getBox(), o.orientation);
    lastPos.current = { x: e.clientX, y: e.clientY };
    if (dialRef.current) {
      closeDial();
      return;
    }
    // "Tapping anywhere cancels it" (DESIGN 6.3).
    if (cancelPremove()) {
      select(null);
      return;
    }
    if (!sq) {
      select(null);
      return;
    }
    setCursorState(sq);
    const sel = selRef.current;
    const base = { pointerId: e.pointerId, pointerType: e.pointerType || 'mouse', x: e.clientX, y: e.clientY, dragging: false };
    const info = sel ? targetsFor(sel).get(sq) : undefined;
    if (sel && info && !info.hidden) {
      press.current = { ...base, kind: 'target', from: sel, to: sq, wasSelected: false };
      capture(e);
      if (info.promotion) {
        cancelHold();
        holdSquare.current = sq;
        holdTimer.current = window.setTimeout(() => {
          holdTimer.current = null;
          if (press.current?.kind === 'target') openDial(sel, sq, lastPos.current.x, lastPos.current.y, 'pointer');
        }, DIAL_HOLD_MS);
      }
      return;
    }
    if (selectable(sq)) {
      press.current = { ...base, kind: 'piece', from: sq, to: null, wasSelected: sel === sq };
      select(sq);
      capture(e);
      return;
    }
    select(null);
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    const o = opts.current;
    lastPos.current = { x: e.clientX, y: e.clientY };
    const d = dialRef.current;
    if (d) {
      if (d.mode !== 'pointer') return;
      const pick = dialPick(e.clientX - dialOrigin.current.x, e.clientY - dialOrigin.current.y);
      dialRef.current = { ...d, dx: e.clientX - d.x, dy: e.clientY - d.y, aim: pick.piece, zone: pick.zone };
      tick();
      return;
    }
    if (p.kind === 'target') {
      // Leaving the target square turns the press into nothing.
      const over = squareAt(e.clientX, e.clientY, o.getBox(), o.orientation);
      const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y) > (DRAG_THRESHOLD[p.pointerType] ?? 4);
      if (moved && over !== null && over !== p.to) {
        cancelHold();
        p.kind = 'void';
      }
      return;
    }
    if (p.kind !== 'piece') return;
    if (!p.dragging) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < (DRAG_THRESHOLD[p.pointerType] ?? 4)) return;
      p.dragging = true;
    }
    const piece = pieceAt(p.from);
    if (!piece) return;
    const over = squareAt(e.clientX, e.clientY, o.getBox(), o.orientation);
    dragRef.current = { from: p.from, piece, x: e.clientX, y: e.clientY, pointerType: p.pointerType, over };
    const info = over && over !== p.from ? targetsFor(p.from).get(over) : undefined;
    if (info?.promotion && over) {
      if (holdSquare.current !== over) {
        cancelHold();
        holdSquare.current = over;
        const from = p.from;
        holdTimer.current = window.setTimeout(() => {
          holdTimer.current = null;
          if (press.current?.dragging && press.current.from === from) {
            openDial(from, over, lastPos.current.x, lastPos.current.y, 'pointer');
          }
        }, DIAL_HOLD_MS);
      }
    } else {
      cancelHold();
    }
    tick();
  };

  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    const o = opts.current;
    cancelHold();
    press.current = null;
    release(e);
    const d = dialRef.current;
    if (d && d.mode === 'pointer') {
      dialRef.current = null;
      dragRef.current = null;
      const pick = dialPick(e.clientX - dialOrigin.current.x, e.clientY - dialOrigin.current.y);
      if (pick.piece && (pick.zone === 'aim' || pick.zone === 'commit')) {
        commit(d.from, d.to, pick.piece, p.kind === 'piece' ? 'drag' : 'tap');
      }
      tick();
      return;
    }
    if (p.kind === 'piece' && p.dragging) {
      dragRef.current = null;
      const over = squareAt(e.clientX, e.clientY, o.getBox(), o.orientation);
      if (over && over !== p.from && targetsFor(p.from).has(over)) {
        commit(p.from, over, undefined, 'drag');
      } else if (over !== p.from) {
        // Illegal drop: snap back without comment (DESIGN 6.1).
        select(null);
      }
      tick();
      return;
    }
    if (p.kind === 'piece') {
      if (p.wasSelected) select(null);
      return;
    }
    if (p.kind === 'target' && p.to) commit(p.from, p.to, undefined, 'tap');
  };

  const onPointerCancel = (e: PointerEvent<HTMLElement>) => {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    cancelHold();
    press.current = null;
    dragRef.current = null;
    if (dialRef.current?.mode === 'pointer') dialRef.current = null;
    tick();
  };

  /* ---- keyboard ---- */

  const flashError = useCallback((text: string) => {
    setTypedError(text);
    if (errorTimer.current !== null) window.clearTimeout(errorTimer.current);
    errorTimer.current = window.setTimeout(() => {
      errorTimer.current = null;
      setTypedError(null);
    }, 700);
  }, []);

  const submitTyped = useCallback(() => {
    const o = opts.current;
    const text = normalizeTyped(typedRef.current);
    setTypedText('');
    if (!text) return;
    const uci = canMoveNow(o.game.turn) ? sanToUci(o.game, text) : null;
    if (uci) {
      lastInputRef.current = { kind: 'san', uci };
      select(null);
      o.onMove(uci);
      return;
    }
    flashError(text);
  }, [canMoveNow, flashError, select, setTypedText]);

  /** Returns true when the key was a SAN key and was taken. */
  const typeKey = useCallback(
    (key: string): boolean => {
      if (key === 'Enter' && typedRef.current) {
        submitTyped();
        return true;
      }
      if (key === 'Backspace' && typedRef.current) {
        setTypedText(typedRef.current.slice(0, -1));
        return true;
      }
      if (isSanChar(key)) {
        if (typedRef.current.length < MAX_TYPED) setTypedText(typedRef.current + key);
        return true;
      }
      return false;
    },
    [setTypedText, submitTyped],
  );

  const activate = useCallback(
    (sq: Square, shift: boolean) => {
      if (!opts.current.interactive) return;
      if (cancelPremove()) {
        select(null);
        return;
      }
      const sel = selRef.current;
      const info = sel ? targetsFor(sel).get(sq) : undefined;
      if (sel && info && !info.hidden) {
        if (info.promotion && shift) {
          const box = opts.current.getBox();
          const c = box ? squareCenter(sq, box, opts.current.orientation) : { x: 0, y: 0 };
          openDial(sel, sq, c.x, c.y, 'keyboard');
        } else {
          commit(sel, sq, undefined, 'key');
        }
        return;
      }
      if (selectable(sq)) {
        select(sel === sq ? null : sq);
        return;
      }
      select(null);
    },
    [cancelPremove, commit, openDial, select, selectable, targetsFor],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const o = opts.current;
    const arrows: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    // The focused cell is the cursor (state may lag behind a focus change by one render).
    const here = squareFromTarget(e.target) ?? cursor;
    const step = arrows[e.key];
    if (step) {
      e.preventDefault();
      e.stopPropagation();
      setCursorState(stepSquare(here, step[0], step[1], o.orientation));
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      setCursorState(stepSquare(here, e.key === 'Home' ? -7 : 7, 0, o.orientation));
      return;
    }
    if (!o.interactive) return;
    if (e.key === 'Escape') {
      cancelPremove();
      clear();
      e.stopPropagation();
      return;
    }
    if (e.key === 'Enter' && typedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      submitTyped();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      activate(here, e.shiftKey);
      return;
    }
    if (typeKey(e.key)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const dialKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const d = dialRef.current;
      if (!d) return;
      const aims: Record<string, PromotionPiece> = { ArrowUp: 'q', ArrowRight: 'r', ArrowDown: 'b', ArrowLeft: 'n' };
      const letter = e.key.toLowerCase();
      e.stopPropagation();
      if (aims[e.key]) {
        e.preventDefault();
        dialRef.current = { ...d, aim: aims[e.key], zone: 'aim' };
        tick();
      } else if (letter === 'q' || letter === 'r' || letter === 'b' || letter === 'n') {
        e.preventDefault();
        chooseDial(letter);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        chooseDial(d.aim);
      } else if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault();
        chooseDial(null);
      }
    },
    [chooseDial, tick],
  );

  /* ---- effects ---- */

  // Typed SAN anywhere on the page.
  useEffect(() => {
    if (!options.captureKeys || !interactive) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditable(e.target)) return;
      if (dialRef.current) return;
      if (e.key === 'Escape') {
        if (typedRef.current || selRef.current) clear();
        return;
      }
      if (typeKey(e.key)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [options.captureKeys, interactive, typeKey, clear]);

  // A press outside the board clears the selection; a premove is cancelled by any tap.
  useEffect(() => {
    if (!selected && !options.premove) return;
    const onDown = (e: globalThis.PointerEvent) => {
      const root = opts.current.rootRef?.current;
      const t = e.target;
      if (t instanceof Node && root?.contains(t)) return;
      if (t instanceof Element && t.closest('[data-zhess-dial]')) return;
      if (selRef.current) select(null);
      cancelPremove();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [selected, options.premove, select, cancelPremove]);

  // Keep the selection only while it is still a piece this person may move.
  useEffect(() => {
    const sel = selRef.current;
    if (sel && !selectable(sel)) {
      select(null);
      if (!press.current?.dragging) {
        dragRef.current = null;
        dialRef.current = null;
        cancelHold();
        tick();
      }
    }
  }, [game, interactive, movable, onPremove, selectable, select, cancelHold, tick]);

  // Turning input off ends every gesture.
  useEffect(() => {
    if (!interactive) {
      cancelHold();
      press.current = null;
      dragRef.current = null;
      dialRef.current = null;
      select(null);
      setTypedText('');
      tick();
    }
  }, [interactive, cancelHold, select, setTypedText, tick]);

  useEffect(
    () => () => {
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
      if (errorTimer.current !== null) window.clearTimeout(errorTimer.current);
    },
    [],
  );

  const targets = useMemo(
    () => targetsFor(selected),
    // Targets depend on the game and on who may move, which the callbacks read from opts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, game, interactive, movable, onPremove, targetsFor],
  );

  return {
    selected,
    targets,
    cursor,
    setCursor,
    drag: dragRef.current,
    dial: dialRef.current,
    typed,
    typedError,
    lastInput: lastInputRef.current,
    gridHandlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown },
    dialKeyDown,
    chooseDial,
    clear,
  };
}
