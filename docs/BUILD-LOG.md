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

- [ ] 1A · Board
- [ ] 1B · Game state
- [ ] 1C · Game chrome
- [ ] 1D · Start screen
- [ ] 1E · Platform
- [ ] Integrator 1
- [ ] Gate 1

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

## Deviations

_(Where a design decision could not be built as stated: what was built instead, and why.)_

- Contract additions by 0b (PLAN section 4 extended, not changed): `Game.start`; extra `ZhessApi` helpers (replay, fromRecord, reopen, timeout, canMate, clockRunning, sanToUci, …); `Move` carries uci/color/piece/castle/enPassant; `GameLog` gains `white` and `tc` so a recovered device learns colors and time control; protocol `head` gains `ended` and `turnMs`, `ask`/`reply` gain `n`/`epoch`/`len`, `ack` gains `n`/`epoch`.

## Open items

_(Features switched off in `src/lib/flags.ts`, tests marked `fixme`, and anything left for the owner.)_

- The GitHub Pages deploy workflow will fail on each push to `main` until the owner enables Pages (the run must not enable it).
- `npm install` reported 19 audit advisories (2 low, 14 moderate, 1 high, 2 critical) in dev/build dependencies; not addressed.

## Gate results

_(Per gate: commands run, pass/fail counts, what was disabled.)_

**Gate 0** (2026-11-11 01:12): `lint` 0 problems · `typecheck` clean · `test` 7 files / 86 tests passed · `build` ok (engine not precached) · `e2e` 5/5 passed · `public/engine/` holds the engine js, wasm, Copying.txt, README. Passed, nothing disabled.
