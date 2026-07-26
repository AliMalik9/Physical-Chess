import {
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
} from "@shared/roomCode";
import type {
  ApiErrorResponse,
  CreateRoomRequest,
  ErrorCode,
  GameSpeed,
  PieceColor,
} from "@shared/protocol";

import {randomBytes} from "./crypto";
import {rateLimitMultiplier, type Env} from "./env";
import type {RateLimitVerdict} from "./RateLimiter";

export {GameRoom} from "./GameRoom";
export {RateLimiter} from "./RateLimiter";

/**
 * Per-IP budgets. Room creation is the expensive one; code lookups are the
 * sensitive one, because the 8-character code is what protects an open seat.
 */
const RATE_LIMITS = {
  create: {limit: 12, windowMs: 10 * 60_000},
  resolve: {limit: 25, windowMs: 10 * 60_000},
  socket: {limit: 60, windowMs: 60_000},
} as const;

/** Room codes collide roughly never, but a retry loop is cheap insurance. */
const CREATE_ATTEMPTS = 5;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      // Everything else is the SPA. `not_found_handling` in wrangler.jsonc
      // rewrites unknown paths to index.html so deep links load.
      return env.ASSETS.fetch(request);
    }

    // A split deployment (client on Vercel, Worker on Cloudflare) makes every
    // API call cross-origin, so the browser preflights anything with a JSON
    // body. Answered before routing because OPTIONS matches no route.
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, {status: 204}), request, env);
    }

    try {
      const response = await route(request, env, url, ctx);
      return withCors(response, request, env);
    } catch {
      return withCors(apiError("internal_error", 500), request, env);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(
  request: Request,
  env: Env,
  url: URL,
  ctx: ExecutionContext,
): Promise<Response> {
  const segments = url.pathname.split("/").filter(Boolean);

  // POST /api/rooms
  if (segments.length === 2 && segments[1] === "rooms") {
    if (request.method !== "POST") return apiError("bad_request", 405);
    return createRoom(request, env, ctx);
  }

  // /api/rooms/:code[/ws|/pgn]
  if (segments.length >= 3 && segments[1] === "rooms") {
    const code = normalizeRoomCode(segments[2] ?? "");
    if (!isValidRoomCode(code)) return apiError("invalid_code", 404);

    const action = segments[3];

    if (action === "ws") return openSocket(request, env, code);
    if (action === "pgn") return downloadPgn(request, env, code, url);
    if (action === undefined) {
      if (request.method !== "GET") return apiError("bad_request", 405);
      return resolveRoom(request, env, code);
    }
  }

  return apiError("bad_request", 404);
}

/* -------------------------------------------------------------------------- */
/* Handlers                                                                   */
/* -------------------------------------------------------------------------- */

async function createRoom(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const allowed = await checkRateLimit(env, request, "create", ctx);
  if (!allowed.allowed) {
    return apiError("rate_limited", 429, allowed.retryAfter);
  }

  let body: CreateRoomRequest;
  try {
    body = (await request.json()) as CreateRoomRequest;
  } catch {
    return apiError("bad_request", 400);
  }

  const side = normalizeSide(body.side);
  const speed = normalizeSpeed(body.speed);

  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
    const publicCode = generateRoomCode(randomBytes);
    // The DO is addressed by the code itself, so a room can be found from a
    // code read aloud without keeping a lookup table of live games.
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(publicCode));

    const response = await stub.fetch("https://room/create", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        publicCode,
        side,
        speed,
        ...(body.displayName ? {displayName: body.displayName} : {}),
      }),
    });

    if (response.ok) return withApiHeaders(response);
    // 409 means that code already belongs to a live room. Try another.
    if (response.status !== 409) return withApiHeaders(response);
  }

  return apiError("internal_error", 503);
}

async function resolveRoom(
  request: Request,
  env: Env,
  code: string,
): Promise<Response> {
  const allowed = await checkRateLimit(env, request, "resolve");
  if (!allowed.allowed) {
    return apiError("rate_limited", 429, allowed.retryAfter);
  }

  const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code));
  const response = await stub.fetch("https://room/resolve");
  return withApiHeaders(response);
}

async function downloadPgn(
  request: Request,
  env: Env,
  code: string,
  url: URL,
): Promise<Response> {
  if (request.method !== "GET") return apiError("bad_request", 405);

  const seat = url.searchParams.get("seat");
  if (!seat) return apiError("not_a_player", 403);

  const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code));
  const target = new URL("https://room/pgn");
  target.searchParams.set("seat", seat);
  return withApiHeaders(await stub.fetch(target.toString()));
}

async function openSocket(
  request: Request,
  env: Env,
  code: string,
): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return apiError("bad_request", 426);
  }
  if (!isAllowedOrigin(request, env)) {
    // A cross-site page must not be able to open a socket into a room using a
    // code it scraped or guessed.
    return apiError("bad_request", 403);
  }

  const allowed = await checkRateLimit(env, request, "socket");
  if (!allowed.allowed) {
    return apiError("rate_limited", 429, allowed.retryAfter);
  }

  const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code));
  return stub.fetch("https://room/ws", {
    headers: request.headers,
  });
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Adds CORS headers when the request came from an allow-listed origin.
 *
 * Deliberately reuses `isAllowedOrigin`, so the set of origins that may call
 * the API is exactly the set that may open a socket — there is one list to get
 * right, not two. Same-origin deployments never hit this: the browser sends no
 * Origin header worth echoing and none of it applies.
 *
 * A 101 is left untouched; rebuilding it would drop the WebSocket.
 */
function withCors(response: Response, request: Request, env: Env): Response {
  const origin = request.headers.get("Origin");
  if (!origin || response.status === 101) return response;
  if (!isAllowedOrigin(request, env)) return response;

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "86400");
  // The allowed origin varies per request, so caches must key on it.
  headers.append("Vary", "Origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Same-origin by default. `ALLOWED_ORIGINS` widens it for deployments that
 * serve the app from a different host than the API.
 */
function isAllowedOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  // Non-browser clients omit Origin entirely; browsers always send it on a
  // WebSocket handshake, which is the case this check exists for.
  if (!origin) return true;

  const configured = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.length > 0) return configured.includes(origin);

  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function clientKey(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For") ??
    "unknown"
  );
}

async function checkRateLimit(
  env: Env,
  request: Request,
  bucket: keyof typeof RATE_LIMITS,
  ctx?: ExecutionContext,
): Promise<RateLimitVerdict> {
  const config = RATE_LIMITS[bucket];
  const id = env.RATE_LIMITER.idFromName(`${bucket}:${clientKey(request)}`);
  const stub = env.RATE_LIMITER.get(id);

  const url = new URL("https://limiter/check");
  url.searchParams.set(
    "limit",
    String(config.limit * rateLimitMultiplier(env)),
  );
  url.searchParams.set("windowMs", String(config.windowMs));

  try {
    const response = await stub.fetch(url.toString());
    return (await response.json()) as RateLimitVerdict;
  } catch {
    // Never let a limiter outage take the product down; fail open and let the
    // per-room guards do their job.
    void ctx;
    return {allowed: true, retryAfter: 0};
  }
}

function normalizeSide(side: unknown): PieceColor | "surprise" {
  return side === "white" || side === "black" ? side : "surprise";
}

function normalizeSpeed(speed: unknown): GameSpeed {
  return speed === "10" || speed === "30" ? speed : "none";
}

const API_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function withApiHeaders(response: Response): Response {
  // A 101 carries a live socket; rebuilding it would drop the connection.
  if (response.status === 101) return response;

  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(API_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function apiError(
  error: ErrorCode,
  status: number,
  retryAfter?: number,
): Response {
  const body: ApiErrorResponse = {
    error,
    ...(retryAfter ? {retryAfter} : {}),
  };
  const headers = new Headers({
    "Content-Type": "application/json",
    ...API_HEADERS,
  });
  if (retryAfter) headers.set("Retry-After", String(retryAfter));

  return new Response(JSON.stringify(body), {status, headers});
}
