# Redesign notes

What changed when BoardLink moved from Astryx to HeroUI v3, and — kept
deliberately separate — the defects found along the way.

## What was preserved

The redesign did not touch the parts that were working:

- `worker/` — the Durable Object, room state machine, rate limiter and crypto
  are byte-for-byte unchanged.
- `shared/` — the wire protocol, the chess.js adapter and the plain-language
  move generator are unchanged.
- `src/hooks/useRoomConnection.ts`, `src/lib/snapshotReducer.ts`,
  `src/lib/gameView.ts`, `src/lib/api.ts`, `src/lib/seatStorage.ts`,
  `src/router.tsx` — reconnection, seat restoration and view derivation are
  unchanged.

All 126 unit tests covering that logic still pass without modification.

## What was replaced

| Before | After | Why |
| --- | --- | --- |
| Astryx Neutral, dark only | HeroUI v3 + a warm BoardLink theme, light/dark/system | Brief |
| `react-chessboard` | `src/components/board/` | See below |
| Board ~480px in a padded column | Board sized to the largest square that fits | Brief |
| Panels stacked in a scrolling page | Fixed `100dvh` frame, two-column on desktop | Brief |
| Separate panel components per state | One `TurnPanel` with a state per branch | One dominant action per state |

### Why `react-chessboard` was removed

1. It could not render the exact Lichess Brown board and Maestro pieces cleanly.
2. Its draggable pieces were `role="button"` elements with no accessible name.
   The previous build worked around this with a `MutationObserver` that injected
   `aria-label`s into the library's DOM — a hack that also had to re-run on every
   animation frame to catch newly mounted pieces.

The replacement is ~300 lines, renders the artwork exactly, and makes every
square a real labelled `<button>`, so the workaround is gone.

---

## Defects found

These are bugs, not styling. Listed separately as requested.

### Fixed during this redesign

**1. Tap-to-move could not reach an empty square.**
`Board` only recorded pointer state when the press landed on a piece the player
could pick up. Pressing a legal *destination* — always an empty square for a
non-capture — was therefore ignored, so tap-to-move silently did nothing. Drag
worked, which is why it was not obvious. Fixed by tracking every press and using
`canDrag` to decide only whether it may become a drag.

**2. The board was unreachable by keyboard.**
Every square button was `tabIndex={-1}`, so Tab skipped the board entirely and
there was no way in. Fixed with a roving tabindex: one square is tabbable and
the arrow keys move between squares.

**3. `aria-label` on a generic element.**
The connection status was a `<span aria-label="Connection: …">`. `aria-label` is
prohibited on an element with no role, and axe flagged it on mobile — where the
visible text was hidden, leaving no accessible name at all. Fixed by making the
label real text that is visually hidden only on narrow screens.

**4. The no-flash theme script was blocked by the production CSP.**
The theme was applied by an inline `<script>` in `index.html`, but
`public/_headers` sets `script-src 'self'` with no hash — so the script would
have been blocked in production while working perfectly in development, where
`_headers` is not applied. The symptom would have been a theme flash on every
production load and nothing else. Moved to `public/theme-init.js`, loaded
render-blocking from the same origin. The built HTML now contains zero inline
scripts.

**5. The waiting room claimed the opponent was thinking.**
`TurnPanel` had no branch for `waiting_for_opponent`, so it fell through to the
"opponent's turn" copy — telling the host that a player who had not yet joined
was "making a move on their board". Fixed with a dedicated branch.

### Fixed in the previous build, recorded here for completeness

**6. A seat could be locked read-only forever.** When the tab holding a seat
closed, `primaryConnectionId` kept pointing at the dead socket, so every
surviving tab was permanently unable to move. Fixed by handing primary status to
a survivor.

**7. A player could confirm their own move.** `guardConfirmCopy` checked that the
opponent's *seat existed* rather than that the confirmer was the receiver, so the
mover could confirm their own move, take a second turn, and silently
desynchronise the two physical boards. Fixed by passing the last move's colour
into the guard.

---

## Known issues not fixed

**HeroUI Spinner has no accessible name.** `@heroui/react@3.2.2` renders
`<span data-slot="spinner"><svg aria-hidden role="presentation"/></span>`. There
is no `label` prop and the SVG is hidden, so a spinner alone announces nothing.
Every spinner in BoardLink sits beside real text ("Preparing the board",
"Waiting for the other player…"), so nothing is lost — but a standalone spinner
would be silent.

**react-aria's LiveAnnouncer leaves an empty `role="img"` node.** Its
visually-hidden announcement region retains an element whose `aria-labelledby`
points at a removed node, which axe reports as `role-img-alt`. It is excluded
from the axe scan via `[data-live-announcer]`; see ACCESSIBILITY.md.

**The piece set is non-commercial.** Maestro is CC BY-NC-SA 4.0. See
THIRD_PARTY_NOTICES.md before monetising anything.

**Firefox is configured but unverified.** The `firefox` Playwright project is in
`playwright.config.ts` and will run in CI, but Firefox could not be launched on
the machine this was built on — the OS refuses to spawn the binary
(`browserType.launch: spawn UNKNOWN`, and `Permission denied` when run directly),
which is an environment restriction rather than a problem with the app or the
config. Chromium (desktop and mobile) and WebKit both pass. Someone should run
the suite once on a machine where Firefox launches.

---

## Test changes

The e2e suites were updated for the new UI rather than rewritten:

- `"Your turn"` became a state label; the heading is now `"Make your move"`.
- HeroUI renders radio and checkbox inputs visually hidden, so the specs click
  `label[data-slot="radio-content"]` instead of the input.
- The invite URL is read from the address bar rather than scraped from the page.
- Piece assertions use the square's accessible name
  (`"D4, white pawn, part of the last move"`) rather than a DOM structure, since
  pieces now render in a separate layer.

Added: `e2e/theme.spec.ts` (system preference, persistence, no-flash, switching
mid-game without disturbing room state, identical board artwork in both themes,
and a dark-mode axe scan) and `e2e/screenshots.spec.ts`.

---

## Deployment

Two bugs surfaced when this was first pushed to Vercel, both mine.

**`worker-configuration.d.ts` was gitignored.** It is generated by
the former Worker type generation used an isolated `"types": []` setup — so every
Workers runtime global (`Request`, `Response`, `URL`, `WebSocket`, `crypto`)
comes from that one file. The build passed locally because the file existed
there and failed on any fresh clone with ~110 `TS2304` errors. It is now
committed, with a header saying why. Verified by copying the repo minus every
gitignored path and running `npm install && npm run build`.

**Vercel served a 404 for the whole site.** The Cloudflare Vite plugin emits to
`dist/client` and `dist/boardlink`, but Vercel looks for `index.html` in
`dist`. Fixed with `vercel.json` (`outputDirectory`, SPA rewrite, and the
security headers that `public/_headers` provides on Cloudflare — Vercel ignores
that file).

Neither fix makes Vercel able to host the *backend*. Durable Objects have no
equivalent there, so the Worker runs on Cloudflare either way. `VITE_API_ORIGIN`
plus CORS on the Worker exist to support that split; see the README.
