import {PIECE_NAME, pieceAsset} from "@/lib/pieceAssets";
import type {PieceColor, PieceSymbol} from "@shared/protocol";

/**
 * A Maestro piece shown inline in instructions.
 *
 * Only ever used for actual chess pieces — never as a decorative or navigation
 * icon, which is what the rest of the icon set is for.
 */
export function PieceIcon({
  color,
  type,
  className = "size-10",
}: {
  color: PieceColor;
  type: PieceSymbol;
  className?: string;
}) {
  return (
    <img
      src={pieceAsset(color, type)}
      alt={`${color} ${PIECE_NAME[type]}`}
      draggable={false}
      className={`select-none ${className}`}
    />
  );
}
