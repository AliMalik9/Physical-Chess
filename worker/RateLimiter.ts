import {DurableObject} from "cloudflare:workers";

/**
 * A fixed-window counter, sharded one instance per bucket key.
 *
 * Room creation, code lookups and socket upgrades all pass through here. The
 * public room code is only 8 characters, so throttling lookups is what keeps
 * the code space from being walked. See SECURITY.md.
 */
interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  /** Seconds until the window rolls. Only meaningful when allowed is false. */
  retryAfter: number;
}

export class RateLimiter extends DurableObject {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? "30");
    const windowMs = Number(url.searchParams.get("windowMs") ?? "60000");
    const now = Date.now();

    const stored = await this.ctx.storage.get<Window>("window");
    const window =
      stored && stored.resetAt > now
        ? stored
        : {count: 0, resetAt: now + windowMs};

    window.count += 1;
    await this.ctx.storage.put("window", window);
    // Let the instance evict itself once the window has rolled rather than
    // leaving an empty object around for every IP that ever hit the service.
    await this.ctx.storage.setAlarm(window.resetAt + 1000);

    const verdict: RateLimitVerdict = {
      allowed: window.count <= limit,
      retryAfter: Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
    };

    return Response.json(verdict);
  }

  override async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
