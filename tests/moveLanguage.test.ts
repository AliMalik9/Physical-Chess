import {Chess} from "chess.js";
import {describe, expect, it} from "vitest";

import {tryMove} from "@shared/chessEngine";
import {
  announceMove,
  describeMove,
  describeSquare,
  enPassantCapturedSquare,
  friendlyPieceName,
  moveSummaryLine,
} from "@shared/moveLanguage";
import type {SerializedMove} from "@shared/protocol";

/** Plays a list of SAN moves and serialises the final one. */
function moveFrom(sanHistory: string[], from: string, to: string, promotion?: "q" | "r" | "b" | "n"): SerializedMove {
  const chess = new Chess();
  for (const san of sanHistory) chess.move(san);

  const attempt = tryMove({
    fen: chess.fen(),
    from,
    to,
    ...(promotion ? {promotion} : {}),
    sequence: sanHistory.length + 1,
    playedAt: 0,
  });

  if (!attempt) throw new Error(`Expected ${from}-${to} to be legal`);
  return attempt.move;
}

describe("ordinary moves", () => {
  it("describes a pawn push in plain words", () => {
    const move = moveFrom([], "e2", "e4");
    const instruction = describeMove(move, "copier");

    expect(instruction.headline).toBe("Move the white pawn from E2 to E4.");
    expect(instruction.requiresMultipleActions).toBe(false);
    expect(instruction.steps).toHaveLength(1);
  });

  it("describes a black knight move", () => {
    const move = moveFrom(["e4", "e5", "Nf3"], "g8", "f6");

    expect(describeMove(move, "copier").headline).toBe(
      "Move the black knight from G8 to F6.",
    );
  });

  it("says 'your' to the player who made the move and 'the' to the copier", () => {
    const move = moveFrom([], "e2", "e4");

    expect(describeMove(move, "actor").headline).toBe(
      "Move your white pawn from E2 to E4.",
    );
    expect(describeMove(move, "copier").headline).toBe(
      "Move the white pawn from E2 to E4.",
    );
  });

  it("marks black moves with an ellipsis in notation", () => {
    const move = moveFrom(["e4"], "e7", "e5");
    const instruction = describeMove(move);

    expect(instruction.notation).toBe("…e5");
    expect(instruction.numberedNotation).toBe("1… e5");
  });

  it("summarises a move for the confirmation panel", () => {
    const move = moveFrom([], "g1", "f3");
    expect(moveSummaryLine(move)).toBe("White knight: G1 → F3");
  });
});

describe("captures", () => {
  it("names the captured piece and splits the physical actions", () => {
    // 1. e4 d5 — white pawn on e4 can take the black pawn on d5.
    const move = moveFrom(["e4", "d5"], "e4", "d5");
    const instruction = describeMove(move, "actor");

    expect(instruction.headline).toBe(
      "Capture the black pawn on D5 with your white pawn from E4.",
    );
    expect(instruction.requiresMultipleActions).toBe(true);
    // Lifting the captured piece comes first: it is the order hands work in.
    expect(instruction.steps[0]!.kind).toBe("remove");
    expect(instruction.steps[0]!.text).toBe("Take the black pawn off D5.");
    expect(instruction.steps[1]!.text).toBe(
      "Move the white pawn from E4 to D5.",
    );
  });
});

describe("castling", () => {
  it("spells out both the king and the rook", () => {
    const setup = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"];
    const move = moveFrom(setup, "e1", "g1");
    const instruction = describeMove(move, "copier");

    expect(move.castle).toBe("king");
    expect(instruction.headline).toBe(
      "Move the white king from E1 to G1, then move the rook from H1 to F1.",
    );
    expect(instruction.steps).toHaveLength(2);
    expect(instruction.steps[1]!.text).toBe(
      "Move the white rook from H1 to F1.",
    );
  });

  it("handles queenside castling with the other rook squares", () => {
    const setup = ["d4", "d5", "Nc3", "Nc6", "Bf4", "Bf5", "Qd2", "Qd7"];
    const move = moveFrom(setup, "e1", "c1");
    const instruction = describeMove(move, "copier");

    expect(move.castle).toBe("queen");
    expect(instruction.headline).toBe(
      "Move the white king from E1 to C1, then move the rook from A1 to D1.",
    );
  });
});

describe("en passant", () => {
  it("points at the pawn beside the destination, not on it", () => {
    // 1. e4 a6 2. e5 d5 — white can take en passant on d6, removing the pawn
    // that is sitting on d5.
    const move = moveFrom(["e4", "a6", "e5", "d5"], "e5", "d6");
    const instruction = describeMove(move, "copier");

    expect(move.isEnPassant).toBe(true);
    expect(enPassantCapturedSquare(move)).toBe("d5");
    expect(instruction.steps).toHaveLength(2);
    expect(instruction.steps[0]!.text).toBe(
      "Move the white pawn from E5 to D6.",
    );
    expect(instruction.steps[1]!.text).toContain("Take the black pawn off D5");
    // The whole point: say it is *not* on the destination square.
    expect(instruction.steps[1]!.text).toContain("beside D6, not on it");
  });
});

describe("promotion", () => {
  it("adds a replace step and never assumes a queen", () => {
    const chess = new Chess("k7/4P3/8/8/8/8/8/7K w - - 0 1");
    const attempt = tryMove({
      fen: chess.fen(),
      from: "e7",
      to: "e8",
      promotion: "q",
      sequence: 1,
      playedAt: 0,
    });
    const instruction = describeMove(attempt!.move, "copier");

    expect(instruction.headline).toBe(
      "Move the white pawn from E7 to E8, then replace it with a queen.",
    );
    expect(instruction.steps).toHaveLength(2);
    expect(instruction.steps[1]!.kind).toBe("replace");
  });

  it("describes an under-promotion as the piece actually chosen", () => {
    const attempt = tryMove({
      fen: "k7/4P3/8/8/8/8/8/7K w - - 0 1",
      from: "e7",
      to: "e8",
      promotion: "n",
      sequence: 1,
      playedAt: 0,
    });

    expect(describeMove(attempt!.move, "copier").headline).toContain(
      "replace it with a knight",
    );
  });

  it("combines a capture and a promotion into three physical steps", () => {
    const attempt = tryMove({
      fen: "k4r2/4P3/8/8/8/8/8/7K w - - 0 1",
      from: "e7",
      to: "f8",
      promotion: "q",
      sequence: 1,
      playedAt: 0,
    });
    const instruction = describeMove(attempt!.move, "copier");

    expect(instruction.steps).toHaveLength(3);
    expect(instruction.steps[0]!.kind).toBe("remove");
    expect(instruction.steps[2]!.kind).toBe("replace");
  });
});

describe("check and mate", () => {
  it("states check calmly, naming the king in check", () => {
    // Scholar's mate setup, one move before mate.
    const move = moveFrom(["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6"], "h5", "f7");
    const instruction = describeMove(move, "copier");

    expect(move.isCheckmate).toBe(true);
    expect(instruction.isCheckmate).toBe(true);
    // On mate the result headline carries the message instead.
    expect(instruction.checkNote).toBeNull();
  });

  it("adds a check note when the game continues", () => {
    const move = moveFrom(["e4", "e5", "Bc4", "d6"], "c4", "f7");
    const instruction = describeMove(move, "copier");

    expect(move.isCheck).toBe(true);
    expect(instruction.checkNote).toBe("Black king is in check.");
  });
});

describe("wording for children", () => {
  it("adds a hint for the pieces children misname", () => {
    expect(friendlyPieceName("n")).toBe("Knight — the horse piece");
    expect(friendlyPieceName("r")).toBe("Rook — the castle piece");
  });

  it("leaves the obvious pieces alone", () => {
    expect(friendlyPieceName("q")).toBe("Queen");
    expect(friendlyPieceName("p")).toBe("Pawn");
  });
});

describe("screen reader output", () => {
  it("announces the square first, then what is on it", () => {
    expect(
      describeSquare({square: "e4", piece: {color: "white", type: "p"}}),
    ).toBe("E4, white pawn");

    expect(describeSquare({square: "e5", piece: null})).toBe("E5, empty");
  });

  it("adds selection and target state", () => {
    expect(
      describeSquare({
        square: "d5",
        piece: {color: "black", type: "n"},
        isLegalTarget: true,
      }),
    ).toBe("D5, black knight, can be captured");

    expect(
      describeSquare({square: "d5", piece: null, isLegalTarget: true}),
    ).toBe("D5, empty, can move here");
  });

  it("announces an arriving move with the opponent's name", () => {
    const move = moveFrom(["e4"], "e7", "e5");

    expect(announceMove(move, "Sam")).toBe(
      "Sam moved. Move the black pawn from E7 to E5.",
    );
  });
});
