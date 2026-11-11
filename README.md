# Zhess

**Zero Distractions. Just Chess.**

A minimalist chess game built as a Progressive Web App, by [izzardry](https://github.com/izzardry). Play the computer, pass one device between two players, or open a room for two devices with no game server. No ads, no accounts, no nonsense — just chess.

## Features

- **Computer opponent** — Stockfish in a Web Worker, 12 levels from Beginner to Insane (default Medium); the low levels make human mistakes
- **Pass-and-play** — two players on one device; the far side's pieces can be drawn rotated
- **Rooms for two** — play across two devices peer to peer, with no server holding the game; a room is a series with a running score and alternating colors
- **Game codes** — every game has a 6-character code; for a room the code is the room
- **Chess clock** — optional, with presets and custom minutes + increment; premoves in timed games against the computer or in a room
- **Undo / Redo** — free in solo games, clock restored; a takeback request in rooms
- **Hints and blunder guard** — tap the bulb for the best move, hold it to see the squares the opponent attacks; against the computer, a move that drops 3 pawns or more bounces back once
- **Draws, resignation, auto-queen** — automatic draws, draw offers, resign with a short undo window
- **History and review** — the last 100 games; unfinished games resume, finished ones open in a replay viewer with "continue from here"
- **Sharing by link** — a solo game travels as a URL with its moves; a room link carries only the code; PGN export
- **Input** — tap-tap, drag, keyboard, or typed SAN
- **PWA / installable** — offline after the first load (the computer after its first use; rooms need a network)
- **Four languages** — English, German, French, Spanish
- **Dark mode** — follows the system

## Tech Stack

- [React](https://react.dev) + [TypeScript](https://www.typescriptlang.org)
- [Vite](https://vitejs.dev) (with SWC)
- [Tailwind CSS](https://tailwindcss.com) with the izzardry Ztyle preset
- [shadcn/ui](https://ui.shadcn.com) (Radix UI primitives)
- [chess.js](https://github.com/jhlywa/chess.js) for the rules
- [Stockfish](https://github.com/nmrugg/stockfish.js) (WebAssembly, lite, single-threaded) for the computer
- [PeerJS](https://peerjs.com) and WebRTC for rooms, [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) for the manual fallback
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app) for service worker and offline support
- [Vitest](https://vitest.dev) and [Playwright](https://playwright.dev) for testing

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) (v18+; `scripts/selfplay.mjs` needs v23.6+)
- npm

### Install & Run

```sh
# Clone the repo
git clone https://github.com/izzardry/zhess.git
cd zhess

# Install dependencies
npm install

# Start the dev server
npm run dev
```

The app will be available at `http://localhost:8080`.

### Build for Production

```sh
npm run build
npm run preview   # preview the production build locally
```

### Run Tests

```sh
npm run lint
npm run typecheck
npm test          # unit and component tests (Vitest)
npm run e2e       # end-to-end tests (Playwright, Chromium)
```

Before the first e2e run, install the browser once with `npx playwright install chromium`. `npm run e2e` builds the app and serves it on port 4173, so two runs cannot overlap. It also rewrites the screenshots in `docs/screenshots/m1/`.

### Scripts

```sh
node scripts/selfplay.mjs                      # level 12 plays level 1 in Node with the real engine
node scripts/screenshots.mjs <baseURL> <outDir> # screenshots of the main screens against a running preview
```

## Project Structure

```
src/
  pages/           # The stage (Index) and NotFound
  components/
    board/         # Board, squares, pieces, promotion dial
    game/          # Player strips, info pill, move list, toolbar, game-over overlay, share
    start/         # Start screen: code, opponent, color and clock pills
    room/          # Invite and manual-connect sheets, room toasts, requests
    platform/      # History, tutorial, install prompt, language switcher, credits
    ui/            # shadcn/ui primitives
  hooks/           # Game state, clock, engine, room, saved games, helpers, PWA
  lib/             # Core logic, framework-free
    zhess.ts       #   rules wrapper over chess.js, move codec, PGN
    levels.ts      #   level table and humanized move picker
    engine/        #   UCI driver for the Stockfish worker
    sync.ts        #   reconcile, log hashing, seat proof
    room/          #   room state machine (room.ts is its entry point)
    transport/     #   PeerJS, manual (link/QR) and in-memory transports
    i18n/          #   EN, DE, FR, ES
  ztyle/           # Shared style preset
public/
  engine/          # Stockfish (GPL-3.0), unmodified, with its licence
e2e/               # Playwright tests
scripts/           # Self-play, screenshots, brand images
docs/              # Build log and screenshots
```

## How Rooms Work

A room connects exactly two devices over one WebRTC data channel. No server stores anything; each device keeps the full record of every game in the room.

- **Joining is creating.** The room code is the PeerJS id `zhess-<CODE>` on the public PeerJS broker. The first device to claim it is the *anchor* and waits; if the id is taken, the device registers a random id and *dials* the anchor. Anchor and dialer are transport roles only, and both devices repeat the procedure on every reconnect.
- **STUN only.** ICE uses public STUN servers (Google, Cloudflare). There is no TURN relay, so two strict NATs may not connect; the app says so calmly. After the connection, nothing passes through a third party.
- **Manual fallback.** If the broker is unreachable or blocked, the offer and answer travel as links or QR codes (`?s=<CODE>&o=r&x=<offer>`, answered with `&y=<answer>`). The answer can be pasted into the waiting tab or opened on the same device.
- **Seat key.** The creator makes a 128-bit secret and hands it to the first device that joins. From then on the room is locked: on every connection each side proves it holds the key with an HMAC-SHA-256 challenge-response. The key is never sent again, and room links carry only the code.
- **Sync and recovery.** On every connection the devices compare a summary of the current game and reconcile: the higher game number wins, then the higher takeback epoch, then the longer log when one continues the other, and a finished log beats an unfinished one of the same length. Every adopted log is replayed through chess.js first. A true fork, which normal play cannot produce, is settled by the creator's copy. A device that lost its data asks to rejoin; the other player taps **Allow** and it receives the key, score and every game.
- **Offline moves.** In untimed games the player to move may move while the other is away; the move is delivered on the next connection. Timed games pause and lock while disconnected.

## Licence

Zhess is MIT-licensed (see [LICENSE](LICENSE)).

The computer opponent is [Stockfish](https://stockfishchess.org/), through [stockfish.js](https://github.com/nmrugg/stockfish.js) 19.0.1 by Nathan Rugg and contributors, licensed under GPL-3.0. It ships unmodified in [`public/engine/`](public/engine/README.md) with its licence (`Copying.txt`), and runs as a separate Web Worker spoken to over UCI; it is not linked into the app bundle.
