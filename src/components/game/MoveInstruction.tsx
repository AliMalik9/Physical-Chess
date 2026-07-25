import {describeMove, formatSquare} from "@shared/moveLanguage";
import type {SerializedMove} from "@shared/protocol";

import {PieceIcon} from "@/components/PieceIcon";

/**
 * The from → to display.
 *
 * Sized large on purpose: this is read from across a table by someone whose
 * hands are on a wooden board, not on the phone. Notation is present but
 * deliberately small — it is metadata, never the instruction.
 */
export function MoveInstruction({
  move,
  perspective,
  size = "lg",
}: {
  move: SerializedMove;
  perspective: "actor" | "copier";
  size?: "lg" | "sm";
}) {
  const instruction = describeMove(move, perspective);
  const isLarge = size === "lg";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <PieceIcon
          color={move.color}
          type={move.piece}
          className={isLarge ? "size-12 shrink-0" : "size-9 shrink-0"}
        />
        <div className="flex items-baseline gap-2.5">
          <span
            className={`tabular font-semibold tracking-tight ${
              isLarge ? "text-4xl" : "text-2xl"
            }`}
          >
            {formatSquare(move.from)}
          </span>
          <span
            aria-hidden="true"
            className={`text-accent ${isLarge ? "text-2xl" : "text-lg"}`}
          >
            →
          </span>
          <span
            className={`tabular font-semibold tracking-tight ${
              isLarge ? "text-4xl" : "text-2xl"
            }`}
          >
            {formatSquare(move.to)}
          </span>
        </div>
      </div>

      <p
        className={`font-medium text-pretty ${isLarge ? "text-lg" : "text-base"}`}
      >
        {instruction.headline}
      </p>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="tabular">{instruction.numberedNotation}</span>
        {instruction.checkNote ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="text-warning">{instruction.checkNote}</span>
          </>
        ) : null}
        {move.isCheckmate ? (
          <>
            <span aria-hidden="true">·</span>
            <span>Checkmate</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
