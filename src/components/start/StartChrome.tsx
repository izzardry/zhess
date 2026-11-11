/**
 * Every fixed piece of the start screen in one component (DESIGN 4, 4.1). It overlays the stage
 * and never moves the board: the integrator renders the board inside `BoardPreview` (with the
 * `StartPill` as its overlay) and this component next to it.
 *
 *   StartHeader   wordmark, tagline, CodeSelector          (idle start screen)
 *   StartFooter   OpponentSelector, ColorPill, ClockPill,   (idle start screen)
 *                 footerExtra, ScrollChevron
 *   StickyHeader  small wordmark bar                        (scrolled past 50 px)
 *   BackToTop     FAB                                       (scrolled past 50 px)
 *   VersionStamp                                            (start screen)
 */
import type { ReactNode } from 'react';
import { flags } from '@/lib/flags';
import type { ColorChoice, Opponent, Rng, TimeControl } from '@/lib/types';
import { BackToTop } from './BackToTop';
import { ClockPill, type ClockPillAnchor } from './ClockPill';
import { CodeSelector, type CodeSource } from './CodeSelector';
import { ColorPill } from './ColorPill';
import { OpponentSelector } from './OpponentSelector';
import { ScrollChevron } from './ScrollChevron';
import { StartFooter } from './StartFooter';
import { VersionStamp } from './VersionStamp';
import { StartHeader, StickyHeader } from './Wordmark';

export interface StartChromeProps {
  /** The start screen is showing (also during the game → start transition). */
  visible: boolean;
  /** From `useScrolled()`: swaps the big header for the sticky one and shows back-to-top. */
  scrolled?: boolean;
  /** Mobile landscape layout (`innerWidth > innerHeight && min side < 768`). */
  landscape?: boolean;

  code: string;
  onCodeChange: (code: string, source: CodeSource) => void;
  /** Random source for new codes (tests). */
  rng?: Rng;

  opponent: Opponent;
  onOpponentChange: (value: Opponent) => void;
  color: ColorChoice;
  onColorChange: (value: ColorChoice) => void;
  clock: TimeControl;
  onClockChange: (value: TimeControl) => void;
  /** 500 ms hold on the clock pill (milestone 2's custom dial). */
  onClockLongPress?: (anchor: ClockPillAnchor) => void;

  /** RESUME / REVIEW: the selectors show the saved game's settings, dimmed and disabled. */
  settingsLocked?: boolean;
  /** Room joiner: the color pill is dimmed because the creator's choice applies. */
  colorLocked?: boolean;
  /** Blocks the code field during the start transition. */
  busy?: boolean;

  /** Show the bounce chevron (e.g. only when there is history below). Default true. */
  showChevron?: boolean;
  /** Extra footer content, e.g. the install pill. */
  footerExtra?: ReactNode;
  /** Called when the version stamp is tapped (after copying), e.g. the SW update check. */
  onVersionTap?: () => void;
}

export function StartChrome({
  visible,
  scrolled = false,
  landscape = false,
  code,
  onCodeChange,
  rng,
  opponent,
  onOpponentChange,
  color,
  onColorChange,
  clock,
  onClockChange,
  onClockLongPress,
  settingsLocked = false,
  colorLocked = false,
  busy = false,
  showChevron = true,
  footerExtra,
  onVersionTap,
}: StartChromeProps) {
  const idle = visible && !scrolled;
  // Pass-and-play has no "your color": both sides sit at this device.
  const colorDisabled = settingsLocked || colorLocked || opponent.mode === 'local';

  return (
    <>
      <StickyHeader visible={visible && scrolled} />
      <BackToTop visible={visible && scrolled} />

      <StartHeader visible={idle} landscape={landscape}>
        <CodeSelector code={code} onChange={onCodeChange} rng={rng} disabled={!idle || busy} landscape={landscape} />
      </StartHeader>

      <StartFooter
        visible={idle}
        landscape={landscape}
        selector={
          <OpponentSelector value={opponent} onChange={onOpponentChange} disabled={settingsLocked} landscape={landscape} />
        }
        pills={
          <>
            <ColorPill value={color} onChange={onColorChange} disabled={colorDisabled} />
            {flags.clock && (
              <ClockPill value={clock} onChange={onClockChange} onLongPress={onClockLongPress} disabled={settingsLocked} />
            )}
          </>
        }
        extra={footerExtra}
        chevron={showChevron ? <ScrollChevron hidden={!idle} /> : undefined}
      />

      <VersionStamp visible={visible} onTap={onVersionTap} />
    </>
  );
}
