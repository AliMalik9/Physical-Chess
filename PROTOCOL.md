# Protocol

The wire contract lives in [`shared/protocol.ts`](shared/protocol.ts) and is
imported by both the browser and the Durable Object, so this document and the
types cannot drift apart.

Current version: **`PROTOCOL_VERSION = 1`**.

A socket announcing a different version is rejected with `protocol_mismatch`
rather than being allowed to corrupt a game. The client renders that as “This
page is out of date — reload to carry on.”

---

## HTTP

All endpoints are under `/api/`. Everything else serves the SPA.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/rooms` | Create a room. Returns the code, invite secret and the creator's seat token. |
| `GET` | `/api/rooms/:code` | Resolve a code before joining: does it exist, is a seat free, who is waiting. |
| `GET` | `/api/rooms/:code/ws` | WebSocket upgrade. |
| `GET` | `/api/rooms/:code/pgn?seat=…` | Download the PGN. Requires a valid seat token. |

`POST /api/rooms` body:

```jsonc
{
  "displayName": "Alex",          // optional, defaults to "Player 1"
  "side": "white",                // "white" | "black" | "surprise"
  "speed": "none"                 // "none" | "10" | "30"  (minutes)
}
```

Response:

```jsonc
{
  "roomId": "…",
  "publicCode": "BNXWZK43",
  "inviteSecret": "…",            // 128 bits, base64url — goes in the URL fragment
  "seatToken": "…",               // 256 bits — stored on the device only
  "color": "white"
}
```

Errors are `{"error": ErrorCode, "retryAfter"?: number}` with a matching status.
Raw server errors are never shown to a player; `src/lib/errorCopy.ts` maps every
code to a sentence saying what happened and what to do next.

---

## Envelope

Every frame in both directions carries:

```ts
{
  v: number;        // protocol version
  roomId: string;
  eventId: string;  // unique per event; makes replays detectable
  ts: number;       // server time on server messages, advisory on client ones
  type: string;     // discriminant
  // …event-specific fields
}
```

Actions that change state also carry a client-generated `actionId`. The room
remembers the last 64 and ignores repeats, so a retry after a flaky send is a
no-op rather than a second move.

Frames larger than 4096 bytes are rejected unparsed.

---

## Client → server

| Event | Fields | Notes |
| --- | --- | --- |
| `join_room` | `inviteSecret?`, `seatToken?`, `displayName?` | Sent on every connect. The server decides whether this device already owns a seat. |
| `resume_seat` | `seatToken` | Explicit reclaim; `join_room` covers this case too. |
| `submit_move` | `from`, `to`, `promotion?`, `expectedSequence` | Rejected unless `expectedSequence` matches the server's. |
| `confirm_move_copied` | `sequence` | “Done — I moved it.” |
| `request_undo` | `targetSequence` | |
| `respond_to_undo` | `accept` | Only the other player may answer. |
| `offer_draw` | | |
| `respond_to_draw` | `accept` | |
| `resign` | | |
| `heartbeat` | | Keeps presence fresh; carries no state. |
| `leave_room` | | |

## Server → client

| Event | Sent to | Carries |
| --- | --- | --- |
| `room_snapshot` | one socket | Complete room state, plus `seatToken` the first time a seat is granted |
| `player_joined` | others | The new player and a fresh snapshot |
| `player_presence_changed` | others | Colour, connected, clock |
| `move_accepted` | the mover | The serialised move, new sequence, phase, clock, result |
| `move_rejected` | the mover | `code`, the `actionId` that failed, current sequence |
| `move_received` | the opponent | Same payload as `move_accepted` |
| `move_copied` | both | Sequence, who confirmed, new phase |
| `turn_changed` | both | Turn, phase, sequence, check, clock |
| `undo_requested` | the opponent | The request and the requester's name |
| `undo_resolved` | both | Whether it was accepted, plus a full snapshot |
| `draw_offered` | the opponent | The offer and the offerer's name |
| `draw_resolved` | both | A declined offer (an accepted one ends the game) |
| `game_completed` | both | The result and a full snapshot |
| `room_expired` | both | |
| `error` | one socket | `code`, optional `actionId`, optional `retryAfter` |

Events carrying a snapshot are built **per socket**, because a snapshot includes
a `you` field describing that connection's own seat. Broadcasting one shared
snapshot would tell one of the two players they are nobody.

---

## State machine

```ts
type RoomStatus = "waiting_for_opponent" | "active" | "completed" | "expired";

type TurnPhase =
  | "waiting_for_move"
  | "move_submitted"
  | "waiting_for_copy_confirmation";
```

```
waiting_for_move ──submit_move──► move_submitted
                                        │
                        receiver's socket is live
                                        ▼
                        waiting_for_copy_confirmation
                                        │
                              confirm_move_copied
                                        ▼
                    waiting_for_move  (opposite colour)
```

### A move is accepted only when all of these hold

- the room is `active`
- the sender occupies the colour to move
- the phase is `waiting_for_move`
- the move is legal from the server's own position
- `expectedSequence` equals the server's `moveSequence`
- the connection is the seat's primary one (not a duplicate tab)
- the game is not already over

### A copy confirmation is accepted only when

- the phase is `move_submitted` or `waiting_for_copy_confirmation`
- `sequence` equals the server's `moveSequence`
- the confirming player is **not** the player who made that move
- the connection is the seat's primary one

That third condition is load-bearing. Without it the mover could confirm their
own move, take a second turn, and leave the two wooden boards showing different
positions — which is the one failure this product cannot recover from.

### Rejected outright

Duplicate `actionId`s · stale sequences · out-of-turn moves · confirmations of a
move you made · replayed frames · a third player · oversized frames · mismatched
protocol versions.

---

## Reconnection

The client never reconciles by hand. On connect it sends `join_room` with
whatever seat token it has, and rebuilds entirely from the `room_snapshot` it
gets back.

Backoff is exponential with jitter, capped at 8s, and reset immediately when the
tab becomes visible or the browser reports `online` — a phone coming off standby
should not wait out a backoff.

While reconnecting, move submission is disabled and the current instruction stays
on screen. The board is never reset. On success the client shows “Back in the
game.”

## Presence and clocks

Presence changes on socket close, not on a timer. A disconnect starts a 30-second
grace period; only after that does a running clock pause, so a brief tunnel does
not stop the game. The seat is held for 10 minutes, and a player is never
resigned automatically.

Clocks switch to the opponent when a move is **accepted**, so the time spent
copying a move onto wood comes out of the copier's own turn.

## Expiry

| Room | Lifetime |
| --- | --- |
| Created but never joined | 1 hour |
| Active | 24 hours from the last action |
| Completed | 24 hours, so both players can still download the PGN |

Expiry is enforced by a Durable Object alarm, which is also used for clock
flag-fall and the disconnect grace period — the object has one alarm, so it
wakes at the earliest of the three and re-evaluates.
