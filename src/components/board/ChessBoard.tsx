/**
 * The Zhess board (DESIGN 5, 6, 14.1). Controlled: it draws `game` and reports moves through
 * `onMove(uci)`; it never changes the game itself.
 *
 * - 8×8 `grid` of `gridcell`s labelled `white knight, g1`, roving tabindex, arrow keys.
 * - Square states of 5.3 as overlays; coordinates, last move, dots and check glow are helpers.
 * - Orientation (`orientation` at the bottom) and face-to-face seating (far side upside down).
 * - Tap-tap, drag (pointer events, `touch-action: none`, piece lifted above the finger), keyboard,
 *   typed SAN + Enter, the 300 ms hold that opens the promotion dial, premoves.
 * - A polite live region announces each new move in words.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/lib/i18n';
import { board as boardOf, history, inCheck, lastMove as lastMoveOf } from '@/lib/zhess';
import { cn } from '@/lib/utils';
import type { Color, Game, Square } from '@/lib/types';
import { useBoardInput } from '@/hooks/useBoardInput';
import { DEFAULT_CELL_SIZE, drawOrder, isLightSquare, squareToCell } from './geometry';
import { describeMove, describeSquare, pieceName } from './describe';
import { PieceIcon } from './PieceIcon';
import { PromotionDial } from './PromotionDial';
import { BoardSquare } from './Square';
import type { ChessBoardProps } from './types';
import './board.css';

const sqIndex = (sq: Square) => 'abcdefgh'.indexOf(sq[0]) + 8 * (Number(sq[1]) - 1);

/** Counts changes of a value (React's "information from previous renders" pattern). */
function useChangeCount(value: unknown, active: boolean): number {
  const [state, setState] = useState({ value, n: active ? 1 : 0 });
  if (state.value !== value) {
    const n = active ? state.n + 1 : state.n;
    setState({ value, n });
    return active ? n : 0;
  }
  return active ? state.n : 0;
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function ChessBoard({
  game,
  orientation,
  helpers,
  interactive = true,
  movable = 'both',
  seating = 'side',
  premove = null,
  highlights,
  onMove,
  onPremove,
  captureKeys,
  announce = true,
  cellSize = DEFAULT_CELL_SIZE,
  className,
}: ChessBoardProps) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const instructionsId = useId();

  const getBox = useCallback(() => gridRef.current?.getBoundingClientRect() ?? null, []);

  const input = useBoardInput({
    game,
    orientation,
    interactive,
    movable,
    premove,
    onMove,
    onPremove,
    getBox,
    captureKeys: captureKeys ?? interactive,
    rootRef,
  });
  const { selected, targets, cursor, drag, dial, typed, typedError } = input;

  const pieces = useMemo(() => boardOf(game), [game]);
  const rows = useMemo(() => drawOrder(orientation), [orientation]);
  const last = helpers ? lastMoveOf(game) : null;
  const check = helpers ? inCheck(game) : null;
  const farColor: Color = orientation === 'w' ? 'b' : 'w';

  const hints = highlights?.hint ?? null;
  const hintKey = useChangeCount(hints, !!hints && hints.length > 0);
  const hintSet = useMemo(() => new Set(hints ?? []), [hints]);
  const threatSet = useMemo(() => new Set(highlights?.threats ?? []), [highlights?.threats]);
  const blunderSq = helpers ? (highlights?.blunder ?? null) : null;
  const blunderKey = useChangeCount(`${blunderSq ?? ''}:${highlights?.blunderKey ?? 0}`, !!blunderSq);

  /* ---- focus ---- */

  // `visible`: show the focus ring even after a pointer tap (`focusVisible`, not yet in TS's DOM types),
  // so a hint stays marked when reduced motion removes its pulse (DESIGN 5.3, 14.1).
  const focusSquare = useCallback((sq: Square, visible = false) => {
    const opts = { preventScroll: true, ...(visible ? { focusVisible: true } : {}) } as FocusOptions;
    gridRef.current?.querySelector<HTMLElement>(`[data-square="${sq}"]`)?.focus(opts);
  }, []);

  // Arrow keys move the DOM focus with the cursor while the board has focus.
  useEffect(() => {
    const grid = gridRef.current;
    if (grid && document.activeElement instanceof HTMLElement && grid.contains(document.activeElement)) {
      if (document.activeElement.dataset.square !== cursor) focusSquare(cursor);
    }
  }, [cursor, focusSquare]);

  // "Hints move focus to the square" (DESIGN 5.3).
  const { setCursor } = input;
  useEffect(() => {
    if (hintKey > 0 && hints && hints[0]) {
      setCursor(hints[0]);
      focusSquare(hints[0], true);
    }
    // Only when a new hint arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hintKey]);

  // The keyboard dial takes focus while open and gives it back to the cell when it closes.
  const dialMode = dial?.mode ?? null;
  const prevDialMode = useRef<typeof dialMode>(null);
  useEffect(() => {
    if (dialMode === 'keyboard') menuRef.current?.focus({ preventScroll: true });
    else if (prevDialMode.current === 'keyboard') focusSquare(cursor);
    prevDialMode.current = dialMode;
  }, [dialMode, cursor, focusSquare]);

  /* ---- piece slide (skipped after a drag and with reduced motion) ---- */

  const prevGame = useRef<Game>(game);
  const { lastInput } = input;
  useLayoutEffect(() => {
    const prev = prevGame.current;
    prevGame.current = game;
    if (prev === game || game.cursor !== prev.cursor + 1 || game.start !== prev.start) return;
    const lm = lastMoveOf(game);
    const grid = gridRef.current;
    if (!lm || !grid || prefersReducedMotion()) return;
    if (lastInput?.kind === 'drag' && lastInput.uci.slice(0, 4) === game.plies[game.cursor - 1]?.m.slice(0, 4)) return;
    const el = grid.querySelector<SVGElement>(`[data-square="${lm.to}"] [data-piece]`);
    if (!el || typeof el.animate !== 'function') return;
    const box = grid.getBoundingClientRect();
    const cell = box.width / 8;
    if (!cell) return;
    const a = squareToCell(lm.from, orientation);
    const b = squareToCell(lm.to, orientation);
    const dx = (a.col - b.col) * cell;
    const dy = (a.row - b.row) * cell;
    const rot = el.classList.contains('rotate-180') ? ' rotate(180deg)' : '';
    el.animate([{ transform: `translate(${dx}px, ${dy}px)${rot}` }, { transform: `translate(0, 0)${rot}` }], {
      duration: 200,
      easing: 'cubic-bezier(0, 0, 0.2, 1)',
    });
  }, [game, orientation, lastInput]);

  /* ---- live region ---- */

  const [announcement, setAnnouncement] = useState('');
  const announced = useRef({ cursor: game.cursor, plies: game.plies });
  useEffect(() => {
    const prev = announced.current;
    announced.current = { cursor: game.cursor, plies: game.plies };
    if (!announce || (prev.cursor === game.cursor && prev.plies === game.plies)) return;
    const h = history(game);
    const m = h[h.length - 1];
    setAnnouncement(m ? describeMove(m, t) : '');
  }, [game, announce, t]);

  /* ---- drawing ---- */

  const dragOver = drag?.over && drag.over !== drag.from && targets.has(drag.over) ? drag.over : null;
  const dialLabels = useMemo(
    () => ({
      title: t('board.promoteTo'),
      keys: t('board.dialKeys'),
      cancel: t('cancel'),
      q: pieceName('q', t),
      r: pieceName('r', t),
      b: pieceName('b', t),
      n: pieceName('n', t),
    }),
    [t],
  );

  const onCellFocus = useCallback((sq: Square) => setCursor(sq), [setCursor]);

  const rootStyle = { '--cell-size': cellSize } as CSSProperties;

  return (
    <div ref={rootRef} className={cn('relative w-fit select-none', className)} style={rootStyle} data-testid="chess-board">
      <div className="rounded-lg bg-foreground/10 p-1 shadow-lg">
        <div
          ref={gridRef}
          role="grid"
          aria-label={t('board.label')}
          aria-describedby={instructionsId}
          aria-readonly={!interactive || undefined}
          className={cn('flex flex-col overflow-hidden rounded-md', interactive && 'touch-none')}
          style={interactive ? { touchAction: 'none', WebkitTouchCallout: 'none' } as CSSProperties : undefined}
          {...input.gridHandlers}
          onContextMenu={interactive ? (e) => e.preventDefault() : undefined}
          // A press must not move DOM focus (no stray focus ring after a click); keyboard users Tab in.
          onMouseDown={interactive ? (e) => e.preventDefault() : undefined}
        >
          {rows.map((row, r) => (
            <div role="row" key={r} className="flex">
              {row.map((sq, c) => {
                const piece = pieces[sqIndex(sq)];
                const info = targets.get(sq);
                const shownTarget = info && !info.hidden && helpers ? (info.capture ? 'ring' : 'dot') : null;
                const isPremove = !!premove && (premove.from === sq || premove.to === sq);
                const isLast = !!last && (last.from === sq || last.to === sq);
                const isCheck = check === sq;
                const isHint = hintSet.has(sq);
                const isThreat = threatSet.has(sq);
                return (
                  <BoardSquare
                    key={sq}
                    square={sq}
                    piece={piece}
                    light={isLightSquare(sq)}
                    label={describeSquare(sq, piece, t, {
                      target: !!shownTarget,
                      capture: shownTarget === 'ring',
                      check: isCheck,
                      premove: isPremove,
                      lastMove: isLast,
                      hint: isHint,
                      threat: isThreat,
                    })}
                    focusable={sq === cursor}
                    selected={sq === selected}
                    lastMove={isLast}
                    target={shownTarget}
                    premove={isPremove}
                    check={isCheck}
                    threat={isThreat}
                    dropOver={sq === dragOver}
                    lifted={(!!drag && drag.from === sq) || (!!dial && dial.from === sq)}
                    rotated={seating === 'face' && piece?.color === farColor}
                    hintKey={isHint ? hintKey : 0}
                    blunderKey={sq === blunderSq ? blunderKey : 0}
                    fileLabel={helpers && r === 7 ? sq[0] : undefined}
                    rankLabel={helpers && c === 0 ? sq[1] : undefined}
                    onFocus={onCellFocus}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <span id={instructionsId} className="sr-only">
        {t('board.instructions')}
      </span>
      {announce && (
        <div aria-live="polite" aria-atomic className="sr-only" data-testid="board-live">
          {announcement}
        </div>
      )}

      {(typed || typedError) && (
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-1/2 z-chrome -translate-x-1/2 translate-y-1/2"
        >
          <div
            data-testid="board-typed"
            key={typedError ?? 'typing'}
            className={cn(
              'rounded-full border border-border bg-card px-3 py-0.5 font-mono text-sm shadow-lg',
              typedError && !typed && 'zhess-typed-error text-destructive line-through',
            )}
          >
            {typed || typedError}
            {typed && <span className="ml-0.5 inline-block w-px animate-pulse bg-foreground">&nbsp;</span>}
          </div>
        </div>
      )}

      {drag && !dial && <DragGhost drag={drag} getBox={getBox} rotated={seating === 'face' && drag.piece.color === farColor} />}

      {dial && (
          <PromotionDial
            x={dial.x}
            y={dial.y}
            color={dial.color}
            aim={dial.aim}
            zone={dial.zone}
            dx={dial.dx}
            dy={dial.dy}
            rotated={seating === 'face' && dial.color === farColor}
            labels={dialLabels}
            onChoose={input.chooseDial}
            onKeyDown={input.dialKeyDown}
            menuRef={menuRef}
          />
      )}
    </div>
  );
}

/** The dragged piece, following the pointer; lifted above a finger so it stays visible. */
function DragGhost({
  drag,
  getBox,
  rotated,
}: {
  drag: NonNullable<ReturnType<typeof useBoardInput>['drag']>;
  getBox: () => DOMRect | null;
  rotated: boolean;
}) {
  if (typeof document === 'undefined') return null;
  const box = getBox();
  const cell = box && box.width > 0 ? box.width / 8 : 48;
  const touch = drag.pointerType !== 'mouse';
  const size = touch ? cell * 1.25 : cell;
  const lift = touch ? cell * 0.8 * (rotated ? -1 : 1) : 0;
  return createPortal(
    <div
      aria-hidden
      data-testid="drag-ghost"
      className="pointer-events-none fixed z-overlay drop-shadow-lg"
      style={{ left: drag.x - size / 2, top: drag.y - size / 2 - lift, width: size, height: size }}
    >
      <PieceIcon type={drag.piece.type} color={drag.piece.color} className={cn('h-full w-full', rotated && 'rotate-180')} />
    </div>,
    document.body,
  );
}
