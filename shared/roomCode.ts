/**
 * Human-readable room codes.
 *
 * The code exists so one player can read it aloud to the other across a table.
 * It is a convenience, not the security boundary — the invite URL carries a
 * 128-bit secret and the room rate-limits code lookups. See SECURITY.md.
 */

/**
 * Crockford-style alphabet: digits 0 and 1 and letters I, L and O are removed
 * because they are the pairs people actually confuse when reading a code out.
 * 31 symbols x 8 characters is roughly 8.5e11 codes.
 */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export const CODE_LENGTH = 8;
const GROUP_SIZE = 4;

/**
 * Generates a room code using rejection sampling so every symbol is equally
 * likely. A plain `% alphabet.length` would bias the first few symbols.
 */
export function generateRoomCode(
  randomBytes: (n: number) => Uint8Array,
): string {
  const alphabetSize = CODE_ALPHABET.length;
  // Largest multiple of alphabetSize that fits in a byte; values at or above
  // this are discarded rather than folded, which is what removes the bias.
  const limit = Math.floor(256 / alphabetSize) * alphabetSize;

  let code = "";
  while (code.length < CODE_LENGTH) {
    const chunk = randomBytes(CODE_LENGTH);
    for (const byte of chunk) {
      if (byte >= limit) continue;
      code += CODE_ALPHABET[byte % alphabetSize];
      if (code.length === CODE_LENGTH) break;
    }
  }
  return code;
}

/**
 * Canonicalises whatever the user typed or pasted: strips spaces, hyphens and
 * other separators, and uppercases.
 *
 * Characters outside the alphabet are intentionally *not* remapped. Because
 * 0/1/I/L/O can never appear in a real code there is no correct guess for what
 * the user meant, and silently substituting one would send them to a stranger's
 * room. `isValidRoomCode` rejects them instead and the UI explains.
 */
export function normalizeRoomCode(input: string): string {
  return input.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
}

export function isValidRoomCode(input: string): boolean {
  const normalized = normalizeRoomCode(input);
  if (normalized.length !== CODE_LENGTH) return false;
  for (const character of normalized) {
    if (!CODE_ALPHABET.includes(character)) return false;
  }
  return true;
}

/** Presentation form: `ABCD-EFGH`. Storage always uses the ungrouped code. */
export function formatRoomCode(code: string): string {
  const normalized = normalizeRoomCode(code);
  const groups: string[] = [];
  for (let i = 0; i < normalized.length; i += GROUP_SIZE) {
    groups.push(normalized.slice(i, i + GROUP_SIZE));
  }
  return groups.join("-");
}

/**
 * Reads a room code out of a pasted invite URL, or returns the normalised input
 * if it was already a bare code. Lets the join field accept either.
 */
export function extractRoomCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    const match = url.pathname.match(/\/room\/([^/]+)/);
    if (match?.[1]) {
      const candidate = normalizeRoomCode(decodeURIComponent(match[1]));
      return isValidRoomCode(candidate) ? candidate : null;
    }
    return null;
  }

  const candidate = normalizeRoomCode(trimmed);
  return isValidRoomCode(candidate) ? candidate : null;
}
