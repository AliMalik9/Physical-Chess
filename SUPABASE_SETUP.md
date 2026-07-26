# Supabase setup

1. Create a Supabase project in the desired region and enable Anonymous Sign-Ins.
2. Enable Realtime and require private channels. Apply `supabase/migrations`.
3. Deploy `room-create`, `room-join`, `room-snapshot`, and `room-action`.
4. Set Edge Function secret `ALLOWED_ORIGINS` to comma-separated production,
   preview, and custom origins. Localhost is built in for development.
5. Confirm Edge Functions have Supabase-provided `SUPABASE_URL` and
   `SUPABASE_SECRET_KEY`; never copy either to Vercel or a `VITE_` variable.
6. Review RLS and the Realtime `realtime.messages` policy, then schedule
   `select public.expire_boardlink_rooms()` at least hourly with Supabase Cron.
7. Configure anonymous-user retention only after confirming it does not delete
   a user that still owns an active `rooms` row.

For local work use `npx supabase start`, `npx supabase db reset`, and
`npx supabase functions serve`. Generate database types with
`npm run supabase:types` after a local reset.
