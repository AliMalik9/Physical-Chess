import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {inviteUrl, resolveRoom} from "@/lib/api";

beforeEach(() => {
  Object.defineProperty(window, "location", {
    value: new URL("https://play.boardlink.test/room/ABCD2345"), writable: true,
  });
});

afterEach(() => vi.restoreAllMocks());

describe("Supabase client boundary", () => {
  it("keeps the invite credential in a URL fragment", () => {
    expect(inviteUrl("ABCD2345", "a+b/c=")).toBe(
      "https://play.boardlink.test/room/ABCD2345#a%2Bb%2Fc%3D",
    );
  });

  it("does not disclose private room details during a code-only lookup", async () => {
    await expect(resolveRoom("ABCD2345")).resolves.toEqual({
      roomId: "", publicCode: "ABCD2345", status: "waiting_for_opponent", hostName: null, hasOpenSeat: true,
    });
  });
});
