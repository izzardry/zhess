/**
 * Package 1C · Game chrome. Presentational components (props in, callbacks out) and helpers.
 * See each file for the full prop documentation.
 */
export { StatusBar, type StatusBarProps, type ToolbarMode, type HintControls } from './StatusBar';
export { ToolbarButton, type ToolbarButtonProps } from './ToolbarButton';
export { SeatingButton, type SeatingButtonProps } from './SeatingButton';
export { ShareMenu, type ShareMenuProps } from './ShareMenu';
export { InfoPill, type InfoPillProps, type InfoOpponent } from './InfoPill';
export { MoveList, type MoveListProps } from './MoveList';
export { PlayerStrip, type PlayerStripProps, type StripClock } from './PlayerStrip';
export { GameOverOverlay, PageTint, TINT_MS, type GameOverOverlayProps, type PageTintProps } from './GameOverOverlay';
export { ResignUndoToast, RESIGN_UNDO_MS, type ResignUndoToastProps } from './ResignUndoToast';
export { PieceGlyph, FigurineSan, PieceRenderProvider, type PieceGlyphProps, type FigurineSanProps } from './PieceGlyph';
export { PIECE_CHARS, type PieceRender } from './pieceContext';
export { useShare, type ShareApi, type ShareKind } from './useShare';
export { shareOrCopy, copyText, type ShareOutcome, type ShareNavigator } from './share';
export { endTexts, outcomeFor, tintClass, tintFor, winner, type EndTexts, type Outcome, type Tint } from './outcome';
export {
  figurineParts,
  formatPoints,
  groupCaptured,
  fullMoves,
  movePairs,
  plyNumber,
  stripPair,
  type FigurinePart,
  type MovePair,
} from './notation';
