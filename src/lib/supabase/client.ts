import {createClient, type SupabaseClient} from "@supabase/supabase-js";

import type {Database} from "@/types/database";

let client: SupabaseClient<Database> | null = null;

function required(name: "VITE_SUPABASE_URL" | "VITE_SUPABASE_PUBLISHABLE_KEY"): string {
  const value = import.meta.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required. Copy .env.local.example and configure Supabase.`);
  }
  return value;
}

/** The only browser Supabase client. It deliberately receives a publishable key. */
export function getSupabase(): SupabaseClient<Database> {
  if (client) return client;
  client = createClient(
    required("VITE_SUPABASE_URL"),
    required("VITE_SUPABASE_PUBLISHABLE_KEY"),
    {auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: false}},
  );
  return client;
}
