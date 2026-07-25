/**
 * The room state machine, as pure functions.
 *
 * Nothing in this file touches storage, sockets or the Workers runtime, so the
 * rules that actually decide whether a move is allowed can be unit tested
 * directly. GameRoom.ts is the thin shell that persists the result and pushes
 * it down the wire.
 *
 * The one invariant worth stating up front: a move is legal because *this*
 * module says so against its own Chess instance, never because a client
 * claimed it was.
 */

import type {Chess} from "chess.js";
import {detectGameEnd, result, toColor, tryMove} from "@shared/chessEngine";
import {
  LIMITS,
  type ClockState,
  type ErrorCode,
  type GameResult,
  type PendingDrawOffer,
  type PieceColor,
  type PieceSymbol,
  type PublicUndoRequest,
  type RoomStatus,
  type SerializedMove,
  type TurnPhase,
} from "@shared/protocol";

export interface RoomPlayerState {
  id: string;
  seatTokenHash: string;
  displayName: string;
  color: PieceColor;
  connected: boolean;
  lastSeenAt: number;
  /** Highest move sequence this player confirmed onto their physical board. */
  copiedThroughSequence: number;
  /**
   * The connection currently allowed to act for this seat. A second tab takes
   * over this slot and the older socket becomes read-only.
   */
  primaryConnectionId: string | null;
  /** When the last socket for this seat dropped, for the clock grace period. */
  disconnectedAt: number | null;
}

export interface RoomState {
  id: string;
  publicCode: string;
  inviteHash: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  startedAt: number;
  status: RoomStatus;
  turnPhase: TurnPhase;
  moveSequence: number;
  previousFen: string | null;
  white: RoomPlayerState | null;
  black: RoomPlayerState | null;
  pendingUndo: PublicUndoRequest | null;
  pendingDraw: PendingDrawOffer | null;
  result: GameResult | null;
  clock: ClockState | null;
  /** Ring buffer of applied action ids, newest last. Makes actions idempotent. */
  recentActionIds: string[];
}

export function opponentOf(color: PieceColor): PieceColor {
  return color === "white" ? "black" : "white";
}

export function playerAt(
  state: RoomState,
  color: PieceColor,
): RoomPlayerState | null {
  return color === "white" ? state.white : state.black;
}

export function setPlayerAt(
  state: RoomState,
  color: PieceColor,
  player: RoomPlayerState | null,
): void {
  if (color === "white") state.white = player;
  else state.black = player;
}

export function bothSeatsTaken(state: RoomState): boolean {
  return Boolean(state.white && state.black);
}

/* -------------------------------------------------------------------------- */
/* Idempotency                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Returns false when this action has already been applied. A client that
 * retries after a flaky send must not produce a second move, so every
 * state-changing handler calls this first.
 */
export function claimAction(state: RoomState, actionId: string): boolean {
  if (!actionId) return false;
  if (state.recentActionIds.includes(actionId)) return false;

  state.recentActionIds.push(actionId);
  if (state.recentActionIds.length > LIMITS.actionMemory) {
    state.recentActionIds.splice(
      0,
      state.recentActionIds.length - LIMITS.actionMemory,
    );
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Clock                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Charges elapsed time to whoever's clock is running. Safe to call as often as
 * you like: it always settles up to `now` and moves the marker forward.
 */
export function tickClock(state: RoomState, now: number): void {
  const clock = state.clock;
  if (!clock) return;

  if (!clock.runningFor || clock.pausedReason || state.status !== "active") {
    clock.lastTickAt = now;
    return;
  }

  const elapsed = Math.max(0, now - clock.lastTickAt);
  if (clock.runningFor === "white") {
    clock.whiteMs = Math.max(0, clock.whiteMs - elapsed);
  } else {
    clock.blackMs = Math.max(0, clock.blackMs - elapsed);
  }
  clock.lastTickAt = now;
}

/** Wall-clock time the running clock would hit zero, or null if none is. */
export function clockDeadline(state: RoomState): number | null {
  const clock = state.clock;
  if (!clock?.runningFor || clock.pausedReason || state.status !== "active") {
    return null;
  }
  const remaining = clock.runningFor === "white" ? clock.whiteMs : clock.blackMs;
  return clock.lastTickAt + remaining;
}

/**
 * Ends the game on time if a clock has run out. Call after tickClock.
 * Flagging is automatic here because both players are away from the screen,
 * looking at wood — nobody is watching for the flag to fall.
 */
export function applyClockExpiry(
  state: RoomState,
  now: number,
): GameResult | null {
  const clock = state.clock;
  if (!clock || state.status !== "active" || state.result) return null;

  const flagged: PieceColor | null =
    clock.whiteMs <= 0 ? "white" : clock.blackMs <= 0 ? "black" : null;
  if (!flagged) return null;

  const outcome = result("clock_expired", opponentOf(flagged), now);
  finish(state, outcome);
  return outcome;
}

export function startClockForActiveGame(state: RoomState, now: number): void {
  if (!state.clock) return;
  state.clock.runningFor = "white";
  state.clock.lastTickAt = now;
  state.clock.pausedReason = null;
}

/**
 * Holds the clock while a player is away. Only paused after the grace period so
 * a brief tunnel or a screen lock does not stop the game.
 */
export function pauseClockForDisconnect(state: RoomState, now: number): boolean {
  const clock = state.clock;
  if (!clock || clock.pausedReason || state.status !== "active") return false;

  tickClock(state, now);
  clock.pausedReason = "opponent_disconnected";
  return true;
}

export function resumeClock(state: RoomState, now: number): boolean {
  const clock = state.clock;
  if (!clock || !clock.pausedReason) return false;

  clock.pausedReason = null;
  clock.lastTickAt = now;
  return true;
}

/* -------------------------------------------------------------------------- */
/* Completion                                                                 */
/* -------------------------------------------------------------------------- */

export function finish(state: RoomState, outcome: GameResult): void {
  state.status = "completed";
  state.result = outcome;
  state.pendingUndo = null;
  state.pendingDraw = null;
  if (state.clock) {
    state.clock.runningFor = null;
    state.clock.pausedReason = null;
  }
}

/* -------------------------------------------------------------------------- */
/* Guards                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every condition from the protocol spec that must hold before a move is even
 * looked at. Returns an error code, or null when the move may be attempted.
 */
export function guardSubmitMove(options: {
  state: RoomState;
  game: Chess;
  color: PieceColor;
  expectedSequence: number;
  isReadOnly: boolean;
}): ErrorCode | null {
  const {state, game, color, expectedSequence, isReadOnly} = options;

  if (isReadOnly) return "read_only_connection";
  if (state.status === "expired") return "room_expired";
  if (state.status === "completed" || state.result) return "game_already_over";
  if (state.status !== "active") return "wrong_phase";
  if (!playerAt(state, color)) return "not_a_player";
  if (state.turnPhase !== "waiting_for_move") return "wrong_phase";
  if (toColor(game.turn()) !== color) return "not_your_turn";
  // A mismatch means the client is looking at a stale position; making its move
  // would apply the right notation to the wrong board.
  if (expectedSequence !== state.moveSequence) return "stale_sequence";

  return null;
}

export interface AppliedMove {
  move: SerializedMove;
  outcome: GameResult | null;
}

/**
 * Validates and applies a move against the authoritative position. `game` is
 * mutated only on success.
 */
export function applyMove(options: {
  state: RoomState;
  game: Chess;
  from: string;
  to: string;
  promotion?: PieceSymbol;
  now: number;
}): {ok: true; applied: AppliedMove} | {ok: false; code: ErrorCode} {
  const {state, game, from, to, promotion, now} = options;

  const attempt = tryMove({
    fen: game.fen(),
    from,
    to,
    ...(promotion ? {promotion} : {}),
    sequence: state.moveSequence + 1,
    playedAt: now,
  });
  if (!attempt) return {ok: false, code: "illegal_move"};

  // Replay the same move onto the live instance so its history — and therefore
  // repetition counts, the fifty-move counter and the PGN — stays intact.
  game.move({from, to, ...(promotion ? {promotion} : {})});

  tickClock(state, now);

  state.previousFen = attempt.move.fenBefore;
  state.moveSequence += 1;
  state.turnPhase = "move_submitted";
  state.pendingDraw = null;
  state.pendingUndo = null;
  state.updatedAt = now;

  if (state.clock) {
    state.clock.runningFor = opponentOf(attempt.move.color);
    state.clock.lastTickAt = now;
  }

  const outcome = detectGameEnd(game, now);
  if (outcome) finish(state, outcome);

  return {ok: true, applied: {move: attempt.move, outcome}};
}

/**
 * Called when the receiving player has a live socket and has actually been
 * handed the move. Distinguishing this from `move_submitted` is what lets a
 * reconnect tell "nobody has seen this yet" from "they are copying it now".
 */
export function markAwaitingCopy(state: RoomState): boolean {
  if (state.turnPhase !== "move_submitted") return false;
  state.turnPhase = "waiting_for_copy_confirmation";
  return true;
}

export function guardConfirmCopy(options: {
  state: RoomState;
  color: PieceColor;
  sequence: number;
  isReadOnly: boolean;
  /** Colour of the move awaiting confirmation. Null when none has been played. */
  lastMoveColor: PieceColor | null;
}): ErrorCode | null {
  const {state, color, sequence, isReadOnly, lastMoveColor} = options;

  if (isReadOnly) return "read_only_connection";
  if (state.status === "expired") return "room_expired";
  if (!playerAt(state, color)) return "not_a_player";
  if (
    state.turnPhase !== "waiting_for_copy_confirmation" &&
    state.turnPhase !== "move_submitted"
  ) {
    return "wrong_phase";
  }
  if (sequence !== state.moveSequence) return "stale_sequence";
  if (state.moveSequence === 0 || lastMoveColor === null) return "wrong_phase";

  // Only the player who has to physically copy the move can confirm it, and
  // that is never the player who just made it. Without this the mover could
  // confirm their own move, take a second turn, and silently leave the two
  // wooden boards showing different positions.
  if (color === lastMoveColor) return "not_your_turn";

  return null;
}

export function applyConfirmCopy(options: {
  state: RoomState;
  color: PieceColor;
  sequence: number;
  now: number;
}): void {
  const {state, color, sequence, now} = options;

  const player = playerAt(state, color);
  if (player) player.copiedThroughSequence = sequence;

  state.turnPhase = "waiting_for_move";
  state.updatedAt = now;
}

/* -------------------------------------------------------------------------- */
/* Undo                                                                       */
/* -------------------------------------------------------------------------- */

export function guardUndoRequest(options: {
  state: RoomState;
  color: PieceColor;
  isReadOnly: boolean;
}): ErrorCode | null {
  const {state, color, isReadOnly} = options;

  if (isReadOnly) return "read_only_connection";
  if (state.status !== "active") return "wrong_phase";
  if (!playerAt(state, color)) return "not_a_player";
  if (state.moveSequence === 0) return "wrong_phase";
  if (state.pendingUndo) return "duplicate_action";

  return null;
}

export function guardUndoResponse(options: {
  state: RoomState;
  color: PieceColor;
  isReadOnly: boolean;
}): ErrorCode | null {
  const {state, color, isReadOnly} = options;

  if (isReadOnly) return "read_only_connection";
  if (!state.pendingUndo) return "no_undo_pending";
  // The player who asked cannot also answer.
  if (state.pendingUndo.requestedBy === color) return "not_a_player";
  if (!playerAt(state, color)) return "not_a_player";

  return null;
}

/**
 * Rolls the authoritative position back one move. The caller replays the
 * remaining move list into a fresh Chess instance rather than calling undo() on
 * the live one, so repetition history cannot drift.
 */
export function applyUndo(options: {
  state: RoomState;
  moves: SerializedMove[];
  now: number;
}): SerializedMove | null {
  const {state, moves, now} = options;

  const undone = moves.pop() ?? null;
  if (!undone) return null;

  state.moveSequence = Math.max(0, state.moveSequence - 1);
  state.previousFen = moves.at(-1)?.fenBefore ?? null;
  // The player who made the undone move is on the clock again.
  state.turnPhase = "waiting_for_move";
  state.pendingUndo = null;
  state.pendingDraw = null;
  state.updatedAt = now;

  for (const color of ["white", "black"] as const) {
    const player = playerAt(state, color);
    if (player) {
      player.copiedThroughSequence = Math.min(
        player.copiedThroughSequence,
        state.moveSequence,
      );
    }
  }

  if (state.clock) {
    state.clock.runningFor = undone.color;
    state.clock.lastTickAt = now;
  }

  return undone;
}

/* -------------------------------------------------------------------------- */
/* Draw and resignation                                                       */
/* -------------------------------------------------------------------------- */

export function guardDrawOffer(options: {
  state: RoomState;
  color: PieceColor;
  isReadOnly: boolean;
}): ErrorCode | null {
  const {state, color, isReadOnly} = options;

  if (isReadOnly) return "read_only_connection";
  if (state.status !== "active") return "wrong_phase";
  if (!playerAt(state, color)) return "not_a_player";
  if (state.pendingDraw) return "duplicate_action";

  return null;
}

export function guardDrawResponse(options: {
  state: RoomState;
  color: PieceColor;
  isReadOnly: boolean;
}): ErrorCode | null {
  const {state, color, isReadOnly} = options;

  if (isReadOnly) return "read_only_connection";
  if (!state.pendingDraw) return "no_draw_pending";
  if (state.pendingDraw.offeredBy === color) return "not_a_player";
  if (!playerAt(state, color)) return "not_a_player";

  return null;
}

export function guardResign(options: {
  state: RoomState;
  color: PieceColor;
  isReadOnly: boolean;
}): ErrorCode | null {
  const {state, color, isReadOnly} = options;

  if (isReadOnly) return "read_only_connection";
  if (state.status !== "active") return "wrong_phase";
  if (!playerAt(state, color)) return "not_a_player";

  return null;
}
