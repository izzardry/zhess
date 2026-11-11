/**
 * Board package (1A). Import from `@/components/board`.
 */
export { ChessBoard } from './ChessBoard';
export { BoardSquare, type BoardSquareProps } from './Square';
export { BoardThumbnail, type BoardThumbnailProps } from './BoardThumbnail';
export { PieceIcon, type PieceIconProps } from './PieceIcon';
export { PromotionDial, type PromotionDialProps } from './PromotionDial';
export {
  dialPick,
  clampDialCenter,
  DIAL_PIECES,
  DIAL_HOLD_MS,
  DIAL_RADIUS,
  DIAL_POP_RADIUS,
  DIAL_REACH,
  type DialPick,
  type DialZone,
} from './dial';
export {
  PIECE_SHAPES,
  PIECE_STROKE,
  pieceSvgMarkup,
  piecePaint,
  partStyle,
  strokeForSize,
  type PiecePart,
  type PiecePaint,
} from './pieceShapes';
export {
  describeMove,
  describeSquare,
  pieceLabel,
  pieceName,
  sideName,
  type CellStates,
  type Translate,
} from './describe';
export {
  DEFAULT_CELL_SIZE,
  cellToSquare,
  drawOrder,
  isLightSquare,
  isPromotionRank,
  parseFenBoard,
  premoveTargets,
  premoveUci,
  squareAt,
  squareCenter,
  squareToCell,
  stepSquare,
  type Box,
} from './geometry';
export type { BoardHighlights, ChessBoardProps, Movable, Premove } from './types';
