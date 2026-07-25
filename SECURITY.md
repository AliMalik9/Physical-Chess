# Security

BoardLink has no accounts. "No account" is a product decision, not a security
posture — a private game between two people still has to stay private.

## What replaces a login

| Secret | Size | Where it lives | What it authorises |
| --- | --- | --- | --- |
| Invite secret | 128 bits | URL **fragment** | Claiming the second seat |
| Seat token | 256 bits | `localStorage`, scoped to one room | Acting as that seat, forever |
| Room code | 8 chars ≈ 39 bits | Spoken aloud, typed | Finding a room; claiming a free seat |

All three come from `crypto.getRandomValues`. Only hashes are stored:
`SHA-256`, compared in constant time (`worker/crypto.ts`). SHA-256 is
appropriate here because every hashed value is a high-entropy random token —
there is no user-chosen password to brute-force, so a slow KDF would buy nothing
but latency.

### The invite secret goes in the fragment

`https://boardlink.example.com/room/BNXWZK43#<secret>`

Browsers never send the fragment to the server. The secret therefore stays out
of access logs, `Referer` headers, and any analytics or error reporting that
records URLs.

### The room code is deliberately weaker

The code exists so someone can read it across a table. Eight characters from a
31-symbol alphabet is roughly 8.5 × 10¹¹ codes — not a cryptographic secret, and
not treated as one. It is protected by rate limiting instead:

- code lookups: 25 per 10 minutes per IP
- room creation: 12 per 10 minutes per IP
- socket upgrades: 60 per minute per IP

The alphabet omits `0`, `1`, `I`, `L` and `O`. Characters outside it are
**rejected rather than corrected** — there is no correct guess for what the user
meant, and silently substituting one could drop them into a stranger's room.

## Seat and turn enforcement

Everything is checked server-side, in the Durable Object, against its own
position:

- A room has exactly two seats. A third arrival is refused with `room_full`.
- A move must come from the colour to move, in the right phase, at the right
  sequence number, and must be legal from the server's position.
- A copy confirmation cannot come from the player who made the move.
- Every state-changing action carries a client `actionId`; the last 64 are
  remembered, so retries are no-ops.
- A stale `expectedSequence` is rejected, so a move composed against an old board
  can never land on the live one.

Duplicate tabs sharing a seat are resolved by making the newest connection
primary; older ones become read-only and cannot act.

## Transport

- **Origin validation** on the WebSocket upgrade. Same-origin by default;
  `ALLOWED_ORIGINS` widens it explicitly. A cross-site page cannot open a socket
  into a room using a scraped or guessed code.
- **HTTPS only** in production, with HSTS.
- **Content Security Policy** (`public/_headers`): `default-src 'self'`,
  `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`,
  `frame-ancestors 'none'`, plus `nosniff`, `no-referrer` and `DENY` framing.
- **No inline scripts.** `script-src` is `'self'` with no `'unsafe-inline'` and
  no hash allowances, and the built HTML contains zero inline `<script>` tags.
  The theme has to be applied before the first paint, so that code lives in
  `public/theme-init.js` and is loaded render-blocking from the same origin
  rather than inlined. All assets — board, pieces, fonts, scripts — are
  same-origin; the app loads nothing from a third party at runtime.
- Room pages are `Cache-Control: no-store` and `X-Robots-Tag: noindex`.

## Input handling

- Display names are clamped to 24 characters and stripped of control characters,
  zero-width characters and bidi overrides (`\p{Cc}`, `\p{Cf}`) as well as angle
  brackets — a name cannot smuggle markup or render as something it is not.
- Frames over 4096 bytes are rejected before parsing.
- Malformed JSON, unknown event types and mismatched protocol versions are
  rejected without touching room state.

## What is stored

Per room: the code, hashed secrets, display names, the move list, clocks and the
result.

Deliberately **not** stored: email addresses, passwords, IP addresses, contact
lists, device fingerprints, or any identifier that survives a game. The only
cross-room value on a device is the display name you last typed, so you do not
have to retype it.

There is no public lobby, no room list and no enumerable index. Room identifiers
are random, never sequential.

## Retention

| Room | Deleted after |
| --- | --- |
| Created but never joined | 1 hour |
| Active | 24 hours of inactivity |
| Completed | 24 hours (so the PGN can still be downloaded) |

Deletion is a Durable Object alarm calling `storage.deleteAll()`. There is no
archive and no backup of game contents.

## Error reporting

No game contents, room codes or secrets are included in client error payloads by
default. Failures surface to the player as plain sentences from
`src/lib/errorCopy.ts`; raw server responses are never rendered.

## Known limitations

- **Anyone with the link can take the free seat.** That is the design: it is
  what makes the product work without accounts. The app says so on the
  How it works page. Share the link only with the person you want to play.
- **A seat token in `localStorage` is a bearer token.** Anyone with access to the
  browser profile can resume that seat. Games are short-lived and contain
  nothing but chess moves, which is why this trade is acceptable.
- **`RATE_LIMIT_MULTIPLIER` must not be set in production.** It exists because
  local requests carry no `CF-Connecting-IP` and therefore share a single bucket,
  which would otherwise throttle a test run.

## Reporting a vulnerability

Open a private security advisory on the repository rather than a public issue.
