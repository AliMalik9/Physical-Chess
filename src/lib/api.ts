import type {
  ApiErrorResponse,
  CreateRoomRequest,
  CreateRoomResponse,
  ErrorCode,
  ResolveCodeResponse,
} from "@shared/protocol";

/**
 * Where the Worker lives.
 *
 * Empty — the default — means same origin, which is the Cloudflare deployment
 * where the Worker also serves the client. Set `VITE_API_ORIGIN` at build time
 * when the two are hosted separately (client on Vercel, Worker on Cloudflare);
 * the Worker must then list the client's origin in `ALLOWED_ORIGINS`.
 */
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/+$/, "");

function apiUrl(path: string): string {
  return `${API_ORIGIN}${path}`;
}

/** A failure the UI can render with errorCopy(), rather than a raw exception. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly retryAfter?: number,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

async function parseError(response: Response): Promise<never> {
  let code: ErrorCode = "internal_error";
  let retryAfter: number | undefined;

  try {
    const body = (await response.json()) as ApiErrorResponse;
    if (body.error) code = body.error;
    retryAfter = body.retryAfter;
  } catch {
    // A non-JSON error body means something upstream failed; the generic code
    // is already the right thing to show.
  }

  throw new ApiError(code, retryAfter);
}

export async function createRoom(
  request: CreateRoomRequest,
): Promise<CreateRoomResponse> {
  const response = await fetch(apiUrl("/api/rooms"), {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(request),
  });

  if (!response.ok) return parseError(response);
  return (await response.json()) as CreateRoomResponse;
}

export async function resolveRoom(code: string): Promise<ResolveCodeResponse> {
  const response = await fetch(apiUrl(`/api/rooms/${encodeURIComponent(code)}`));
  if (!response.ok) return parseError(response);
  return (await response.json()) as ResolveCodeResponse;
}

export function pgnUrl(code: string, seatToken: string): string {
  return apiUrl(
    `/api/rooms/${encodeURIComponent(code)}/pgn?seat=${encodeURIComponent(seatToken)}`,
  );
}

export function socketUrl(code: string): string {
  const path = `/api/rooms/${encodeURIComponent(code)}/ws`;

  // A cross-origin Worker is reached directly. Vercel rewrites cannot proxy a
  // WebSocket upgrade, so this one always has to be a real cross-origin URL.
  if (API_ORIGIN) return `${API_ORIGIN.replace(/^http/, "ws")}${path}`;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

/**
 * Invite URL. The secret rides in the fragment, which browsers never send to a
 * server — so it stays out of access logs, referrers and analytics.
 */
export function inviteUrl(code: string, inviteSecret: string): string {
  return `${window.location.origin}/room/${code}#${encodeURIComponent(inviteSecret)}`;
}
