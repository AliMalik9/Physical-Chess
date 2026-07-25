import {LIMITS, type RoomSnapshot, type ServerMessage} from "@shared/protocol";

/**
 * Folds incremental server events into the local room snapshot.
 *
 * Normal play sends small deltas; joins, reconnects and anything that rewrites
 * history send a whole snapshot. This module never invents state — when an
 * event does not carry enough to update a field, the field is derived from the
 * FEN the server sent, which is the one value the server is always right about.
 */

function fenField(fen: string, index: number): string | undefined {
  return fen.split(" ")[index];
}

export function turnFromFen(fen: string): "white" | "black" {
  return fenField(fen, 1) === "b" ? "black" : "white";
}

export function moveNumberFromFen(fen: string): number {
  const parsed = Number(fenField(fen, 5));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function applyServerEvent(
  snapshot: RoomSnapshot | null,
  message: ServerMessage,
): RoomSnapshot | null {
  switch (message.type) {
    case "room_snapshot":
      return message.snapshot;

    case "player_joined":
    case "undo_resolved":
    case "game_completed":
      // These rewrite enough of the room that a full snapshot is cheaper to
      // trust than a delta.
      return message.snapshot;

    case "room_expired":
      return snapshot ? {...snapshot, status: "expired"} : snapshot;

    default:
      break;
  }

  if (!snapshot) return snapshot;

  switch (message.type) {
    case "player_presence_changed": {
      const side = message.color;
      const player = snapshot[side];
      if (!player) return snapshot;
      return {
        ...snapshot,
        [side]: {...player, connected: message.connected},
        clock: message.clock ?? snapshot.clock,
      };
    }

    case "move_accepted":
    case "move_received": {
      const move = message.move;
      const recent = [...snapshot.recentMoves, move].slice(
        -LIMITS.recentMoveWindow,
      );
      return {
        ...snapshot,
        fen: move.fenAfter,
        previousFen: move.fenBefore,
        turn: turnFromFen(move.fenAfter),
        moveNumber: moveNumberFromFen(move.fenAfter),
        moveSequence: message.moveSequence,
        turnPhase: message.turnPhase,
        lastMove: move,
        recentMoves: recent,
        inCheck: move.isCheck,
        clock: message.clock ?? snapshot.clock,
        result: message.result ?? snapshot.result,
        status: message.result ? "completed" : snapshot.status,
        // A new move supersedes any offer that was on the table.
        pendingDraw: null,
        pendingUndo: null,
      };
    }

    case "move_copied": {
      const side = message.by;
      const player = snapshot[side];
      return {
        ...snapshot,
        turnPhase: message.turnPhase,
        clock: message.clock ?? snapshot.clock,
        ...(player
          ? {[side]: {...player, copiedThroughSequence: message.sequence}}
          : {}),
      };
    }

    case "turn_changed":
      return {
        ...snapshot,
        turn: message.turn,
        turnPhase: message.turnPhase,
        moveSequence: message.moveSequence,
        inCheck: message.inCheck,
        clock: message.clock ?? snapshot.clock,
      };

    case "undo_requested":
      return {...snapshot, pendingUndo: message.request};

    case "draw_offered":
      return {...snapshot, pendingDraw: message.offer};

    case "draw_resolved":
      return {...snapshot, pendingDraw: null};

    case "move_rejected":
    case "error":
      // Surfaced separately by the connection hook; the position is unchanged.
      return snapshot;

    default:
      return snapshot;
  }
}
