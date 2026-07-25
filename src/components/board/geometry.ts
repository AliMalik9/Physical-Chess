import type {PieceColor, PieceSymbol} from "@shared/protocol";

/**
 * Board coordinate maths, kept in one place.
 *
 * Orientation is applied here and only here. Every other part of the board
 * works in real square names ("e4"), so flipping the board can never
 * accidentally flip the *meaning* of a move — the bug where the visual board
 * rotates but input mapping does not.
 */

export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

export interface BoardCell {
  /** Column from the left of the screen, 0-7. */
  col: number;
  /** Row from the top of the screen, 0-7. */
  row: number;
}

export function squareToCell(
  square: string,
  orientation: PieceColor,
): BoardCell {
  const fileIndex = square.charCodeAt(0) - 97;
  const rankIndex = Number(square[1]) - 1;

  return orientation === "white"
    ? {col: fileIndex, row: 7 - rankIndex}
    : {col: 7 - fileIndex, row: rankIndex};
}

export function cellToSquare(
  col: number,
  row: number,
  orientation: PieceColor,
): string {
  const fileIndex = orientation === "white" ? col : 7 - col;
  const rankIndex = orientation === "white" ? 7 - row : row;
  return `${FILES[fileIndex]}${rankIndex + 1}`;
}

/** Squares in screen order, top-left first. Used to render the grid. */
export function squaresInOrder(orientation: PieceColor): string[] {
  const squares: string[] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      squares.push(cellToSquare(col, row, orientation));
    }
  }
  return squares;
}

/**
 * True when the square is a light one. Depends only on the square name, never
 * on orientation — a1 is dark from either side of the board.
 */
export function isLightSquare(square: string): boolean {
  const fileIndex = square.charCodeAt(0) - 97;
  const rankIndex = Number(square[1]) - 1;
  return (fileIndex + rankIndex) % 2 === 1;
}

export interface PlacedPiece {
  square: string;
  color: PieceColor;
  type: PieceSymbol;
}

/**
 * Reads the piece placement out of a FEN.
 *
 * Only the first field is parsed. Everything else about the position — whose
 * turn it is, castling rights, legality — comes from chess.js on the server,
 * never from this function.
 */
export function piecesFromFen(fen: string): PlacedPiece[] {
  const placement = fen.split(" ")[0] ?? "";
  const pieces: PlacedPiece[] = [];

  placement.split("/").forEach((row, rowIndex) => {
    const rank = 8 - rowIndex;
    let fileIndex = 0;

    for (const character of row) {
      if (character >= "1" && character <= "8") {
        fileIndex += Number(character);
        continue;
      }

      pieces.push({
        square: `${FILES[fileIndex]}${rank}`,
        color: character === character.toUpperCase() ? "white" : "black",
        type: character.toLowerCase() as PieceSymbol,
      });
      fileIndex += 1;
    }
  });

  return pieces;
}

/** Locates a king, so check can be shown on the right square. */
export function findKing(
  pieces: PlacedPiece[],
  color: PieceColor,
): string | null {
  return pieces.find((p) => p.type === "k" && p.color === color)?.square ?? null;
}
