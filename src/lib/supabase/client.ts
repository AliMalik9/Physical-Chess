import {createClient, type SupabaseClient} from "@supabase/supabase-js";

import type {Database} from "@/types/database";

let client: SupabaseClient<Database> | null = null;

function required(name: "SUPABASE_URL" | "SUPABASE_PUBLISHABLE_KEY"): string {
  const value =
    import.meta.env[`VITE_${name}`]?.trim() ??
    import.meta.env[`NEXT_PUBLIC_${name}`]?.trim();
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
