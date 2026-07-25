import {memo, useEffect, useState} from "react";

import type {ClockState, PieceColor, RoomSnapshot} from "@shared/protocol";

import {PieceColorDot} from "@/components/PieceColorDot";
import type {PlayView} from "@/lib/gameView";

/**
 * The strip that sits directly against the board edge.
 *
 * It reports who the game is waiting on, which is not always whose turn it is:
 * after a move is sent the turn has flipped to the receiver, but their job is
 * to move a wooden piece, not to reply. Deriving from the same view the panel
 * uses is what keeps the two from contradicting each other.
 */
function isWaitingOn(view: PlayView, color: PieceColor, myColor: PieceColor) {
  const isMine = color === myColor;
  switch (view.kind) {
    case "your_turn":
    case "copy_move":
      return isMine;
    case "move_sent":
    case "opponent_turn":
      return !isMine;
    default:
      return false;
  }
}

function statusText(view: PlayView, isMine: boolean): string | null {
  switch (view.kind) {
    case "your_turn":
      return isMine ? "Your turn" : null;
    case "copy_move":
      return isMine ? "Copy their move" : null;
    case "move_sent":
      return isMine ? null : "Copying your move";
    case "opponent_turn":
      return isMine ? null : "Thinking";
    default:
      return null;
  }
}

export function PlayerStrip({
  snapshot,
  color,
  myColor,
  view,
}: {
  snapshot: RoomSnapshot;
  color: PieceColor;
  myColor: PieceColor;
  view: PlayView;
}) {
  const player = snapshot[color];
  const isMine = color === myColor;
  const isActive = isWaitingOn(view, color, myColor);
  const status = statusText(view, isMine);
  const isAway = player?.connected === false;
  const name = player?.displayName ?? "Waiting…";

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 transition-colors duration-200 ${
        isActive ? "bg-surface shadow-surface" : ""
      }`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {/* Reinforces the written "White"/"Black" beside it; never the only
            signal of which side someone is playing. */}
        <PieceColorDot color={color} />
        <span className="truncate text-sm font-medium">
          {isMine ? `${name} (you)` : name}
        </span>
        <span className="shrink-0 text-xs text-muted">
          {color === "white" ? "White" : "Black"}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {isAway ? (
          <span className="text-xs text-warning">Reconnecting…</span>
        ) : status ? (
          <span
            className={`text-xs font-medium ${
              isActive ? "text-accent" : "text-muted"
            }`}
          >
            {status}
          </span>
        ) : null}

        {snapshot.clock ? (
          <ClockChip clock={snapshot.clock} color={color} />
        ) : null}
      </div>
    </div>
  );
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Memoised and self-contained so a ticking clock repaints six characters
 * instead of re-rendering the board every second.
 */
const ClockChip = memo(function ClockChip({
  clock,
  color,
}: {
  clock: ClockState;
  color: PieceColor;
}) {
  const base = color === "white" ? clock.whiteMs : clock.blackMs;
  const isRunning = clock.runningFor === color && !clock.pausedReason;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  // The server owns the remaining time; the client only interpolates between
  // updates rather than keeping a count of its own.
  const remaining = isRunning ? Math.max(0, base - (now - clock.lastTickAt)) : base;
  const isLow = remaining <= 30_000;

  return (
    <span
      className={`tabular rounded-md px-1.5 py-0.5 text-sm font-medium ${
        isLow ? "text-danger" : "text-foreground"
      } ${isRunning ? "bg-default" : ""}`}
      aria-label={`${color} clock: ${formatClock(remaining)}${
        clock.pausedReason ? ", paused" : ""
      }`}
    >
      {formatClock(remaining)}
    </span>
  );
});
