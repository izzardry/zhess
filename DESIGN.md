# Zhess — design document

**Zero Distractions. Just Chess.**

Zhess is the izzardry chess game: a monochrome, monospaced, no-frills 2D chess board that can be played against the computer, by two people on one device, or by two people in a serverless peer-to-peer room.

This document records every product and technical decision taken before the first line of code. It is the specification for the implementation.

- **Status:** agreed design, nothing implemented yet
- **Date:** 2026-11-10
- **House style:** [Ztyle](https://github.com/izzardry/ztyle). Where this document is silent, do what Ztyle says; where Ztyle is silent, do what [Zudoku](https://github.com/holzschneider/zudoku) does.

Decisions marked **(interview)** were chosen explicitly by the owner. Decisions marked **(derived)** follow from those choices or from Ztyle and were filled in while writing; they are open to correction.

---

## 1. Summary of decisions

| Area | Decision |
|------|----------|
| Modes | Vs computer, pass-and-play, peer-to-peer room. No free analysis board. **(interview)** |
| Computer | Stockfish WASM (lite, single-threaded), loaded lazily in a worker. **(interview)** |
| Levels | 12 levels with the Zudoku names, default 5, humanized low end. **(interview)** |
| Rules | `chess.js` behind a thin pure wrapper in `lib/zhess.ts`. **(interview)** |
| Code | Every game has a 6-character game code. For rooms the code is the room. **(interview)** |
| Signalling | PeerJS public broker, with a manual link + QR exchange as fallback. **(interview)** |
| NAT | STUN only. No TURN relay. Failure is stated calmly. **(interview)** |
| Seat security | Seats lock to two devices through a stored secret; a device without it needs one confirmation from the other player. **(interview)** |
| Sync | Longest valid move log wins; an empty side adopts everything. **(interview)** |
| Room lifetime | A room is a series with a running score; rematch alternates colors. **(interview)** |
| Offline moves | Allowed in untimed room games, delivered on reconnect. Timed games lock while disconnected. **(interview)** |
| Clock | Optional. One preset pill; long-press for custom. Pauses for both on disconnect. **(interview)** |
| Undo | Free in solo modes with clock restored; takeback request in rooms. **(interview)** |
| Colors | White / black / random pill, default random, remembered. **(interview)** |
| Pieces | Own SVG set: white outlined, black solid. **(interview)** |
| Input | Tap-tap and drag, plus keyboard. **(interview)** |
| Helpers | Legal-move dots, last move, check glow, coordinates, blunder guard. **(interview)** |
| Hint | Tap = best move; hold = threat peek. **(interview)** |
| Endings | Automatic draws, draw offer, resign, auto-queen, premove. **(interview)** |
| History | Last 100 games; unfinished games resume, finished games open a replay viewer with "continue from here". **(interview)** |
| URL | Code + settings + compact move list. Room links carry the code only. **(interview)** |
| Pass-and-play | Board fixed; far side's pieces drawn rotated; a button switches seating. **(interview)** |
| Board chrome | Captured pieces + material, move strip, coordinates. No sound, no haptics. **(interview)** |
| Room talk | None. **(interview)** |
| Presence | One dot in the info pill plus a toast on each change. **(interview)** |
| Licence | Zhess is MIT. Stockfish ships as a separate, unmodified GPLv3 asset. **(interview)** |
| Delivery | Three milestones (section 16). **(interview)** |
| Repository | `github.com/izzardry/zhess`. **(interview)** |

---

## 2. Brand

| Item | Value |
|------|-------|
| Name | Zhess (wordmark `ZHESS`, `font-light tracking-[0.3em]`) |
| Tagline | `Zero Distractions. Just Chess.` |
| Page title | `Zhess - Zero Distractions. Just Chess.` |
| Meta description | `Zero Distractions. Just Chess. A minimalist chess board for one or two players.` |
| OG description | `A minimalist chess game. 12 computer levels, serverless rooms for two, a chess clock, and zero ads.` |
| `author` | `izzardry` |
| PWA `short_name` | `Zhess` |
| Storage prefix | `zhess:` |
| Icon | Ztyle icon standard: `#0d0d0d` tile, thin-stroke 8×8 grid hint, one knight glyph from the piece set in the center. Grayscale. |

---

## 3. Modes

There are three ways to play. They share one board, one move model and one history.

| Mode | Opponent | Network | Engine download |
|------|----------|---------|-----------------|
| **Computer** | Stockfish at level 1–12 | none | yes, on first use |
| **Two players** (pass-and-play) | a person on the same device | none | only if a hint is requested |
| **Room** | a person on another device | WebRTC | none |

"Solo" in the original brief means the first two.

Out of scope: free analysis board, Chess960 and other variants, spectators, more than two peers, chat, puzzles, opening books shown to the user, engine evaluation bar, ratings, accounts.

---

## 4. Screen flow

Zhess has one route and one stage, exactly like Zudoku. The board is always centered and never moves. Screens are states of the same stage.

| State | Board | Visible UI |
|-------|-------|------------|
| **Start** | Blurred (8 px, 60 %). Shows the start position, or the position of the game the code refers to. | Wordmark, tagline, code field (top). **Start** pill over the board. Opponent selector, color pill, clock pill, install pill, bounce chevron (bottom). Language (top right). Version stamp (bottom right). |
| **Start, scrolled** | Blurred | Sticky wordmark header, history, back-to-top, support button. |
| **Game** | Sharp, interactive | Back (top left), info pill (top center), help (top right), two player strips at the board edges, toolbar (bottom). |
| **Game, UI hidden** | Sharp | Board and the two clocks only. Tapping empty stage toggles. |
| **Review** | Sharp, read-only | Same as game; toolbar changes to stepping controls. |
| **Overlay** | Blurred behind scrim | Game-over overlay, tutorial, manual-connect sheet. |

Mobile landscape uses rails as in Ztyle: info and player strips on the left, toolbar on the right.

### 4.1 Start screen

Zudoku's start screen has a code field, a level stepper and one Start pill. Zhess keeps that shape and adds two small pills.

```
              Z H E S S
     Zero Distractions. Just Chess.

               K7QW2M  ✎
              game code

          ┌───────────────┐
          │   (blurred)   │
          │    [ START ]  │
          │               │
          └───────────────┘

         ‹  COMPUTER · 5 MEDIUM  ›
           [ ◐ random ] [ ⏱ off ]
                   ⌄
```

**Opponent selector.** One stepper replaces Zudoku's level stepper. Its ordered values are:

`ROOM` · `TWO PLAYERS` · `COMPUTER 1 BEGINNER` … `COMPUTER 12 INSANE`

The last selection is remembered. The first-run default is `COMPUTER 5 MEDIUM`.

**Color pill.** Cycles random → white → black. Default random. Remembered. In a room it sets the creator's color for game 1; a joiner sees it dimmed because the creator's choice applies.

**Clock pill.** Cycles `off` · `1+0` · `3+2` · `5+0` · `10+0` · `15+10` · `30+0`. A 500 ms long-press opens the radial dial to pick custom minutes, then increment. Remembered.

**Code field.** Works as in Zudoku: tap generates a new random 6-character code; ✎ edits inline (uppercase `0-9A-Z`, 1–8 characters).

**Start pill.** There is exactly one primary action, and its label follows the context:

| Context | Label | Action |
|---------|-------|--------|
| Code is new | `START` | Begin a new game with the selected settings. |
| Code matches an unfinished local game | `RESUME` | Continue it. The selectors show that game's settings, dimmed. |
| Code matches a finished local game | `REVIEW` | Open the replay viewer. |
| Opponent = Room | `START` | Create or join; the app finds out which (section 9.2). |

There is no separate "join" flow. Typing a friend's code with the selector on `ROOM` and pressing Start joins their room. Opening an invite link preselects `ROOM` and the code, then starts immediately.

### 4.2 Game screen

```
 (←)      [ K7QW2M ● │ LEVEL 5 │ 12. Nf3 e5 ]      (?)

            ♟♟ +2                        4:31
          ┌────────────────────────────────┐
          │                                │
          │             BOARD              │
          │                                │
          └────────────────────────────────┘
            ♙                            5:02

              [ ↶  ↷ │ 💡  🛡 │ ⚑  ⇪ ]
```

**Info pill** (top center), three cells:

1. Game code. In a room, a presence dot sits next to it.
2. Opponent: `LEVEL 5`, `2 PLAYERS`, or the room score `2 – 1`.
3. Move strip: the last one or two moves in SAN with the move number. Tapping opens the full move list in a popover; tapping a move there jumps to it in review.

**Player strips.** One strip floats at the top edge of the board for the far player and one at the bottom edge for the near player. Each holds the captured pieces (small, grouped by type), the material difference (`+2`, only on the side that is ahead) and the clock. With the clock off, the strip shows time used by that side, dimmed. The strip of the player to move is at full opacity; the other is at 50 %.

**Toolbar** (bottom center), by mode:

| Slot | Computer | Two players | Room | Review |
|------|----------|-------------|------|--------|
| Undo | one full turn back | one ply back | takeback request | step back (hold: to start) |
| Redo | replay | replay | hidden | step forward (hold: to end) |
| Hint | yes | yes | hidden | hidden |
| Helpers shield | yes | yes | yes | yes |
| Seating | hidden | yes | hidden | flip board |
| Flag | draw offer / resign | resign | draw offer / resign | "continue from here" |
| Share | yes | yes | invite link | link or PGN |

---

## 5. Board

### 5.1 Drawing

- 8×8 grid sized from one variable, `--cell-size: clamp(34px, min(11.5vw, 10vh), 96px)`, so it fits from 320 × 568 upward without scrolling. In portrait, 14rem of height stays free for the info pill, the player strips and the toolbar. **(derived; cap raised from 76px by the owner after the first release)**
- Squares are grayscale, and the light squares are the lighter ones in both themes. The two tones differ by a `foreground/10` overlay: on the dark squares in the light theme, on the light squares in the dark theme.
- Pieces are one custom SVG set of six shapes with thin, even strokes. White pieces are filled with the lighter of `background` and `foreground`, black pieces with the darker one, in both themes, so white always looks white. The outline is always `foreground`, so it contrasts with the board: in the light theme white reads as an outline and black as a solid shape, in the dark theme white is solid and black an outline.
- The same six SVG symbols are reused for captured pieces, thumbnails, the promotion dial, the move strip (figurine notation) and the app icon.
- Your color is at the bottom. In a room and against the computer the board is oriented once at game start and stays.

### 5.2 Pass-and-play seating

The board never rotates between turns. Two seatings exist, switched by a toolbar button and remembered:

- **Face to face** (default on touch devices): the far player's pieces, strip and clock are drawn rotated 180°, so two people on opposite sides of a phone or tablet both read their own side.
- **Side by side** (default with a mouse): everything upright, white at the bottom.

### 5.3 Square states

In priority order, lowest first. Fills are overlays on the square color, as Ztyle requires. Grey fills are half the light/dark step (`foreground/5`), so a highlighted square sits between the two square tones and the checkerboard stays readable.

| State | Visual | Needs helpers |
|-------|--------|---------------|
| Last move (from and to) | `foreground/5` overlay | yes |
| Selected piece | `foreground/5` overlay + `ring-2 ring-foreground/50` | no |
| Legal target, empty | centered dot, `foreground/25` | yes |
| Legal target, capture | ring around the square, `foreground/25` | yes |
| Premove (from and to) | dashed `ring-foreground/40` | no |
| King in check | `destructive/15` overlay + `ring-1 ring-destructive/40`, pulsing | yes |
| Blunder warning | piece pulses `destructive` once | yes |
| Hint | `animate-hint-pulse` (green, 800 ms, once) | — |
| Threat peek | `destructive/10` overlay on attacked squares, while held | — |

State is never shown by color alone: check also shows `+` in the move strip, and hints move focus to the square.

### 5.4 Coordinates

Faint `a–h` and `1–8` labels inside the edge squares, `text-[0.5rem] text-foreground/40`. They belong to the helpers bundle.

---

## 6. Interaction

### 6.1 Moving

| Input | How |
|-------|-----|
| Tap-tap | Tap a piece, then a target. Tapping another own piece changes the selection. Tapping elsewhere clears it. |
| Drag | Press and drag a piece; it follows the pointer above the finger; release on a target. |
| Keyboard | Arrow keys move a focus ring; `Enter` or `Space` selects and drops; `Escape` clears. Typing SAN (`Nf3`, `exd5`, `O-O`) and `Enter` plays the move directly. `Z` / `Shift+Z` undo and redo; `←` / `→` step in review. |

With helpers off, an illegal drop snaps back without comment.

Castling is played by moving the king two squares, or by dropping the king on its own rook. En passant is an ordinary legal target.

### 6.2 Promotion

A pawn reaching the last rank promotes to a queen at once. To choose another piece, hold the pawn on the target square for 300 ms (or long-press the target in tap-tap). The radial dial opens with Q, R, B, N; release commits. This is the Ztyle radial dial reused unchanged.

### 6.3 Premove

In timed games against the computer or in a room, one move can be queued during the opponent's turn. It is drawn with dashed rings. It plays instantly when the opponent has moved, if it is still legal; otherwise it is dropped silently. Tapping anywhere cancels it. Premoves bypass the blunder guard.

### 6.4 Long-press ladder

| Hold | Where | Action |
|------|-------|--------|
| 300 ms | Promotion square | Promotion dial |
| 500 ms | Clock pill | Custom time control |
| 500 ms | Flag button | Resign (tap = offer draw) |
| 500 ms | Undo / redo in review | Jump to start / end |
| 1000 ms | Hint bulb | Threat peek while held |
| 3000 ms | Help button | Easter egg (donation prompt), as in Zudoku |

Each long press suppresses the click that follows and is announced in the `aria-label`.

---

## 7. Helpers and hints

### 7.1 Helpers shield

One toggle, on by default, stored in `zhess:helpers`. It bundles:

- legal-move dots and capture rings,
- last-move highlight,
- check glow,
- coordinates,
- the blunder guard.

Off is purist mode: a bare board.

### 7.2 Blunder guard

Active against the computer only, with helpers on.

After the player drops a move and before it is committed, the engine worker runs a short fixed-depth search on the position before and after the move. The move is flagged if it drops the evaluation by 3 pawns or more, or allows a forced mate within 2 moves that was not already there. **(derived; thresholds to be tuned)**

A flagged move is not played. The piece returns to its square and pulses red once. Playing the same move again within 5 seconds commits it. There is no dialog and no text.

The check must finish within about 150 ms. If the engine has not answered by then, the move goes through.

### 7.3 Hint bulb

Available against the computer and in pass-and-play. Hidden in rooms.

- **Tap:** the piece the engine would move pulses green. A second tap pulses its target square. The hint never plays the move.
- **Hold 1 s:** threat peek. All squares attacked by the opponent are shaded while the button is held. This uses `chess.js` attack data, not the engine.

The interview offered an evaluation bar on hold as well. It is left out because both cannot share the hold gesture, and the threat peek was chosen explicitly. **(derived)**

Hints are unlimited. A game in which a hint or an undo was used is marked `assisted` in history with a small hollow dot. There is no other consequence.

---

## 8. Game rules and endings

### 8.1 Rules engine

`chess.js` provides legal move generation, SAN, FEN, PGN, check, mate, stalemate, insufficient material, repetition and the 50-move rule. `lib/zhess.ts` wraps it with no React and no DOM and adds: move encoding for the URL, the game record type, clock arithmetic and log reconciliation.

### 8.2 Automatic endings

The game ends without anyone claiming anything on: checkmate, stalemate, insufficient material, threefold repetition, the 50-move rule, and time running out. Running out of time against a side that cannot possibly mate is a draw.

### 8.3 Flag button

- **Tap = offer a draw.**
  - Room: the opponent gets an undo-style toast with Accept and Decline. It expires when they move.
  - Computer: accepted if the game is past move 30 and the engine's evaluation is within ±0.3 pawns; otherwise a toast says `Declined`. **(derived)**
  - Pass-and-play: no draw offer; the two players agree out loud and one resigns, or the tap is ignored. The button shows only resign.
- **Hold 500 ms = resign.** The game ends immediately. Against the computer and in pass-and-play an undo toast can take it back for 5 seconds. In a room resignation is final, because the opponent has already been told.

The computer never resigns and never offers a draw.

### 8.4 Game-over overlay

As in Ztyle: the page tints over 1000 ms, then the overlay appears.

| Outcome for the device's player | Tint | Glyph | Title |
|---------------------------------|------|-------|-------|
| Win | `success/12` | 🎉 | `Checkmate!` / `You won!` |
| Loss | `destructive/12` | none | `Checkmate` / `Out of time` / `Resigned` |
| Draw | none | none | `Draw` + reason |
| Pass-and-play | none | 🎉 | `White wins!` / `Black wins!` / `Draw` |

Summary line: `K7QW2M • Level 5 • 34 moves • 12:08`.

Actions: ghost **Share**, primary **New game** (computer, pass-and-play) or **Rematch** (room). Tapping the scrim dismisses the overlay to look at the board. The one-time donation prompt follows the first win after 1.5 s.

---

## 9. Rooms

A room is a persistent place for exactly two devices. It is identified by its game code. No server holds any game state.

### 9.1 Building blocks

| Piece | Choice |
|-------|--------|
| Transport | One WebRTC data channel, reliable and ordered. |
| Signalling, primary | `peerjs` against the public PeerJS broker (`0.peerjs.com`). |
| Signalling, fallback | Manual offer/answer by link or QR (section 9.9). |
| ICE | Public STUN servers only. No TURN. |
| Encryption | WebRTC's own DTLS. Nothing passes through a third party after connection. |
| Abstraction | A `Transport` interface (`send`, `onMessage`, `onState`, `close`) with two implementations: `PeerJsTransport` and `ManualTransport`. The room logic above it does not know which one is in use. |

### 9.2 Creating and joining are the same action

The PeerJS peer id of a room is `zhess-<CODE>`. Only one device can hold an id at a time.

1. On Start with `ROOM`, the device tries to register `zhess-<CODE>` with the broker.
2. If that succeeds, the device is the **anchor**. It waits for a connection and shows the invite sheet (link, QR, native share).
3. If the id is taken, another device is the anchor. This device registers a random id and **dials** `zhess-<CODE>`.

Anchor and dialer are transport roles only. They do not give authority over the game. On every reconnect both devices run the same procedure again, so either can become the anchor. A random delay of 0–500 ms before step 1 avoids both grabbing at once.

### 9.3 Room record and seat lock

Each device stores a room record:

```ts
type Room = {
  code: string;          // "K7QW2M"
  key: string;           // 128-bit random secret, base64url; shared by both devices
  seat: 0 | 1;           // 0 = creator, 1 = joiner
  createdAt: number;
  lastSeenAt: number;    // last successful sync
  score: [number, number];   // points per seat, in half points ×2
  games: string[];       // ids of this room's games, oldest first
};
```

The creator generates `key`. The room has three states as seen from a device that holds it:

- **Open:** created, nobody has joined yet. The first device that connects with the code and passes nothing else gets seat 1 and receives `key` over the data channel.
- **Locked:** both seats are taken. A connecting device must prove it knows `key`.
- **Rejoin pending:** a device without `key` asks for a seat in a locked room (section 9.5).

Proof of `key` is a mutual challenge-response: each side sends a random nonce and the other returns `HMAC-SHA-256(key, nonce)` through WebCrypto. The key itself is never sent after the first join. This matters because anyone can register the peer id `zhess-<CODE>` while both real players are offline; that device learns nothing and is dropped when it fails the challenge.

What this protects and what it does not:

- A stranger who guesses the code cannot take a seat in a locked room and cannot read the game.
- A stranger who guesses the code of an **open** room before the invited friend arrives takes the seat. The creator sees a toast `Opponent joined` at an unexpected moment and can leave the room. This window is accepted.
- A stranger can squat on the peer id and so block broker signalling for that room. The manual fallback still works.
- The two players are trusted to each other. There is no protection against a modified client (section 9.8).

### 9.4 Sync model

Each device stores the complete record of every game in the room. The live state of a game is:

```ts
type GameLog = {
  n: number;        // game number within the room, 1-based
  epoch: number;    // incremented on every accepted takeback
  plies: Ply[];     // { m: string /* UCI */, ms: number /* time the mover used */ }
  end?: { result: '1-0' | '0-1' | '1/2-1/2'; by: Termination };
};
```

On every connection the two sides exchange `(n, epoch, plies.length, hash)` and then reconcile:

1. The higher `n` wins; the side that is behind receives the missing finished games and the current one.
2. With equal `n`, the higher `epoch` wins.
3. With equal `n` and `epoch`, if one log is a prefix of the other, the longer one wins. The shorter side replays the extra plies through `chess.js`; an illegal ply aborts the sync with an error toast.
4. With equal `n`, `epoch` and length but different content, or any other true fork, seat 0's log wins and both sides get a toast `Game restored from opponent's copy`.
5. A finished log beats an unfinished one of the same length.

A true fork (rule 4) cannot occur in normal play: only the side to move can add a ply, an offline player can add at most one, and takebacks need a live connection. Rule 4 exists so that corrupt storage cannot deadlock a room.

During live play each move is sent as `{n, epoch, index, m, ms}` and acknowledged. An unacknowledged move stays queued and is covered by the reconcile on the next connection.

### 9.5 Recovery

The brief requires that a room survives when only one player still has it.

| Situation | What happens |
|-----------|--------------|
| Both devices have the room | Challenge-response, reconcile, continue. No interaction. |
| One device lost everything (cleared storage, new phone, other browser) | It has no record, so Start with the code dials or anchors as a newcomer. The surviving device sees that the room is locked and that the newcomer has no key. It shows one toast: `Opponent is rejoining from a new device` with **Allow** and **Decline**. On Allow it sends `key`, the seat number, the score and all game logs. The newcomer is fully restored, including finished games in its history. |
| One device has an older state (restored backup) | Reconcile rules 1–3 bring it up to date. |
| Both devices lost the room | The code is free again. The first to start creates a fresh room. |
| The survivor is offline when the other returns | The returning device waits as anchor with `Waiting for opponent`. Recovery happens when the survivor next opens the room. |

The Allow toast is the only manual step in recovery. It exists because without it the seat lock would be meaningless: the stranger from section 9.3 would look exactly like a player who lost their storage.

Deleting a room game from local history removes the local room record as well (with the usual undo toast). If the opponent still has the room, typing the code again recovers it through the path above.

### 9.6 Offline moves

- **Untimed room game:** the player to move may move while the opponent is disconnected. The ply is stored, shown normally, and delivered on the next connection. The board then waits. This gives correspondence-style play with no server: each player moves when they like, and the moves cross whenever both have the app open at the same time.
- **Timed room game:** the board is locked while disconnected. The strips show `Paused`.

### 9.7 Requests

All requests use the same quiet pattern: the requester sees a pending state on the button; the other side gets a toast with Accept and Decline; no modal.

| Request | Trigger | Effect when accepted |
|---------|---------|----------------------|
| Takeback | Undo button | The log is cut back to before the requester's last move, `epoch` increases, clocks return to the stamps of that position. The request is withdrawn if the requester moves. |
| Draw | Flag tap | Game ends `1/2-1/2`. |
| Rematch | Overlay button | A new game `n+1` starts in the same room with colors swapped and the same time control. Either player may ask. |

There is no redo in a room.

Score: a win adds 1, a draw adds ½ to each. The info pill shows it as `2 – 1` from the device's own point of view.

### 9.8 Clocks in a room

- Each ply carries `ms`, the time its mover used, measured on the mover's device. The receiver accepts it. Remaining time is derived from the log, so both devices always agree after a sync.
- While it is the opponent's turn, the device counts their clock down locally from the moment it received the previous move. The arrival of the real `ms` corrects the display.
- A player's flag falls on their own device, which sends the end of the game. The opponent's device may also end the game once its local view of that clock has been at zero for 2 seconds while connected.
- **Disconnect pauses both clocks.** They resume from the last agreed stamps when the connection is back. The time the player to move had already used in the current turn is kept by that player's device and reported on reconnect.
- The first move of each side starts that side's clock, as over the board.

This is a design for two people who chose to play each other. A modified client could lie about `ms` or disconnect to think. That is accepted and not defended against.

### 9.9 Manual connection fallback

Shown only when the broker cannot be reached or signalling fails for 10 seconds, behind a ghost button `Connect manually`.

1. **Host:** creates a plain `RTCPeerConnection` and a data channel, waits for ICE gathering to finish, and packs the offer (SDP reduced to its essential lines, deflated with `CompressionStream`, base64url). It shows this as an invite link and QR: `…/#/?s=K7QW2M&o=r&x=<offer>`.
2. **Guest:** opens the link. The app builds the answer the same way and shows it as an answer link and QR: `…/#/?s=K7QW2M&o=r&y=<answer>`.
3. **Host:** opens the answer link or scans the QR. The link opens in a new tab, which passes the answer to the waiting tab through a `BroadcastChannel` and tells the user to return to the game. A paste field in the waiting tab accepts the answer link directly as an alternative.

After the channel opens, everything is identical to a PeerJS connection: challenge, reconcile, play. A manually connected room reconnects through the broker when it is available again, and falls back to the manual exchange if not.

QR codes are generated in the app by a small dependency. Scanning uses the phone's camera app; Zhess has no in-app scanner.

### 9.10 Presence

- **Dot** next to the code in the info pill: solid = connected; hollow and pulsing = waiting or reconnecting. Tapping the dot opens the invite sheet again.
- **Toasts** on each change: `Opponent connected`, `Opponent disconnected`, `Reconnected`.
- The opponent's strip dims while they are disconnected.
- Reconnection is automatic: backoff 1, 2, 4, 8 … up to 30 seconds, and immediately on `visibilitychange`, `online` and `focus`.
- When STUN cannot establish a path, a calm message appears once: `Could not reach your opponent directly. Try another network.` with the `Connect manually` button. The manual path uses the same STUN-only ICE, so it helps when the broker is the problem and not when the network is.

### 9.11 Protocol

JSON messages over the data channel, each with `v: 1`.

| Message | Purpose |
|---------|---------|
| `hello {v, hasKey, nonce}` | First message both ways. |
| `proof {mac}` | Answer to the other side's nonce. |
| `join` / `welcome {key, seat, tc, color}` | First join of an open room. |
| `rejoin` / `grant {key, seat, score, games}` / `deny` | Recovery of a lost device. |
| `head {n, epoch, len, hash}` | Reconcile summary. |
| `logs {games}` | Reconcile payload. |
| `move {n, epoch, i, m, ms}` / `ack {i}` | Live play. |
| `ask {kind}` / `reply {kind, ok}` | Takeback, draw, rematch. |
| `end {n, result, by}` | Resign, flag, agreed draw. |
| `ping` / `pong` | Liveness every 5 s; three misses mark the peer disconnected. |

A peer with a different `v` gets a toast `Your opponent uses another version. Reload to update.` and the service worker update check is triggered.

### 9.12 Same room in two tabs

The room is guarded with the Web Locks API (`zhess:room:<CODE>`). A second tab on the same device opens the game read-only with the message `This room is open in another tab`.

---

## 10. Computer opponent

### 10.1 Engine

- Stockfish compiled to WebAssembly, lite single-threaded build, run in a Web Worker and driven by UCI text over `postMessage`.
- Single-threaded is required: GitHub Pages cannot send the COOP/COEP headers that `SharedArrayBuffer` needs.
- About 1.8 MB (stockfish.js 19.0.1, `lite-single`). It is not part of the app shell. It is fetched on the first computer game, the first hint, or the first blunder check, and is then cached by the service worker with a `CacheFirst` rule. While it loads, the Start pill shows the Ztyle spinner with progress.
- `useZhessEngine` owns the worker: `bestMove(fen, level)`, `evaluate(fen, depth)`, `multiPv(fen, n, depth)`, `stop()`.

### 10.2 Levels

Twelve levels reuse Zudoku's names. Default is 5. The parameters below are starting values to be tuned by play-testing.

| # | Name | Method |
|---|------|--------|
| 1 | Beginner | MultiPV 6 at depth 4. Picks at random among moves within 400 cp of the best. Captures a hanging queen only half the time. |
| 2 | Novice | MultiPV 5, depth 5, within 300 cp. |
| 3 | Easy | MultiPV 4, depth 6, within 200 cp. |
| 4 | Casual | MultiPV 3, depth 7, within 120 cp. |
| 5 | Medium | Skill Level 3, 200 ms per move. |
| 6 | Moderate | Skill Level 6, 300 ms. |
| 7 | Tricky | Skill Level 9, 400 ms. |
| 8 | Hard | Skill Level 12, 500 ms. |
| 9 | Tough | Skill Level 15, 700 ms. |
| 10 | Expert | Skill Level 18, 1000 ms. |
| 11 | Master | Skill Level 20, 1500 ms. |
| 12 | Insane | Skill Level 20, 3000 ms, or 1/30 of its remaining clock if that is longer. |

Levels 1–4 are "humanized": the error budget produces real mistakes, where Stockfish's own lowest skill settings still play too soundly for a beginner. A never-walk-into-mate-in-1 rule applies from level 3 upward.

The computer answers after a minimum of 400 ms so its moves do not appear to teleport. In timed games the engine respects its own clock.

### 10.3 Undo against the computer

Undo steps back one full turn: the computer's reply and the player's move. Redo replays both. If the player is black and undoes the very first turn, the computer moves again. Clock values return to the stamps stored with the position.

---

## 11. Chess clock

- Optional, chosen on the start screen (section 4.1). `off` is the default.
- Format `minutes+increment seconds`. The increment is added after each completed move (Fischer).
- Display: `m:ss`; below 10 seconds `s.t` with tenths. Below 10 seconds the clock gains `font-bold`; at 0 it shows `0.0` in `destructive`.
- The running clock is driven by `performance.now()` deltas, not by counting ticks, so a throttled background tab cannot drift.
- Solo modes: the clocks pause when the tab is hidden or the player leaves the game with Back, and resume on return.
- Room mode: see section 9.8.
- With the clock off, the time each side used is still recorded per ply and shown in history and review.

---

## 12. History and review

### 12.1 Stored game

```ts
type SavedGame = {
  id: string;                 // code for solo games, `${code}.${n}` for room games
  code: string;
  mode: 'computer' | 'local' | 'room';
  level?: number;             // computer only
  color: 'w' | 'b';           // this device's side; 'w' in pass-and-play
  tc: string | null;          // "5+0" or null
  moves: string;              // compact encoding, section 13.2
  ms: number[];               // time used per ply
  result?: '1-0' | '0-1' | '1/2-1/2';
  by?: Termination;           // mate, resign, time, stalemate, repetition, fifty, material, agreed
  assisted: boolean;
  room?: { n: number; epoch: number };
  createdAt: number;
  lastPlayedAt: number;
};
```

- Saved on every move, undo, redo and result. The last 100 games are kept, newest first.
- The "last played" time changes only if the player changes something or stays 15 seconds, as in Ztyle.
- The undo and redo stack is session-only in solo modes; after a resume, redo is empty.

### 12.2 History list

Below the fold of the start screen: the five most recent cards, then `N more games` opening the full list grouped by time. Each card shows:

- a thumbnail of the current position,
- the code, and for rooms the game number and room score,
- the opponent (`Level 5 Medium`, `2 players`, `Room`),
- the state: `Your move`, `Their move`, or the result (`Won`, `Lost`, `Draw`, `1–0`),
- move count, time control, relative time, and the assisted dot.

Tap resumes an unfinished game or opens a finished one in review. Swipe left or hover × deletes with an undo toast.

### 12.3 Review

The board is read-only. Undo and redo step through the game; holding them jumps to the start or end; arrow keys and a horizontal swipe on the board do the same. The move popover lists all moves and jumps on tap. The player strips show the clocks as they stood at that move.

- **Share** offers the link and `Copy PGN`.
- **Continue from here** (the flag slot) starts a new game from the shown position with a new code. The mode follows the opponent selector's last solo setting: computer at the remembered level, or pass-and-play. Room games cannot be forked into a room.

---

## 13. Persistence and sharing

### 13.1 Storage keys

All values are JSON; every read is wrapped in `try/catch` with a default.

| Key | Content |
|-----|---------|
| `zhess:games` | `SavedGame[]`, at most 100 |
| `zhess:rooms` | `Room[]` |
| `zhess:opponent` | last opponent selector value |
| `zhess:color` | `random` / `w` / `b` |
| `zhess:clock` | last time control |
| `zhess:helpers` | `'true'` / `'false'` |
| `zhess:seating` | `face` / `side` |
| `zhess:lang` | language code |
| `zhess:tutorial-seen`, `zhess:donation-shown`, `zhess:install-dismissed` | flags |

Room keys never leave `zhess:rooms` except in the `welcome` and `grant` messages.

### 13.2 URL

`HashRouter`, state in the query string, written with `replace: true`. The first three parameters keep Zudoku's letters.

| Param | Meaning |
|-------|---------|
| `s` | game code |
| `d` | computer level 1–12 |
| `p` | `1` = playing |
| `o` | opponent: `c` computer, `l` local, `r` room |
| `w` | this side: `w` or `b` |
| `t` | time control, e.g. `5+0` |
| `m` | moves |
| `x`, `y` | manual signalling offer and answer (transient, removed after use) |

**Move encoding.** Each ply is two base64url characters: one for the from-square and one for the to-square (64 squares, 64 symbols). A promotion to anything but a queen adds `.r`, `.b` or `.n`. A 60-move game is about 240 characters.

**What Share sends:**

- Solo game: the full URL. The receiver gets the position with its history as a new local game they can continue or review. Clock times are not carried.
- Room: `?s=<CODE>&o=r` only. Never `m`, never the key. The receiver joins or, if the room is locked, is refused.
- Finished game: the full URL, opening in review, or PGN.

Share texts: `Join my chess game!` (room), `Look at this chess game.` (solo), `I beat Level {level}! Can you?` (win against the computer).

Room games do not write `m` to the address bar, so a screenshot or a copied address never leaks more than the code.

---

## 14. Platform

Everything in Ztyle chapter 12 applies unchanged: PWA manifest, network-first HTML, update toast with hourly check, version stamp, install bottom sheet and pill, GitHub Pages deployment with `base: "./"`.

Additions for Zhess:

- The Stockfish files are excluded from the precache manifest and cached at runtime, `CacheFirst`.
- After the engine has been fetched once, computer games work offline. Pass-and-play works offline from the first load. Rooms need a network.
- Languages: EN, DE, FR, ES, complete including `aria-label`s. Move notation uses figurines from the piece set in the UI and English letters in PGN.
- No sound and no vibration.
- Theme follows the system, light and dark.

### 14.1 Accessibility

- The board is a `grid` of 64 `gridcell`s with labels such as `white knight, g1`.
- A polite live region announces each move in words: `Black: knight to f6, check`.
- Clocks are `role="timer"`. Low time is shown by weight and tenths as well as color.
- Focus ring from Ztyle. `prefers-reduced-motion` removes piece slides and pulses.
- Touch targets of the toolbar are at least 44 px. Board squares are at least 34 px; this is below 44 px on the smallest phones and is accepted because the whole board must fit.

### 14.2 Onboarding

A coach-mark tutorial on the first game, dismissed by tapping anywhere, reachable through `?`. It teaches: tap or drag to move; hold to underpromote; the shield; the bulb (tap and hold); the flag (tap and hold); tap the background to hide the UI.

---

## 15. Technology

### 15.1 Stack

The Ztyle reference stack: React 18, TypeScript, Vite 5 with SWC, Tailwind 3 with the Ztyle preset, the few shadcn/ui primitives actually used, `lucide-react`, `sonner`, `react-router-dom` `HashRouter`, `vite-plugin-pwa`, Vitest.

Additional runtime dependencies, and nothing else:

| Package | Purpose | Licence |
|---------|---------|---------|
| `chess.js` | rules, SAN, FEN, PGN | BSD-2-Clause |
| `peerjs` | signalling and data channel | MIT |
| a small QR generator | manual fallback | MIT |
| Stockfish WASM (lite, single-threaded) | computer opponent, as a static asset | GPL-3.0 |

Exact packages and versions are pinned at implementation time.

### 15.2 Licence

Zhess source is MIT. Stockfish is not linked into the app bundle: it is an unmodified binary in `public/engine/`, loaded as a separate worker and spoken to over UCI text. Its `COPYING` file sits next to it, the README names the upstream source and version, and the start screen's scroll area carries a one-line credit: `computer opponent: Stockfish (GPLv3)` linking to that source.

### 15.3 Project layout

```
src/
  pages/        Index.tsx (the stage), NotFound.tsx
  components/   ChessBoard, Square, Piece (SVG symbols), PlayerStrip, InfoPill, MoveList,
                StatusBar, CodeSelector, OpponentSelector, ColorPill, ClockPill,
                PromotionDial, GameOverOverlay, InviteSheet, ManualConnectSheet,
                RequestToasts, GameHistory, BoardThumbnail, DeleteUndoToasts,
                TutorialOverlay, DonationPrompt, PWAInstallPrompt, InstallButton,
                LanguageSwitcher
    ui/         shadcn primitives in use
  hooks/        useGameState, useSavedGames, useClock, useZhessEngine, useRoom,
                useHelpers, useSeating, useTutorial, useDonationPrompt,
                usePWAInstall, useSWUpdate, use-mobile, use-orientation
  lib/          zhess.ts      pure: game record, move codec, clock math, material, PGN
                levels.ts     pure: level table and move picker
                sync.ts       pure: reconcile, hashing, protocol types
                room.ts       room state machine over a Transport
                transport/    peerjs.ts, manual.ts, memory.ts (tests)
                i18n.tsx, timeUtils.ts, utils.ts
  workers/      engine.worker.ts (UCI bridge)
public/         engine/ (Stockfish + COPYING), icons, og-image, fonts, robots.txt
```

### 15.4 Testing

- `zhess.ts`: move codec round-trips, clock arithmetic including increment and undo, material count, PGN export.
- `sync.ts`: every row of the reconcile rules, including empty-side recovery, stale backup, takeback epochs and the forced fork.
- `room.ts`: two room instances joined by the in-memory transport play through join, lock, challenge failure, rejoin grant and deny, offline move delivery, takeback, draw, rematch, clock pause, version mismatch.
- `levels.ts`: the picker respects its error budget with a seeded PRNG.
- Components: board input paths (tap, drag, keyboard, SAN), promotion dial, premove.
- A manual two-browser checklist for real WebRTC, including the QR fallback, before each release that touches rooms.

`npm run lint`, `npm test` and `npm run build` pass before every push.

---

## 16. Milestones

| Milestone | Contents | Done when |
|-----------|----------|-----------|
| **M1 · Board** | Project scaffold with Ztyle, piece set, board with all input paths, rules through `chess.js`, pass-and-play with both seatings, undo and redo, automatic endings, resign, game-over overlay, autosave, history, review with "continue from here", URL state and sharing, PWA shell, i18n, tutorial. | Two people can play a full game on one phone, close the app, and find it in history. |
| **M2 · Computer** | Lazy Stockfish worker, 12 levels, hint bulb and threat peek, blunder guard, chess clock with presets and custom dial, premove, draw offer to the computer, assisted marker, donation prompt. | A beginner beats level 1 and a club player loses to level 12, offline. |
| **M3 · Rooms** | Transport abstraction, PeerJS transport, room record and seat lock, reconcile, recovery, offline moves, takeback, draw and rematch requests, room clocks with pause, presence dot and toasts, invite sheet, manual link and QR fallback, tab lock. | Two phones on different networks finish a series; one clears its storage mid-game and is restored with one tap. |

The Ztyle launch checklist is run after M3.

---

## 17. Risks and open questions

**Risks**

1. **The public PeerJS broker is one third party.** If it is down or rate-limits, rooms depend on the manual fallback. A `zhess:signal` override to point at another PeerServer is cheap to add and not yet decided.
2. **STUN only.** A share of network pairs (symmetric NAT, some mobile carriers) will never connect. The decision is to say so plainly.
3. **Manual fallback on iOS.** An installed PWA and Safari do not share storage or `BroadcastChannel`, so the answer link may open in the wrong context. The paste field covers this, but the flow needs testing on real devices.
4. **Offer size in a QR.** A compressed SDP offer must stay within a scannable QR. If it does not, the manual path falls back to links only.
5. **Blunder guard latency.** A 150 ms budget at useful depth on a low-end phone is unproven. If it cannot be met, the guard runs only on levels where the engine is otherwise idle, or is cut down to mate-in-1 and hanging-piece detection without the engine.
6. **Level feel.** The level table is a guess until played.
7. **Engine size.** 1.8 MB is fetched on first use; the progress indicator and one-time caching are the mitigation.

**Open questions**

- The repository `izzardry/zhess` is private at the time of writing. Public release timing is undecided.
- Which bundled mono typeface (follow whatever Ztyle chapter 4 fixes).
- The small easter egg required by the launch checklist beyond the shared 3-second help press.
- Whether the support link stays personal as in Zudoku.
- Whether to show the room score anywhere outside the info pill and history cards.
