import {describe, expect, it} from "vitest";

import {LIMITS} from "@shared/protocol";
import {
  INVITE_SECRET_BYTES,
  newInviteSecret,
  newSeatToken,
  sanitizeDisplayName,
  sha256Hex,
  timingSafeEqual,
  verifySecret,
} from "../worker/crypto";

describe("secret generation", () => {
  it("gives an invite secret at least 128 bits of entropy", () => {
    expect(INVITE_SECRET_BYTES * 8).toBeGreaterThanOrEqual(128);

    // base64url of 16 bytes, unpadded, is 22 characters.
    expect(newInviteSecret()).toHaveLength(22);
  });

  it("produces URL-safe tokens with no padding", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(newSeatToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("never repeats a secret", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(newSeatToken());
    expect(seen.size).toBe(500);
  });
});

describe("seat token validation", () => {
  it("accepts the token it issued and rejects everything else", async () => {
    const token = newSeatToken();
    const hash = await sha256Hex(token);

    expect(await verifySecret(token, hash)).toBe(true);
    expect(await verifySecret(newSeatToken(), hash)).toBe(false);
    expect(await verifySecret(undefined, hash)).toBe(false);
    expect(await verifySecret("", hash)).toBe(false);
  });

  it("stores only a hash, never the token", async () => {
    const token = newSeatToken();
    const hash = await sha256Hex(token);

    expect(hash).not.toContain(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a token that differs only in its last character", async () => {
    const token = newSeatToken();
    const hash = await sha256Hex(token);
    const nearMiss = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    expect(await verifySecret(nearMiss, hash)).toBe(false);
  });
});

describe("constant-time comparison", () => {
  it("matches identical strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
  });

  it("rejects different strings, including different lengths", () => {
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "ab")).toBe(false);
    expect(timingSafeEqual("", "a")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

describe("display name sanitising", () => {
  it("falls back when the name is missing or empty", () => {
    expect(sanitizeDisplayName(undefined, "Player 2", 24)).toBe("Player 2");
    expect(sanitizeDisplayName("   ", "Player 2", 24)).toBe("Player 2");
    expect(sanitizeDisplayName(42 as unknown as string, "Player 2", 24)).toBe(
      "Player 2",
    );
  });

  it("strips angle brackets so a name cannot smuggle markup", () => {
    expect(sanitizeDisplayName("<script>x</script>", "P", 24)).toBe(
      "scriptx/script",
    );
  });

  it("removes bidi overrides used to disguise a name", () => {
    const spoofed = `Sam${String.fromCharCode(0x202e)}evil`;
    expect(sanitizeDisplayName(spoofed, "P", 24)).toBe("Samevil");
  });

  it("removes zero-width characters", () => {
    const padded = `Sa${String.fromCharCode(0x200b)}m`;
    expect(sanitizeDisplayName(padded, "P", 24)).toBe("Sam");
  });

  it("collapses whitespace and clamps the length", () => {
    expect(sanitizeDisplayName("  Sam    Smith  ", "P", 24)).toBe("Sam Smith");
    expect(
      sanitizeDisplayName("x".repeat(200), "P", LIMITS.displayNameMaxLength),
    ).toHaveLength(LIMITS.displayNameMaxLength);
  });

  it("leaves an ordinary name untouched", () => {
    expect(sanitizeDisplayName("Sam", "Player 2", 24)).toBe("Sam");
    expect(sanitizeDisplayName("Ana María", "Player 2", 24)).toBe("Ana María");
  });
});
