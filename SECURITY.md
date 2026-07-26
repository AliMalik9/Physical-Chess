# Security

Anonymous Supabase Auth gives each browser a non-PII identity without a sign-in
screen. Invite tokens are random, travel in URL fragments, and only their SHA-256
hashes are stored. Public codes omit ambiguous characters but are not the primary
credential and never reveal room state by themselves.

RLS is enabled on every application table. Members can read their own room,
players, and moves; browser clients have no direct insert/update/delete policy.
The Edge Functions verify the caller JWT and use the authenticated user rather
than a supplied user id. Authoritative mutations are transactional RPCs with
expected-version and client-action-id checks.

The browser bundle receives only the project URL and publishable key. Secret or
service keys exist only as Supabase Edge Function secrets. Function logs must not
include Authorization headers, JWTs, invite tokens, or database credentials.

Waiting rooms expire after one hour; active rooms expire after 24 hours of
inactivity; completed/expired rooms are deleted after 24 hours. Add CAPTCHA and
project rate limits in production if anonymous creation is abused.
