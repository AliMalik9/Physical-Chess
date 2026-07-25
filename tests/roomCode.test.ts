import {describe, expect, it} from "vitest";

import {
  CODE_ALPHABET,
  CODE_LENGTH,
  extractRoomCode,
  formatRoomCode,
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
} from "@shared/roomCode";

/** Deterministic byte source so generation can be asserted exactly. */
function bytesFrom(values: number[]): (n: number) => Uint8Array {
  let cursor = 0;
  return (n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      out[i] = values[cursor % values.length]!;
      cursor += 1;
    }
    return out;
  };
}

describe("room code generation", () => {
  it("produces a code of the expected length from the alphabet", () => {
    const code = generateRoomCode(() => crypto.getRandomValues(new Uint8Array(8)));

    expect(code).toHaveLength(CODE_LENGTH);
    for (const character of code) {
      expect(CODE_ALPHABET).toContain(character);
    }
  });

  it("never emits the characters people confuse when reading aloud", () => {
    // 200 codes is enough to catch an off-by-one in the alphabet.
    for (let i = 0; i < 200; i += 1) {
      const code = generateRoomCode((n) =>
        crypto.getRandomValues(new Uint8Array(n)),
      );
      expect(code).not.toMatch(/[01ILO]/);
    }
  });

  it("rejects biased bytes rather than folding them onto early symbols", () => {
    // 248 is the first byte at or above the rejection limit (31 * 8 = 248).
    // If it were folded with a modulo it would silently become "2".
    const code = generateRoomCode(bytesFrom([248, 0, 1, 2, 3, 4, 5, 6, 7, 8]));

    expect(code).toHaveLength(CODE_LENGTH);
    expect(code[0]).toBe(CODE_ALPHABET[0]);
  });
});

describe("normalizing what a person typed", () => {
  it("strips separators and uppercases", () => {
    expect(normalizeRoomCode(" abcd-efgh ")).toBe("ABCDEFGH");
    expect(normalizeRoomCode("ab cd ef gh")).toBe("ABCDEFGH");
  });

  it("treats ambiguous characters as invalid instead of guessing", () => {
    // There is no correct substitution for these, and guessing would send the
    // player into a stranger's room.
    expect(isValidRoomCode("ABCDEFGO")).toBe(false);
    expect(isValidRoomCode("ABCDEFG0")).toBe(false);
    expect(isValidRoomCode("ABCDEFGI")).toBe(false);
    expect(isValidRoomCode("ABCDEFGL")).toBe(false);
    expect(isValidRoomCode("ABCDEFG1")).toBe(false);
  });

  it("rejects codes of the wrong length", () => {
    expect(isValidRoomCode("ABCDEFG")).toBe(false);
    expect(isValidRoomCode("ABCDEFGHJ")).toBe(false);
    expect(isValidRoomCode("")).toBe(false);
  });

  it("accepts a valid code in any spacing", () => {
    expect(isValidRoomCode("bnxw-zk43")).toBe(true);
    expect(isValidRoomCode("BNXWZK43")).toBe(true);
  });

  it("formats into two readable groups", () => {
    expect(formatRoomCode("BNXWZK43")).toBe("BNXW-ZK43");
  });
});

describe("extracting a code from pasted input", () => {
  it("reads a code out of a full invite URL", () => {
    expect(
      extractRoomCode("https://boardlink.example.com/room/BNXWZK43#secret"),
    ).toBe("BNXWZK43");
  });

  it("accepts a bare code", () => {
    expect(extractRoomCode("bnxw zk43")).toBe("BNXWZK43");
  });

  it("returns null for a URL that is not a room link", () => {
    expect(extractRoomCode("https://boardlink.example.com/join")).toBeNull();
  });

  it("returns null for a room URL carrying an impossible code", () => {
    expect(
      extractRoomCode("https://boardlink.example.com/room/OOOOOOOO"),
    ).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(extractRoomCode("   ")).toBeNull();
  });
});
