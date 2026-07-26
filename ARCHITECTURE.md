# Architecture

```text
React/Vite on Vercel
  └─ Supabase browser client (publishable key only)
      ├─ Anonymous Auth
      ├─ Edge Functions: create, join, snapshot, action
      └─ private Realtime Broadcast + Presence
              └─ Postgres rooms, room_players, moves
```

`src/services/gameBackend/` is the sole infrastructure adapter. Components keep
their existing domain snapshot and UI contracts. It initializes one persisted
anonymous identity, invokes Edge Functions for all writes, and owns one private
`room:<uuid>:game` channel per active tab.

Postgres is authoritative. Edge Functions validate chess moves with `chess.js`,
then call version-checked SQL RPCs. The RPC transaction writes the move and
increments `rooms.version`; a conflict returns `room_version_conflict` and the
client fetches one snapshot. The recipient must confirm the physical copy before
the next playable turn.

There is no polling, application heartbeat, manual WebSocket, per-second clock
write, or custom reconnect loop. On Realtime resubscribe or an event gap, the
client fetches a single authoritative snapshot.
