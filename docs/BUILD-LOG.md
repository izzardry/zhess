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

- [ ] 2A · Engine
- [ ] 2B · Clock
- [ ] 2C · Assistance
- [ ] Integrator 2
- [ ] Gate 2

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

## Deviations

_(Where a design decision could not be built as stated: what was built instead, and why.)_

- Contract additions by 0b (PLAN section 4 extended, not changed): `Game.start`; extra `ZhessApi` helpers (replay, fromRecord, reopen, timeout, canMate, clockRunning, sanToUci, …); `Move` carries uci/color/piece/castle/enPassant; `GameLog` gains `white` and `tc` so a recovered device learns colors and time control; protocol `head` gains `ended` and `turnMs`, `ask`/`reply` gain `n`/`epoch`/`len`, `ack` gains `n`/`epoch`.

- 1B: New URL parameter `r` (result of a finished shared game, e.g. `1-0.resign`) beyond DESIGN 13.2; without it a game that ended by resignation, time or agreement could not open in review. Never written for rooms.
- 1B/1C: Seating lives in `useSeating` (1C), not in `useGameState`, to keep one writer of `zhess:seating`.
- 1E: The Buy Me a Coffee button is drawn locally instead of loading the CDN image (PLAN rule 9: no outside services). Same link as Zudoku.

## Open items

_(Features switched off in `src/lib/flags.ts`, tests marked `fixme`, and anything left for the owner.)_

- The GitHub Pages deploy workflow will fail on each push to `main` until the owner enables Pages (the run must not enable it).
- `npm install` reported 19 audit advisories (2 low, 14 moderate, 1 high, 2 critical) in dev/build dependencies; not addressed.
- M1 visual notes for the final visual pass: start-screen chrome overlaps the blurred preview board at 1280×800 and in mobile landscape; Tailwind drops `duration-[400ms]` (TutorialOverlay) and `duration-[250ms]` (ResignUndoToast) as ambiguous; phone version stamp is centered, not bottom right; game-over summary line wraps awkwardly at 390 px; far clock in the landscape rail is not rotated face-to-face.
- `og:image` / `twitter:image` are root-absolute (`/og-image.png`) until a deployed URL exists.
- Build warns that one JS chunk is 561 kB (> 500 kB).

## Gate results

_(Per gate: commands run, pass/fail counts, what was disabled.)_

**Gate 0** (2026-11-11 01:12): `lint` 0 problems · `typecheck` clean · `test` 7 files / 86 tests passed · `build` ok (engine not precached) · `e2e` 5/5 passed · `public/engine/` holds the engine js, wasm, Copying.txt, README. Passed, nothing disabled.

**Gate 1** (2026-11-11, round 1 of up to 4): `lint` 0 problems · `typecheck` clean · `test` 39 files / 507 tests passed · `build` ok (25 precache entries; 561 kB chunk warning) · `e2e` 23/23 passed (m1 × 2 viewports, screenshots, smoke). Verifier confirmed every Gate 1 scenario is implemented at both viewports with no skips and checked all 16 screenshots. Passed, nothing disabled.
