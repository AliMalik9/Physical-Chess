import {Chess} from "chess.js";
import {beforeEach, describe, expect, it} from "vitest";

import {LIMITS, type PieceColor} from "@shared/protocol";
import {
  applyClockExpiry,
  applyConfirmCopy,
  applyMove,
  applyUndo,
  bothSeatsTaken,
  claimAction,
  clockDeadline,
  guardConfirmCopy,
  guardDrawResponse,
  guardResign,
  guardSubmitMove,
  guardUndoRequest,
  guardUndoResponse,
  markAwaitingCopy,
  pauseClockForDisconnect,
  playerAt,
  resumeClock,
  startClockForActiveGame,
  tickClock,
  type RoomPlayerState,
  type RoomState,
} from "../worker/roomLogic";

const NOW = 1_700_000_000_000;

function player(color: PieceColor, name: string): RoomPlayerState {
  return {
    id: `${color}-id`,
    seatTokenHash: `${color}-hash`,
    displayName: name,
    color,
    connected: true,
    lastSeenAt: NOW,
    copiedThroughSequence: 0,
    primaryConnectionId: `${color}-conn`,
    disconnectedAt: null,
  };
}

function makeRoom(overrides: Partial<RoomState> = {}): RoomState {
  return {
    id: "room-id",
    publicCode: "BNXWZK43",
    inviteHash: "invite-hash",
    createdAt: NOW,
    updatedAt: NOW,
    startedAt: NOW,
    expiresAt: NOW + 3_600_000,
    status: "active",
    turnPhase: "waiting_for_move",
    moveSequence: 0,
    previousFen: null,
    white: player("white", "Alex"),
    black: player("black", "Sam"),
    pendingUndo: null,
    pendingDraw: null,
    result: null,
    clock: null,
    recentActionIds: [],
    ...overrides,
  };
}

function submit(
  room: RoomState,
  game: Chess,
  color: PieceColor,
  from: string,
  to: string,
  promotion?: "q" | "r" | "b" | "n",
) {
  const guard = guardSubmitMove({
    state: room,
    game,
    color,
    expectedSequence: room.moveSequence,
    isReadOnly: false,
  });
  if (guard) return {guard, applied: null};

  const applied = applyMove({
    state: room,
    game,
    from,
    to,
    ...(promotion ? {promotion} : {}),
    now: NOW,
  });
  return {guard: null, applied};
}

describe("seating", () => {
  it("reports both seats taken only when two players are present", () => {
    expect(bothSeatsTaken(makeRoom())).toBe(true);
    expect(bothSeatsTaken(makeRoom({black: null}))).toBe(false);
  });
});

describe("submitting a move", () => {
  let room: RoomState;
  let game: Chess;

  beforeEach(() => {
    room = makeRoom();
    game = new Chess();
  });

  it("accepts a legal move from the player to move", () => {
    const {guard, applied} = submit(room, game, "white", "e2", "e4");

    expect(guard).toBeNull();
    expect(applied?.ok).toBe(true);
    expect(room.moveSequence).toBe(1);
    // The receiver has not seen it yet, so the phase stops short of "copying".
    expect(room.turnPhase).toBe("move_submitted");
    expect(game.fen()).toContain(" b ");
  });

  it("rejects a move from the player who is not to move", () => {
    const {guard} = submit(room, game, "black", "e7", "e5");

    expect(guard).toBe("not_your_turn");
    expect(room.moveSequence).toBe(0);
  });

  it("rejects an illegal move even when it is that player's turn", () => {
    const applied = applyMove({
      state: room,
      game,
      from: "e2",
      to: "e5",
      now: NOW,
    });

    expect(applied.ok).toBe(false);
    expect(applied.ok === false && applied.code).toBe("illegal_move");
    expect(room.moveSequence).toBe(0);
  });

  it("rejects a move built against a stale position", () => {
    const guard = guardSubmitMove({
      state: room,
      game,
      color: "white",
      // The client thinks three moves have been played; the server knows none.
      expectedSequence: 3,
      isReadOnly: false,
    });

    expect(guard).toBe("stale_sequence");
  });

  it("rejects a move from a read-only duplicate tab", () => {
    const guard = guardSubmitMove({
      state: room,
      game,
      color: "white",
      expectedSequence: 0,
      isReadOnly: true,
    });

    expect(guard).toBe("read_only_connection");
  });

  it("refuses a second move before the first has been copied", () => {
    submit(room, game, "white", "e2", "e4");

    const guard = guardSubmitMove({
      state: room,
      game,
      color: "black",
      expectedSequence: room.moveSequence,
      isReadOnly: false,
    });

    expect(guard).toBe("wrong_phase");
  });

  it("refuses moves once the game is over", () => {
    room.status = "completed";
    room.result = {
      reason: "resignation",
      winner: "black",
      scoreline: "0-1",
      endedAt: NOW,
    };

    expect(
      guardSubmitMove({
        state: room,
        game,
        color: "white",
        expectedSequence: 0,
        isReadOnly: false,
      }),
    ).toBe("game_already_over");
  });
});

describe("the copy confirmation handshake", () => {
  let room: RoomState;
  let game: Chess;

  beforeEach(() => {
    room = makeRoom();
    game = new Chess();
    submit(room, game, "white", "e2", "e4");
  });

  it("advances to awaiting-copy once the receiver is actually connected", () => {
    expect(markAwaitingCopy(room)).toBe(true);
    expect(room.turnPhase).toBe("waiting_for_copy_confirmation");
    // Only meaningful once, from move_submitted.
    expect(markAwaitingCopy(room)).toBe(false);
  });

  it("lets the receiving player confirm and hands them the move", () => {
    markAwaitingCopy(room);

    const guard = guardConfirmCopy({
      state: room,
      color: "black",
      sequence: room.moveSequence,
      isReadOnly: false,
      lastMoveColor: "white",
    });
    expect(guard).toBeNull();

    applyConfirmCopy({state: room, color: "black", sequence: 1, now: NOW});

    expect(room.turnPhase).toBe("waiting_for_move");
    expect(playerAt(room, "black")?.copiedThroughSequence).toBe(1);
  });

  it("does not let the player who moved confirm their own move", () => {
    markAwaitingCopy(room);

    expect(
      guardConfirmCopy({
        state: room,
        color: "white",
        sequence: 1,
        isReadOnly: false,
        lastMoveColor: "white",
      }),
      // White would be confirming the move white just made. Allowing it would
      // hand white a second turn and desynchronise the two wooden boards.
    ).toBe("not_your_turn");
  });

  it("rejects a confirmation that names the wrong move", () => {
    markAwaitingCopy(room);

    expect(
      guardConfirmCopy({
        state: room,
        color: "black",
        sequence: 99,
        isReadOnly: false,
        lastMoveColor: "white",
      }),
    ).toBe("stale_sequence");
  });
});

describe("idempotency", () => {
  it("applies an action id once and ignores repeats", () => {
    const room = makeRoom();

    expect(claimAction(room, "action-1")).toBe(true);
    expect(claimAction(room, "action-1")).toBe(false);
    expect(claimAction(room, "action-2")).toBe(true);
  });

  it("ignores an empty action id", () => {
    expect(claimAction(makeRoom(), "")).toBe(false);
  });

  it("keeps the memory bounded but still catches recent repeats", () => {
    const room = makeRoom();

    for (let i = 0; i < LIMITS.actionMemory + 10; i += 1) {
      claimAction(room, `action-${i}`);
    }

    expect(room.recentActionIds.length).toBe(LIMITS.actionMemory);
    // The newest ids are still remembered, which is what retries actually use.
    expect(claimAction(room, `action-${LIMITS.actionMemory + 9}`)).toBe(false);
  });

  it("stops a replayed move from being played twice", () => {
    const room = makeRoom();
    const game = new Chess();

    expect(claimAction(room, "same-id")).toBe(true);
    submit(room, game, "white", "e2", "e4");
    expect(room.moveSequence).toBe(1);

    // The retry never reaches the move logic.
    expect(claimAction(room, "same-id")).toBe(false);
    expect(room.moveSequence).toBe(1);
  });
});

describe("undo", () => {
  it("rolls the position back and puts the mover back on the clock", () => {
    const room = makeRoom();
    const game = new Chess();
    submit(room, game, "white", "e2", "e4");
    markAwaitingCopy(room);
    applyConfirmCopy({state: room, color: "black", sequence: 1, now: NOW});

    const moves = [
      {
        sequence: 1,
        color: "white" as const,
        from: "e2",
        to: "e4",
        piece: "p" as const,
        san: "e4",
        lan: "e2e4",
        moveNumber: 1,
        isCapture: false,
        isEnPassant: false,
        castle: null,
        isCheck: false,
        isCheckmate: false,
        fenBefore: new Chess().fen(),
        fenAfter: game.fen(),
        playedAt: NOW,
      },
    ];

    const undone = applyUndo({state: room, moves, now: NOW});

    expect(undone?.san).toBe("e4");
    expect(moves).toHaveLength(0);
    expect(room.moveSequence).toBe(0);
    expect(room.turnPhase).toBe("waiting_for_move");
    // A rolled-back move must not stay marked as copied onto a real board.
    expect(playerAt(room, "black")?.copiedThroughSequence).toBe(0);
  });

  it("refuses an undo request before any move has been played", () => {
    expect(
      guardUndoRequest({
        state: makeRoom(),
        color: "white",
        isReadOnly: false,
      }),
    ).toBe("wrong_phase");
  });

  it("refuses a second undo request while one is pending", () => {
    const room = makeRoom({
      moveSequence: 1,
      pendingUndo: {requestedBy: "white", targetSequence: 1, requestedAt: NOW},
    });

    expect(
      guardUndoRequest({state: room, color: "white", isReadOnly: false}),
    ).toBe("duplicate_action");
  });

  it("does not let the requester answer their own undo request", () => {
    const room = makeRoom({
      moveSequence: 1,
      pendingUndo: {requestedBy: "white", targetSequence: 1, requestedAt: NOW},
    });

    expect(
      guardUndoResponse({state: room, color: "white", isReadOnly: false}),
    ).toBe("not_a_player");
    expect(
      guardUndoResponse({state: room, color: "black", isReadOnly: false}),
    ).toBeNull();
  });

  it("refuses a response when nothing was asked", () => {
    expect(
      guardUndoResponse({
        state: makeRoom(),
        color: "black",
        isReadOnly: false,
      }),
    ).toBe("no_undo_pending");
  });
});

describe("draw and resignation", () => {
  it("does not let a player accept their own draw offer", () => {
    const room = makeRoom({
      pendingDraw: {offeredBy: "white", offeredAt: NOW},
    });

    expect(
      guardDrawResponse({state: room, color: "white", isReadOnly: false}),
    ).toBe("not_a_player");
    expect(
      guardDrawResponse({state: room, color: "black", isReadOnly: false}),
    ).toBeNull();
  });

  it("refuses a resignation from a read-only tab", () => {
    expect(
      guardResign({state: makeRoom(), color: "white", isReadOnly: true}),
    ).toBe("read_only_connection");
  });
});

describe("clocks", () => {
  function timedRoom(): RoomState {
    return makeRoom({
      clock: {
        initialMs: 600_000,
        whiteMs: 600_000,
        blackMs: 600_000,
        runningFor: null,
        lastTickAt: NOW,
        pausedReason: null,
      },
    });
  }

  it("charges elapsed time to whoever is running", () => {
    const room = timedRoom();
    startClockForActiveGame(room, NOW);

    tickClock(room, NOW + 5_000);

    expect(room.clock!.whiteMs).toBe(595_000);
    expect(room.clock!.blackMs).toBe(600_000);
  });

  it("switches the clock to the opponent when a move is accepted", () => {
    const room = timedRoom();
    const game = new Chess();
    startClockForActiveGame(room, NOW);

    applyMove({state: room, game, from: "e2", to: "e4", now: NOW + 3_000});

    expect(room.clock!.whiteMs).toBe(597_000);
    expect(room.clock!.runningFor).toBe("black");
  });

  it("holds the clock while a player is away and resumes it on return", () => {
    const room = timedRoom();
    startClockForActiveGame(room, NOW);

    expect(pauseClockForDisconnect(room, NOW + 1_000)).toBe(true);
    expect(room.clock!.pausedReason).toBe("opponent_disconnected");

    // No time is charged while held.
    tickClock(room, NOW + 60_000);
    expect(room.clock!.whiteMs).toBe(599_000);

    expect(resumeClock(room, NOW + 60_000)).toBe(true);
    tickClock(room, NOW + 62_000);
    expect(room.clock!.whiteMs).toBe(597_000);
  });

  it("ends the game when a clock runs out", () => {
    const room = timedRoom();
    startClockForActiveGame(room, NOW);

    tickClock(room, NOW + 600_001);
    const outcome = applyClockExpiry(room, NOW + 600_001);

    expect(outcome?.reason).toBe("clock_expired");
    expect(outcome?.winner).toBe("black");
    expect(room.status).toBe("completed");
    expect(room.clock!.runningFor).toBeNull();
  });

  it("reports no deadline when nothing is running", () => {
    const room = timedRoom();
    expect(clockDeadline(room)).toBeNull();

    startClockForActiveGame(room, NOW);
    expect(clockDeadline(room)).toBe(NOW + 600_000);
  });

  it("has no clock at all in an untimed game", () => {
    const room = makeRoom();
    tickClock(room, NOW + 10_000);
    expect(applyClockExpiry(room, NOW + 10_000)).toBeNull();
    expect(clockDeadline(room)).toBeNull();
  });
});

describe("finished and expired rooms", () => {
  it("refuses everything once the room has expired", () => {
    const room = makeRoom({status: "expired"});
    const game = new Chess();

    expect(
      guardSubmitMove({
        state: room,
        game,
        color: "white",
        expectedSequence: 0,
        isReadOnly: false,
      }),
    ).toBe("room_expired");

    expect(
      guardConfirmCopy({
        state: room,
        color: "black",
        sequence: 0,
        isReadOnly: false,
        lastMoveColor: null,
      }),
    ).toBe("room_expired");
  });

  it("detects checkmate and records the winner", () => {
    const room = makeRoom();
    const game = new Chess();

    // Fool's mate: the fastest possible checkmate.
    submit(room, game, "white", "f2", "f3");
    room.turnPhase = "waiting_for_move";
    submit(room, game, "black", "e7", "e5");
    room.turnPhase = "waiting_for_move";
    submit(room, game, "white", "g2", "g4");
    room.turnPhase = "waiting_for_move";
    const {applied} = submit(room, game, "black", "d8", "h4");

    expect(applied?.ok).toBe(true);
    expect(applied?.ok === true && applied.applied.outcome?.reason).toBe(
      "checkmate",
    );
    expect(room.result?.winner).toBe("black");
    expect(room.status).toBe("completed");
  });
});
