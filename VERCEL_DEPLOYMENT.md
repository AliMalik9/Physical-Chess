# Vercel deployment

Import the repository. `main` is production and pull requests/non-main branches
receive Preview deployments. `vercel.json` builds `dist` and rewrites SPA routes
such as `/room/:roomId` to `index.html`.

Set these Vercel variables for Development, Preview, and Production:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Vite bundles only `VITE_` values, therefore the publishable key is the only key
allowed there. A variable change requires a new deployment. Do not configure a
secret/service key, database password, or connection string in Vercel.

Deploy in this order: tests; backward-compatible migration; Edge Functions;
Vercel frontend; two-private-context smoke test. Do not run destructive
production migrations from untrusted Preview branches.
