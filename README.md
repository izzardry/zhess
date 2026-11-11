# Zhess

**Zero Distractions. Just Chess.**

Zhess is the [izzardry](https://github.com/izzardry) chess game: a monochrome, monospaced, no-frills chess board for playing against the computer, with two people on one device, or in a serverless peer-to-peer room.

This project is being built. The specification is [DESIGN.md](DESIGN.md); progress is logged in [docs/BUILD-LOG.md](docs/BUILD-LOG.md).

## Getting started

```sh
npm install
npm run dev        # http://localhost:8080
npm run lint
npm run typecheck
npm test           # unit tests (Vitest)
npm run build
npm run e2e        # end-to-end tests (Playwright, Chromium); run `npx playwright install chromium` once
```

## Licence

Zhess is MIT-licensed (see [LICENSE](LICENSE)). The computer opponent is [Stockfish](https://github.com/nmrugg/stockfish.js) (GPL-3.0), shipped unmodified as a separate asset in [`public/engine/`](public/engine/README.md).
