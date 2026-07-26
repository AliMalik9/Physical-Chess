# Migration from Cloudflare

BoardLink previously used a Cloudflare Worker, Durable Objects, hibernating
WebSockets, Wrangler, and Worker-local rate limiter. Those files/configuration
have been removed. Vercel now serves only the Vite SPA; Supabase owns identity,
database state, Edge Functions, private Broadcast, and Presence.

| Previous | Current |
| --- | --- |
| Durable Object room state | `rooms`, `room_players`, `moves` in Postgres |
| Worker HTTP/WebSocket routes | Supabase Edge Functions |
| Worker WebSocket messages | private Realtime Broadcast envelope |
| DO alarms | `expire_boardlink_rooms()` scheduled with Supabase Cron |

Rollback: retain the previous production deployment until Supabase migration,
functions, RLS, and a two-browser smoke test are verified. Database migrations
are additive; any destructive cleanup should be a later, separately reviewed
migration. Known limitation: anonymous identities are browser-storage scoped.
