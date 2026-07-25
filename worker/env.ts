import type {GameRoom} from "./GameRoom";
import type {RateLimiter} from "./RateLimiter";

export interface Env {
  GAME_ROOM: DurableObjectNamespace<GameRoom>;
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
  ASSETS: Fetcher;

  /** Comma-separated origins allowed to open a WebSocket. Empty = same-origin. */
  ALLOWED_ORIGINS?: string;
  EMPTY_ROOM_TTL_MINUTES?: string;
  ACTIVE_ROOM_TTL_HOURS?: string;
  COMPLETED_ROOM_TTL_HOURS?: string;

  /**
   * Multiplies every per-IP rate limit. Exists because local development and
   * end-to-end tests all arrive without a CF-Connecting-IP header and therefore
   * share a single bucket, which would otherwise throttle a test run. Leave
   * unset in production.
   */
  RATE_LIMIT_MULTIPLIER?: string;
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Room lifetimes. Short by design: a room holds a game in progress, not a
 * record worth keeping. See SECURITY.md for the retention rationale.
 */
export function rateLimitMultiplier(env: Env): number {
  const parsed = Number(env.RATE_LIMIT_MULTIPLIER);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

export function roomTtls(env: Env): {
  emptyMs: number;
  activeMs: number;
  completedMs: number;
} {
  return {
    emptyMs: positiveNumber(env.EMPTY_ROOM_TTL_MINUTES, 60) * 60_000,
    activeMs: positiveNumber(env.ACTIVE_ROOM_TTL_HOURS, 24) * 3_600_000,
    completedMs: positiveNumber(env.COMPLETED_ROOM_TTL_HOURS, 24) * 3_600_000,
  };
}
