/**
 * Turns a move into words a five-year-old can act on.
 *
 * Two things matter here and nothing else does:
 *
 * 1. A move is one *logical* action but sometimes several *physical* ones.
 *    Castling touches two pieces. A capture means lifting a piece off before
 *    another lands. En passant removes a pawn that is not on the target square.
 *    Promotion swaps a pawn for a new piece. The receiving player is standing
 *    over a real board, so every physical action gets its own step.
 *
 * 2. The wording changes depending on who is reading. The player who made the
 *    move sees "your white pawn"; the player copying it sees "the white pawn",
 *    because on their board those are the opponent's pieces.
 *
 * Notation is always available but never the only thing on screen.
 */

import type {PieceColor, PieceSymbol, SerializedMove} from "./protocol";

/** Who is reading the instruction. */
export type Perspective =
  /** The player who made the move, confirming it before it is sent. */
  | "actor"
  /** The player copying the move onto their own physical board. */
  | "copier";

export type PhysicalStepKind = "move" | "remove" | "replace";

export interface PhysicalStep {
  id: string;
  kind: PhysicalStepKind;
  text: string;
}

export interface MoveInstruction {
  /** One sentence covering the whole move. Always safe to show alone. */
  headline: string;
  /** Ordered physical actions. Length > 1 means the board needs several touches. */
  steps: PhysicalStep[];
  /** True when the move cannot be done by lifting exactly one piece once. */
  requiresMultipleActions: boolean;
  /** Standard algebraic notation, shown only as secondary text. */
  notation: string;
  /** Notation with the move number, e.g. "12. Nf3" or "12… Nf6". */
  numberedNotation: string;
  colorName: string;
  pieceName: string;
  /** Piece name plus a hint for children, where one helps. */
  friendlyPieceName: string;
  from: string;
  to: string;
  /** "White king is in check." — null when there is no check, or on mate. */
  checkNote: string | null;
  /** Set when the move ends the game by mate. */
  isCheckmate: boolean;
}

const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

/**
 * Extra wording for the two pieces children most often fail to identify by
 * name. The others read fine on their own; adding a hint to every piece would
 * make the instruction long without making it clearer.
 */
const PIECE_HINTS: Partial<Record<PieceSymbol, string>> = {
  n: "the horse piece",
  r: "the castle piece",
};

export function pieceName(piece: PieceSymbol): string {
  return PIECE_NAMES[piece];
}

/** "Knight — the horse piece", or just "Bishop" when no hint helps. */
export function friendlyPieceName(piece: PieceSymbol): string {
  const base = capitalize(PIECE_NAMES[piece]);
  const hint = PIECE_HINTS[piece];
  return hint ? `${base} — ${hint}` : base;
}

export function colorName(color: PieceColor): string {
  return color === "white" ? "White" : "Black";
}

export function otherColor(color: PieceColor): PieceColor {
  return color === "white" ? "black" : "white";
}

/** Squares are shown uppercase everywhere a person reads them. */
export function formatSquare(square: string): string {
  return square.toUpperCase();
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** "the white pawn" / "your white pawn", depending on who is reading. */
function piecePhrase(
  move: SerializedMove,
  piece: PieceSymbol,
  color: PieceColor,
  perspective: Perspective,
): string {
  const owned = perspective === "actor" && color === move.color;
  const article = owned ? "your" : "the";
  return `${article} ${color} ${PIECE_NAMES[piece]}`;
}

/**
 * The square holding the pawn captured en passant: same file as the
 * destination, same rank the capturing pawn started on.
 */
export function enPassantCapturedSquare(move: SerializedMove): string {
  return `${move.to[0]}${move.from[1]}`;
}

/** Where the rook starts and ends for a castle, in physical terms. */
export function castlingRookSquares(move: SerializedMove): {
  from: string;
  to: string;
} {
  const rank = move.color === "white" ? "1" : "8";
  return move.castle === "king"
    ? {from: `h${rank}`, to: `f${rank}`}
    : {from: `a${rank}`, to: `d${rank}`};
}

/**
 * Builds the full instruction. Pure and deterministic, so the sender's
 * confirmation panel and the receiver's instruction card are always describing
 * the same move in the same words.
 */
export function describeMove(
  move: SerializedMove,
  perspective: Perspective = "copier",
): MoveInstruction {
  const from = formatSquare(move.from);
  const to = formatSquare(move.to);
  const mover = piecePhrase(move, move.piece, move.color, perspective);
  const steps: PhysicalStep[] = [];
  let headline: string;

  if (move.castle) {
    const rook = castlingRookSquares(move);
    const rookFrom = formatSquare(rook.from);
    const rookTo = formatSquare(rook.to);

    headline =
      `Move ${mover} from ${from} to ${to}, ` +
      `then move the rook from ${rookFrom} to ${rookTo}.`;

    steps.push(
      step("king", "move", `Move the ${move.color} king from ${from} to ${to}.`),
      step("rook", "move", `Move the ${move.color} rook from ${rookFrom} to ${rookTo}.`),
    );
  } else if (move.isEnPassant) {
    // The captured pawn is beside the destination, not on it. Saying so
    // explicitly is the whole point — otherwise the boards silently diverge.
    const capturedSquare = formatSquare(enPassantCapturedSquare(move));
    const victimColor = otherColor(move.color);

    headline =
      `Move ${mover} from ${from} to ${to}, ` +
      `then take the ${victimColor} pawn off ${capturedSquare}.`;

    steps.push(
      step("move", "move", `Move the ${move.color} pawn from ${from} to ${to}.`),
      step(
        "remove",
        "remove",
        `Take the ${victimColor} pawn off ${capturedSquare}. It is beside ${to}, not on it.`,
      ),
    );
  } else if (move.isCapture && move.captured) {
    const victimColor = otherColor(move.color);
    const victim = `the ${victimColor} ${PIECE_NAMES[move.captured]}`;

    headline = `Capture ${victim} on ${to} with ${mover} from ${from}.`;

    // Lift the captured piece first: it is the order a person's hands follow.
    steps.push(
      step("remove", "remove", `Take ${victim} off ${to}.`),
      step(
        "move",
        "move",
        `Move the ${move.color} ${PIECE_NAMES[move.piece]} from ${from} to ${to}.`,
      ),
    );
  } else {
    headline = `Move ${mover} from ${from} to ${to}.`;
    steps.push(
      step(
        "move",
        "move",
        `Move the ${move.color} ${PIECE_NAMES[move.piece]} from ${from} to ${to}.`,
      ),
    );
  }

  if (move.promotion) {
    const promoted = PIECE_NAMES[move.promotion];
    headline = `${stripPeriod(headline)}, then replace it with a ${promoted}.`;
    steps.push(
      step(
        "promote",
        "replace",
        `Take the ${move.color} pawn off ${to} and put a ${move.color} ${promoted} there.`,
      ),
    );
  }

  const notation = move.color === "black" ? `…${move.san}` : move.san;
  const numberedNotation =
    move.color === "white"
      ? `${move.moveNumber}. ${move.san}`
      : `${move.moveNumber}… ${move.san}`;

  return {
    headline,
    steps,
    requiresMultipleActions: steps.length > 1,
    notation,
    numberedNotation,
    colorName: colorName(move.color),
    pieceName: capitalize(PIECE_NAMES[move.piece]),
    friendlyPieceName: friendlyPieceName(move.piece),
    from,
    to,
    // On mate the UI shows the result headline instead, so the check note would
    // be redundant noise at exactly the moment the player wants a clear answer.
    checkNote:
      move.isCheck && !move.isCheckmate
        ? `${colorName(otherColor(move.color))} king is in check.`
        : null,
    isCheckmate: move.isCheckmate,
  };
}

function step(id: string, kind: PhysicalStepKind, text: string): PhysicalStep {
  return {id, kind, text};
}

function stripPeriod(sentence: string): string {
  return sentence.endsWith(".") ? sentence.slice(0, -1) : sentence;
}

/**
 * Compact form for the confirmation panel's secondary line:
 * "White knight: G1 → F3".
 */
export function moveSummaryLine(move: SerializedMove): string {
  return `${colorName(move.color)} ${PIECE_NAMES[move.piece]}: ${formatSquare(
    move.from,
  )} → ${formatSquare(move.to)}`;
}

/**
 * Screen-reader label for a board square. Announces the square name first so
 * users navigating with a keyboard always know where they are, then what is on
 * it and whether it is a legal destination.
 */
export function describeSquare(options: {
  square: string;
  piece: {color: PieceColor; type: PieceSymbol} | null;
  isSelected?: boolean;
  isLegalTarget?: boolean;
  isLastMove?: boolean;
}): string {
  const parts: string[] = [formatSquare(options.square)];

  parts.push(
    options.piece
      ? `${options.piece.color} ${PIECE_NAMES[options.piece.type]}`
      : "empty",
  );

  if (options.isSelected) parts.push("selected");
  if (options.isLegalTarget) {
    parts.push(options.piece ? "can be captured" : "can move here");
  }
  if (options.isLastMove) parts.push("part of the last move");

  return parts.join(", ");
}

/** Sentence announced through the live region when a move arrives. */
export function announceMove(move: SerializedMove, opponentName: string): string {
  const instruction = describeMove(move, "copier");
  const check = instruction.checkNote ? ` ${instruction.checkNote}` : "";
  const mate = move.isCheckmate ? " Checkmate." : "";
  return `${opponentName} moved. ${instruction.headline}${check}${mate}`;
}
