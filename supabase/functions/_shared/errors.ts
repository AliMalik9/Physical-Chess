export interface ApiErrorBody {code: string; message: string; retryable: boolean; status: number; details?: Record<string, unknown>}

const STATUS: Record<string, number> = {
  AUTH_REQUIRED: 401, INVALID_INPUT: 400, ROOM_NOT_FOUND: 404, ROOM_EXPIRED: 410,
  ROOM_FULL: 409, INVALID_INVITE: 403, NOT_A_ROOM_MEMBER: 403, NOT_YOUR_TURN: 409,
  INVALID_TURN_PHASE: 409, ILLEGAL_MOVE: 422, ROOM_VERSION_CONFLICT: 409,
  MOVE_ALREADY_COPIED: 409, UNDO_NOT_AVAILABLE: 409, NO_UNDO_PENDING: 409,
  NO_DRAW_PENDING: 409, GAME_ALREADY_OVER: 409, RATE_LIMITED: 429,
};

export function apiError(code: string, message = "BoardLink is temporarily unavailable.", details?: Record<string, unknown>): Response {
  const normalized = code.toUpperCase();
  const status = STATUS[normalized] ?? 500;
  const body: ApiErrorBody = {code: normalized.toLowerCase(), message, retryable: status >= 500 || normalized === "RATE_LIMITED", status, ...(details ? {details} : {})};
  return Response.json(body, {status});
}

export function rpcError(error: {message?: string}): Response {
  const match = error.message?.match(/(AUTH_REQUIRED|INVALID_INPUT|ROOM_NOT_FOUND|ROOM_EXPIRED|ROOM_FULL|INVALID_INVITE|NOT_A_ROOM_MEMBER|NOT_YOUR_TURN|INVALID_TURN_PHASE|ILLEGAL_MOVE|ROOM_VERSION_CONFLICT|MOVE_ALREADY_COPIED|UNDO_NOT_AVAILABLE|NO_UNDO_PENDING|NO_DRAW_PENDING|GAME_ALREADY_OVER)/);
  return apiError(match?.[1] ?? "INTERNAL_ERROR");
}
