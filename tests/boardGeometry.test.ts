import {Chess} from "chess.js";
import {describe, expect, it} from "vitest";

import {
  cellToSquare,
  findKing,
  isLightSquare,
  piecesFromFen,
  squareToCell,
  squaresInOrder,
} from "@/components/board/geometry";

/**
 * Orientation maths.
 *
 * This is the one place the board knows about flipping. If it is wrong the
 * board looks fine but taps land on the wrong squares — so every mapping is
 * asserted from both sides.
 */
describe("square to screen position", () => {
  it("puts a1 bottom-left for White", () => {
    expect(squareToCell("a1", "white")).toEqual({col: 0, row: 7});
    expect(squareToCell("h8", "white")).toEqual({col: 7, row: 0});
    expect(squareToCell("e4", "white")).toEqual({col: 4, row: 4});
  });

  it("puts a1 top-right for Black", () => {
    expect(squareToCell("a1", "black")).toEqual({col: 7, row: 0});
    expect(squareToCell("h8", "black")).toEqual({col: 0, row: 7});
    expect(squareToCell("e4", "black")).toEqual({col: 3, row: 3});
  });

  it("round-trips every square in both orientations", () => {
    for (const orientation of ["white", "black"] as const) {
      for (const square of squaresInOrder("white")) {
        const {col, row} = squareToCell(square, orientation);
        expect(cellToSquare(col, row, orientation)).toBe(square);
      }
    }
  });

  it("lists 64 squares, top-left first", () => {
    const white = squaresInOrder("white");
    expect(white).toHaveLength(64);
    expect(white[0]).toBe("a8");
    expect(white[63]).toBe("h1");

    const black = squaresInOrder("black");
    expect(black[0]).toBe("h1");
    expect(black[63]).toBe("a8");
  });

  it("shows the two orientations as exact reverses of each other", () => {
    expect(squaresInOrder("black")).toEqual([...squaresInOrder("white")].reverse());
  });
});

describe("square colour", () => {
  it("knows a1 is dark and h1 is light", () => {
    expect(isLightSquare("a1")).toBe(false);
    expect(isLightSquare("h1")).toBe(true);
    expect(isLightSquare("a8")).toBe(true);
    expect(isLightSquare("h8")).toBe(false);
  });

  it("does not depend on orientation", () => {
    // Colour is a property of the square, not of who is looking at it.
    for (const square of squaresInOrder("white")) {
      const fileIndex = square.charCodeAt(0) - 97;
      const rankIndex = Number(square[1]) - 1;
      expect(isLightSquare(square)).toBe((fileIndex + rankIndex) % 2 === 1);
    }
  });
});

describe("reading a position out of a FEN", () => {
  it("finds all 32 pieces in the starting position", () => {
    const pieces = piecesFromFen(new Chess().fen());
    expect(pieces).toHaveLength(32);

    expect(pieces).toContainEqual({square: "e1", color: "white", type: "k"});
    expect(pieces).toContainEqual({square: "d8", color: "black", type: "q"});
    expect(pieces.filter((p) => p.type === "p")).toHaveLength(16);
  });

  it("agrees with chess.js on an arbitrary position", () => {
    const chess = new Chess();
    for (const san of ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Bxc6"]) {
      chess.move(san);
    }

    const parsed = piecesFromFen(chess.fen());
    for (const piece of parsed) {
      const actual = chess.get(piece.square as never);
      expect(actual, `expected a piece on ${piece.square}`).toBeTruthy();
      expect(actual!.type).toBe(piece.type);
      expect(actual!.color === "w" ? "white" : "black").toBe(piece.color);
    }
    expect(parsed).toHaveLength(chess.board().flat().filter(Boolean).length);
  });

  it("handles an almost-empty board", () => {
    const pieces = piecesFromFen("k7/8/8/8/8/8/8/7K w - - 0 1");
    expect(pieces).toEqual([
      {square: "a8", color: "black", type: "k"},
      {square: "h1", color: "white", type: "k"},
    ]);
  });

  it("locates each king so check can be shown on the right square", () => {
    const pieces = piecesFromFen(new Chess().fen());
    expect(findKing(pieces, "white")).toBe("e1");
    expect(findKing(pieces, "black")).toBe("e8");
  });

  it("returns null when a king is missing", () => {
    expect(findKing(piecesFromFen("8/8/8/8/8/8/8/7K w - - 0 1"), "black")).toBeNull();
  });
});
