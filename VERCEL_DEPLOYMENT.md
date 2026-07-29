# Vercel deployment

Import the repository. `main` is production and pull requests/non-main branches
receive Preview deployments. `vercel.json` builds `dist` and rewrites SPA routes
such as `/room/:roomId` to `index.html`.

Set these Vercel variables for Development, Preview, and Production:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are also
supported for an existing Vercel setup, but `VITE_` is the preferred convention.
A variable change requires a new deployment. Do not configure a secret/service
key, database password, or connection string in Vercel.

Deploy in this order: tests; backward-compatible migration; Edge Functions;
Vercel frontend; two-private-context smoke test. Do not run destructive
production migrations from untrusted Preview branches.
