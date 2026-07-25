import type {
  GameResult,
  PieceColor,
  RoomSnapshot,
  SerializedMove,
} from "@shared/protocol";

/**
 * The four states from the product brief, plus the two waiting states either
 * side of them, derived from one authoritative snapshot.
 *
 * Every screen decision reads from this. Deriving it in one place is what makes
 * "a child can always identify the next action" checkable rather than hopeful.
 */
export type PlayView =
  | {kind: "waiting_for_opponent"}
  /** State A — your move, board is live. */
  | {kind: "your_turn"}
  /** State B — sent, waiting for them to copy it. */
  | {kind: "move_sent"; move: SerializedMove}
  /** State C — they moved; copy it onto the real board. */
  | {kind: "copy_move"; move: SerializedMove}
  /** They have the move and have not sent it yet. */
  | {kind: "opponent_turn"}
  | {kind: "game_over"; result: GameResult};

export function deriveView(
  snapshot: RoomSnapshot,
  myColor: PieceColor,
): PlayView {
  if (snapshot.status === "waiting_for_opponent") {
    return {kind: "waiting_for_opponent"};
  }

  const lastMove = snapshot.lastMove;
  const awaitingCopy =
    snapshot.turnPhase === "move_submitted" ||
    snapshot.turnPhase === "waiting_for_copy_confirmation";

  // Checked before the game-over branch on purpose: the player who was just
  // checkmated still has to put the mating piece on their own board, and they
  // cannot do that from a result screen.
  if (lastMove && awaitingCopy && lastMove.color !== myColor) {
    return {kind: "copy_move", move: lastMove};
  }

  if (snapshot.status === "completed" && snapshot.result) {
    return {kind: "game_over", result: snapshot.result};
  }

  if (lastMove && awaitingCopy && lastMove.color === myColor) {
    return {kind: "move_sent", move: lastMove};
  }

  return snapshot.turn === myColor
    ? {kind: "your_turn"}
    : {kind: "opponent_turn"};
}

export function opponentColorOf(color: PieceColor): PieceColor {
  return color === "white" ? "black" : "white";
}

export function playerName(
  snapshot: RoomSnapshot,
  color: PieceColor,
  fallback: string,
): string {
  return snapshot[color]?.displayName ?? fallback;
}

/** Result sentence for the game-over panel: "Sam wins." or "It is a draw." */
export function resultSentence(
  result: GameResult,
  snapshot: RoomSnapshot,
): string {
  if (!result.winner) return "It is a draw.";
  return `${playerName(snapshot, result.winner, "Your opponent")} wins.`;
}

const REASON_TEXT: Record<GameResult["reason"], string> = {
  checkmate: "Checkmate",
  resignation: "One player resigned",
  draw_agreement: "Both players agreed to a draw",
  stalemate: "Stalemate — no legal moves left",
  threefold_repetition: "The same position happened three times",
  fifty_move_rule: "Fifty moves with no capture and no pawn move",
  insufficient_material: "Not enough pieces left to checkmate",
  clock_expired: "Time ran out",
  opponent_left: "The other player left",
};

export function resultReasonText(result: GameResult): string {
  return REASON_TEXT[result.reason];
}
