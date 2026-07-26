# Realtime protocol

All private Broadcast payloads use:

```ts
{ protocolVersion, roomId, eventId, version, moveSequence, serverTimestamp, type, payload }
```

The topic is `room:<room UUID>:game`. Realtime RLS permits subscription only to
authenticated users listed in `room_players`. Events are emitted only after an
action RPC commits. Clients deduplicate `eventId`, reject another room's events,
ignore stale versions, and fetch `room-snapshot` on a version gap.

Broadcast carries compact committed events such as `player_joined`,
`submit_move`, `confirm_move_copied`, undo/draw decisions, resignation and room
expiry. Presence only reports online/offline seat status. It is tracked once on
subscription and is never used for moves, clocks, or heartbeat traffic.
