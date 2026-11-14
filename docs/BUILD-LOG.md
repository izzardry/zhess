# Zhess build log

The run's memory (PLAN.md section 1, rule 5). Updated after every package and every gate.

## Summary

The overnight run of 2026-11-11 is complete. All three milestones and the final audit passed their gates, and **nothing is switched off by flag**. `main` is pushed to izzardry/zhess.

**What works, per milestone**
- **Milestone 1 · Board (Gate 1 passed, round 1):** pass-and-play on one device. Tap, drag, keyboard and typed SAN input; promotion dial; face-to-face or side-by-side seating; helpers; undo/redo; review with step, flip and "continue from here"; resign with a 5 s undo; game-over overlay with tint; history (finished and unfinished, swipe to delete with undo); share by link and PGN; start screen with code, opponent stepper, color and clock pills; tutorial; four languages; installable offline PWA.
- **Milestone 2 · Computer (Gate 2 passed, round 2):** Stockfish 19 lite (single-threaded WASM, loaded lazily from `public/engine`, runtime-cached, works offline after the first load). 12 levels, humanized 1–4. Clock with presets and a custom radial dial, Fischer increment, pause on Back or a hidden tab. Premove; two-tap hint and 1 s threat peek; blunder guard (refuse once, confirm within 5 s); draw offers to the computer; assisted marker. `node scripts/selfplay.mjs`: level 12 beats level 1.
- **Milestone 3 · Rooms (Gate 3 passed, round 2):** serverless rooms for two. Start with ROOM creates or joins the code through the public PeerJS broker (STUN only), with a manual link/QR fallback. Covered: seat key with HMAC challenge and the "rejoin" Allow toast; reconcile by longest valid log with epochs; recovery when one device lost its storage; offline moves in untimed rooms; clocks paused while disconnected; takeback, draw and rematch requests with colour swap and score; presence; the same room in two tabs. e2e passes for the manual path, recovery, offline move and BroadcastChannel hand-over, **and the public-broker path was verified** in every gate run.
- **Final phase (passed, round 1):** design audit (5 section groups in 3 agents), Ztyle launch-checklist audit, `/code-review high` and a visual pass at 5 sizes × light/dark. 31 confirmed findings were fixed, with tests. README rewritten.

**Gate results:** Gate 0: 86 tests, e2e 5/5. Gate 1: 507 tests, e2e 23/23. Gate 2: 769 tests, e2e 32/32. Gate 3: 1410 tests, e2e 37/37. Final: lint and typecheck clean, 71 files / 1449 tests, build ok, e2e 38/38 (smoke 5, m1 18, m2 10, m3 5), nothing skipped. Details under "Gate results".

**Failures along the way, stated plainly:** Gate 2 round 1 failed on three visual and timing bugs: the win/loss tint was hidden, the dial caption was clipped, and the duration left out the flagged turn. Gate 3 round 1 failed on three toast layout bugs. All were fixed in one round each. The machine crashed during the Gate 2 fix round; the workflow was resumed from its cache with no lost work.

**Flagged off:** nothing.

**Not verified (needs you):** two real phones on different networks (without TURN, some NAT pairs will not connect); the iOS installed-PWA path with the manual fallback, and Safari/Firefox in general (e2e is Chromium only); how levels 1–12 feel in play; blunder-guard latency on a low-end phone. The PeerJS broker path **was** verified (Chromium, one machine).

**For you to decide or do:** review the 19 npm audit advisories; optionally split the 748 kB main chunk. PLAN.md and PROMPT.md stay uncommitted (excluded via .git/info/exclude), as asked.

**Decisions and deviations:** every one is listed below under "Decisions" and "Deviations", grouped by phase. The most visible are:
- Strict TypeScript.
- The engine file runs directly as the Web Worker.
- The clock dial has 9 values per ring (no 45 or 90 minutes).
- A new `r` URL parameter carries a finished shared game's result.
- The seat proof also signs the code and seat.
- A device without a key always sends `join`.
- The second tab can "Use here".
- There is no outgoing-request toast; pending state shows on the button.
- 44 px toolbar buttons always.
- The Buy Me a Coffee button is drawn locally (no CDN).

**Commands**
```
npm install
npm run dev          # Vite dev server
npm run build        # production build into dist/
npm run preview      # serve dist/ (port 4173)
npm run lint
npm run typecheck
npm test             # Vitest unit tests (71 files, 1449 tests)
npm run e2e          # Playwright: smoke, m1, m2, m3 (builds and previews itself; rewrites docs/screenshots/m1)
node scripts/selfplay.mjs                                   # level 12 vs level 1 with the real engine
node scripts/screenshots.mjs http://localhost:4173/ <outdir> # 10 screens x 5 sizes x light/dark (needs a running preview)
```

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

- [x] 3A · Sync
- [x] 3B · Transports
- [x] 3C · Room
- [x] 3D · Room UI
- [x] Integrator 3
- [x] Gate 3

### Final phase · Audit and polish

- [x] 1 · Design audit
- [x] 2 · Ztyle audit
- [x] 3 · Code review
- [x] 4 · Visual pass
- [x] 5 · Fix confirmed findings, re-run all e2e suites and the full gate
- [x] 6 · Docs
- [x] 7 · Commit and push

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

**Milestone 3**
- 3A: Reconcile (DESIGN 9.4) converges in at most 6 messages. A finished copy beats a longer unfinished copy that continues it (an offline resignation crossing an offline move). Plies compare by move and ms, and a different `white`/`tc` for the same game number counts as a fork. Only the `logs` step reports a fork, so each device shows the restored toast exactly once.
- 3A: The `head.hash` is a synchronous 64-bit non-cryptographic hash (cyrb53 style) over n, epoch, white, tc and each ply's move and ms, plus `.result.by` when the game is over. Its value is pinned in a test. Adopted logs are replayed through ZhessApi and stored in normalized form.
- 3A: The seat proof is HMAC-SHA-256(key, nonce ‖ code ‖ prover seat byte); verifySeat compares in constant time and never rejects.
- 3B: PeerJS: the anchor is `zhess-<CODE>`; dialers register `zhess-<CODE>-<random>`. ICE servers are STUN only (two Google, one Cloudflare), overriding PeerJS's default config, which includes TURN. Failure classes: broker-unreachable (socket/server error or 10 s timeout), id-taken, ice-failed, peer-gone (after 3 claim/dial flips). The anchor accepts the newest connection. The `online` event resets the backoff; focus and visibility cut the wait short. peerjs is loaded by dynamic import.
- 3B: The manual offer is reduced to a compact versioned line (UDP component-1 candidates, at most 10, no related addresses), deflate-raw and base64url. Real links are 155–230 characters (QR version 9–11, error correction M). An answer carries the offer's ufrag, so stale answers are rejected. Non-trickle gathering is capped at 5 s; the host gives up 20 s after applying the answer.
- 3B: BroadcastChannel hand-over on `zhess:manual:<CODE>`; the answer tab gets a "took" reply or falls back after 1.5 s.
- 3C: Start with ROOM stores an open room at once, so the creator sees it in history and can close the app after sharing. An invite link only joins. If neither device holds the room, the anchor creates it. The room locks when the joiner's first `head` proves it received the key.
- 3C: Requests are tied to (n, epoch, len) and lapse when the game changes. Only one outgoing request at a time; it is asked again after a reconnect if still valid. Crossing draw offers or rematch requests count as agreement; crossing takebacks do not. Takeback, draw and rematch need a live connection; resignation works offline and arrives through reconcile.
- 3C: While disconnected, the opponent's turn pauses. In timed games the own turn pauses too and the board locks (also while the creator waits for a joiner in a timed room). In untimed games the own turn keeps counting and offline moves are allowed. `grant` and `logs` messages are split below 200 000 bytes.
- 3D: Tab guard (DESIGN 9.12) uses Web Locks. The second tab is read-only, follows the owner through `storage` events, takes over when the owner closes, and offers "Use here". Without Web Locks every tab owns the room. A tab opened from an answer link stays passive.
- 3D: Broker and manual connection race; the first channel to open wins. A lost manual channel restarts the broker. "Connect manually" is offered at once on broker-unreachable or ice-failed, otherwise after 10 s without an open channel. Whoever presses it becomes the manual host.
- 3D: Request toasts stay until answered and vanish when the request lapses. Presence toasts share one id, so a flap shows only the latest. The failure toast shows once per cause. QR codes are dark on a white plate in both themes; Share shows only where navigator.share exists.
- 3D: The running room turn is banked in sessionStorage `zhess:room-turn` (tab-local, ignored after 12 h). Room vocabulary: Raum / salon / sala; opponent: Gegner / adversaire / rival.
- Integrator 3: The invite link `#/?s=CODE&o=r` opens the room at once. The start screen with ROOM selected no longer writes `o=r` to the address bar; the choice is remembered in `zhess:opponent`.
- Integrator 3: A room game from history reconnects if it is unfinished or is the room's latest game (so a rematch is still possible); older finished games open in review.
- Integrator 3: Entering a room whose current game is over shows the overlay with Rematch, without the tint (Rematch lives only on the overlay).
- Integrator 3: Share in a live room opens the invite sheet. "Paused" shows on both strips in timed rooms while the clock is paused, and the opponent's strip dims while they are disconnected.
- Integrator 3: The e2e manual-path tests block the PeerJS WebSocket (`context.routeWebSocket`), so only STUN leaves the machine. No extra Chromium flags were needed: mDNS host candidates connect between two headless contexts.
- Gate 3 fix: There is no outgoing request toast; the requester sees a pulsing pending state on the undo/flag/Rematch button (DESIGN 9.7). Request toasts have a single frame. The broker-failure toast is held back while the invite or manual sheet is open and for a manual guest, and shows afterwards only if still owed.

**Final phase**
- Audit: three design auditors (DESIGN 4–8, 9, 10–14), the Ztyle launch checklist and a visual pass found 27 items; a skeptic confirmed 23 and rejected 4 (duplicates, or not stated by the design). `/code-review high` found 8 more. All 31 were fixed; none was flagged off.
- Rooms: a clash of two provisional rooms (both devices started the code while apart) is settled by the room, not the transport role: the older room wins, then the one with more plies, then the anchor. A locked room always beats a provisional one. `hello` carries open/born/len for this.
- Rooms: a rejoin grant no longer double-counts the score. The running room turn is banked in localStorage `zhess:room-turn` (one entry per code, pruned after 12 h), so it survives closing the app.
- Rooms: in a finished room game the toolbar's flag slot becomes Rematch, which reopens the overlay and pulses while a rematch request waits. The overlay's Rematch is disabled with "Waiting for opponent" when it cannot be asked.
- Rooms: toasts get a fresh sonner id per showing (`components/room/toastSlot.ts`), because sonner 1.7.4 deletes a toast re-created under a just-dismissed id. Remembered failure causes reset when the room changes.
- History: undoing the deletion of any game of a room brings the room record back (deleting a room game still removes the local room record, per DESIGN 9.5).
- "Continue from here" also works from a room game's review and starts a solo game. A solo clock and the computer keep running while the player looks back through a live game.
- The Start pill cancels when tapped while the engine loads, and shows the load percent in a tooltip (Ztyle 09).
- Service worker: page loads are network-first (`html-cache`) with the precached index.html as offline fallback (workbox `directoryIndex: null`).
- Toolbar buttons are always 44 px (DESIGN 14.1); in portrait only the spacing shrinks. The mobile-landscape rail becomes a two-column grid on short screens.
- Toasts sit at the bottom right, above the toolbar and the bottom safe area; in mobile landscape they fit between the board and the right edge.
- Below 360 px the info pill uses two rows, so the opponent cell (level, players, room score) is kept.
- Under reduced motion the hint and blunder marks are drawn statically for 1.6 s; the hinted square gets a visible focus ring.
- The start screen draws the blurred preview board smaller (`previewFit`) so the chrome never overlaps it; it scales back to full size on Start.
- The clock dial's caption goes above the ring when the dial was pushed up (landscape). Help's 3 s hold is announced: "Show help (hold for a surprise)".
- History cards never truncate the code; game number and room score move to the opponent line. Game-over summary parts wrap whole.
- A device waiting as anchor without a seat shows "Waiting for opponent" after 1 s.
- `scripts/screenshots.mjs` captures 10 screens × 5 sizes × light/dark; the final set is in docs/screenshots/final/ (100 images).
- README rewritten in Zudoku's shape (features, stack, getting started, scripts, structure, how rooms work, licence and engine credit).

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
- 3A: `reconcile` returns `adopt?: GameLog[]`, because rule 1 may adopt several games. The seat proof also signs the code and the prover's seat (DESIGN 9.3 says HMAC(key, nonce)), to block a reflection attack.
- 3B: During development the 3B agent ran one throwaway Chromium smoke test against the public broker 0.peerjs.com (random code, no personal data) plus manual-path checks that used public STUN only; neither was committed.
- 3C: A device without a key always sends `join`; the device holding the room decides between welcome and a rejoin request (DESIGN 9.11 lists join and rejoin separately; a received `rejoin` is still accepted). `end` carries `epoch` and `len` so a resignation crossing a move resolves without a fork.
- 3C/3B contract additions, still local and not merged into types.ts: TransportFailure `peer-gone`; EndMsg `epoch`/`len`; the RoomTransport extras (state, failure, onRole, onFailure, reconnect); RoomController methods return boolean.
- 3D: The second tab gets a "Use here" take-over action beyond DESIGN 9.12's read-only message.
- Integrator 3: Removed `invite`/`consumeInvite` from useGameState; invite links open the room directly. Edited 3B's manual.test.ts (test only) to fix a timing flake under full-suite load. `StripClock` gains `note`; `UseSavedGames` gains `rooms`.
- Gate 3 fix: Changed the unit test that asserted an outgoing request toast, because DESIGN 9.7 asks for a pending state on the button instead; gave one long Index.room integration test an explicit 15 s timeout (no assertion loosened).
- Final phase: the protocol `hello` carries open/born/len (local `HelloOut` type in room/controller.ts, like `EndOut`).
- Final phase, tests changed to match DESIGN/Ztyle (never loosened): the StartPill test now expects a press while loading to cancel (Ztyle 09). The toolbar test expects 44 px buttons instead of shrinking ones (DESIGN 14.1). The Help label includes its hold (DESIGN 6.4). The room-turn bank test reads the new per-code format, and the room history-card regex follows the new card layout.

## Open items

_(Features switched off in `src/lib/flags.ts`, tests marked `fixme`, and anything left for the owner.)_

Nothing is switched off: every flag in `src/lib/flags.ts` is on, and no test is marked `fixme` or skipped. The broker test can skip itself only when 0.peerjs.com is unreachable, and it did not.

For the owner:
- Done after the run, on the owner's go-ahead: the repository is public and GitHub Pages is enabled (Actions source); the app is live at https://izzardry.github.io/zhess/. `og:image` / `twitter:image` now point at the absolute Pages URL, with `og:url` added.
- Owner feedback after the release, fixed: in dark mode the piece fills and the square tones swapped with the theme, so white looked black (and a1 looked light); white pieces now always use the lighter ink and light squares are always the lighter tone. The last-move and selection fills dropped from `foreground/10`/`/15` to `/5`, half the square step, so highlighted squares no longer match the other color. The board cap rose from 76px to 96px, and the portrait chrome reserve from 20rem to 14rem (measured: pill, strips and toolbar need about 13rem), giving 636px instead of 540px at 1512 × 860 and 768px at 1920 × 1080. DESIGN 5.1 and 5.3 updated.
- Owner feedback, fixed: the hint pulse's outer glow was cut off by the neighbouring squares (painted later) and by the grid's `overflow-hidden`. The hint layer now sits above the squares (`z-[1]`), the grid no longer clips, and the four corner squares carry the grid's rounding themselves, with their overlays inheriting it.
- Owner request, done: the computer is downloaded on the first launch instead of on first use, and the start screen shows its state (`Computer 43%` with a bar, `Computer ready offline`, `Computer needs a connection`, or a retry). The page downloads both engine files itself into `engine-cache` (src/lib/engine/offline.ts), because a page cannot see the progress of a service worker precache; the existing CacheFirst route serves them offline. Every launch re-checks the cache and downloads again if iOS evicted it; offline it waits for `online`; Save-Data waits for a tap. e2e now checks that a computer game starts offline without one ever played online. Still unverified on a real iPhone.
- Owner feedback, fixed: reloading the start screen flickered. Recorded frame by frame, three causes: a light first frame in dark mode (the theme class was set by the app script), the status line arriving ~60 ms after the first paint and pushing the bottom-anchored footer up 24 px (the board preview then re-fitted), and the fonts arriving after the first paint. Now `index.html` sets the theme and page colour before anything loads; `src/lib/boot.ts` keeps `#root` transparent until Fira Code 300/400/500 and the first layout are ready (at most 1 s, CSS fallback after 3 s) and fades it in over 300 ms; the status line keeps a same-height placeholder while checking and fades each state in; the install pill's slot opens over 300 ms. An e2e test checks the dark first paint, the font at reveal, zero layout shift after reveal and the 300 ms fade.
- `npm install` reported 19 audit advisories (2 low, 14 moderate, 1 high, 2 critical) in dev/build dependencies; not addressed.
- Build warns that the main JS chunk is 748 kB (> 500 kB). peerjs is already split out; the engine is not bundled.

Known limits, by design or accepted:
- Rooms: if both players end the same game while disconnected (for example both resign offline), the two finished copies count as a fork and seat 0's copy wins, with a restore toast on both devices. A test pins this.
- Rooms: `head` covers only the current game, so differences in older finished games are repaired only when they travel in a `logs` message.
- Rooms: no channel binding. A stranger relaying between two online players who both dial the stranger's anchor id could read moves (not the key); out of scope under DESIGN 9.3's threat model.
- Rooms: two provisional rooms created within the devices' clock skew of each other are ordered by plies, then by anchor.
- Rooms: if the 100-game store cap evicts old room games, the score is updated incrementally instead of being recomputed.
- DESIGN 4.1: a joiner's color pill is not dimmed, because the start screen cannot tell a joiner from a creator before connecting.
- Minor duplication: DEFAULT_LEVEL in three places; useComputer's toTc vs clock.ts toTimeControl; useGameState's own Date.now turn timer is unused by the page.
- Cosmetic: the clock dial opens over the opponent selector; at 320×568 and 844×390 the invite sheet scrolls and Copy link starts below the fold; a toast at 320×568 covers the near clock for its lifetime; the version stamp is bottom-centre on phones, and the back-to-top button can cover the last credit line (both inherited from Zudoku); the guest's manual sheet focuses its close button; at 2560×1440 the board stops at the 76 px cell cap.

Not verified (needs a person):
- Two real phones on different networks (mobile data vs Wi-Fi, NAT types). Without TURN, some symmetric-NAT pairs will not connect; the manual fallback uses the same STUN-only ICE.
- The iOS installed-PWA (home-screen) path with the manual link/QR fallback, and Safari/Firefox in general: e2e runs Chromium only, and the Firefox SDP rebuild is untested.
- Level feel for levels 1–12 (DESIGN 17 risk 6) and blunder-guard latency on low-end phones (risk 5; in Node the depth-8 check takes 6–11 ms cold, ~1 ms warm).
- A manually connected room falling back to the broker when the channel drops is covered by unit tests only.

## Gate results

_(Per gate: commands run, pass/fail counts, what was disabled.)_

**Gate 0** (2026-11-11 01:12): `lint` 0 problems · `typecheck` clean · `test` 7 files / 86 tests passed · `build` ok (engine not precached) · `e2e` 5/5 passed · `public/engine/` holds the engine js, wasm, Copying.txt, README. Passed, nothing disabled.

**Gate 1** (2026-11-11, round 1 of up to 4): `lint` 0 problems · `typecheck` clean · `test` 39 files / 507 tests passed · `build` ok (25 precache entries; 561 kB chunk warning) · `e2e` 23/23 passed (m1 × 2 viewports, screenshots, smoke). Verifier confirmed every Gate 1 scenario is implemented at both viewports with no skips and checked all 16 screenshots. Passed, nothing disabled.

**Gate 2** (2026-11-11, passed in round 2 of up to 4). Round 1 failed on three findings: the win/loss page tint was hidden behind the body background, the clock-dial caption was clipped at 390×844, and the game-over duration left out the turn on which the flag fell. The machine crashed during fix round 1; the workflow was resumed from its cache. Fix 514984b. Round 2: `lint` 0 problems · `typecheck` clean · `test` 58 files / 769 tests passed (the real-engine suites ran, not skipped) · `build` ok (25 precache entries; engine runtime-cached by CacheFirst `engine-cache`, not precached) · `e2e` 32/32 (smoke 5, m1 14, m2 9; no skips or retries) · `node scripts/selfplay.mjs` level 12 beat level 1. Screenshots in docs/screenshots/m2/ (`r2-*` are after the fix). Passed, nothing disabled.

**Gate 3** (2026-11-11, passed in round 2 of up to 4). Round 1: all commands passed, `e2e` 37/37, but three layout faults failed it: the never-expiring broker-failure toast covered the invite and manual sheets; request toasts had a double frame; the outgoing pending toast covered the toolbar. Fix 9b2c717. Round 2: `lint` 0 problems · `typecheck` clean · `test` 69 files / 1410 tests passed · `build` ok (only the >500 kB chunk warning) · `e2e` 37/37 with 0 skipped, 0 flaky: smoke 5, m1 18, m2 9, m3 5. The m3 tests are the manual path, recovery, offline move, the BroadcastChannel hand-over (same context, two pages) and the broker path. **Broker path: verified.** Both contexts connected through the public 0.peerjs.com broker (`data-room-via=broker`) and played moves across, in both rounds. 30 screenshots in docs/screenshots/m3/. Passed, nothing disabled.

**Final gate** (2026-11-11, passed in round 1 of up to 4, at b255d9d): `lint` 0 problems · `typecheck` clean · `test` 71 files / 1449 tests passed, 0 skipped (the real-engine suites ran) · `build` ok (26 precache entries; only the chunk-size warning remains after c5abb45 removed a Tailwind warning caused by a test comment) · `e2e` 38/38, 0 skipped, 0 flaky, 0 retries: smoke 5, m1 18, m2 10, m3 5 · broker path verified (2.5 s through 0.peerjs.com) · `node scripts/selfplay.mjs`: level 12 mated level 1 in 47 plies, +20 material · test-diff check since 35ff61b: nothing skipped or loosened. 100 screenshots in docs/screenshots/final/ checked at 320×568, 390×844, 844×390, 1280×800 and 2560×1440 in light and dark; no layout faults. Nothing disabled.
