import type {PieceColor, PieceSymbol} from "@shared/protocol";

/**
 * The exact Lichess Maestro piece set, vendored into /public.
 *
 * Vendored rather than hotlinked so the game keeps working offline, never
 * depends on lichess.org uptime, and does not send our players' traffic to
 * someone else's servers. See THIRD_PARTY_NOTICES.md for licensing.
 */
export type PieceName =
  | "pawn"
  | "knight"
  | "bishop"
  | "rook"
  | "queen"
  | "king";

const MAESTRO_ROOT = "/vendor/lichess/pieces/maestro";

export const maestroPieceAsset: Record<
  PieceColor,
  Record<PieceName, string>
> = {
  white: {
    pawn: `${MAESTRO_ROOT}/wP.svg`,
    knight: `${MAESTRO_ROOT}/wN.svg`,
    bishop: `${MAESTRO_ROOT}/wB.svg`,
    rook: `${MAESTRO_ROOT}/wR.svg`,
    queen: `${MAESTRO_ROOT}/wQ.svg`,
    king: `${MAESTRO_ROOT}/wK.svg`,
  },
  black: {
    pawn: `${MAESTRO_ROOT}/bP.svg`,
    knight: `${MAESTRO_ROOT}/bN.svg`,
    bishop: `${MAESTRO_ROOT}/bB.svg`,
    rook: `${MAESTRO_ROOT}/bR.svg`,
    queen: `${MAESTRO_ROOT}/bQ.svg`,
    king: `${MAESTRO_ROOT}/bK.svg`,
  },
};

export const BOARD_IMAGE = "/vendor/lichess/board/brown.png";

/** chess.js piece letters to the names used by the asset map and by copy. */
export const PIECE_NAME: Record<PieceSymbol, PieceName> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

export function pieceAsset(color: PieceColor, symbol: PieceSymbol): string {
  return maestroPieceAsset[color][PIECE_NAME[symbol]];
}

/** Every image the board needs, for preloading before the first paint. */
export function allBoardAssets(): string[] {
  return [
    BOARD_IMAGE,
    ...Object.values(maestroPieceAsset).flatMap((set) => Object.values(set)),
  ];
}
