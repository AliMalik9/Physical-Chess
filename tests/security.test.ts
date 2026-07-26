import {readFileSync} from "node:fs";
import {resolve} from "node:path";

import {describe, expect, it} from "vitest";

const migration = readFileSync(resolve("supabase/migrations/20260726000100_boardlink_supabase.sql"), "utf8");

describe("Supabase database security", () => {
  it("enables RLS on every authoritative table", () => {
    for (const table of ["rooms", "room_players", "moves", "room_action_audit"]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it("does not give browsers a permissive write policy", () => {
    expect(migration).not.toMatch(/using\s*\(\s*true\s*\)/i);
    expect(migration).not.toMatch(/with check\s*\(\s*true\s*\)/i);
    expect(migration).toContain("No INSERT/UPDATE/DELETE policies");
  });

  it("stores a hash instead of a plain invite credential", () => {
    expect(migration).toContain("invite_token_hash text not null");
    expect(migration).not.toContain("invite_token text");
  });
});
