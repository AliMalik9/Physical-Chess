/**
 * Per-room anonymous seat tokens.
 *
 * This is the entire "account" system. A token identifies a seat in exactly one
 * room and is scoped by room code, so nothing about a player persists across
 * games and there is no identifier to correlate them by.
 */

const PREFIX = "boardlink.seat.";
const NAME_KEY = "boardlink.lastName";

/** localStorage throws in private modes and when storage is disabled. */
function safeStorage(): Storage | null {
  try {
    const probe = "__boardlink_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

interface StoredSeat {
  seatToken: string;
  roomId?: string;
  inviteSecret?: string;
}

function key(roomCode: string): string {
  return `${PREFIX}${roomCode.toUpperCase()}`;
}

export function readSeat(roomCode: string): StoredSeat | null {
  const storage = safeStorage();
  if (!storage) return null;

  const raw = storage.getItem(key(roomCode));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as StoredSeat;
    return parsed.seatToken ? parsed : null;
  } catch {
    return null;
  }
}

export function writeSeat(roomCode: string, seat: StoredSeat): void {
  safeStorage()?.setItem(key(roomCode), JSON.stringify(seat));
}

export function mergeSeat(roomCode: string, patch: Partial<StoredSeat>): void {
  const existing = readSeat(roomCode);
  const next = {...existing, ...patch} as StoredSeat;
  if (next.seatToken) writeSeat(roomCode, next);
}

export function clearSeat(roomCode: string): void {
  safeStorage()?.removeItem(key(roomCode));
}

/**
 * The only cross-room value kept, so a returning player does not retype their
 * name. It is a display name they chose, never an identifier.
 */
export function readLastName(): string | null {
  return safeStorage()?.getItem(NAME_KEY) ?? null;
}

export function writeLastName(name: string): void {
  safeStorage()?.setItem(NAME_KEY, name);
}
