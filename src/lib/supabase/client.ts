import {createClient, type SupabaseClient} from "@supabase/supabase-js";

import type {Database} from "@/types/database";

let client: SupabaseClient<Database> | null = null;

function required(name: "SUPABASE_URL" | "SUPABASE_PUBLISHABLE_KEY"): string {
  // Keep these property reads explicit. Vite replaces direct `import.meta.env`
  // references at build time; a computed key works in dev but is omitted from a
  // production bundle, leaving the deployed app without its Supabase config.
  const value =
    name === "SUPABASE_URL"
      ? import.meta.env.VITE_SUPABASE_URL?.trim() ??
        import.meta.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
      : import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ??
        import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!value) {
    throw new Error(
      `VITE_${name} or NEXT_PUBLIC_${name} is required. Configure the public Supabase values and restart the app.`,
    );
  }
  return value;
}

/** The only browser Supabase client. It deliberately receives a publishable key. */
export function getSupabase(): SupabaseClient<Database> {
  if (client) return client;
  client = createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_PUBLISHABLE_KEY"),
    {auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: false}},
  );
  return client;
}
