import type {PieceColor} from "@shared/protocol";

/**
 * The small token marking which side a player has.
 *
 * Always sits next to the words "White" or "Black" — it is a reinforcement, not
 * the signal, so nothing depends on telling the two apart by eye.
 */
export function PieceColorDot({
  color,
  className = "size-3.5",
}: {
  color: PieceColor;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`shrink-0 rounded-full border ${className} ${
        color === "white"
          ? "border-black/25 bg-[var(--piece-white)]"
          : "border-white/20 bg-[var(--piece-black)]"
      }`}
    />
  );
}
