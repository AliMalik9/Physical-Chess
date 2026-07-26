import type {SupabaseClient} from "npm:@supabase/supabase-js@2";

function player(row: Record<string, unknown>, you: boolean) {
  return {displayName: row.display_name, color: row.color, connected: true, lastSeenAt: new Date(String(row.last_seen_at ?? row.joined_at)).getTime(), copiedThroughSequence: Number(row.copied_through_sequence ?? 0), ...(you ? {isYou: true} : {})};
}

/** Service-side projection. Hashes, audit rows and invite credentials never leave it. */
export async function snapshot(admin: SupabaseClient, roomId: string, userId: string): Promise<Record<string, unknown>> {
  const {data: room, error: roomError} = await admin.from("rooms").select("*").eq("id", roomId).single();
  if (roomError || !room) throw new Error("ROOM_NOT_FOUND");
  const {data: players, error: playersError} = await admin.from("room_players").select("*").eq("room_id", roomId);
  if (playersError || !players?.some((row) => row.user_id === userId)) throw new Error("NOT_A_ROOM_MEMBER");
  const {data: moves} = await admin.from("moves").select("*").eq("room_id", roomId).order("sequence", {ascending: false}).limit(5);
  const current = players.find((row) => row.user_id === userId)!;
  const convertMove = (move: Record<string, unknown>) => ({...(move.metadata as Record<string, unknown>), sequence: Number(move.sequence), playedAt: new Date(String(move.created_at)).getTime()});
  const pending = room.pending_action as Record<string, unknown> | null;
  return {
    roomId: room.id, publicCode: room.public_code, status: room.status, turnPhase: room.turn_phase,
    fen: room.fen, pgn: room.pgn, version: Number(room.version), turn: room.side_to_move,
    moveNumber: Number(room.move_number), moveSequence: Number(room.move_sequence), lastMove: room.last_move,
    previousFen: room.previous_fen, recentMoves: (moves ?? []).reverse().map(convertMove),
    white: players.find((row) => row.color === "white") ? player(players.find((row) => row.color === "white")!, current.color === "white") : null,
    black: players.find((row) => row.color === "black") ? player(players.find((row) => row.color === "black")!, current.color === "black") : null,
    pendingUndo: pending?.kind === "undo" ? {requestedBy: pending.requestedBy, targetSequence: Number(pending.targetSequence), requestedAt: Number(pending.requestedAt)} : null,
    pendingDraw: pending?.kind === "draw" ? {offeredBy: pending.offeredBy, offeredAt: Number(pending.offeredAt)} : null,
    result: room.result, clock: room.clock_state, inCheck: Boolean((room.last_move as Record<string, unknown> | null)?.isCheck),
    expiresAt: new Date(room.expires_at).getTime(), you: {color: current.color, displayName: current.display_name, isReadOnly: false},
  };
}
