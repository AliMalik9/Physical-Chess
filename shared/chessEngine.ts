/**
 * The single place chess.js is adapted to BoardLink's own types.
 *
 * Both the Durable Object and the browser import this. The server's copy is
 * authoritative — the client uses it only to preview legal moves and to render
 * a confirmation panel before anything is sent.
 */

import {Chess, type Move, type Square} from "chess.js";
import type {
  GameEndReason,
  GameResult,
  PieceColor,
  PieceSymbol,
  Scoreline,
  SerializedMove,
} from "./protocol";

export function toColor(color: "w" | "b"): PieceColor {
  return color === "w" ? "white" : "black";
}

export function toShortColor(color: PieceColor): "w" | "b" {
  return color === "white" ? "w" : "b";
}

/**
 * Flattens a chess.js Move into the wire shape.
 *
 * `moveNumber` must be read *before* the move is applied: chess.js increments
 * the full-move counter after Black moves, so reading it afterwards would
 * mislabel every Black move.
 */
export function serializeMove(options: {
  move: Move;
  sequence: number;
  moveNumber: number;
  /** Position after the move, used for check and mate detection. */
  after: Chess;
  playedAt: number;
}): SerializedMove {
  const {move, sequence, moveNumber, after, playedAt} = options;

  const castle = move.isKingsideCastle()
    ? ("king" as const)
    : move.isQueensideCastle()
      ? ("queen" as const)
      : null;

  const serialized: SerializedMove = {
    sequence,
    color: toColor(move.color),
    from: move.from,
    to: move.to,
    piece: move.piece as PieceSymbol,
    san: move.san,
    lan: move.lan,
    moveNumber,
    isCapture: move.isCapture(),
    isEnPassant: move.isEnPassant(),
    castle,
    isCheck: after.inCheck(),
    isCheckmate: after.isCheckmate(),
    fenBefore: move.before,
    fenAfter: move.after,
    playedAt,
  };

  // Only set the optional keys when they apply, so the JSON stays small.
  if (move.captured) serialized.captured = move.captured as PieceSymbol;
  if (move.promotion) serialized.promotion = move.promotion as PieceSymbol;

  return serialized;
}

/**
 * Detects a natural game ending in the given position. Returns null while the
 * game is still playable. Resignation and draw agreement are decisions, not
 * positions, so they are built by the caller instead.
 */
export function detectGameEnd(chess: Chess, now: number): GameResult | null {
  if (chess.isCheckmate()) {
    // chess.js reports the side *to move*, which is the side that was mated.
    const loser = toColor(chess.turn());
    const winner: PieceColor = loser === "white" ? "black" : "white";
    return result("checkmate", winner, now);
  }
  if (chess.isStalemate()) return result("stalemate", null, now);
  if (chess.isInsufficientMaterial()) {
    return result("insufficient_material", null, now);
  }
  if (chess.isThreefoldRepetition()) {
    return result("threefold_repetition", null, now);
  }
  if (chess.isDrawByFiftyMoves()) return result("fifty_move_rule", null, now);
  return null;
}

export function result(
  reason: GameEndReason,
  winner: PieceColor | null,
  endedAt: number,
): GameResult {
  return {reason, winner, scoreline: scorelineFor(winner), endedAt};
}

export function scorelineFor(winner: PieceColor | null): Scoreline {
  if (winner === "white") return "1-0";
  if (winner === "black") return "0-1";
  return "1/2-1/2";
}

/** Legal destination squares for a piece, used to light up the input board. */
export function legalTargets(fen: string, from: string): string[] {
  const chess = new Chess(fen);
  const moves = chess.moves({square: from as Square, verbose: true});
  return moves.map((move) => move.to);
}

/**
 * True when moving from -> to would land a pawn on its last rank, meaning the
 * player must be asked which piece they want before the move can be sent.
 */
export function isPromotionMove(fen: string, from: string, to: string): boolean {
  const chess = new Chess(fen);
  const piece = chess.get(from as Square);
  if (!piece || piece.type !== "p") return false;
  const lastRank = piece.color === "w" ? "8" : "1";
  if (!to.endsWith(lastRank)) return false;

  // Only a genuinely legal promotion counts; a pawn pinned to its king cannot
  // promote and must not trigger the chooser.
  return chess
    .moves({square: from as Square, verbose: true})
    .some((move) => move.to === to && Boolean(move.promotion));
}

/**
 * Applies a move to a FEN and returns the resulting state, or null when the
 * move is not legal. Never throws: illegal input is an expected condition here,
 * not an exceptional one.
 */
export function tryMove(options: {
  fen: string;
  from: string;
  to: string;
  promotion?: PieceSymbol;
  sequence: number;
  playedAt: number;
}): {move: SerializedMove; chess: Chess} | null {
  const chess = new Chess(options.fen);
  const moveNumber = chess.moveNumber();

  let move: Move;
  try {
    move = chess.move({
      from: options.from,
      to: options.to,
      ...(options.promotion ? {promotion: options.promotion} : {}),
    });
  } catch {
    return null;
  }

  return {
    move: serializeMove({
      move,
      sequence: options.sequence,
      moveNumber,
      after: chess,
      playedAt: options.playedAt,
    }),
    chess,
  };
}

/**
 * Rebuilds a Chess instance from a move list. Used when undo rolls the game
 * back: replaying is the only way to keep PGN, repetition counts and the
 * fifty-move counter consistent, since a FEN alone loses that history.
 */
export function replay(moves: SerializedMove[]): Chess {
  const chess = new Chess();
  for (const move of moves) {
    chess.move({
      from: move.from,
      to: move.to,
      ...(move.promotion ? {promotion: move.promotion} : {}),
    });
  }
  return chess;
}

/**
 * PGN with the seven-tag roster filled in. Names are the display names players
 * chose; there is no account behind them.
 */
export function buildPgn(options: {
  chess: Chess;
  whiteName: string;
  blackName: string;
  publicCode: string;
  startedAt: number;
  result: GameResult | null;
}): string {
  const {chess, whiteName, blackName, publicCode, startedAt} = options;
  const date = new Date(startedAt);
  const pad = (value: number) => String(value).padStart(2, "0");

  chess.setHeader("Event", "BoardLink game");
  chess.setHeader("Site", "BoardLink");
  chess.setHeader(
    "Date",
    `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())}`,
  );
  chess.setHeader("Round", "-");
  chess.setHeader("White", whiteName);
  chess.setHeader("Black", blackName);
  chess.setHeader("Result", options.result?.scoreline ?? "*");
  chess.setHeader("BoardLinkCode", publicCode);
  if (options.result) {
    chess.setHeader("Termination", terminationText(options.result.reason));
  }

  return chess.pgn();
}

function terminationText(reason: GameEndReason): string {
  switch (reason) {
    case "checkmate":
      return "Checkmate";
    case "resignation":
      return "Resignation";
    case "draw_agreement":
      return "Draw by agreement";
    case "stalemate":
      return "Stalemate";
    case "threefold_repetition":
      return "Threefold repetition";
    case "fifty_move_rule":
      return "Fifty-move rule";
    case "insufficient_material":
      return "Insufficient material";
    case "clock_expired":
      return "Time forfeit";
    case "opponent_left":
      return "Abandoned";
  }
}
