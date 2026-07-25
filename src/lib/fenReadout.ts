import {formatSquare, pieceName} from "@shared/moveLanguage";
import type {PieceSymbol} from "@shared/protocol";

/**
 * Turns a FEN into something a person can read out while setting up wood.
 *
 * A FEN string is unreadable to almost everyone, and the one moment a player
 * needs to reconstruct a position by hand is the one moment they cannot be
 * asked to parse it. Output looks like:
 *
 *   "King on E1, queen on D1, rooks on A1 and H1, pawns on A2, B2, C2."
 */
const ORDER: PieceSymbol[] = ["k", "q", "r", "b", "n", "p"];

const PLURALS: Record<PieceSymbol, string> = {
  k: "kings",
  q: "queens",
  r: "rooks",
  b: "bishops",
  n: "knights",
  p: "pawns",
};

export function piecesFromFen(fen: string): {white: string; black: string} {
  const board = fen.split(" ")[0] ?? "";
  const white = new Map<PieceSymbol, string[]>();
  const black = new Map<PieceSymbol, string[]>();

  board.split("/").forEach((row, rowIndex) => {
    const rank = 8 - rowIndex;
    let file = 0;

    for (const character of row) {
      if (character >= "1" && character <= "8") {
        file += Number(character);
        continue;
      }

      const square = `${String.fromCharCode(97 + file)}${rank}`;
      const isWhite = character === character.toUpperCase();
      const type = character.toLowerCase() as PieceSymbol;
      const target = isWhite ? white : black;
      target.set(type, [...(target.get(type) ?? []), square]);
      file += 1;
    }
  });

  return {white: describeSide(white), black: describeSide(black)};
}

function describeSide(pieces: Map<PieceSymbol, string[]>): string {
  const parts: string[] = [];

  for (const type of ORDER) {
    const squares = pieces.get(type);
    if (!squares || squares.length === 0) continue;

    const names = squares.map(formatSquare);
    const label = squares.length === 1 ? pieceName(type) : PLURALS[type];
    parts.push(`${capitalize(label)} on ${joinNaturally(names)}`);
  }

  return parts.length > 0 ? `${parts.join(". ")}.` : "No pieces left.";
}

function joinNaturally(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
