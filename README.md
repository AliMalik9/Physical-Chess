# BoardLink

BoardLink lets two people play one chess game on two ordinary physical boards.
It preserves the approved HeroUI v3 interface while Supabase provides anonymous
identity, Postgres persistence, Edge Function validation and private Realtime.

## Local development

```bash
npm install
cp .env.local.example .env.local
npx supabase start
npx supabase db reset
npm run dev
```

Copy the local publishable key printed by `supabase start` into `.env.local`.
Anonymous sign-in must be enabled (it is enabled in `supabase/config.toml`).
Use two separate browser profiles for the two players.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite client at localhost:5173 |
| `npm run typecheck` | TypeScript validation |
| `npm test` | Vitest unit/component suite |
| `npm run test:e2e` | Playwright against local Supabase and localhost only |
| `npm run build` | Production Vite build |
| `npm run supabase:start` | Start local Supabase/Docker services |
| `npm run supabase:reset` | Apply migrations to the local database |
| `npm run supabase:functions` | Serve Edge Functions locally |

## Architecture and deployment

The browser contains only `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY`. It never receives a database password,
secret/service key, or invite-token hash. See [ARCHITECTURE.md](ARCHITECTURE.md),
[SUPABASE_SETUP.md](SUPABASE_SETUP.md), [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md),
[SECURITY.md](SECURITY.md), and [REALTIME_PROTOCOL.md](REALTIME_PROTOCOL.md).

Clearing browser storage clears the anonymous session and may lose access to a
player's existing seat. This is an intentional consequence of no visible
registration. Production should enable Supabase CAPTCHA/rate limits if abuse
becomes a concern; BoardLink does not show a CAPTCHA by default.

The board uses vendored Lichess Brown and Maestro artwork. Read
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before any commercial release.
