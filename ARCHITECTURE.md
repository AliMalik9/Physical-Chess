# Architecture

## The one idea

Two people are looking at wood, not at a screen. Everything here follows from
that.

The consequence is that **the two physical boards can silently disagree**, and
no amount of server correctness can fix a game once they do. So the system is
built around a single guarantee: a move is not "played" until the receiving
player has said, in so many words, that they moved the piece on their own board.
That handshake is the reason the turn phase has three states instead of two, and
the reason the most detailed screen in the product is the one that just tells you
which piece to pick up.

## Shape

```
Browser (React)                 Cloudflare edge
┌────────────────────┐          ┌──────────────────────────────────────┐
│ routes/Room.tsx    │          │ worker/index.ts                      │
│  useRoomConnection │◄────────►│  routing · origin check · rate limit  │
│  snapshotReducer   │ WebSocket│                 │                     │
│  gameView          │          │                 ▼                     │
│                    │  HTTPS   │ GameRoom (Durable Object, one/game)   │
│ components/board   │─────────►│  roomLogic.ts  — state machine        │
│  (input only)      │          │  chess.js      — the real position    │
└────────────────────┘          │  storage       — room + move list     │
                                └──────────────────────────────────────┘
                                          ▲
                                RateLimiter (Durable Object, one/bucket)
```

`shared/` is imported by both sides, so the wire contract, the chess adapter and
the plain-language move text cannot drift between client and server.

## Why a Durable Object per room

A chess game is a small piece of state with exactly two writers who must agree on
ordering. That is precisely what a Durable Object is for: single-threaded
execution, co-located storage, and a natural home for the WebSockets belonging to
that game. No locking, no transactions, no shared database.

The object is addressed by `idFromName(publicCode)`. That means a room can be
found from a code someone read out loud without keeping a directory of live
games — there is no table to enumerate and no index to leak.

WebSocket **hibernation** (`ctx.acceptWebSocket`) lets the object be evicted from
memory between moves while the sockets stay open. A game where both players are
staring at a board for four minutes costs nothing.

## The authority boundary

The Durable Object owns:

- the position (a live `chess.js` instance, rebuilt from the stored move list on
  every cold start)
- the move sequence number
- the turn phase
- who occupies which seat
- clocks, undo requests, draw offers and the result

The client owns nothing that matters. It runs `chess.js` too, but only to light
up legal destination squares and to render the confirmation panel before
anything is sent. Every move is validated again on the server against its own
position. A client that lies is simply rejected.

On reconnect the client does not attempt to reconcile: it throws away what it had
and rebuilds from a `room_snapshot`. Normal play uses small deltas; anything that
rewrites history sends a whole snapshot.

## Why the state machine is a separate file

`worker/roomLogic.ts` contains the rules — may this player move, is this
confirmation valid, whose clock is running — as pure functions over a plain
`RoomState`. `worker/GameRoom.ts` is the shell that persists the result and
pushes it down the socket.

The split exists so the rules can be tested directly, without a Workers runtime,
a socket or a fake clock. That paid for itself: the unit tests caught a case
where the player who *made* a move could also confirm it had been copied, which
would have handed them a second turn and desynchronised the two boards.

## Move storage

Moves are stored one per key (`m:0001`, `m:0002`, …) rather than as a single
array. A long game would otherwise approach the per-value size limit, and
zero-padded keys mean `storage.list()` returns them already in order.

The position is **replayed** from that list rather than restored from a FEN.
A FEN cannot express threefold repetition or the fifty-move counter, so a room
restored from one would eventually disagree with the players about whether the
game was drawn. Replaying is O(moves) and a chess game is short.

The same reasoning applies to undo: the last move is dropped and the remaining
list is replayed into a fresh instance, rather than calling `chess.undo()`.

## Turn phases

```
waiting_for_move
  │  submit_move (validated against the server's position)
  ▼
move_submitted                    ← accepted, but nobody has seen it yet
  │  the receiving player's socket is live
  ▼
waiting_for_copy_confirmation     ← they are physically moving a piece
  │  confirm_move_copied
  ▼
waiting_for_move  (other colour)
```

`move_submitted` and `waiting_for_copy_confirmation` look redundant until someone
disconnects mid-move. The first says "delivered to the room"; the second says
"actually in front of a human". A player who reconnects into the second state
gets the instruction again; a player who reconnects into the first is simply
handed it for the first time.

## Client state

Three layers, each with one job:

- **`useRoomConnection`** owns the socket: reconnect with exponential backoff and
  jitter, heartbeats, and waking immediately on `online` or a tab becoming
  visible (a phone coming off standby is the common case).
- **`snapshotReducer`** folds server events into the local `RoomSnapshot`. It
  never invents state; anything it cannot derive comes from the FEN the server
  sent.
- **`gameView.deriveView()`** turns the snapshot plus your colour into one of six
  screens. Every rendering decision reads from it, which is what makes "a child
  can always identify the next action" something you can actually check — and
  test.

## Duplicate tabs

Each socket gets a connection id; each seat records which connection is primary.
The newest tab becomes primary and older ones go read-only — they see everything
and may change nothing.

When the primary tab closes, primary status is handed to a surviving tab. Without
that the seat stays pinned to a dead connection and every remaining tab is locked
out. (This was a real bug, found by driving the app rather than by reading it.)

## Layout

Frame-first. The game screen is a fixed `100dvh` frame that never scrolls as a
page; each region opts into its own scrolling.

```
> 1024px   board fills the height | 352-384px contextual panel beside it
<= 1024px  board first, action panel pinned beneath it in thumb reach
```

`dvh` rather than `vh` is load-bearing on phones: with `vh` the primary action
sits behind Safari's collapsing toolbar exactly when the player needs to press
it.

`BoardFrame` measures the space actually left over with a ResizeObserver and
sizes the board to the largest square that fits, then pins the player strips to
that same width so they read as part of the board. Breakpoints could not do
this — the constraint depends on the strips, the browser chrome and the
safe-area inset, none of which a media query knows about.

The board is given an explicit pixel box, so it can never be squeezed out of
square by a flex parent.

## The board component

`react-chessboard` was removed during the redesign. It could not render the
exact Lichess artwork cleanly, and its draggable pieces were `role="button"`
elements with no accessible name — which had previously been patched over with a
MutationObserver. A purpose-built component is about 300 lines and removes both
problems.

Its shape:

- **One background image.** `brown.png` is the complete 8x8 Lichess board, so it
  is stretched across the square exactly once — never tiled, never cropped.
- **64 real `<button>` elements** form the interaction and accessibility layer.
  They own every pointer and keyboard event and describe themselves to screen
  readers.
- **Pieces are a separate, purely visual layer** positioned with CSS transforms,
  so movement runs on the compositor and never triggers layout. They are
  `pointer-events: none`; all input lands on the buttons underneath.
- **Orientation lives in `geometry.ts` and nowhere else.** Everything else works
  in real square names, so flipping the board cannot flip the meaning of a move.

Tap and drag are one code path: a press records its origin, and whether it
travelled past a threshold decides whether it was a tap or a drag on release.
A press that starts on an empty square is still tracked — that is how
tap-to-move reaches its destination, and forgetting it was a real bug during
the redesign.

Move animation keys pieces by square, so the piece that just arrived is a freshly
mounted element. Mounting it at the *origin* square and moving it to its real
square on the next frame is what makes the CSS transition run. Castling animates
the rook alongside the king.

## Theming

HeroUI v3 is CSS-driven, so there is no theme provider. The theme is a class and
a `data-theme` attribute on `<html>`.

`src/styles/theme.css` overrides HeroUI's built-in `light` and `dark` themes
rather than declaring new theme names. That matters: `useTheme()` writes
`light`/`dark`, so overriding them keeps one controller and system mode working
with no extra wiring.

The inline script in `index.html` replays the same resolution before the first
paint — React mounts too late to prevent a flash on its own. It reads the same
`heroui-theme` key `useTheme()` persists, including the `system` intent.

The board artwork is deliberately outside the theme: `--board-image` is declared
once, not per theme, so the wood is identical in light and dark. Coordinate
contrast is therefore keyed to the square underneath rather than to the app
theme, which is the only way it stays readable in both.

## Performance

Only the landing screen is in the first bundle. `/join`, `/how-it-works` and the
room are separate chunks, and the start-game modal loads on first open. chess.js
never reaches the landing page.

An earlier `manualChunks` config was removed after it was found to pull the board
into the entry graph — expressing splits as dynamic imports and letting the
bundler chunk them produced a smaller first load than hand-tuning.

The board and all twelve pieces are decoded before a game is shown. Without that
the pieces pop in one at a time as each SVG arrives, which on a board someone is
trying to copy from looks exactly like pieces moving.

Pieces are memoised individually and positioned with transforms, so dragging or
re-highlighting squares never re-renders 32 images or triggers layout. Clocks
tick inside a memoised `ClockChip`, so a running clock repaints six characters
rather than re-rendering the board every second.
