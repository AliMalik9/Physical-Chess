import type {User} from "@supabase/supabase-js";

import {getSupabase} from "./client";

let initialization: Promise<User> | null = null;

/**
 * Restores the browser's anonymous identity or creates exactly one when needed.
 * The Supabase SDK owns token persistence; no JWT is copied into application
 * storage. Clearing browser storage therefore also loses an anonymous seat.
 */
export function initializeAnonymousIdentity(): Promise<User> {
  if (!initialization) {
    initialization = (async () => {
      const supabase = getSupabase();
      const {data, error} = await supabase.auth.getSession();
      if (error) throw error;
      if (data.session?.user) return data.session.user;

      const signedIn = await supabase.auth.signInAnonymously();
      if (signedIn.error || !signedIn.data.user) {
        throw signedIn.error ?? new Error("Could not establish a private session.");
      }
      return signedIn.data.user;
    })().catch((error: unknown) => {
      // A temporary outage must be retryable. Do not retain a rejected promise.
      initialization = null;
      throw error;
    });
  }
  return initialization;
}
