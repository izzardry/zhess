/**
 * The single stage (DESIGN 4, Ztyle 05): one route, one board that is always centered and never
 * moves. Start screen, game, hidden UI, review and overlays are states of this stage.
 *
 * | State          | Board                      | Chrome                                                |
 * |----------------|----------------------------|-------------------------------------------------------|
 * | start          | blurred preview            | StartChrome (header, footer, pill), language, version |
 * | start scrolled | blurred, scrolled away     | sticky header, history, back-to-top, support, credits |
 * | playing        | sharp, interactive         | Back, info pill, help, two strips, toolbar            |
 * | UI hidden      | sharp                      | board and the two clocks only (tap empty stage)       |
 * | review         | sharp, read-only           | as playing, toolbar with stepping controls            |
 * | overlay        | behind the scrim           | game-over overlay, tutorial, donation                 |
 *
 * Game state lives in `useGameState` (package 1B); this file only wires packages together:
 * the computer opponent (`useComputer`, `useEngineStart`), the clock and premoves (`useClock`,
 * `usePremove`), the hint bulb (`useHint`), the blunder guard (`useBlunderGuard`) and draw offers
 * to the computer (`askComputerDraw`) all share the one engine of `useZhessEngine`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { toast } from 'sonner';
import { BoardThumbnail, ChessBoard, PieceIcon } from '@/components/board';
import {
  GameOverOverlay,
  InfoPill,
  PageTint,
  TINT_MS,
  PieceRenderProvider,
  PlayerStrip,
  ResignUndoToast,
  StatusBar,
  outcomeFor,
  tintFor,
  useShare,
  type InfoOpponent,
  type PieceRender,
  type ToolbarMode,
} from '@/components/game';
import {
  DonationPrompt,
  EngineCredit,
  GameHistory,
  InstallButton,
  IzzardryFooter,
  LanguageSwitcher,
  PWAInstallPrompt,
  SupportButton,
  TutorialOverlay,
} from '@/components/platform';
import { BoardPreview, ClockDial, StartChrome, StartPill, useScrolled, type ClockPillAnchor } from '@/components/start';
import { useIsMobileLandscape } from '@/hooks/use-orientation';
import { useBlunderGuard } from '@/hooks/useBlunderGuard';
import { useClock, usePremove } from '@/hooks/useClock';
import { useComputer, useEngineStart } from '@/hooks/useComputer';
import { DONATION_DELAY_MS, useDonationPrompt } from '@/hooks/useDonationPrompt';
import { useGameState } from '@/hooks/useGameState';
import { useHelpers } from '@/hooks/useHelpers';
import { useHint } from '@/hooks/useHint';
import { useZhessEngine } from '@/hooks/useZhessEngine';
import { usePWAInstall } from '@/hooks/usePWAInstall';
import { useSavedGames } from '@/hooks/useSavedGames';
import { useSeating } from '@/hooks/useSeating';
import { useSWUpdate } from '@/hooks/useSWUpdate';
import { useTutorial } from '@/hooks/useTutorial';
import { askComputerDraw } from '@/lib/drawOffer';
import { flags } from '@/lib/flags';
import { DEFAULT_LEVEL, gameFromSaved, opponentOf } from '@/lib/gameRecord';
import { useI18n } from '@/lib/i18n';
import { bankTurn, bankedTurnMs } from '@/lib/turnBank';
import type { Color, Opponent, SavedGame, Square, TimeControl } from '@/lib/types';
import { appBaseUrl } from '@/lib/url';
import { cn } from '@/lib/utils';
import zhess, { attacked, formatTc, lastMove, material, parseTc } from '@/lib/zhess';
import {
  CELL_SIZE_LANDSCAPE,
  CELL_SIZE_PORTRAIT,
  PLAYABLE_MODES,
  SWIPE_MIN_PX,
  TRANSITION_MS,
  allSan,
  baseOrientation,
  canContinueFrom,
  other,
  pgnMeta,
  reviewClockView,
  totalTime,
} from './stage';

const renderPiece: PieceRender = (type, color, className) => <PieceIcon type={type} color={color} className={className} />;

const renderThumbnail = (g: SavedGame, size: number) => {
  const game = gameFromSaved(g);
  return <BoardThumbnail fen={game.fen} size={size} orientation={g.mode === 'local' ? 'w' : g.color} lastMove={lastMove(game)} />;
};

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

export default function Index() {
  const { t } = useI18n();
  const gs = useGameState();
  const saved = useSavedGames();
  const { helpers, toggleHelpers } = useHelpers();
  const { seating, toggleSeating } = useSeating();
  const landscape = useIsMobileLandscape();
  const { shareLink, copyPgn } = useShare();
  const { shouldShowPrompt, canInstall, install, dismiss: dismissInstall } = usePWAInstall();
  const { showTutorial, startTutorial, forceShowTutorial, completeTutorial } = useTutorial();
  const { showPrompt: showDonation, triggerPrompt: triggerDonation, dismissPrompt: dismissDonation } = useDonationPrompt();
  const engine = useZhessEngine();

  const { phase, session, view } = gs;
  const isStart = phase === 'start';
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const gsRef = useRef(gs);
  gsRef.current = gs;
  const { checkForUpdate } = useSWUpdate({ shouldAutoReload: () => phaseRef.current === 'start' });

  const scrolled = useScrolled(50, isStart);
  const [showUI, setShowUI] = useState(true);
  const [animating, setAnimating] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [threats, setThreats] = useState<readonly Square[] | null>(null);

  /* ---- start ⇄ game transition: the board stays put, only the blur and the chrome animate ---- */
  const animTimer = useRef<ReturnType<typeof setTimeout>>();
  const animate = useCallback(() => {
    setAnimating(true);
    clearTimeout(animTimer.current);
    animTimer.current = setTimeout(() => setAnimating(false), TRANSITION_MS);
  }, []);
  useEffect(() => () => clearTimeout(animTimer.current), []);

  // Entering a game from anywhere (Start, history card, overlay): show the chrome, unflip, top of page.
  const sessionId = session?.id ?? null;
  useEffect(() => {
    setShowUI(true);
    setFlipped(false);
    setThreats(null);
    if (sessionId && typeof window !== 'undefined' && window.scrollY !== 0) window.scrollTo({ top: 0, behavior: 'auto' });
  }, [sessionId]);

  /* ---- game over: overlay only when the game ends while it is being played ---- */
  const [overlay, setOverlay] = useState(false);
  const [endedHere, setEndedHere] = useState(false);
  const prevEnd = useRef<{ id: string | null; ended: boolean }>({ id: null, ended: false });
  const ended = !!session?.game.end;
  useEffect(() => {
    const prev = prevEnd.current;
    prevEnd.current = { id: sessionId, ended };
    if (sessionId !== prev.id) {
      setOverlay(false);
      setEndedHere(false);
      return;
    }
    if (ended && !prev.ended) {
      setOverlay(true);
      setEndedHere(true);
      // The one-time donation prompt follows the first win, 1.5 s after the overlay (DESIGN 8.4).
      const s = sessionRef.current;
      if (s?.game.end && outcomeFor(s.game.end, s.mode, s.color) === 'win') triggerDonation(TINT_MS + DONATION_DELAY_MS);
    } else if (!ended) {
      setOverlay(false);
      setEndedHere(false);
    }
  }, [sessionId, ended, triggerDonation]);

  /* ---- resign with a 5-second undo (DESIGN 8.3) ---- */
  const [resigned, setResigned] = useState<'you' | Color | null>(null);
  useEffect(() => {
    if (!ended) setResigned(null);
  }, [ended]);

  /* ---- the chess clock (DESIGN 11): performance.now() stamps, paused on Back / hidden tab ---- */
  const sessionGame = session?.game ?? null;
  const { timeout } = gs;
  // Time already spent on this turn before a reload or Back → Resume (lib/turnBank).
  const banked = useRef<{ id: string | null; ms: number }>({ id: null, ms: 0 });
  if (banked.current.id !== sessionId) {
    banked.current = { id: sessionId, ms: session && session.mode !== 'room' ? bankedTurnMs(session.id, session.game) : 0 };
  }
  const clock = useClock(sessionGame, session?.tc ?? null, {
    active: phase === 'playing',
    key: sessionId,
    onFlag: timeout,
    initialTurnMs: banked.current.ms,
  });
  const clockRef = useRef(clock);
  clockRef.current = clock;

  /** Keeps the running turn's time for a reload or a later resume. */
  const bankNow = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.mode === 'room' || s.game.end) return;
    bankTurn(s.id, s.game, clockRef.current.elapsed());
  }, []);
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') bankNow();
    };
    window.addEventListener('pagehide', bankNow);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', bankNow);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [bankNow]);

  /* ---- engine trouble: one calm toast (DESIGN 10.1) ---- */
  const engineFailed = useCallback(
    (retry?: () => void) => {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      toast(t(offline ? 'engine.failedOffline' : 'engine.failed'), {
        id: 'engine-failed',
        action: retry ? { label: t('engine.retry'), onClick: retry } : undefined,
      });
    },
    [t],
  );

  /* ---- the computer's turn (DESIGN 10) ---- */
  const mode = session?.mode ?? 'local';
  const computerRetry = useRef<() => void>(() => {});
  const computer = useComputer({
    engine,
    game: sessionGame,
    enabled: flags.computer && mode === 'computer' && phase === 'playing',
    computerColor: session ? other(session.color) : null,
    level: session?.level ?? DEFAULT_LEVEL,
    tc: session?.tc ?? null,
    onMove: (uci, ms) => void gsRef.current.move(uci, ms),
    onFail: () => engineFailed(() => computerRetry.current()),
    elapsed: clock.elapsed,
    sessionKey: sessionId,
  });
  computerRetry.current = computer.retry;

  /* ---- premove in timed games against the computer (DESIGN 6.3); it bypasses the guard ---- */
  const premove = usePremove(sessionGame, {
    player: session?.color ?? 'w',
    mode,
    tc: session?.tc ?? null,
    live: phase === 'playing',
    key: sessionId,
    onFire: (uci) => void gsRef.current.move(uci, clockRef.current.elapsed()),
  });

  /* ---- hint bulb (DESIGN 7.3) ---- */
  const hintEnabled =
    flags.hint && (mode === 'computer' || mode === 'local') && phase === 'playing' && gs.isPlayerTurn;
  const hint = useHint({
    engine,
    game: sessionGame,
    enabled: hintEnabled,
    onAssisted: gs.markAssisted,
    onFail: () => engineFailed(),
    sessionKey: sessionId,
  });

  /* ---- blunder guard: against the computer, helpers on (DESIGN 7.2) ---- */
  const guard = useBlunderGuard({
    engine,
    game: sessionGame,
    enabled: flags.blunderGuard && mode === 'computer' && helpers && phase === 'playing',
    playerColor: session?.color ?? null,
  });
  const guardRef = useRef(guard);
  guardRef.current = guard;

  /* ---- screen-reader notes of the assistance (hint squares, refused blunder) ---- */
  const [assistNote, setAssistNote] = useState('');
  const hintSquares = hint.squares;
  const hintStep = hint.step;
  useEffect(() => {
    if (!hintSquares?.[0]) return;
    setAssistNote(t(hintStep === 2 ? 'assist.hintTo' : 'assist.hintFrom', { square: hintSquares[0] }));
  }, [hintSquares, hintStep, t]);
  const liveFen = sessionGame?.fen;
  useEffect(() => setAssistNote(''), [liveFen]);

  /* ---- settings shown on the start screen (dimmed: the stored game's own) ---- */
  const pillSaved = gs.startPill.saved;
  const shownOpponent: Opponent = pillSaved ? opponentOf(pillSaved) : gs.opponent;
  const shownColor = pillSaved ? pillSaved.color : gs.colorChoice;
  const shownClock: TimeControl = parseTc(pillSaved ? pillSaved.tc : gs.tc);

  const comingSoon = useCallback(() => toast(t('comingSoon')), [t]);

  /* ---- actions ---- */
  const begin = useCallback(
    (run: () => boolean) => {
      animate();
      const ok = run();
      if (!ok) setAnimating(false);
      return ok;
    },
    [animate],
  );

  /* ---- Start: a computer game waits for the engine (spinner with progress, DESIGN 10.1) ---- */
  const engineStart = useEngineStart(engine, { onFail: () => engineFailed(() => void handleStartRef.current()) });
  const { cancel: cancelEngineStart } = engineStart;
  useEffect(() => {
    if (!isStart) cancelEngineStart();
  }, [isStart, cancelEngineStart]);

  const handleStart = useCallback(async () => {
    const pill = gs.startPill;
    const label = pill.label;
    if (label === 'start' && !PLAYABLE_MODES[gs.opponent.mode]) {
      comingSoon();
      return;
    }
    const target = pill.saved ? opponentOf(pill.saved) : gs.opponent;
    if (label !== 'review' && target.mode === 'computer') {
      if (!(await engineStart.prepare())) return;
      // The player went elsewhere meanwhile (a history card, a link).
      if (phaseRef.current !== 'start') return;
    }
    if (!begin(gsRef.current.start)) {
      comingSoon();
      return;
    }
    if (label === 'start') startTutorial();
  }, [gs.startPill, gs.opponent, engineStart, begin, comingSoon, startTutorial]);
  const handleStartRef = useRef(handleStart);
  handleStartRef.current = handleStart;

  const handleOpen = useCallback(
    (g: SavedGame) => {
      if (!begin(() => gs.open(g))) comingSoon();
    },
    [begin, gs, comingSoon],
  );

  const handleExit = useCallback(() => {
    animate();
    setResigned(null);
    // The clock pauses on Back and resumes with this turn's time on return (DESIGN 11).
    bankNow();
    gs.exit();
  }, [animate, gs, bankNow]);

  const handleNewGame = useCallback(() => {
    setOverlay(false);
    gs.newGame();
  }, [gs]);

  const handleResign = useCallback(() => {
    if (!session) return;
    const who: 'you' | Color = session.mode === 'local' ? session.game.turn : 'you';
    if (gs.resign()) setResigned(who);
  }, [gs, session]);

  const handleUndoResign = useCallback(() => {
    gs.reopen();
    setResigned(null);
  }, [gs]);

  const handleShare = useCallback(() => {
    const url = gs.shareUrl();
    if (session?.mode === 'room') return void shareLink(url, 'room');
    const end = session?.game.end;
    const won = !!end && session?.mode === 'computer' && outcomeFor(end, session.mode, session.color) === 'win';
    void shareLink(url, won ? 'win' : 'solo', session?.level);
  }, [gs, session, shareLink]);

  const handleCopyPgn = useCallback(() => {
    if (!session) return;
    void copyPgn(zhess.pgn(session.game, pgnMeta(session, appBaseUrl())));
  }, [session, copyPgn]);

  const handleContinue = useCallback(() => {
    if (!begin(gs.continueFromHere)) comingSoon();
  }, [begin, gs, comingSoon]);

  /** A move made on the board: through the blunder guard against the computer, else at once. */
  const handleMove = useCallback(
    (uci: string) => {
      const g = guardRef.current;
      if (!g.active) {
        gsRef.current.move(uci, clockRef.current.elapsed());
        return;
      }
      void g.check(uci).then((r) => {
        if (r.action === 'commit') gsRef.current.move(uci, clockRef.current.elapsed());
        else if (r.action === 'refuse') setAssistNote(t('assist.blunderRefused'));
      });
    },
    [t],
  );

  /* ---- draw offer to the computer: accepted past move 30 at ±0.3, else `Declined` (DESIGN 8.3) ---- */
  const drawAsked = useRef(false);
  const handleOfferDraw = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.mode !== 'computer' || s.game.end || drawAsked.current) return;
    drawAsked.current = true;
    const g = s.game;
    void askComputerDraw(engine, g).then((answer) => {
      drawAsked.current = false;
      const cur = sessionRef.current;
      if (!cur || cur.id !== s.id || cur.game.end) return;
      if (answer === 'accept' && cur.game === g) gsRef.current.finish({ result: '1/2-1/2', by: 'agreed' });
      else toast(t('assist.drawDeclined'));
    });
  }, [engine, t]);

  /* ---- custom time control: the clock pill's 500 ms hold opens the dial (DESIGN 4.1) ---- */
  const [dial, setDial] = useState<{ x: number; y: number; dragging: boolean } | null>(null);
  const openDial = useCallback((a: ClockPillAnchor) => setDial({ x: a.x, y: a.y, dragging: a.source === 'pointer' }), []);
  useEffect(() => {
    if (!isStart) setDial(null);
  }, [isStart]);

  /* ---- invite links (rooms come in milestone 3) ---- */
  const { invite, consumeInvite } = gs;
  useEffect(() => {
    if (!invite || PLAYABLE_MODES.room) return;
    consumeInvite();
    comingSoon();
  }, [invite, consumeInvite, comingSoon]);

  /* ---- keyboard: Z / Shift+Z undo and redo; ← / → step in review (DESIGN 6.1, 12.3) ---- */
  useEffect(() => {
    if (isStart) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const inGrid = e.target instanceof Element && !!e.target.closest('[role="grid"],[role="menu"],[role="dialog"]');
      const key = e.key;
      const gs = gsRef.current;
      if (key === 'z' || key === 'Z') {
        e.preventDefault();
        if (phase === 'review') gs.step(e.shiftKey ? 1 : -1);
        else if (e.shiftKey) gs.redo();
        else gs.undo();
      } else if (phase === 'review' && !inGrid && (key === 'ArrowLeft' || key === 'ArrowRight')) {
        e.preventDefault();
        gs.step(key === 'ArrowLeft' ? -1 : 1);
      } else if (phase === 'review' && !inGrid && (key === 'Home' || key === 'End')) {
        e.preventDefault();
        if (key === 'Home') gs.toStart();
        else gs.toEnd();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isStart, phase]);

  /* ---- review: a horizontal swipe on the board steps (DESIGN 12.3) ---- */
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const onSwipeDown = (e: PointerEvent<HTMLDivElement>) => {
    if (phase !== 'review') return;
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onSwipeUp = (e: PointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId || phase !== 'review') return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) gs.step(dx < 0 ? 1 : -1);
  };

  /* ---- tap on empty stage toggles the chrome (DESIGN 4) ---- */
  const onStageClick = (e: MouseEvent<HTMLDivElement>) => {
    if (isStart || e.target !== e.currentTarget) return;
    // "Tapping anywhere cancels it" (DESIGN 6.3): the first tap only drops a queued premove.
    if (premove.premove) {
      premove.cancel();
      return;
    }
    setShowUI((v) => !v);
  };

  /* ---- derived view ---- */
  const boardGame = isStart || !view ? gs.preview : view;
  const orientation: Color = session ? (flipped ? other(baseOrientation(session)) : baseOrientation(session)) : 'w';
  const farColor = other(orientation);
  const faceToFace = !!session && mode === 'local' && seating === 'face' && phase === 'playing';
  const interactive = phase === 'playing' && !!session && !session.game.end && mode !== 'room';
  const movable = mode === 'local' ? 'both' : (session?.color ?? 'none');
  const chromeVisible = !isStart && showUI;
  const toolbarMode: ToolbarMode = phase === 'review' ? 'review' : mode;
  const cellSize = landscape ? CELL_SIZE_LANDSCAPE : CELL_SIZE_PORTRAIT;

  const mat = useMemo(() => (view ? material(view) : null), [view]);
  const reviewFaces = useMemo(
    () => (phase === 'review' && view && session ? reviewClockView(view, session.tc) : null),
    [phase, view, session],
  );
  const faces = reviewFaces ?? clock;
  const sans = useMemo(() => (session ? allSan(session.game) : []), [session]);
  const strip = (color: Color, rotated: boolean, layout: 'row' | 'rail') =>
    session && view && mat ? (
      <PlayerStrip
        color={color}
        captured={mat.captured[color]}
        advantage={color === 'w' ? mat.diff : -mat.diff}
        clock={faces[color]}
        active={!view.end && view.turn === color}
        rotated={rotated}
        details={showUI}
        layout={layout}
      />
    ) : null;

  const infoOpponent: InfoOpponent =
    mode === 'computer' ? { kind: 'computer', level: session?.level ?? 5 } : mode === 'room' ? { kind: 'room', score: [0, 0] } : { kind: 'local' };
  const info = session ? (
    <InfoPill
      code={session.code}
      opponent={infoOpponent}
      moves={sans}
      cursor={view?.cursor ?? 0}
      onJump={gs.goto}
      visible={chromeVisible}
      landscape={landscape}
      placement={landscape ? 'inline' : 'fixed'}
    />
  ) : null;

  const peekColor: Color | null = session ? (mode === 'local' ? other(session.game.turn) : other(session.color)) : null;
  const hintControls =
    flags.hint && session && (mode === 'computer' || mode === 'local') && phase === 'playing'
      ? {
          // Tap: the engine's move (piece, then target). Hold 1 s: the threat peek (chess.js only).
          onHint: hint.tap,
          onPeekStart: () => view && peekColor && setThreats(attacked(view, peekColor)),
          onPeekEnd: () => setThreats(null),
          busy: hint.pending,
          disabled: !hintEnabled,
        }
      : undefined;
  const highlights = useMemo(
    () => ({ hint: hint.squares, threats: threats ?? undefined, blunder: guard.blunder, blunderKey: guard.blunderKey }),
    [hint.squares, threats, guard.blunder, guard.blunderKey],
  );

  const end = session?.game.end;
  const tint = end && endedHere && session ? tintFor(end, session.mode, session.color) : null;
  const canContinue = useMemo(
    () => phase === 'review' && !!view && mode !== 'room' && canContinueFrom(view),
    [phase, view, mode],
  );

  return (
    <PieceRenderProvider render={renderPiece}>
      <div className={cn('halftone-bg relative select-none', isStart ? 'min-h-[100dvh]' : 'h-[100dvh] overflow-hidden')}>
        <PageTint tint={tint} />

        {/* ---- the stage: board always centered ---- */}
        <main
          aria-label="Zhess"
          onClick={onStageClick}
          data-testid="stage"
          data-phase={phase}
          data-engine={engine.state}
          data-computer={computer.thinking ? 'thinking' : undefined}
          className={cn(
            'flex h-[100dvh] min-h-[320px] items-center justify-center',
            landscape
              ? 'px-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]'
              : 'px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]',
          )}
        >
          <BoardPreview
            blurred={isStart}
            animate={animating}
            overlay={
              <StartPill
                label={gs.startPill.label}
                onClick={() => void handleStart()}
                loading={engineStart.loading}
                progress={engineStart.progress}
                disabled={!isStart || animating}
              />
            }
            overlayVisible={isStart}
          >
            <div className="relative" onPointerDown={onSwipeDown} onPointerUp={onSwipeUp} onPointerCancel={() => (swipe.current = null)}>
              {!isStart && !landscape && <div className="absolute inset-x-0 bottom-full mb-1 px-1">{strip(farColor, faceToFace, 'row')}</div>}
              <ChessBoard
                game={boardGame}
                orientation={orientation}
                helpers={helpers}
                interactive={interactive}
                movable={movable}
                seating={faceToFace ? 'face' : 'side'}
                premove={premove.premove}
                onPremove={premove.onPremove}
                highlights={highlights}
                onMove={handleMove}
                announce={!isStart}
                cellSize={cellSize}
              />
              {!isStart && !landscape && <div className="absolute inset-x-0 top-full mt-1 px-1">{strip(orientation, false, 'row')}</div>}
            </div>
          </BoardPreview>
        </main>

        {/* ---- game chrome ---- */}
        {session && (
          <>
            {landscape ? (
              <div
                // Left rail (DESIGN 4): centered in the height below the Back button.
                className={cn(
                  'pointer-events-none fixed z-chrome left-[max(1rem,env(safe-area-inset-left))]',
                  'top-[calc(max(1.5rem,env(safe-area-inset-top))+3.25rem)] bottom-[max(1rem,env(safe-area-inset-bottom))]',
                  'flex flex-col items-center justify-center gap-3 [&>*]:pointer-events-auto',
                )}
              >
                {strip(farColor, false, 'rail')}
                <div
                  aria-hidden={chromeVisible ? undefined : true}
                  className={cn(
                    'transition-all duration-chrome ease-out',
                    chromeVisible ? 'opacity-100' : 'pointer-events-none -translate-x-8 opacity-0',
                  )}
                >
                  {info}
                </div>
                {strip(orientation, false, 'rail')}
              </div>
            ) : (
              info
            )}

            <StatusBar
              mode={toolbarMode}
              visible={chromeVisible}
              landscape={landscape}
              onBack={handleExit}
              onHelp={forceShowTutorial}
              onHelpHold={flags.donationPrompt ? () => triggerDonation() : undefined}
              canUndo={phase === 'review' ? gs.canStepBack : gs.canUndo}
              canRedo={phase === 'review' ? gs.canStepForward : gs.canRedo}
              onUndo={phase === 'review' ? () => gs.step(-1) : () => void gs.undo()}
              onRedo={phase === 'review' ? () => gs.step(1) : () => void gs.redo()}
              onUndoHold={gs.toStart}
              onRedoHold={gs.toEnd}
              hint={hintControls}
              helpers={helpers}
              onToggleHelpers={toggleHelpers}
              seating={mode === 'local' ? seating : undefined}
              onToggleSeating={mode === 'local' ? toggleSeating : undefined}
              onFlip={() => setFlipped((f) => !f)}
              onOfferDraw={mode === 'computer' ? handleOfferDraw : mode === 'room' ? comingSoon : undefined}
              onResign={handleResign}
              flagDisabled={!!end}
              onContinue={canContinue ? handleContinue : undefined}
              onShare={handleShare}
              onCopyPgn={handleCopyPgn}
            />
          </>
        )}

        {session && end && (
          <GameOverOverlay
            open={overlay && !resigned}
            end={end}
            mode={session.mode}
            myColor={session.color}
            code={session.code}
            level={session.level}
            plies={session.game.cursor}
            durationMs={totalTime(session.game)}
            onShare={handleShare}
            onCopyPgn={handleCopyPgn}
            onPrimary={handleNewGame}
            onDismiss={() => setOverlay(false)}
          />
        )}

        {session && (
          <ResignUndoToast
            open={!!resigned && !!end}
            who={resigned ?? 'you'}
            onUndo={handleUndoResign}
            onExpire={() => setResigned(null)}
          />
        )}

        {/* ---- start-screen chrome ---- */}
        <StartChrome
          visible={isStart}
          scrolled={scrolled}
          landscape={landscape}
          code={gs.code}
          onCodeChange={(code) => void gs.setCode(code)}
          opponent={shownOpponent}
          onOpponentChange={gs.setOpponent}
          color={shownColor}
          onColorChange={gs.setColorChoice}
          clock={shownClock}
          onClockChange={(tc) => gs.setTc(formatTc(tc))}
          onClockLongPress={openDial}
          settingsLocked={!!pillSaved}
          busy={animating}
          showChevron={saved.games.length > 0}
          footerExtra={canInstall ? <InstallButton onClick={() => void install()} /> : undefined}
          onVersionTap={() => void checkForUpdate()}
        />

        <div
          className={cn(
            'fixed z-chrome top-[max(1.5rem,env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))]',
            'transition-all duration-500 ease-out',
            isStart && !scrolled ? 'scale-100 opacity-100' : 'pointer-events-none scale-90 opacity-0',
          )}
          aria-hidden={isStart && !scrolled ? undefined : true}
        >
          <LanguageSwitcher />
        </div>

        {/* ---- below the fold: history, support, credits ---- */}
        {isStart && (
          <section aria-label={t('platform.history.title')} className="relative min-h-[60dvh] pb-[max(2rem,env(safe-area-inset-bottom))]">
            <GameHistory
              games={saved.games}
              onOpen={handleOpen}
              onDelete={(g) => void saved.remove(g.id)}
              onRestore={(g) => saved.restore(g)}
              renderThumbnail={renderThumbnail}
              isVisible={scrolled}
            />
            <div
              className={cn(
                'flex flex-col items-center gap-4 pt-10 transition-opacity duration-300',
                scrolled ? 'opacity-100' : 'pointer-events-none opacity-0',
              )}
            >
              <SupportButton size="lg" />
              <EngineCredit />
              <IzzardryFooter />
            </div>
          </section>
        )}

        {shouldShowPrompt && isStart && <PWAInstallPrompt onInstall={() => void install()} onDismiss={dismissInstall} />}

        {showTutorial && session && !isStart && (
          <TutorialOverlay onDismiss={completeTutorial} mode={session.mode} isLandscape={landscape} />
        )}

        {dial && isStart && (
          <ClockDial
            x={dial.x}
            y={dial.y}
            dragging={dial.dragging}
            value={shownClock}
            onPick={(tc) => {
              gs.setTc(tc);
              setDial(null);
            }}
            onCancel={() => setDial(null)}
          />
        )}

        {/* Screen-reader notes of the hint and the blunder guard (the guard shows no text, DESIGN 7.2). */}
        <div aria-live="polite" aria-atomic className="sr-only" data-testid="assist-live">
          {assistNote}
        </div>

        <DonationPrompt open={showDonation} onDismiss={dismissDonation} />
      </div>
    </PieceRenderProvider>
  );
}
