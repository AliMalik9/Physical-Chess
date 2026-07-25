import {Chess} from "chess.js";
import {describe, expect, it} from "vitest";

import {tryMove} from "@shared/chessEngine";
import type {RoomSnapshot, SerializedMove, TurnPhase} from "@shared/protocol";

import {deriveView, resultReasonText, resultSentence} from "@/lib/gameView";
import {piecesFromFen} from "@/lib/fenReadout";

const START_FEN = new Chess().fen();

const whiteMove: SerializedMove = tryMove({
  fen: START_FEN,
  from: "e2",
  to: "e4",
  sequence: 1,
  playedAt: 0,
})!.move;

function snapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    roomId: "room",
    publicCode: "BNXWZK43",
    status: "active",
    turnPhase: "waiting_for_move",
    fen: START_FEN,
    pgn: "",
    turn: "white",
    moveNumber: 1,
    moveSequence: 0,
    lastMove: null,
    previousFen: null,
    recentMoves: [],
    white: {
      displayName: "Alex",
      color: "white",
      connected: true,
      lastSeenAt: 0,
      copiedThroughSequence: 0,
    },
    black: {
      displayName: "Sam",
      color: "black",
      connected: true,
      lastSeenAt: 0,
      copiedThroughSequence: 0,
    },
    pendingUndo: null,
    pendingDraw: null,
    result: null,
    clock: null,
    inCheck: false,
    expiresAt: 0,
    you: null,
    ...overrides,
  };
}

function afterWhiteMove(phase: TurnPhase): RoomSnapshot {
  return snapshot({
    turnPhase: phase,
    fen: whiteMove.fenAfter,
    turn: "black",
    moveSequence: 1,
    lastMove: whiteMove,
  });
}

describe("deriving what the player sees", () => {
  it("shows the waiting room until someone joins", () => {
    expect(
      deriveView(snapshot({status: "waiting_for_opponent"}), "white"),
    ).toEqual({kind: "waiting_for_opponent"});
  });

  it("gives the board to the player to move", () => {
    expect(deriveView(snapshot(), "white")).toEqual({kind: "your_turn"});
    expect(deriveView(snapshot(), "black")).toEqual({kind: "opponent_turn"});
  });

  it("shows the sender a waiting state and the receiver the instruction", () => {
    const state = afterWhiteMove("waiting_for_copy_confirmation");

    expect(deriveView(state, "white").kind).toBe("move_sent");
    expect(deriveView(state, "black").kind).toBe("copy_move");
  });

  it("still shows the sender as waiting before the receiver has seen it", () => {
    const state = afterWhiteMove("move_submitted");

    expect(deriveView(state, "white").kind).toBe("move_sent");
    expect(deriveView(state, "black").kind).toBe("copy_move");
  });

  it("hands the turn over once the move is confirmed as copied", () => {
    const state = snapshot({
      turnPhase: "waiting_for_move",
      fen: whiteMove.fenAfter,
      turn: "black",
      moveSequence: 1,
      lastMove: whiteMove,
    });

    expect(deriveView(state, "black").kind).toBe("your_turn");
    expect(deriveView(state, "white").kind).toBe("opponent_turn");
  });
});

describe("the end of a game", () => {
  const mate = {
    reason: "checkmate" as const,
    winner: "white" as const,
    scoreline: "1-0" as const,
    endedAt: 0,
  };

  it("shows the winner the result straight away", () => {
    const state = snapshot({
      status: "completed",
      result: mate,
      turnPhase: "waiting_for_copy_confirmation",
      lastMove: whiteMove,
      moveSequence: 1,
    });

    expect(deriveView(state, "white").kind).toBe("game_over");
  });

  it("asks the loser to place the mating move before showing the result", () => {
    const state = snapshot({
      status: "completed",
      result: mate,
      turnPhase: "waiting_for_copy_confirmation",
      lastMove: whiteMove,
      moveSequence: 1,
    });

    // They still have to put the piece on their own board.
    expect(deriveView(state, "black").kind).toBe("copy_move");
  });

  it("shows the loser the result once they have copied it", () => {
    const state = snapshot({
      status: "completed",
      result: mate,
      turnPhase: "waiting_for_move",
      lastMove: whiteMove,
      moveSequence: 1,
    });

    expect(deriveView(state, "black").kind).toBe("game_over");
  });

  it("names the winner by their display name", () => {
    expect(resultSentence(mate, snapshot())).toBe("Alex wins.");
    expect(
      resultSentence({...mate, winner: "black", scoreline: "0-1"}, snapshot()),
    ).toBe("Sam wins.");
  });

  it("says plainly when a game is drawn", () => {
    expect(
      resultSentence(
        {
          reason: "stalemate",
          winner: null,
          scoreline: "1/2-1/2",
          endedAt: 0,
        },
        snapshot(),
      ),
    ).toBe("It is a draw.");
  });

  it("explains every ending in words rather than a code", () => {
    const reasons = [
      "checkmate",
      "resignation",
      "draw_agreement",
      "stalemate",
      "threefold_repetition",
      "fifty_move_rule",
      "insufficient_material",
      "clock_expired",
      "opponent_left",
    ] as const;

    for (const reason of reasons) {
      const text = resultReasonText({
        reason,
        winner: null,
        scoreline: "1/2-1/2",
        endedAt: 0,
      });
      expect(text).toBeTruthy();
      expect(text).not.toContain("_");
    }
  });
});

describe("reading a position out loud", () => {
  it("describes the starting position in words a person can follow", () => {
    const readout = piecesFromFen(START_FEN);

    expect(readout.white).toContain("King on E1");
    expect(readout.white).toContain("Rooks on A1 and H1");
    expect(readout.white).toContain(
      "Pawns on A2, B2, C2, D2, E2, F2, G2 and H2",
    );
    expect(readout.black).toContain("King on E8");
  });

  it("uses the singular for a lone piece", () => {
    const readout = piecesFromFen("k7/8/8/8/8/8/4P3/7K w - - 0 1");

    expect(readout.white).toContain("Pawn on E2");
    expect(readout.white).not.toContain("Pawns");
  });

  it("says so when a side has nothing left", () => {
    const readout = piecesFromFen("8/8/8/8/8/8/8/7K w - - 0 1");
    expect(readout.black).toBe("No pieces left.");
  });
});
