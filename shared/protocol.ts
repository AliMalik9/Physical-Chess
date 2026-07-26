/**
 * The wire contract between the browser and the GameRoom Durable Object.
 *
 * Both sides import this file, so a change here is a change to both ends at
 * once. Bump PROTOCOL_VERSION whenever a message shape changes incompatibly;
 * the room rejects sockets that announce a different major version rather than
 * letting a stale tab corrupt a game.
 */

export const PROTOCOL_VERSION = 1;

export type PieceColor = "white" | "black";
export type PieceSymbol = "p" | "n" | "b" | "r" | "q" | "k";

export type RoomStatus =
  | "waiting_for_opponent"
  | "active"
  | "completed"
  | "expired";

/**
 * The phase always advances in one direction:
 *
 *   waiting_for_move
 *     -> move_submitted                (mover sent it, we owe the opponent)
 *     -> waiting_for_copy_confirmation  (opponent is moving real pieces)
 *     -> waiting_for_move               (now the opponent's turn)
 *
 * `move_submitted` is deliberately distinct from
 * `waiting_for_copy_confirmation`: the first means the server has accepted the
 * move, the second means the receiving client has actually rendered it. Keeping
 * them apart is what makes a mid-flight reconnect recoverable.
 */
export type TurnPhase =
  | "waiting_for_move"
  | "move_submitted"
  | "waiting_for_copy_confirmation";

export type GameEndReason =
  | "checkmate"
  | "resignation"
  | "draw_agreement"
  | "stalemate"
  | "threefold_repetition"
  | "fifty_move_rule"
  | "insufficient_material"
  | "clock_expired"
  | "opponent_left";

export type Scoreline = "1-0" | "0-1" | "1/2-1/2";

export interface GameResult {
  reason: GameEndReason;
  /** null means the game was drawn. */
  winner: PieceColor | null;
  scoreline: Scoreline;
  endedAt: number;
}

/** Which castle, expressed the way a person moves the pieces. */
export type CastleSide = "king" | "queen";

/**
 * One move, flattened to exactly what both clients need to render an
 * instruction. Plain-language text is derived on the client from these fields
 * (see moveLanguage.ts) rather than shipped over the wire, so the payload stays
 * small and both players always read identical wording.
 */
export interface SerializedMove {
  /** Move sequence number this move produced. Starts at 1. */
  sequence: number;
  color: PieceColor;
  from: string;
  to: string;
  piece: PieceSymbol;
  san: string;
  lan: string;
  /** Full-move number, as printed in PGN. */
  moveNumber: number;
  captured?: PieceSymbol;
  promotion?: PieceSymbol;
  isCapture: boolean;
  isEnPassant: boolean;
  castle: CastleSide | null;
  isCheck: boolean;
  isCheckmate: boolean;
  fenBefore: string;
  fenAfter: string;
  playedAt: number;
}

export interface PublicPlayer {
  displayName: string;
  color: PieceColor;
  connected: boolean;
  lastSeenAt: number;
  /** Highest move sequence this player has confirmed onto their real board. */
  copiedThroughSequence: number;
}

export interface ClockState {
  initialMs: number;
  whiteMs: number;
  blackMs: number;
  /** Whose clock is counting down right now, or null if nothing is running. */
  runningFor: PieceColor | null;
  /** Server timestamp the running clock was last reconciled at. */
  lastTickAt: number;
  /** Set while a clock is held because the other player dropped off. */
  pausedReason: "opponent_disconnected" | null;
}

export interface PublicUndoRequest {
  requestedBy: PieceColor;
  /** The move sequence the requester wants to roll back to. */
  targetSequence: number;
  requestedAt: number;
}

export interface PendingDrawOffer {
  offeredBy: PieceColor;
  offeredAt: number;
}

/** Per-connection identity. Never contains another player's secrets. */
export interface SeatView {
  color: PieceColor;
  displayName: string;
  /**
   * True when this socket lost primary status to a newer tab using the same
   * seat token. Read-only sockets receive every update but may not act.
   */
  isReadOnly: boolean;
}

/**
 * The complete client-visible room state. Sent on join and on every reconnect;
 * normal play uses incremental events instead.
 */
export interface RoomSnapshot {
  roomId: string;
  /** Optimistic-concurrency version maintained by Postgres. */
  version: number;
  publicCode: string;
  status: RoomStatus;
  turnPhase: TurnPhase;
  fen: string;
  pgn: string;
  /** Side to move in the authoritative position. */
  turn: PieceColor;
  moveNumber: number;
  moveSequence: number;
  lastMove: SerializedMove | null;
  previousFen: string | null;
  /** Most recent moves, oldest first. Powers the "boards don't match" panel. */
  recentMoves: SerializedMove[];
  white: PublicPlayer | null;
  black: PublicPlayer | null;
  pendingUndo: PublicUndoRequest | null;
  pendingDraw: PendingDrawOffer | null;
  result: GameResult | null;
  clock: ClockState | null;
  inCheck: boolean;
  expiresAt: number;
  /** Null while a spectator-less socket is still identifying itself. */
  you: SeatView | null;
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Machine-readable failure reasons. The client maps each to friendly copy in
 * src/lib/errorCopy.ts; raw codes are never rendered to a player.
 */
export type ErrorCode =
  | "auth_required"
  | "invalid_input"
  | "protocol_mismatch"
  | "bad_request"
  | "rate_limited"
  | "room_not_found"
  | "room_expired"
  | "room_full"
  | "invalid_invite"
  | "invalid_code"
  | "not_a_player"
  | "not_your_turn"
  | "wrong_phase"
  | "illegal_move"
  | "stale_sequence"
  | "room_version_conflict"
  | "not_a_room_member"
  | "invalid_turn_phase"
  | "move_already_copied"
  | "undo_not_available"
  | "duplicate_action"
  | "read_only_connection"
  | "game_already_over"
  | "no_undo_pending"
  | "no_draw_pending"
  | "internal_error";

/* -------------------------------------------------------------------------- */
/* Envelopes                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Every message on the socket carries these. `eventId` makes server events
 * de-duplicatable after a reconnect replay; `ts` is authoritative server time
 * on server messages and advisory client time on client messages.
 */
export interface Envelope {
  v: number;
  roomId: string;
  eventId: string;
  ts: number;
}

/* ------------------------------- client -> server ------------------------- */

/**
 * Actions that change room state carry a client-generated `actionId`. The room
 * remembers recently applied ids, so a retry after a flaky send is a no-op
 * rather than a second move.
 */
interface IdempotentAction {
  actionId: string;
}

export interface JoinRoomEvent extends IdempotentAction {
  type: "join_room";
  /** Invite secret from the URL fragment. Required for the second seat. */
  inviteSecret?: string;
  /** Existing seat token from local storage, if this device played before. */
  seatToken?: string;
  displayName?: string;
}

export interface ResumeSeatEvent extends IdempotentAction {
  type: "resume_seat";
  seatToken: string;
}

export interface SubmitMoveEvent extends IdempotentAction {
  type: "submit_move";
  from: string;
  to: string;
  promotion?: PieceSymbol;
  /** The move sequence the client believes is current. Guards against races. */
  expectedSequence: number;
}

export interface ConfirmMoveCopiedEvent extends IdempotentAction {
  type: "confirm_move_copied";
  /** The sequence of the move being confirmed. */
  sequence: number;
}

export interface RequestUndoEvent extends IdempotentAction {
  type: "request_undo";
  targetSequence: number;
}

export interface RespondToUndoEvent extends IdempotentAction {
  type: "respond_to_undo";
  accept: boolean;
}

export interface OfferDrawEvent extends IdempotentAction {
  type: "offer_draw";
}

export interface RespondToDrawEvent extends IdempotentAction {
  type: "respond_to_draw";
  accept: boolean;
}

export interface ResignEvent extends IdempotentAction {
  type: "resign";
}

export interface LeaveRoomEvent {
  type: "leave_room";
}

export type ClientEventBody =
  | JoinRoomEvent
  | ResumeSeatEvent
  | SubmitMoveEvent
  | ConfirmMoveCopiedEvent
  | RequestUndoEvent
  | RespondToUndoEvent
  | OfferDrawEvent
  | RespondToDrawEvent
  | ResignEvent
  | LeaveRoomEvent;

export type ClientMessage = Envelope & ClientEventBody;

/* ------------------------------- server -> client ------------------------- */

export interface RoomSnapshotEvent {
  type: "room_snapshot";
  snapshot: RoomSnapshot;
  /**
   * Present only on the first snapshot after a seat is granted. The client
   * stores it per-room in local storage to survive refreshes.
   */
  seatToken?: string;
}

export interface PlayerJoinedEvent {
  type: "player_joined";
  player: PublicPlayer;
  snapshot: RoomSnapshot;
}

export interface PlayerPresenceChangedEvent {
  type: "player_presence_changed";
  color: PieceColor;
  connected: boolean;
  displayName: string;
  clock: ClockState | null;
}

export interface MoveAcceptedEvent {
  type: "move_accepted";
  move: SerializedMove;
  moveSequence: number;
  turnPhase: TurnPhase;
  clock: ClockState | null;
  result: GameResult | null;
}

export interface MoveRejectedEvent {
  type: "move_rejected";
  code: ErrorCode;
  /** Echoed so the client can clear exactly the attempt that failed. */
  actionId: string;
  moveSequence: number;
}

export interface MoveReceivedEvent {
  type: "move_received";
  move: SerializedMove;
  moveSequence: number;
  turnPhase: TurnPhase;
  clock: ClockState | null;
  result: GameResult | null;
}

export interface MoveCopiedEvent {
  type: "move_copied";
  sequence: number;
  by: PieceColor;
  turnPhase: TurnPhase;
  clock: ClockState | null;
}

export interface TurnChangedEvent {
  type: "turn_changed";
  turn: PieceColor;
  turnPhase: TurnPhase;
  moveSequence: number;
  inCheck: boolean;
  clock: ClockState | null;
}

export interface UndoRequestedEvent {
  type: "undo_requested";
  request: PublicUndoRequest;
  requesterName: string;
}

export interface UndoResolvedEvent {
  type: "undo_resolved";
  accepted: boolean;
  snapshot: RoomSnapshot;
}

export interface DrawOfferedEvent {
  type: "draw_offered";
  offer: PendingDrawOffer;
  offererName: string;
}

/**
 * Sent when a draw offer is declined. An accepted offer ends the game and
 * arrives as `game_completed` instead.
 */
export interface DrawResolvedEvent {
  type: "draw_resolved";
  accepted: false;
  declinedBy: PieceColor;
}

export interface GameCompletedEvent {
  type: "game_completed";
  result: GameResult;
  snapshot: RoomSnapshot;
}

export interface RoomExpiredEvent {
  type: "room_expired";
}

export interface ErrorEvent {
  type: "error";
  code: ErrorCode;
  /** Echoed when the failure can be traced to a specific client action. */
  actionId?: string;
  /** Seconds to wait before retrying. Only set for rate_limited. */
  retryAfter?: number;
}

export type ServerEventBody =
  | RoomSnapshotEvent
  | PlayerJoinedEvent
  | PlayerPresenceChangedEvent
  | MoveAcceptedEvent
  | MoveRejectedEvent
  | MoveReceivedEvent
  | MoveCopiedEvent
  | TurnChangedEvent
  | UndoRequestedEvent
  | UndoResolvedEvent
  | DrawOfferedEvent
  | DrawResolvedEvent
  | GameCompletedEvent
  | RoomExpiredEvent
  | ErrorEvent;

export type ServerMessage = Envelope & ServerEventBody;

/* -------------------------------------------------------------------------- */
/* HTTP contract                                                              */
/* -------------------------------------------------------------------------- */

export type GameSpeed = "none" | "10" | "30";

export const CLOCK_MS: Record<GameSpeed, number> = {
  none: 0,
  "10": 10 * 60 * 1000,
  "30": 30 * 60 * 1000,
};

export interface CreateRoomRequest {
  displayName?: string;
  /** "surprise" lets the server pick, which is the default in the UI. */
  side: PieceColor | "surprise";
  speed: GameSpeed;
}

export interface CreateRoomResponse {
  roomId: string;
  publicCode: string;
  inviteSecret: string;
  seatToken: string;
  color: PieceColor;
}

/** Response to a code lookup, used by /join before a socket is opened. */
export interface ResolveCodeResponse {
  roomId: string;
  publicCode: string;
  status: RoomStatus;
  /** Name of the player already seated, for the "Join Sam's game?" prompt. */
  hostName: string | null;
  hasOpenSeat: boolean;
}

export interface ApiErrorResponse {
  error: ErrorCode;
  retryAfter?: number;
}

/* -------------------------------------------------------------------------- */
/* Limits                                                                     */
/* -------------------------------------------------------------------------- */

export const LIMITS = {
  /** Display names are trimmed and clamped to this before storage. */
  displayNameMaxLength: 24,
  /** Rejects oversized frames before they are parsed. */
  maxMessageBytes: 4096,
  /** How many recent moves ride along in a snapshot. */
  recentMoveWindow: 5,
  /** Grace period before a disconnect pauses a running clock. */
  disconnectGraceMs: 30_000,
  /** How long a dropped player keeps their seat and the game stays warm. */
  reconnectWindowMs: 10 * 60 * 1000,
  /** Remembered action ids per room, for idempotency. */
  actionMemory: 64,
} as const;

export const DEFAULT_NAMES = {
  host: "Player 1",
  guest: "Player 2",
} as const;
