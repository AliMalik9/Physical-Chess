import {DurableObject} from "cloudflare:workers";
import {Chess} from "chess.js";

import {buildPgn, replay, result} from "@shared/chessEngine";
import {
  CLOCK_MS,
  DEFAULT_NAMES,
  LIMITS,
  PROTOCOL_VERSION,
  type ClientMessage,
  type CreateRoomRequest,
  type CreateRoomResponse,
  type ErrorCode,
  type PieceColor,
  type PieceSymbol,
  type PublicPlayer,
  type ResolveCodeResponse,
  type RoomSnapshot,
  type SeatView,
  type SerializedMove,
  type ServerEventBody,
} from "@shared/protocol";

import {
  newId,
  newInviteSecret,
  newSeatToken,
  sanitizeDisplayName,
  sha256Hex,
  verifySecret,
} from "./crypto";
import {roomTtls, type Env} from "./env";
import {
  applyClockExpiry,
  applyConfirmCopy,
  applyMove,
  applyUndo,
  bothSeatsTaken,
  claimAction,
  clockDeadline,
  finish,
  guardConfirmCopy,
  guardDrawOffer,
  guardDrawResponse,
  guardResign,
  guardSubmitMove,
  guardUndoRequest,
  guardUndoResponse,
  markAwaitingCopy,
  opponentOf,
  pauseClockForDisconnect,
  playerAt,
  resumeClock,
  setPlayerAt,
  startClockForActiveGame,
  tickClock,
  type RoomPlayerState,
  type RoomState,
} from "./roomLogic";

/** Metadata carried on each socket so it survives hibernation. */
interface SocketAttachment {
  connectionId: string;
  color: PieceColor | null;
  playerId: string | null;
}

const ROOM_KEY = "room";
const MOVE_PREFIX = "m:";

function moveKey(sequence: number): string {
  return `${MOVE_PREFIX}${String(sequence).padStart(4, "0")}`;
}

/**
 * One instance per game. Addressed by the public room code, so no directory
 * lookup is needed to find a room from a code someone read aloud.
 *
 * This object is the only authority on the position. Clients render it; they
 * never decide it.
 */
export class GameRoom extends DurableObject<Env> {
  private room: RoomState | null = null;
  private moves: SerializedMove[] = [];
  private game = new Chess();
  private loaded = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Hydrate before any request is served, so a request arriving straight
    // after hibernation never sees an empty board.
    ctx.blockConcurrencyWhile(async () => {
      await this.load();
    });
  }

  private async load(): Promise<void> {
    if (this.loaded) return;

    const stored = await this.ctx.storage.get<RoomState>(ROOM_KEY);
    if (stored) {
      this.room = stored;
      const entries = await this.ctx.storage.list<SerializedMove>({
        prefix: MOVE_PREFIX,
      });
      // Keys are zero-padded, so list() order is move order.
      this.moves = [...entries.values()];
      this.game = replay(this.moves);
    }
    this.loaded = true;
  }

  private async persistRoom(): Promise<void> {
    if (this.room) await this.ctx.storage.put(ROOM_KEY, this.room);
  }

  /* ---------------------------------------------------------------------- */
  /* HTTP entry points, called only by the Worker                            */
  /* ---------------------------------------------------------------------- */

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    switch (url.pathname) {
      case "/create":
        return this.handleCreate(request);
      case "/resolve":
        return this.handleResolve();
      case "/pgn":
        return this.handlePgn(url);
      case "/ws":
        return this.handleSocketUpgrade(request);
      default:
        return jsonError("bad_request", 404);
    }
  }

  private async handleCreate(request: Request): Promise<Response> {
    if (this.room) {
      // The Worker generated a code that is already in use. It retries with a
      // fresh one rather than handing this room to a stranger.
      return jsonError("bad_request", 409);
    }

    const body = (await request.json()) as CreateRoomRequest & {
      publicCode: string;
    };
    const now = Date.now();
    const ttls = roomTtls(this.env);

    const inviteSecret = newInviteSecret();
    const seatToken = newSeatToken();
    const color = pickColor(body.side);
    const clockMs = CLOCK_MS[body.speed] ?? 0;

    const host: RoomPlayerState = {
      id: newId(),
      seatTokenHash: await sha256Hex(seatToken),
      displayName: sanitizeDisplayName(
        body.displayName,
        DEFAULT_NAMES.host,
        LIMITS.displayNameMaxLength,
      ),
      color,
      connected: false,
      lastSeenAt: now,
      copiedThroughSequence: 0,
      primaryConnectionId: null,
      disconnectedAt: null,
    };

    this.room = {
      id: this.ctx.id.toString(),
      publicCode: body.publicCode,
      inviteHash: await sha256Hex(inviteSecret),
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      // An unjoined room is cheap to abandon, so it gets the short lifetime.
      expiresAt: now + ttls.emptyMs,
      status: "waiting_for_opponent",
      turnPhase: "waiting_for_move",
      moveSequence: 0,
      previousFen: null,
      white: null,
      black: null,
      pendingUndo: null,
      pendingDraw: null,
      result: null,
      clock: clockMs
        ? {
            initialMs: clockMs,
            whiteMs: clockMs,
            blackMs: clockMs,
            runningFor: null,
            lastTickAt: now,
            pausedReason: null,
          }
        : null,
      recentActionIds: [],
    };
    setPlayerAt(this.room, color, host);

    this.game = new Chess();
    this.moves = [];
    await this.persistRoom();
    await this.scheduleAlarm();

    const response: CreateRoomResponse = {
      roomId: this.room.id,
      publicCode: this.room.publicCode,
      inviteSecret,
      seatToken,
      color,
    };
    return Response.json(response);
  }

  private handleResolve(): Response {
    const room = this.room;
    if (!room) return jsonError("room_not_found", 404);
    if (room.status === "expired") return jsonError("room_expired", 410);

    const seated = room.white ?? room.black;
    const response: ResolveCodeResponse = {
      roomId: room.id,
      publicCode: room.publicCode,
      status: room.status,
      hostName: seated?.displayName ?? null,
      hasOpenSeat: !bothSeatsTaken(room),
    };
    return Response.json(response);
  }

  /**
   * PGN download. Gated on a seat token: the moves are the game, and the game
   * belongs to the two people who played it.
   */
  private async handlePgn(url: URL): Promise<Response> {
    const room = this.room;
    if (!room) return jsonError("room_not_found", 404);

    const seatToken = url.searchParams.get("seat") ?? undefined;
    const seat = await this.findSeatByToken(seatToken);
    if (!seat) return jsonError("not_a_player", 403);

    const pgn = this.currentPgn();
    return new Response(pgn, {
      headers: {
        "Content-Type": "application/x-chess-pgn; charset=utf-8",
        "Content-Disposition": `attachment; filename="boardlink-${room.publicCode}.pgn"`,
        "Cache-Control": "no-store",
      },
    });
  }

  /* ---------------------------------------------------------------------- */
  /* WebSocket lifecycle                                                     */
  /* ---------------------------------------------------------------------- */

  private handleSocketUpgrade(request: Request): Response {
    if (request.headers.get("Upgrade") !== "websocket") {
      return jsonError("bad_request", 426);
    }
    if (!this.room) return jsonError("room_not_found", 404);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Hibernatable: the room can be evicted between moves and the sockets stay
    // open. Without this a quiet game would bill for wall-clock time.
    this.ctx.acceptWebSocket(server);

    const attachment: SocketAttachment = {
      connectionId: newId(),
      color: null,
      playerId: null,
    };
    server.serializeAttachment(attachment);

    return new Response(null, {status: 101, webSocket: client});
  }

  override async webSocketMessage(
    ws: WebSocket,
    raw: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof raw !== "string") return;
    if (raw.length > LIMITS.maxMessageBytes) {
      this.send(ws, {type: "error", code: "bad_request"});
      return;
    }

    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      this.send(ws, {type: "error", code: "bad_request"});
      return;
    }

    if (message.v !== PROTOCOL_VERSION) {
      this.send(ws, {type: "error", code: "protocol_mismatch"});
      return;
    }

    try {
      await this.dispatch(ws, message);
    } catch {
      // Never leak an internal failure to a player; the client shows a generic
      // recovery message and asks the server for a fresh snapshot.
      this.send(ws, {type: "error", code: "internal_error"});
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.handleSocketGone(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.handleSocketGone(ws);
  }

  private async handleSocketGone(ws: WebSocket): Promise<void> {
    const room = this.room;
    const attachment = readAttachment(ws);
    if (!room || !attachment?.color) return;

    const player = playerAt(room, attachment.color);
    if (!player) return;

    // Another tab for the same seat may still be open; presence only changes
    // when the last one goes.
    const remaining = this.socketsForColor(attachment.color).filter(
      (socket) => socket !== ws,
    );

    if (remaining.length > 0) {
      // If the tab that left was the one driving the seat, hand primary status
      // to a survivor. Without this the seat stays pinned to a dead connection
      // and every remaining tab is locked read-only with nobody able to move.
      if (player.primaryConnectionId === attachment.connectionId) {
        const heir = remaining[remaining.length - 1]!;
        player.primaryConnectionId =
          readAttachment(heir)?.connectionId ?? null;
        await this.persistRoom();
        this.sendSnapshot(heir);
      }
      return;
    }

    const now = Date.now();
    player.connected = false;
    player.lastSeenAt = now;
    player.disconnectedAt = now;
    player.primaryConnectionId = null;

    await this.persistRoom();
    await this.scheduleAlarm();

    this.broadcast({
      type: "player_presence_changed",
      color: player.color,
      connected: false,
      displayName: player.displayName,
      clock: room.clock,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Dispatch                                                                */
  /* ---------------------------------------------------------------------- */

  private async dispatch(ws: WebSocket, message: ClientMessage): Promise<void> {
    const room = this.room;
    if (!room) {
      this.send(ws, {type: "error", code: "room_not_found"});
      return;
    }

    if (message.type === "heartbeat") {
      const attachment = readAttachment(ws);
      if (attachment?.color) {
        const player = playerAt(room, attachment.color);
        if (player) player.lastSeenAt = Date.now();
      }
      return;
    }

    if (message.type === "join_room" || message.type === "resume_seat") {
      await this.handleJoin(ws, message);
      return;
    }

    if (message.type === "leave_room") {
      await this.handleSocketGone(ws);
      return;
    }

    const seat = this.seatFor(ws);
    if (!seat) {
      this.send(ws, {type: "error", code: "not_a_player"});
      return;
    }

    // Expiry and flag-fall are checked on every action so a game cannot be
    // played on past its own deadline.
    if (await this.settleTime()) {
      this.sendSnapshot(ws);
    }

    switch (message.type) {
      case "submit_move":
        await this.handleSubmitMove(ws, seat, message);
        return;
      case "confirm_move_copied":
        await this.handleConfirmCopy(ws, seat, message);
        return;
      case "request_undo":
        await this.handleUndoRequest(ws, seat, message);
        return;
      case "respond_to_undo":
        await this.handleUndoResponse(ws, seat, message);
        return;
      case "offer_draw":
        await this.handleDrawOffer(ws, seat, message);
        return;
      case "respond_to_draw":
        await this.handleDrawResponse(ws, seat, message);
        return;
      case "resign":
        await this.handleResign(ws, seat, message);
        return;
      default:
        this.send(ws, {type: "error", code: "bad_request"});
    }
  }

  /* ------------------------------- joining ------------------------------- */

  private async handleJoin(
    ws: WebSocket,
    message: Extract<ClientMessage, {type: "join_room" | "resume_seat"}>,
  ): Promise<void> {
    const room = this.room;
    if (!room) return;

    const now = Date.now();
    if (room.status === "expired" || room.expiresAt <= now) {
      this.send(ws, {type: "error", code: "room_expired"});
      return;
    }

    // Returning device: match the stored hash and take the seat back.
    let existing = await this.findSeatByToken(message.seatToken);
    let issuedToken: string | undefined;

    if (!existing) {
      if (message.type === "resume_seat") {
        this.send(ws, {type: "error", code: "not_a_player"});
        return;
      }

      // A supplied invite secret must be correct. A missing one is allowed:
      // that is the "typed the room code" path, which the Worker rate-limits.
      if (message.inviteSecret !== undefined) {
        const valid = await verifySecret(message.inviteSecret, room.inviteHash);
        if (!valid) {
          this.send(ws, {type: "error", code: "invalid_invite"});
          return;
        }
      }

      if (bothSeatsTaken(room)) {
        this.send(ws, {type: "error", code: "room_full"});
        return;
      }

      const openColor: PieceColor = room.white ? "black" : "white";
      const token = newSeatToken();
      issuedToken = token;

      const player: RoomPlayerState = {
        id: newId(),
        seatTokenHash: await sha256Hex(token),
        displayName: sanitizeDisplayName(
          message.displayName,
          DEFAULT_NAMES.guest,
          LIMITS.displayNameMaxLength,
        ),
        color: openColor,
        connected: true,
        lastSeenAt: now,
        copiedThroughSequence: 0,
        primaryConnectionId: null,
        disconnectedAt: null,
      };
      setPlayerAt(room, openColor, player);
      existing = player;

      if (bothSeatsTaken(room)) {
        room.status = "active";
        room.startedAt = now;
        startClockForActiveGame(room, now);
        this.refreshExpiry(now);
      }
    }

    // Bind the socket to the seat, and demote any older tab holding it.
    const attachment: SocketAttachment = {
      connectionId: newId(),
      color: existing.color,
      playerId: existing.id,
    };
    ws.serializeAttachment(attachment);

    const previousPrimary = existing.primaryConnectionId;
    existing.primaryConnectionId = attachment.connectionId;
    existing.connected = true;
    existing.lastSeenAt = now;
    existing.disconnectedAt = null;

    const wasPaused = resumeClock(room, now);

    // A move that was waiting for this player is now genuinely in front of
    // them, so the phase can advance past "sent but unseen".
    const isReceiver =
      room.moveSequence > 0 &&
      this.moves.at(-1)?.color === opponentOf(existing.color);
    if (isReceiver) markAwaitingCopy(room);

    await this.persistRoom();
    await this.scheduleAlarm();

    this.sendSnapshot(ws, issuedToken);

    if (previousPrimary && previousPrimary !== attachment.connectionId) {
      // Tell the demoted tab why it just went read-only.
      for (const socket of this.socketsForColor(existing.color)) {
        if (socket !== ws) this.sendSnapshot(socket);
      }
    }

    const joinedPublic = toPublicPlayer(existing);
    if (issuedToken) {
      // A seat was created, so this really is someone arriving for the first
      // time. The waiting room is listening for exactly this to say "Sam joined".
      this.broadcastWithSnapshot(
        (snapshot) => ({type: "player_joined", player: joinedPublic, snapshot}),
        ws,
      );
    } else {
      // A returning device. Presence changed; nobody new arrived.
      this.broadcastExcept(ws, {
        type: "player_presence_changed",
        color: existing.color,
        connected: true,
        displayName: existing.displayName,
        clock: room.clock,
      });
    }

    if (wasPaused) {
      this.broadcast({
        type: "turn_changed",
        turn: this.game.turn() === "w" ? "white" : "black",
        turnPhase: room.turnPhase,
        moveSequence: room.moveSequence,
        inCheck: this.game.inCheck(),
        clock: room.clock,
      });
    }
  }

  private broadcastExcept(exclude: WebSocket, body: ServerEventBody): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== exclude) this.send(socket, body);
    }
  }

  /* -------------------------------- moves -------------------------------- */

  private async handleSubmitMove(
    ws: WebSocket,
    seat: Seat,
    message: Extract<ClientMessage, {type: "submit_move"}>,
  ): Promise<void> {
    const room = this.room;
    if (!room) return;

    if (!claimAction(room, message.actionId)) {
      // Already applied. Re-sync rather than moving twice.
      this.sendSnapshot(ws);
      return;
    }

    const guard = guardSubmitMove({
      state: room,
      game: this.game,
      color: seat.color,
      expectedSequence: message.expectedSequence,
      isReadOnly: seat.isReadOnly,
    });
    if (guard) {
      this.send(ws, {
        type: "move_rejected",
        code: guard,
        actionId: message.actionId,
        moveSequence: room.moveSequence,
      });
      return;
    }

    const now = Date.now();
    const applied = applyMove({
      state: room,
      game: this.game,
      from: message.from,
      to: message.to,
      ...(message.promotion ? {promotion: message.promotion as PieceSymbol} : {}),
      now,
    });

    if (!applied.ok) {
      this.send(ws, {
        type: "move_rejected",
        code: applied.code,
        actionId: message.actionId,
        moveSequence: room.moveSequence,
      });
      return;
    }

    const {move, outcome} = applied.applied;
    this.moves.push(move);
    await this.ctx.storage.put(moveKey(move.sequence), move);

    const opponent = opponentOf(seat.color);
    const opponentOnline = this.socketsForColor(opponent).length > 0;
    if (opponentOnline) markAwaitingCopy(room);

    this.refreshExpiry(now);
    await this.persistRoom();
    await this.scheduleAlarm();

    this.sendToColor(seat.color, {
      type: "move_accepted",
      move,
      moveSequence: room.moveSequence,
      turnPhase: room.turnPhase,
      clock: room.clock,
      result: outcome,
    });

    this.sendToColor(opponent, {
      type: "move_received",
      move,
      moveSequence: room.moveSequence,
      turnPhase: room.turnPhase,
      clock: room.clock,
      result: outcome,
    });

    if (outcome) {
      this.broadcastWithSnapshot((snapshot) => ({
        type: "game_completed",
        result: outcome,
        snapshot,
      }));
    }
  }

  private async handleConfirmCopy(
    ws: WebSocket,
    seat: Seat,
    message: Extract<ClientMessage, {type: "confirm_move_copied"}>,
  ): Promise<void> {
    const room = this.room;
    if (!room) return;

    if (!claimAction(room, message.actionId)) {
      this.sendSnapshot(ws);
      return;
    }

    const guard = guardConfirmCopy({
      state: room,
      color: seat.color,
      sequence: message.sequence,
      isReadOnly: seat.isReadOnly,
      lastMoveColor: this.moves.at(-1)?.color ?? null,
    });
    if (guard) {
      this.send(ws, {type: "error", code: guard, actionId: message.actionId});
      return;
    }

    const now = Date.now();
    applyConfirmCopy({
      state: room,
      color: seat.color,
      sequence: message.sequence,
      now,
    });
    this.refreshExpiry(now);
    await this.persistRoom();

    this.broadcast({
      type: "move_copied",
      sequence: message.sequence,
      by: seat.color,
      turnPhase: room.turnPhase,
      clock: room.clock,
    });

    // A finished game has no next turn to hand over.
    if (room.status === "active") {
      this.broadcast({
        type: "turn_changed",
        turn: seat.color,
        turnPhase: room.turnPhase,
        moveSequence: room.moveSequence,
        inCheck: this.game.inCheck(),
        clock: room.clock,
      });
    }
  }

  /* --------------------------------- undo -------------------------------- */

  private async handleUndoRequest(
    ws: WebSocket,
    seat: Seat,
    message: Extract<ClientMessage, {type: "request_undo"}>,
  ): Promise<void> {
    const room = this.room;
    if (!room) return;
    if (!claimAction(room, message.actionId)) return;

    const guard = guardUndoRequest({
      state: room,
      color: seat.color,
      isReadOnly: seat.isReadOnly,
    });
    if (guard) {
      this.send(ws, {type: "error", code: guard, actionId: message.actionId});
      return;
    }

    const player = playerAt(room, seat.color);
    room.pendingUndo = {
      requestedBy: seat.color,
      targetSequence: room.moveSequence,
      requestedAt: Date.now(),
    };
    await this.persistRoom();

    this.sendToColor(opponentOf(seat.color), {
      type: "undo_requested",
      request: room.pendingUndo,
      requesterName: player?.displayName ?? "Your opponent",
    });
  }

  private async handleUndoResponse(
    ws: WebSocket,
    seat: Seat,
    message: Extract<ClientMessage, {type: "respond_to_undo"}>,
  ): Promise<void> {
    const room = this.room;
    if (!room) return;
    if (!claimAction(room, message.actionId)) return;

    const guard = guardUndoResponse({
      state: room,
      color: seat.color,
      isReadOnly: seat.isReadOnly,
    });
    if (guard) {
      this.send(ws, {type: "error", code: guard, actionId: message.actionId});
      return;
    }

    const now = Date.now();
    if (!message.accept) {
      room.pendingUndo = null;
      await this.persistRoom();
      this.broadcastWithSnapshot((snapshot) => ({
        type: "undo_resolved",
        accepted: false,
        snapshot,
      }));
      return;
    }

    const undone = applyUndo({state: room, moves: this.moves, now});
    if (undone) {
      await this.ctx.storage.delete(moveKey(undone.sequence));
      // Rebuild rather than calling game.undo(): a fresh replay is the only way
      // to be sure repetition and fifty-move state match the shortened history.
      this.game = replay(this.moves);
    }

    await this.persistRoom();
    await this.scheduleAlarm();

    this.broadcastWithSnapshot((snapshot) => ({
      type: "undo_resolved",
      accepted: true,
      snapshot,
    }));
  }

  /* ---------------------------- draw and resign --------------------------- */

  private async handleDrawOffer(
    ws: WebSocket,
    seat: Seat,
    message: Extract<ClientMessage, {type: "offer_draw"}>,
  ): Promise<void> {
    const room = this.room;
    if (!room) return;
    if (!claimAction(room, message.actionId)) return;

    const guard = guardDrawOffer({
      state: room,
      color: seat.color,
      isReadOnly: seat.isReadOnly,
    });
    if (guard) {
      this.send(ws, {type: "error", code: guard, actionId: message.actionId});
      return;
    }

    const player = playerAt(room, seat.color);
    room.pendingDraw = {offeredBy: seat.color, offeredAt: Date.now()};
    await this.persistRoom();

    this.sendToColor(opponentOf(seat.color), {
      type: "draw_offered",
      offer: room.pendingDraw,
      offererName: player?.displayName ?? "Your opponent",
    });
  }

  private async handleDrawResponse(
    ws: WebSocket,
    seat: Seat,
    message: Extract<ClientMessage, {type: "respond_to_draw"}>,
  ): Promise<void> {
    const room = this.room;
    if (!room) return;
    if (!claimAction(room, message.actionId)) return;

    const guard = guardDrawResponse({
      state: room,
      color: seat.color,
      isReadOnly: seat.isReadOnly,
    });
    if (guard) {
      this.send(ws, {type: "error", code: guard, actionId: message.actionId});
      return;
    }

    const now = Date.now();
    if (!message.accept) {
      room.pendingDraw = null;
      await this.persistRoom();
      this.broadcast({
        type: "draw_resolved",
        accepted: false,
        declinedBy: seat.color,
      });
      return;
    }

    const outcome = result("draw_agreement", null, now);
    finish(room, outcome);
    this.refreshExpiry(now);
    await this.persistRoom();
    await this.scheduleAlarm();

    this.broadcastWithSnapshot((snapshot) => ({
      type: "game_completed",
      result: outcome,
      snapshot,
    }));
  }

  private async handleResign(
    ws: WebSocket,
    seat: Seat,
    message: Extract<ClientMessage, {type: "resign"}>,
  ): Promise<void> {
    const room = this.room;
    if (!room) return;
    if (!claimAction(room, message.actionId)) return;

    const guard = guardResign({
      state: room,
      color: seat.color,
      isReadOnly: seat.isReadOnly,
    });
    if (guard) {
      this.send(ws, {type: "error", code: guard, actionId: message.actionId});
      return;
    }

    const now = Date.now();
    const outcome = result("resignation", opponentOf(seat.color), now);
    finish(room, outcome);
    this.refreshExpiry(now);
    await this.persistRoom();
    await this.scheduleAlarm();

    this.broadcastWithSnapshot((snapshot) => ({
      type: "game_completed",
      result: outcome,
      snapshot,
    }));
  }

  /* ---------------------------------------------------------------------- */
  /* Time                                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Brings the room up to date with the wall clock: charges elapsed time,
   * flags an expired clock, and expires the room itself. Returns true when
   * something changed and connected clients need a fresh snapshot.
   */
  private async settleTime(): Promise<boolean> {
    const room = this.room;
    if (!room) return false;

    const now = Date.now();
    let changed = false;

    if (room.status !== "expired" && room.expiresAt <= now) {
      room.status = "expired";
      changed = true;
      await this.persistRoom();
      this.broadcast({type: "room_expired"});
      return changed;
    }

    tickClock(room, now);
    const flagged = applyClockExpiry(room, now);
    if (flagged) {
      changed = true;
      this.refreshExpiry(now);
      await this.persistRoom();
      this.broadcastWithSnapshot((snapshot) => ({
        type: "game_completed",
        result: flagged,
        snapshot,
      }));
    }

    return changed;
  }

  private refreshExpiry(now: number): void {
    const room = this.room;
    if (!room) return;
    const ttls = roomTtls(this.env);

    if (room.status === "completed") {
      // Keep a finished game around long enough for both players to grab a PGN.
      room.expiresAt = (room.result?.endedAt ?? now) + ttls.completedMs;
    } else if (room.status === "active") {
      room.expiresAt = now + ttls.activeMs;
    }
    room.updatedAt = now;
  }

  private async scheduleAlarm(): Promise<void> {
    const room = this.room;
    if (!room) return;

    const candidates = [room.expiresAt];

    const deadline = clockDeadline(room);
    if (deadline) candidates.push(deadline);

    // Wake once the grace period ends so a dropped player's clock is paused
    // even though nobody is interacting with the room.
    for (const color of ["white", "black"] as const) {
      const player = playerAt(room, color);
      if (player?.disconnectedAt) {
        candidates.push(player.disconnectedAt + LIMITS.disconnectGraceMs);
      }
    }

    await this.ctx.storage.setAlarm(Math.min(...candidates));
  }

  override async alarm(): Promise<void> {
    const room = this.room;
    if (!room) return;

    const now = Date.now();

    if (room.expiresAt <= now) {
      this.broadcast({type: "room_expired"});
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.close(1000, "room expired");
        } catch {
          // Already gone; nothing to clean up.
        }
      }
      await this.ctx.storage.deleteAll();
      this.room = null;
      this.moves = [];
      this.game = new Chess();
      return;
    }

    let dirty = false;

    for (const color of ["white", "black"] as const) {
      const player = playerAt(room, color);
      if (
        player?.disconnectedAt &&
        now - player.disconnectedAt >= LIMITS.disconnectGraceMs
      ) {
        if (pauseClockForDisconnect(room, now)) {
          dirty = true;
          this.broadcast({
            type: "player_presence_changed",
            color: player.color,
            connected: false,
            displayName: player.displayName,
            clock: room.clock,
          });
        }
      }
    }

    tickClock(room, now);
    const flagged = applyClockExpiry(room, now);
    if (flagged) {
      dirty = true;
      this.refreshExpiry(now);
      this.broadcastWithSnapshot((snapshot) => ({
        type: "game_completed",
        result: flagged,
        snapshot,
      }));
    }

    if (dirty) await this.persistRoom();
    await this.scheduleAlarm();
  }

  /* ---------------------------------------------------------------------- */
  /* Snapshots and delivery                                                  */
  /* ---------------------------------------------------------------------- */

  private currentPgn(): string {
    const room = this.room;
    if (!room) return "";
    return buildPgn({
      // buildPgn writes headers, so hand it a throwaway replay rather than the
      // live instance.
      chess: replay(this.moves),
      whiteName: room.white?.displayName ?? "White",
      blackName: room.black?.displayName ?? "Black",
      publicCode: room.publicCode,
      startedAt: room.startedAt,
      result: room.result,
    });
  }

  private snapshotFor(seat: Seat | null): RoomSnapshot {
    const room = this.room;
    if (!room) throw new Error("snapshot requested before the room existed");

    const you: SeatView | null = seat
      ? {
          color: seat.color,
          displayName: playerAt(room, seat.color)?.displayName ?? "",
          isReadOnly: seat.isReadOnly,
        }
      : null;

    return {
      roomId: room.id,
      publicCode: room.publicCode,
      status: room.status,
      turnPhase: room.turnPhase,
      fen: this.game.fen(),
      pgn: this.currentPgn(),
      turn: this.game.turn() === "w" ? "white" : "black",
      moveNumber: this.game.moveNumber(),
      moveSequence: room.moveSequence,
      lastMove: this.moves.at(-1) ?? null,
      previousFen: room.previousFen,
      recentMoves: this.moves.slice(-LIMITS.recentMoveWindow),
      white: room.white ? toPublicPlayer(room.white) : null,
      black: room.black ? toPublicPlayer(room.black) : null,
      pendingUndo: room.pendingUndo,
      pendingDraw: room.pendingDraw,
      result: room.result,
      clock: room.clock,
      inCheck: this.game.inCheck(),
      expiresAt: room.expiresAt,
      you,
    };
  }

  private sendSnapshot(ws: WebSocket, seatToken?: string): void {
    const seat = this.seatFor(ws);
    this.send(ws, {
      type: "room_snapshot",
      snapshot: this.snapshotFor(seat),
      ...(seatToken ? {seatToken} : {}),
    });
  }

  private send(ws: WebSocket, body: ServerEventBody): void {
    const room = this.room;
    const envelope = {
      v: PROTOCOL_VERSION,
      roomId: room?.id ?? "",
      eventId: newId(),
      ts: Date.now(),
      ...body,
    };
    try {
      ws.send(JSON.stringify(envelope));
    } catch {
      // The socket died between selection and send. The close handler will
      // reconcile presence.
    }
  }

  private broadcast(body: ServerEventBody): void {
    for (const socket of this.ctx.getWebSockets()) this.send(socket, body);
  }

  /**
   * Broadcasts an event that carries a snapshot, rebuilding the snapshot per
   * socket. A shared snapshot would carry one seat's `you` field to both
   * players and tell one of them they are nobody.
   */
  private broadcastWithSnapshot(
    build: (snapshot: RoomSnapshot) => ServerEventBody,
    exclude?: WebSocket,
  ): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === exclude) continue;
      this.send(socket, build(this.snapshotFor(this.seatFor(socket))));
    }
  }

  private sendToColor(color: PieceColor, body: ServerEventBody): void {
    for (const socket of this.socketsForColor(color)) this.send(socket, body);
  }

  private socketsForColor(color: PieceColor): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((socket) => readAttachment(socket)?.color === color);
  }

  /**
   * Resolves the seat a socket speaks for. A socket that is not the seat's
   * current primary connection is read-only: it sees everything and may change
   * nothing, which is how duplicate tabs are made harmless.
   */
  private seatFor(ws: WebSocket): Seat | null {
    const room = this.room;
    const attachment = readAttachment(ws);
    if (!room || !attachment?.color) return null;

    const player = playerAt(room, attachment.color);
    if (!player || player.id !== attachment.playerId) return null;

    return {
      color: player.color,
      isReadOnly: player.primaryConnectionId !== attachment.connectionId,
    };
  }

  private async findSeatByToken(
    token: string | undefined,
  ): Promise<RoomPlayerState | null> {
    const room = this.room;
    if (!room || !token) return null;

    for (const color of ["white", "black"] as const) {
      const player = playerAt(room, color);
      if (player && (await verifySecret(token, player.seatTokenHash))) {
        return player;
      }
    }
    return null;
  }
}

interface Seat {
  color: PieceColor;
  isReadOnly: boolean;
}

function readAttachment(ws: WebSocket): SocketAttachment | null {
  try {
    return (ws.deserializeAttachment() as SocketAttachment | null) ?? null;
  } catch {
    return null;
  }
}

function toPublicPlayer(player: RoomPlayerState): PublicPlayer {
  // Deliberately drops seatTokenHash, id and primaryConnectionId: none of that
  // belongs on the wire.
  return {
    displayName: player.displayName,
    color: player.color,
    connected: player.connected,
    lastSeenAt: player.lastSeenAt,
    copiedThroughSequence: player.copiedThroughSequence,
  };
}

function pickColor(side: CreateRoomRequest["side"]): PieceColor {
  if (side === "white" || side === "black") return side;
  // "Surprise me" is the default, so make it an actual coin flip.
  return crypto.getRandomValues(new Uint8Array(1))[0]! < 128 ? "white" : "black";
}

function jsonError(error: ErrorCode, status: number): Response {
  return Response.json({error}, {status});
}
