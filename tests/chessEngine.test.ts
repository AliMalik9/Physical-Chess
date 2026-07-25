import {Chess} from "chess.js";
import {describe, expect, it} from "vitest";

import {
  buildPgn,
  detectGameEnd,
  isPromotionMove,
  legalTargets,
  replay,
  result,
  scorelineFor,
  tryMove,
} from "@shared/chessEngine";
import type {SerializedMove} from "@shared/protocol";

function playAll(sans: string[]): Chess {
  const chess = new Chess();
  for (const san of sans) chess.move(san);
  return chess;
}

describe("legal target lookup", () => {
  it("lists both pawn pushes from the start", () => {
    expect(legalTargets(new Chess().fen(), "e2").sort()).toEqual(["e3", "e4"]);
  });

  it("returns nothing for an empty square", () => {
    expect(legalTargets(new Chess().fen(), "e5")).toEqual([]);
  });

  it("returns nothing for a piece with no legal move", () => {
    expect(legalTargets(new Chess().fen(), "a1")).toEqual([]);
  });
});

describe("promotion detection", () => {
  it("spots a pawn about to reach the last rank", () => {
    const fen = "k7/4P3/8/8/8/8/8/7K w - - 0 1";
    expect(isPromotionMove(fen, "e7", "e8")).toBe(true);
  });

  it("is false for an ordinary pawn move", () => {
    expect(isPromotionMove(new Chess().fen(), "e2", "e4")).toBe(false);
  });

  it("is false for a pawn that cannot legally promote", () => {
    // The pawn is pinned to its king, so the promotion is not available.
    const fen = "k7/4P3/8/8/8/8/8/4K2r w - - 0 1";
    expect(isPromotionMove(fen, "e7", "e8")).toBe(false);
  });
});

describe("applying a move", () => {
  it("returns null for an illegal move instead of throwing", () => {
    expect(
      tryMove({
        fen: new Chess().fen(),
        from: "e2",
        to: "e5",
        sequence: 1,
        playedAt: 0,
      }),
    ).toBeNull();
  });

  it("returns null for a move by the wrong colour", () => {
    expect(
      tryMove({
        fen: new Chess().fen(),
        from: "e7",
        to: "e5",
        sequence: 1,
        playedAt: 0,
      }),
    ).toBeNull();
  });

  it("labels black's move with the move number it was played on", () => {
    const chess = playAll(["e4"]);
    const move = tryMove({
      fen: chess.fen(),
      from: "e7",
      to: "e5",
      sequence: 2,
      playedAt: 0,
    })!.move;

    // chess.js increments the counter after Black moves; reading it afterwards
    // would label this move 2.
    expect(move.moveNumber).toBe(1);
    expect(move.color).toBe("black");
  });
});

describe("detecting how a game ended", () => {
  it("finds checkmate and names the winner", () => {
    const chess = playAll(["f3", "e5", "g4", "Qh4#"]);
    const outcome = detectGameEnd(chess, 0);

    expect(outcome?.reason).toBe("checkmate");
    expect(outcome?.winner).toBe("black");
    expect(outcome?.scoreline).toBe("0-1");
  });

  it("finds stalemate as a draw", () => {
    // Black to move, no legal move, not in check.
    const chess = new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
    const outcome = detectGameEnd(chess, 0);

    expect(outcome?.reason).toBe("stalemate");
    expect(outcome?.winner).toBeNull();
    expect(outcome?.scoreline).toBe("1/2-1/2");
  });

  it("finds insufficient material", () => {
    const chess = new Chess("7k/8/8/8/8/8/8/6BK w - - 0 1");
    expect(detectGameEnd(chess, 0)?.reason).toBe("insufficient_material");
  });

  it("finds the fifty-move rule", () => {
    // Halfmove clock already at 100.
    const chess = new Chess("7k/8/8/8/8/8/R7/6RK w - - 100 60");
    expect(detectGameEnd(chess, 0)?.reason).toBe("fifty_move_rule");
  });

  it("finds threefold repetition", () => {
    const chess = new Chess();
    // Shuffle the knights back and forth until the position repeats a third time.
    for (let i = 0; i < 2; i += 1) {
      chess.move("Nf3");
      chess.move("Nf6");
      chess.move("Ng1");
      chess.move("Ng8");
    }

    expect(detectGameEnd(chess, 0)?.reason).toBe("threefold_repetition");
  });

  it("returns null while the game is still playable", () => {
    expect(detectGameEnd(playAll(["e4", "e5"]), 0)).toBeNull();
  });
});

describe("scorelines", () => {
  it("maps a winner to a PGN result", () => {
    expect(scorelineFor("white")).toBe("1-0");
    expect(scorelineFor("black")).toBe("0-1");
    expect(scorelineFor(null)).toBe("1/2-1/2");
  });

  it("builds a resignation result", () => {
    const outcome = result("resignation", "white", 123);
    expect(outcome).toEqual({
      reason: "resignation",
      winner: "white",
      scoreline: "1-0",
      endedAt: 123,
    });
  });
});

describe("replaying a move list", () => {
  function serialize(sans: string[]): SerializedMove[] {
    const chess = new Chess();
    const moves: SerializedMove[] = [];

    sans.forEach((san, index) => {
      const before = chess.fen();
      const played = chess.move(san);
      const attempt = tryMove({
        fen: before,
        from: played.from,
        to: played.to,
        ...(played.promotion ? {promotion: played.promotion} : {}),
        sequence: index + 1,
        playedAt: 0,
      });
      moves.push(attempt!.move);
    });

    return moves;
  }

  it("reproduces the position exactly", () => {
    const sans = ["e4", "e5", "Nf3", "Nc6", "Bb5"];
    expect(replay(serialize(sans)).fen()).toBe(playAll(sans).fen());
  });

  it("rebuilds repetition history, which a bare FEN cannot", () => {
    const moves = serialize(["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"]);
    const rebuilt = replay(moves);

    expect(rebuilt.isThreefoldRepetition()).toBe(true);
  });

  it("gives an empty board back for an empty move list", () => {
    expect(replay([]).fen()).toBe(new Chess().fen());
  });
});

describe("PGN export", () => {
  it("fills in the seven-tag roster and the result", () => {
    const chess = playAll(["e4", "e5", "Nf3"]);
    const pgn = buildPgn({
      chess,
      whiteName: "Alex",
      blackName: "Sam",
      publicCode: "BNXWZK43",
      startedAt: Date.UTC(2026, 6, 25),
      result: result("resignation", "white", 0),
    });

    expect(pgn).toContain('[White "Alex"]');
    expect(pgn).toContain('[Black "Sam"]');
    expect(pgn).toContain('[Result "1-0"]');
    expect(pgn).toContain('[Date "2026.07.25"]');
    expect(pgn).toContain('[Termination "Resignation"]');
    expect(pgn).toContain('[BoardLinkCode "BNXWZK43"]');
    expect(pgn).toContain("1. e4 e5 2. Nf3");
  });

  it("marks an unfinished game with a star", () => {
    const pgn = buildPgn({
      chess: playAll(["e4"]),
      whiteName: "Alex",
      blackName: "Sam",
      publicCode: "BNXWZK43",
      startedAt: 0,
      result: null,
    });

    expect(pgn).toContain('[Result "*"]');
  });
});
