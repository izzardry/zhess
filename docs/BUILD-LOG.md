# Zhess build log

The run's memory (PLAN.md section 1, rule 5). Updated after every package and every gate.

## Summary

_(Written at the end of the run.)_

## Package checklist

### Phase 0 · Foundation

- [x] 0a · Scaffold
- [x] 0b · Core library and contracts
- [x] Gate 0

### Milestone 1 · Board

- [x] 1A · Board
- [x] 1B · Game state
- [x] 1C · Game chrome
- [x] 1D · Start screen
- [x] 1E · Platform
- [x] Integrator 1
- [x] Gate 1

### Milestone 2 · Computer

- [x] 2A · Engine
- [x] 2B · Clock
- [x] 2C · Assistance
- [x] Integrator 2
- [x] Gate 2

### Milestone 3 · Rooms

- [ ] 3A · Sync
- [ ] 3B · Transports
- [ ] 3C · Room
- [ ] 3D · Room UI
- [ ] Integrator 3
- [ ] Gate 3

### Final phase · Audit and polish

- [ ] 1 · Design audit
- [ ] 2 · Ztyle audit
- [ ] 3 · Code review
- [ ] 4 · Visual pass
- [ ] 5 · Fix confirmed findings, re-run all e2e suites and the full gate
- [ ] 6 · Docs
- [ ] 7 · Commit and push

## Decisions

_(One line each: where the design was silent, what was chosen and why.)_

**Phase 0**
- 0a: `strict: true` TypeScript (Zudoku uses false) for null safety in chess/sync code.
- 0a: Added `@radix-ui/react-dialog` and `@testing-library/user-event` up front to avoid mid-run installs.
- 0a: Manifest icon paths are relative (no leading slash) so they work on a GitHub Pages project site under `base: "./"`.
- 0a: Fira Code self-hosted, Latin + Latin Extended subsets, weights 300–700, woff2 only in the precache.
- 0a: Engine runtime cache rule `engine-cache`, CacheFirst, 1 year.
- 0a: Playwright `reuseExistingServer: false`: every e2e run builds fresh; two e2e runs cannot overlap.
- 0b: Each side's first move is untimed in every mode (DESIGN 9.8 generalized), so solo and room clocks agree.
- 0b: Move codec square index a1 = 0 … h8 = 63 over the base64url alphabet; `e2e4` encodes as `Mc`.
- 0b: Flag fall against a side that cannot mate is recorded as 1/2-1/2 with `by: 'time'`; `canMate` is a helpmate-aware approximation.
- 0b: Undo/redo drop resign, time and agreed endings and re-detect automatic ones; review `goto` keeps the ending.
- 0b: History is ordered by `lastPlayedAt` so the 15-second rule works.
- 0b: i18n entry is `src/lib/i18n/index.ts` re-exporting `provider.tsx`; per-package tables are registered in `src/lib/i18n/tables.ts` (one import line per package, the single shared edit point).
- 0b: Translations follow Ztyle chapter 14: German du, French vous, Spanish tú.
- Gate 0: Node 26 hides jsdom's `localStorage` under Vitest; `src/test/setup.ts` restores it (or installs an in-memory Storage).

**Milestone 1**
- 1A: Promotion dial release in the aim zone commits (promotion has no secondary action); centre or dead ring cancels.
- 1A: On touch the drop target is the square under the finger, not under the lifted ghost; a drop ring marks it.
- 1A: Capture targets are inscribed rings (radial gradient, foreground/25) to stay distinct from selection/premove rings.
- 1A: Premove targets ignore blockers (Lichess style); legality is checked when the premove fires. A tap with a premove queued only cancels it.
- 1A: Typed SAN uses English letters in all languages; the window-level typing listener is active whenever the board is interactive.
- 1A: Keyboard underpromotion: Shift+Enter/Space on the target opens the dial; arrows aim Q/R/B/N.
- 1A: In dark theme the "dark" squares (card + foreground/10) render lighter than the "light" ones; this follows DESIGN 5.1 literally and was kept.
- 1B: A shared solo link without `o` opens as pass-and-play; times are not carried (ms = 0). A link with the same moves as the stored game resumes it; otherwise a new game is created (fresh code if the code is taken).
- 1B: "Continue from here" copies the plies up to the shown position into a new game; mode = last solo opponent (falls back to Computer 5 if the remembered one is Room); against the computer the player takes the side to move.
- 1B: Undo vs computer goes back to the latest position where the player is to move; undo marks a game assisted in pass-and-play too (DESIGN 7.3 "any undo").
- 1B: Only plies up to the cursor are saved and written to `m`; the redo tail is session-only.
- 1B: A move-list jump in a live game enters review; stepping back to the live position leaves it.
- 1C: The info pill uses Ztyle eyebrow-over-value cells (Level/5, Players/2, Score/2 – 1½, Move/12. Nf3 e5).
- 1C: Toolbar order: undo, redo | hint, helpers, seating/flip | flag, share; toolbar button size adapts to width (34–44 px).
- 1C: Game-over overlay adds a reason line under the title where the title does not say it; Share in the overlay also offers Copy PGN.
- 1C: Share sheet cancel (AbortError) copies nothing (fixes Zudoku's fallback-on-cancel).
- 1D: The opponent stepper shows an overline (Two devices / One device / Computer · Level 5) over the value (Room / Two players / Medium).
- 1D: Code field shows code + pencil only (DESIGN 4.1 mock); rolling never repeats the shown code. Fixed Zudoku's check-button blur/reopen bug.
- 1D: The color pill is disabled (dimmed, in place) in pass-and-play.
- 1D: Keyboard path for the clock pill's hold: Shift+Enter, Shift+F10 or the ContextMenu key.
- 1E: App icon uses the knight from the board's piece set on a #0d0d0d tile with a faint 8×8 grid; OG image per Ztyle 01 with feature line `12 computer levels | rooms for two | zero ads`. Generated by `node scripts/generate-brand-images.mjs` via Playwright's Chromium.
- 1E: Relative times use `Intl.RelativeTimeFormat`; history thumbnails are 96 px (Ztyle says 120) to fit 320 px phones.
- 1E: Card states: Your move / Their move (computer, room), White/Black to move (pass-and-play), 1–0/0–1/Draw, Won in success green, Lost muted.
- 1E: useSWUpdate never auto-reloads mid-game; it shows the Reload toast instead.
- 1E: The tutorial has six bubbles (DESIGN 14.2 list plus Ztyle's back and code bubbles); pointer devices are taught SAN typing.
- Integrator 1: Board cell size gains an extra bound (portrait: (100vh − 20rem)/8; mobile landscape: (100vh − 3rem)/8) so chrome never overlaps the board; it is the same size in every state.
- Integrator 1: Resign's game-over overlay waits until the 5 s undo toast is gone; the overlay and tint appear only when a game ends in this session (opening a finished game goes straight to review).
- Integrator 1: Keyboard: Z / Shift+Z undo/redo (step in review), ←/→/Home/End step in review; horizontal swipe on the review board steps.
- Integrator 1: The tutorial starts only for a brand-new game started with the Start pill; `?` always shows it.
- Integrator 1: Below the fold: history, support button, engine credit, izzardry footer. The language switcher shows on the idle start screen only.

**Milestone 2**
- 2A: The shipped engine file is the Web Worker itself (`new URL('engine/stockfish-19-lite-single.js', document.baseURI)`); it finds its .wasm beside it. Load progress comes from the engine's own progress port (download 0–0.9, 0.95 after uciok, 1 at readyok).
- 2A: stop() cancels the running and queued searches; evaluate never rejects (null on failure, timeout or stop) and its timeout counts from the call, so queue wait and loading count against the blunder guard's 150 ms. A failed engine retries on the next call; init timeout 30 s since the last sign of life.
- 2A: Analysis (evaluate, multiPv, humanized levels) always runs at Skill Level 20. Humanized picker: uniform choice within the budget of the best remaining line; level 1's hanging-queen rule is a 50 % coin flip. From level 3, never walk into mate in 1 (checked with chess.js; levels 5–11 re-search at full strength if needed).
- 2A: Engine time in timed games: at most remaining/20 + increment/2, at least 50 ms; level 12 uses max(3 s, remaining/30) under that cap.
- 2B: The clock dial has 9 minute values (1, 2, 3, 5, 10, 15, 20, 30, 60) and 9 increments (0, 1, 2, 3, 5, 10, 15, 20, 30), Ztyle 08's maximum for a 60 px radial dial. Minutes first, then increment in the same dial, with a caption chip.
- 2B: Clocks are derived from the log plus a performance.now() turn timer (no tick accumulation); redraw every 100 ms with a clock, 250 ms without. A game lost on time shows 0.0 on the flagged side.
- 2B: A premove fires only if exactly one opponent ply was added since it was queued; otherwise it is dropped silently. Promotion defaults to a queen. Room mode: the opponent's flag is claimed only after their clock has read zero for 2 s.
- 2C: Blunder guard: scores clamped to ±1000 cp before the 300 cp test; both positions at depth 8; engine not ready → chess.js fallback (hanging-piece rule, ≥ 3 pawns worse than the best alternative; mate in 1 only if avoidable); engine late → move goes through. The guard never calls engine.stop().
- 2C: Hint uses a full-strength multiPv(fen, 1, 12), independent of the level; taps after the second alternate from-square / target. Only the first hint in a position marks the game assisted.
- 2C: Computer draw offer: considered only after 30 full moves; depth 12, 3 s timeout; no answer declines.
- 2C: An illegal engine answer is replaced by a legal move so the game never stalls.
- Integrator 2: The running turn's spent time is kept in sessionStorage `zhess:turn` (pagehide, hidden tab, Back) and restored on reload for the same game and position; time between pagehide and reload does not count (solo clocks pause when hidden).
- Integrator 2: Start/Resume of a computer game waits on the Start pill (spinner with progress); a history card does not wait. Engine failure shows one calm toast (fixed id) with Try again.
- Integrator 2: Hint bulb disabled while the computer is to move. Donation prompt fires 1.5 s after the win overlay appears. A tap on the stage with a premove queued only cancels the premove.
- Integrator 2: No visible "computer thinking" indicator (the design names none); exposed as `data-computer` on the stage for tests.
- Gate 2 fix: The win/loss tint stays a `-z-10` fixed layer; the stage root became a stacking context (`isolate`) so the body background no longer hides it. The clock dial clamp moved to `components/start/dialPlacement.ts` and reserves the caption, a popped item and the bottom safe area. The game-over duration adds the flagged side's remaining time for games lost on time (derived from the log and time control; no new stored field).

## Deviations

_(Where a design decision could not be built as stated: what was built instead, and why.)_

- Contract additions by 0b (PLAN section 4 extended, not changed): `Game.start`; extra `ZhessApi` helpers (replay, fromRecord, reopen, timeout, canMate, clockRunning, sanToUci, …); `Move` carries uci/color/piece/castle/enPassant; `GameLog` gains `white` and `tc` so a recovered device learns colors and time control; protocol `head` gains `ended` and `turnMs`, `ask`/`reply` gain `n`/`epoch`/`len`, `ack` gains `n`/`epoch`.

- 1B: New URL parameter `r` (result of a finished shared game, e.g. `1-0.resign`) beyond DESIGN 13.2; without it a game that ended by resignation, time or agreement could not open in review. Never written for rooms.
- 1B/1C: Seating lives in `useSeating` (1C), not in `useGameState`, to keep one writer of `zhess:seating`.
- 1E: The Buy Me a Coffee button is drawn locally instead of loading the CDN image (PLAN rule 9: no outside services). Same link as Zudoku.
- 2A: The engine smoke test loads `public/engine/stockfish-19-lite-single.js` (byte-identical to the npm package's copy) instead of a pack cached in node_modules/.cache. No `src/workers/engine.worker.ts`: the engine file is the worker (the plan allows this).
- 2B: The dial cannot pick 45 or 90 minutes (9-item limit); URLs may still carry them. `usePremove` lives in `src/hooks/useClock.ts`.
- 2C: The threat peek was already built in milestone 1; 2C added only a `threatSquares` helper. The guard runs against the real engine in an extra test, `src/lib/blunder.engine.test.ts`.
- Integrator 2: The board does not show the dropped move during the blunder check (≤ 150 ms; about 10 ms with a warm engine), to avoid double or wrong screen-reader announcements. A small fix in useGameState outside the milestone's scope: the saved-games listener re-reads the store on subscribe (Start instead of Resume after Back from a linked game).
- Integrator 2: Contract additions: `ClockPillAnchor.source`, `StripClock.ms` (rendered as `data-ms`); `stripClock` was replaced by `reviewClockView` in stage.ts.

## Open items

_(Features switched off in `src/lib/flags.ts`, tests marked `fixme`, and anything left for the owner.)_

- The GitHub Pages deploy workflow will fail on each push to `main` until the owner enables Pages (the run must not enable it).
- `npm install` reported 19 audit advisories (2 low, 14 moderate, 1 high, 2 critical) in dev/build dependencies; not addressed.
- M1 visual notes for the final visual pass: start-screen chrome overlaps the blurred preview board at 1280×800 and in mobile landscape; Tailwind drops `duration-[400ms]` (TutorialOverlay) and `duration-[250ms]` (ResignUndoToast) as ambiguous; phone version stamp is centered, not bottom right; game-over summary line wraps awkwardly at 390 px; far clock in the landscape rail is not rotated face-to-face.
- `og:image` / `twitter:image` are root-absolute (`/og-image.png`) until a deployed URL exists.
- Build warns that one JS chunk is 561 kB (> 500 kB).
- Level feel (DESIGN 17 risk 6) and blunder-guard latency on low-end phones (risk 5) are not play-tested; in Node the guard's depth-8 check takes 6–11 ms cold, ~1 ms warm.
- Minor duplication left: DEFAULT_LEVEL in lib/levels.ts, lib/gameRecord.ts and components/start/options.ts; useComputer's toTc vs lib/clock.ts toTimeControl; useGameState's own Date.now turn timer is now unused by the page.
- On phones the sonner toast covers the toolbar for its ~4 s lifetime (inherited Zudoku placement); for the final visual pass.
- The custom clock dial floats over the opponent selector and its caption half-covers the clock pill's label while open (cosmetic; for the final visual pass).

## Gate results

_(Per gate: commands run, pass/fail counts, what was disabled.)_

**Gate 0** (2026-11-11 01:12): `lint` 0 problems · `typecheck` clean · `test` 7 files / 86 tests passed · `build` ok (engine not precached) · `e2e` 5/5 passed · `public/engine/` holds the engine js, wasm, Copying.txt, README. Passed, nothing disabled.

**Gate 1** (2026-11-11, round 1 of up to 4): `lint` 0 problems · `typecheck` clean · `test` 39 files / 507 tests passed · `build` ok (25 precache entries; 561 kB chunk warning) · `e2e` 23/23 passed (m1 × 2 viewports, screenshots, smoke). Verifier confirmed every Gate 1 scenario is implemented at both viewports with no skips and checked all 16 screenshots. Passed, nothing disabled.

**Gate 2** (2026-11-11, passed in round 2 of up to 4). Round 1 failed on three findings: the win/loss page tint was hidden behind the body background, the clock-dial caption was clipped at 390×844, and the game-over duration left out the turn on which the flag fell. The machine crashed during fix round 1; the workflow was resumed from its cache. Fix 514984b. Round 2: `lint` 0 problems · `typecheck` clean · `test` 58 files / 769 tests passed (the real-engine suites ran, not skipped) · `build` ok (25 precache entries; engine runtime-cached by CacheFirst `engine-cache`, not precached) · `e2e` 32/32 (smoke 5, m1 14, m2 9; no skips or retries) · `node scripts/selfplay.mjs` level 12 beat level 1. Screenshots in docs/screenshots/m2/ (`r2-*` are after the fix). Passed, nothing disabled.
