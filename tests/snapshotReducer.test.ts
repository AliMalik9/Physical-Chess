import {Chess} from "chess.js";
import {describe, expect, it} from "vitest";

import {tryMove} from "@shared/chessEngine";
import {
  PROTOCOL_VERSION,
  type RoomSnapshot,
  type SerializedMove,
  type ServerMessage,
} from "@shared/protocol";

import {
  applyServerEvent,
  moveNumberFromFen,
  turnFromFen,
} from "@/lib/snapshotReducer";

const START_FEN = new Chess().fen();

function baseSnapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    roomId: "room",
    version: 1,
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
    you: {color: "white", displayName: "Alex", isReadOnly: false},
    ...overrides,
  };
}

function envelope<T extends {type: string}>(body: T): ServerMessage {
  return {
    v: PROTOCOL_VERSION,
    roomId: "room",
    eventId: "event",
    ts: 0,
    ...body,
  } as ServerMessage;
}

function e4(): SerializedMove {
  return tryMove({
    fen: START_FEN,
    from: "e2",
    to: "e4",
    sequence: 1,
    playedAt: 0,
  })!.move;
}

describe("reading position facts from a FEN", () => {
  it("reads the side to move", () => {
    expect(turnFromFen(START_FEN)).toBe("white");
    expect(turnFromFen(e4().fenAfter)).toBe("black");
  });

  it("reads the full move number", () => {
    expect(moveNumberFromFen(START_FEN)).toBe(1);
    expect(moveNumberFromFen(e4().fenAfter)).toBe(1);
  });

  it("falls back to move one on a malformed FEN", () => {
    expect(moveNumberFromFen("nonsense")).toBe(1);
  });
});

describe("applying incremental events", () => {
  it("folds a received move into the position", () => {
    const move = e4();
    const next = applyServerEvent(
      baseSnapshot(),
      envelope({
        type: "move_received",
        move,
        moveSequence: 1,
        turnPhase: "waiting_for_copy_confirmation",
        clock: null,
        result: null,
      }),
    );

    expect(next?.fen).toBe(move.fenAfter);
    expect(next?.turn).toBe("black");
    expect(next?.moveSequence).toBe(1);
    expect(next?.lastMove?.san).toBe("e4");
    expect(next?.recentMoves).toHaveLength(1);
  });

  it("clears a pending offer when a move arrives", () => {
    const snapshot = baseSnapshot({
      pendingDraw: {offeredBy: "black", offeredAt: 0},
      pendingUndo: {requestedBy: "black", targetSequence: 0, requestedAt: 0},
    });

    const next = applyServerEvent(
      snapshot,
      envelope({
        type: "move_accepted",
        move: e4(),
        moveSequence: 1,
        turnPhase: "move_submitted",
        clock: null,
        result: null,
      }),
    );

    expect(next?.pendingDraw).toBeNull();
    expect(next?.pendingUndo).toBeNull();
  });

  it("records a copy confirmation against the right player", () => {
    const next = applyServerEvent(
      baseSnapshot({moveSequence: 1}),
      envelope({
        type: "move_copied",
        sequence: 1,
        by: "black",
        turnPhase: "waiting_for_move",
        clock: null,
      }),
    );

    expect(next?.black?.copiedThroughSequence).toBe(1);
    expect(next?.white?.copiedThroughSequence).toBe(0);
    expect(next?.turnPhase).toBe("waiting_for_move");
  });

  it("updates presence without touching the position", () => {
    const snapshot = baseSnapshot();
    const next = applyServerEvent(
      snapshot,
      envelope({
        type: "player_presence_changed",
        color: "black",
        connected: false,
        displayName: "Sam",
        clock: null,
      }),
    );

    expect(next?.black?.connected).toBe(false);
    expect(next?.fen).toBe(snapshot.fen);
  });

  it("marks the room expired", () => {
    const next = applyServerEvent(
      baseSnapshot(),
      envelope({type: "room_expired"}),
    );

    expect(next?.status).toBe("expired");
  });

  it("leaves the position alone on an error", () => {
    const snapshot = baseSnapshot();
    const next = applyServerEvent(
      snapshot,
      envelope({type: "error", code: "illegal_move"}),
    );

    expect(next).toEqual(snapshot);
  });
});

describe("reconnection", () => {
  it("rebuilds entirely from a snapshot rather than trusting local state", () => {
    // A client that drifted: wrong position, wrong turn, stale sequence.
    const drifted = baseSnapshot({
      fen: e4().fenAfter,
      turn: "black",
      moveSequence: 7,
      turnPhase: "move_submitted",
    });

    const authoritative = baseSnapshot({
      moveSequence: 12,
      turnPhase: "waiting_for_move",
    });

    const next = applyServerEvent(
      drifted,
      envelope({type: "room_snapshot", snapshot: authoritative}),
    );

    expect(next).toEqual(authoritative);
    expect(next?.moveSequence).toBe(12);
  });

  it("accepts a snapshot when there is no local state at all", () => {
    const authoritative = baseSnapshot();
    const next = applyServerEvent(
      null,
      envelope({type: "room_snapshot", snapshot: authoritative}),
    );

    expect(next).toEqual(authoritative);
  });

  it("ignores incremental events before the first snapshot", () => {
    // Ordering can put a broadcast ahead of the snapshot on a fresh socket.
    const next = applyServerEvent(
      null,
      envelope({
        type: "turn_changed",
        turn: "black",
        turnPhase: "waiting_for_move",
        moveSequence: 3,
        inCheck: false,
        clock: null,
      }),
    );

    expect(next).toBeNull();
  });

  it("takes the full snapshot that rides along with an undo", () => {
    const rolledBack = baseSnapshot({moveSequence: 4});
    const next = applyServerEvent(
      baseSnapshot({moveSequence: 5}),
      envelope({type: "undo_resolved", accepted: true, snapshot: rolledBack}),
    );

    expect(next?.moveSequence).toBe(4);
  });
});
