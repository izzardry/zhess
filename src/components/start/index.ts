/** Start screen (package 1D). Presentational pieces plus the remembered-choice hooks. */
export { StartChrome, type StartChromeProps } from './StartChrome';
export { Wordmark, StartHeader, StickyHeader, type WordmarkProps, type StartHeaderProps, type StickyHeaderProps } from './Wordmark';
export { StartFooter, type StartFooterProps } from './StartFooter';
export { CodeSelector, type CodeSelectorProps, type CodeSource } from './CodeSelector';
export { OpponentSelector, type OpponentSelectorProps } from './OpponentSelector';
export { ColorPill, ColorGlyph, type ColorPillProps } from './ColorPill';
export { ClockPill, CLOCK_HOLD_MS, type ClockPillProps, type ClockPillAnchor } from './ClockPill';
export { StartPill, type StartPillProps } from './StartPill';
export { BoardPreview, type BoardPreviewProps } from './BoardPreview';
export { ScrollChevron, type ScrollChevronProps } from './ScrollChevron';
export { BackToTop, type BackToTopProps } from './BackToTop';
export { VersionStamp, APP_VERSION, type VersionStampProps } from './VersionStamp';
export { useOpponentText, useColorName, useClockText, copyText } from './text';
export { useScrolled, scrollOneViewport, scrollToTop, scrollBehavior, SCROLL_THRESHOLD } from './useScrolled';
export {
  useStartPrefs,
  readOpponent,
  readColor,
  readClock,
  writeClock,
  CLOCK_OFF,
  type StartPrefs,
} from './useStartPrefs';
export * from './options';
