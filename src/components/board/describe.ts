/**
 * Words for the screen reader (DESIGN 14.1): grid-cell labels (`white knight, g1`) and move
 * descriptions for the live region (`Black: knight to f6, check`).
 */
import type { TranslationKey, TranslationVars } from '@/lib/i18n';
import type { Color, Move, Piece, PieceType, Square } from '@/lib/types';

/** The `t` of `useI18n()`. */
export type Translate = (key: TranslationKey, vars?: TranslationVars) => string;

const PIECE_KEYS: Record<Color, Record<PieceType, TranslationKey>> = {
  w: {
    k: 'board.piece.wk',
    q: 'board.piece.wq',
    r: 'board.piece.wr',
    b: 'board.piece.wb',
    n: 'board.piece.wn',
    p: 'board.piece.wp',
  },
  b: {
    k: 'board.piece.bk',
    q: 'board.piece.bq',
    r: 'board.piece.br',
    b: 'board.piece.bb',
    n: 'board.piece.bn',
    p: 'board.piece.bp',
  },
};

const NAME_KEYS: Record<PieceType, TranslationKey> = {
  k: 'board.name.k',
  q: 'board.name.q',
  r: 'board.name.r',
  b: 'board.name.b',
  n: 'board.name.n',
  p: 'board.name.p',
};

const SIDE_KEYS: Record<Color, TranslationKey> = { w: 'board.side.w', b: 'board.side.b' };

/** `white knight` */
export function pieceLabel(piece: Piece, t: Translate): string {
  return t(PIECE_KEYS[piece.color][piece.type]);
}

/** `knight` */
export function pieceName(type: PieceType, t: Translate): string {
  return t(NAME_KEYS[type]);
}

/** `White` / `Black` as the subject of a move. */
export function sideName(color: Color, t: Translate): string {
  return t(SIDE_KEYS[color]);
}

/** Extra words appended to a cell label. */
export interface CellStates {
  readonly target?: boolean;
  readonly capture?: boolean;
  readonly check?: boolean;
  readonly premove?: boolean;
  readonly lastMove?: boolean;
  readonly hint?: boolean;
  readonly threat?: boolean;
}

/** Grid-cell label: `white knight, g1`, or `g1` when empty, plus states (`e4, possible move`). */
export function describeSquare(sq: Square, piece: Piece | null, t: Translate, states: CellStates = {}): string {
  const parts = [piece ? t('board.cell', { piece: pieceLabel(piece, t), square: sq }) : sq];
  if (states.check) parts.push(t('board.state.check'));
  if (states.capture) parts.push(t('board.state.capture'));
  else if (states.target) parts.push(t('board.state.target'));
  if (states.premove) parts.push(t('board.state.premove'));
  if (states.lastMove) parts.push(t('board.state.lastMove'));
  if (states.hint) parts.push(t('board.state.hint'));
  if (states.threat) parts.push(t('board.state.threat'));
  return parts.join(', ');
}

/**
 * A move in words for the live region: `Black: knight to f6, check`,
 * `White: bishop takes knight on f6`, `White: castles kingside`,
 * `White: pawn to e8, promotes to queen, checkmate`.
 * Check and mate are read from the SAN suffix.
 */
export function describeMove(move: Move, t: Translate): string {
  const side = sideName(move.color, t);
  const parts: string[] = [];
  if (move.castle) {
    parts.push(t(move.castle === 'k' ? 'board.say.castleK' : 'board.say.castleQ', { side }));
  } else if (move.captured) {
    parts.push(
      t('board.say.capture', {
        side,
        piece: pieceName(move.piece, t),
        captured: pieceName(move.captured, t),
        square: move.to,
      }),
    );
  } else {
    parts.push(t('board.say.move', { side, piece: pieceName(move.piece, t), square: move.to }));
  }
  if (move.enPassant) parts.push(t('board.say.enPassant'));
  if (move.promotion) parts.push(t('board.say.promote', { piece: pieceName(move.promotion, t) }));
  if (move.san.endsWith('#')) parts.push(t('board.say.mate'));
  else if (move.san.endsWith('+')) parts.push(t('board.say.check'));
  return parts.join(', ');
}
