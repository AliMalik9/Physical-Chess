import {createClient, type SupabaseClient} from "npm:@supabase/supabase-js@2";

export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  // New projects expose SUPABASE_SECRET_KEY. Existing projects can still
  // expose the same server-only credential under the legacy name.
  const secret = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !secret) throw new Error("Supabase Edge Function secrets are not configured.");
  return createClient(url, secret, {auth: {persistSession: false, autoRefreshToken: false}});
}

export async function callerId(request: Request): Promise<string | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const {data, error} = await adminClient().auth.getUser(token);
  return error ? null : data.user?.id ?? null;
}
