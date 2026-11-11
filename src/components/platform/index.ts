/** Package 1E · Platform: history, undo toasts, tutorial, donation, install, language, credits. */
export { GameHistory, type GameHistoryProps } from './GameHistory';
export { GameCard, THUMBNAIL_SIZE, type GameCardProps, type RenderThumbnail } from './GameCard';
export { DeleteUndoToasts, UNDO_TOAST_MS, type DeleteUndoToastsProps, type PendingDeletion } from './DeleteUndoToasts';
export { useUndoDeletions, type UndoDeletions } from './useUndoDeletions';
export { useSwipeToDelete, prefersReducedMotion } from './useSwipeToDelete';
export { TutorialOverlay, TUTORIAL_EXIT_MS, type TutorialOverlayProps } from './TutorialOverlay';
export { DonationPrompt, type DonationPromptProps } from './DonationPrompt';
export { SupportButton, SUPPORT_URL, type SupportButtonProps } from './SupportButton';
export { PWAInstallPrompt, type PWAInstallPromptProps } from './PWAInstallPrompt';
export { InstallButton, type InstallButtonProps } from './InstallButton';
export { LanguageSwitcher, type LanguageSwitcherProps } from './LanguageSwitcher';
export { EngineCredit, IzzardryFooter, ENGINE_SOURCE_URL, ENGINE_LICENCE_URL } from './Credits';
export { KnightGlyph, type KnightGlyphProps } from './KnightGlyph';
export {
  RECENT_GAMES,
  HISTORY_GROUPS,
  cardState,
  formatPoints,
  formatRelativeTime,
  formatRoomScore,
  groupByTime,
  groupOf,
  moveCount,
  plyCount,
  roomOf,
  sideToMove,
  sortByRecent,
  type CardState,
  type HistoryGroup,
} from './history';
