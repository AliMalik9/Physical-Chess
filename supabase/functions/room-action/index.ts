import {Chess, type Move, type Square} from "npm:chess.js@1.4.0";

import {callerId, adminClient} from "../_shared/auth.ts";
import {corsHeaders, options} from "../_shared/cors.ts";
import {apiError, rpcError} from "../_shared/errors.ts";
import {broadcast, newEvent} from "../_shared/realtime.ts";
import {snapshot} from "../_shared/snapshot.ts";
import {actionId, square, uuid} from "../_shared/validation.ts";

type Action = Record<string, unknown> & {type: string; roomId: string; expectedVersion: number; clientActionId: string};

function result(chess: Chess): Record<string, unknown> | null {
  const endedAt = Date.now();
  if (chess.isCheckmate()) { const winner = chess.turn() === "w" ? "black" : "white"; return {reason: "checkmate", winner, scoreline: winner === "white" ? "1-0" : "0-1", endedAt}; }
  if (chess.isStalemate()) return {reason: "stalemate", winner: null, scoreline: "1/2-1/2", endedAt};
  if (chess.isInsufficientMaterial()) return {reason: "insufficient_material", winner: null, scoreline: "1/2-1/2", endedAt};
  if (chess.isThreefoldRepetition()) return {reason: "threefold_repetition", winner: null, scoreline: "1/2-1/2", endedAt};
  if (chess.isDrawByFiftyMoves()) return {reason: "fifty_move_rule", winner: null, scoreline: "1/2-1/2", endedAt};
  return null;
}

function serialized(move: Move, chess: Chess, sequence: number): Record<string, unknown> {
  const color = move.color === "w" ? "white" : "black";
  const castle = move.isKingsideCastle() ? "king" : move.isQueensideCastle() ? "queen" : null;
  return {
    sequence, color, from: move.from, to: move.to, piece: move.piece, san: move.san, lan: move.lan,
    moveNumber: Number(move.before.split(" ")[5] ?? 1), captured: move.captured, promotion: move.promotion,
    isCapture: move.isCapture(), isEnPassant: move.isEnPassant(), castle, isCheck: chess.inCheck(), isCheckmate: chess.isCheckmate(),
    fenBefore: move.before, fenAfter: move.after, playedAt: Date.now(),
    plainInstruction: `Move the ${color} ${move.piece} from ${move.from.toUpperCase()} to ${move.to.toUpperCase()}.`,
  };
}

function envelope(roomId: string, type: string, body: Record<string, unknown>) {
  return {v: 1, roomId, eventId: crypto.randomUUID(), ts: Date.now(), type, ...body};
}

async function callRpc(admin: ReturnType<typeof adminClient>, name: string, args: Record<string, unknown>): Promise<void> {
  const {error} = await admin.rpc(name, args);
  if (error) throw error;
}

Deno.serve(async (request) => {
  const preflight = options(request); if (preflight) return preflight;
  const headers = corsHeaders(request);
  try {
    const userId = await callerId(request); if (!userId) { const response=apiError("AUTH_REQUIRED"); return new Response(response.body,{status:response.status,headers}); }
    const action = await request.json() as Action;
    const roomId = uuid(action.roomId); const expectedVersion = Number(action.expectedVersion); const clientActionId = actionId(action.clientActionId);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error("INVALID_INPUT");
    const admin = adminClient();
    const before = await snapshot(admin, roomId, userId);
    let ownMessage: Record<string, unknown> | undefined;
    let roomMessage: Record<string, unknown> | undefined;

    if (action.type === "submit_move") {
      const chess = new Chess(String(before.fen));
      let move: Move;
      try { move = chess.move({from: square(action.from) as Square, to: square(action.to) as Square, ...(action.promotion ? {promotion: String(action.promotion) as "q" | "r" | "b" | "n"} : {})}); }
      catch { throw new Error("ILLEGAL_MOVE"); }
      const nextMove = serialized(move, chess, Number(before.moveSequence) + 1);
      const gameResult = result(chess);
      await callRpc(admin, "room_submit_move", {p_room_id: roomId,p_actor_id:userId,p_expected_version:expectedVersion,p_client_action_id:clientActionId,p_move:nextMove,p_fen:chess.fen(),p_pgn:chess.pgn(),p_result:gameResult,p_clock_state:before.clock});
      ownMessage = envelope(roomId, "move_accepted", {move: nextMove, moveSequence: nextMove.sequence, turnPhase: "waiting_for_copy_confirmation", clock: before.clock, result: gameResult});
      roomMessage = envelope(roomId, "move_received", {move: nextMove, moveSequence: nextMove.sequence, turnPhase: "waiting_for_copy_confirmation", clock: before.clock, result: gameResult});
    } else if (action.type === "confirm_move_copied") {
      const sequence = Number(action.moveSequence); if (!Number.isSafeInteger(sequence)) throw new Error("INVALID_INPUT");
      await callRpc(admin, "room_confirm_copy", {p_room_id:roomId,p_actor_id:userId,p_expected_version:expectedVersion,p_client_action_id:clientActionId,p_sequence:sequence,p_clock_state:before.clock});
      roomMessage = envelope(roomId, "move_copied", {sequence, by: before.you?.color, turnPhase:"waiting_for_move",clock:before.clock});
    } else if (["request_undo","respond_to_undo","offer_draw","respond_to_draw","resign","leave_room"].includes(action.type)) {
      const payload: Record<string, unknown> = {...action};
      if (action.type === "respond_to_undo" && action.accepted === true) {
        const target = Number((before.pendingUndo as Record<string, unknown> | null)?.targetSequence);
        const {data: history} = await admin.from("moves").select("*").eq("room_id", roomId).lte("sequence", target).order("sequence");
        const chess = new Chess();
        for (const move of history ?? []) chess.move({from: move.from_square as Square,to:move.to_square as Square,...(move.promotion ? {promotion:move.promotion as "q"|"r"|"b"|"n"}:{})});
        const last = history?.at(-1);
        Object.assign(payload, {fen:chess.fen(),pgn:chess.pgn(),moveNumber:chess.moveNumber(),sideToMove:chess.turn()==="w"?"white":"black",lastMove:last?.metadata ?? null,previousFen:null});
      }
      await callRpc(admin,"room_meta_action",{p_room_id:roomId,p_actor_id:userId,p_expected_version:expectedVersion,p_client_action_id:clientActionId,p_action:action.type,p_payload:payload});
      roomMessage = envelope(roomId, action.type === "request_undo" ? "undo_requested" : action.type === "offer_draw" ? "draw_offered" : action.type === "resign" ? "game_completed" : action.type === "respond_to_undo" ? "undo_resolved" : "draw_resolved", {});
      ownMessage = roomMessage;
    } else throw new Error("INVALID_INPUT");

    const after = await snapshot(admin, roomId, userId);
    // Snapshots are authoritative for the caller; broadcasts are compact and
    // recipients recover a snapshot if their version sequence has a gap.
    if (roomMessage) await broadcast(newEvent(roomId, Number(after.version), Number(after.moveSequence), action.type, {message: roomMessage}));
    return Response.json({snapshot: after, ...(ownMessage ? {message: ownMessage} : {})}, {headers});
  } catch (error) {
    const response = error instanceof Error && /^(INVALID_INPUT|ILLEGAL_MOVE)$/.test(error.message) ? apiError(error.message) : error && typeof error === "object" && "message" in error ? rpcError(error as {message?:string}) : apiError("INTERNAL_ERROR");
    return new Response(response.body, {status: response.status, headers});
  }
});
