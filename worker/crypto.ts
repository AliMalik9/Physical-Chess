/**
 * Secret generation and comparison.
 *
 * BoardLink has no accounts, so these tokens *are* the authentication. Every
 * value here comes from the platform CSPRNG and is stored only as a hash.
 */

/** Bytes of entropy in an invite secret. 16 bytes = 128 bits, per SECURITY.md. */
export const INVITE_SECRET_BYTES = 16;

/** Seat tokens are longer because they are long-lived on the player's device. */
export const SEAT_TOKEN_BYTES = 32;

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** URL-safe, unpadded base64. Safe to put in a URL fragment. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(byteLength: number): string {
  return toBase64Url(randomBytes(byteLength));
}

export function newInviteSecret(): string {
  return randomToken(INVITE_SECRET_BYTES);
}

export function newSeatToken(): string {
  return randomToken(SEAT_TOKEN_BYTES);
}

export function newId(): string {
  return randomToken(12);
}

/**
 * SHA-256, hex encoded. Suitable here because every hashed value is a
 * high-entropy random token — there is no password to brute-force, so a slow
 * KDF would only cost latency.
 */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time string comparison. Always walks the full length of the longer
 * input so neither a length difference nor an early mismatch is observable in
 * the timing.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

/** Compares a presented secret against a stored hash without leaking timing. */
export async function verifySecret(
  presented: string | undefined,
  storedHash: string,
): Promise<boolean> {
  if (!presented) return false;
  return timingSafeEqual(await sha256Hex(presented), storedHash);
}

/**
 * C0 and C1 control characters, zero-width characters, and the bidi override
 * characters that can make a name render as something other than what it is.
 */
const UNSAFE_NAME_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;

/**
 * Strips anything that could turn a display name into markup, a spoofed system
 * message, or a layout break, then clamps the length.
 */
export function sanitizeDisplayName(
  raw: string | undefined,
  fallback: string,
  maxLength: number,
): string {
  if (typeof raw !== "string") return fallback;

  const cleaned = raw
    .replace(UNSAFE_NAME_CHARACTERS, "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

  return cleaned.length > 0 ? cleaned : fallback;
}
