import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {describeSquare} from "@shared/moveLanguage";
import type {PieceColor, PieceSymbol} from "@shared/protocol";

import {pieceAsset} from "@/lib/pieceAssets";
import {
  cellToSquare,
  isLightSquare,
  piecesFromFen,
  squareToCell,
  squaresInOrder,
  type BoardCell,
  type PlacedPiece,
} from "./geometry";

export interface BoardMove {
  from: string;
  to: string;
  /** Set for castling so the rook can be animated alongside the king. */
  rook?: {from: string; to: string};
}

export interface BoardProps {
  fen: string;
  orientation: PieceColor;
  /** Colour this player may pick up. null disables all input. */
  movableColor: PieceColor | null;
  selectedSquare: string | null;
  legalTargets: string[];
  lastMove: BoardMove | null;
  /** Square of a king in check, if any. */
  checkSquare: string | null;
  showCoordinates: boolean;
  animateMoves: boolean;
  onSquareActivate: (square: string) => void;
  onDragMove: (from: string, to: string) => void;
}

/** Pixels of pointer travel before a press counts as a drag rather than a tap. */
const DRAG_THRESHOLD = 6;

interface DragState {
  from: string;
  pointerId: number;
  /** Pointer position relative to the board, in pixels. */
  x: number;
  y: number;
  hasMoved: boolean;
  /**
   * Whether this press could become a drag. A press on an empty square is
   * still tracked — that is how tap-to-move reaches its destination — but it
   * can never turn into a drag.
   */
  canDrag: boolean;
}

export function Board({
  fen,
  orientation,
  movableColor,
  selectedSquare,
  legalTargets,
  lastMove,
  checkSquare,
  showCoordinates,
  animateMoves,
  onSquareActivate,
  onDragMove,
}: BoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  /*
   * Roving tabindex: exactly one square is in the tab order, and the arrow keys
   * move between squares from there. Without this the board is either 64 tab
   * stops or — if every square is -1 — unreachable by keyboard entirely.
   */
  const [focusSquare, setFocusSquare] = useState("e4");

  const pieces = useMemo(() => piecesFromFen(fen), [fen]);
  const squares = useMemo(() => squaresInOrder(orientation), [orientation]);

  const pieceBySquare = useMemo(() => {
    const map = new Map<string, PlacedPiece>();
    for (const piece of pieces) map.set(piece.square, piece);
    return map;
  }, [pieces]);

  const targetSet = useMemo(() => new Set(legalTargets), [legalTargets]);

  /* ---------------------------------------------------------------------- */
  /* Move animation                                                         */
  /* ---------------------------------------------------------------------- */

  /*
   * Pieces are keyed by square, so the piece that just arrived is a freshly
   * mounted element. Mounting it at the *origin* square and moving it to its
   * real square on the next frame is what makes the CSS transition run.
   */
  const [animateFrom, setAnimateFrom] = useState<Record<string, BoardCell>>({});
  const lastAnimatedRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!animateMoves || !lastMove) {
      lastAnimatedRef.current = null;
      return;
    }

    const signature = `${lastMove.from}-${lastMove.to}-${orientation}`;
    if (lastAnimatedRef.current === signature) return;
    lastAnimatedRef.current = signature;

    const origins: Record<string, BoardCell> = {
      [lastMove.to]: squareToCell(lastMove.from, orientation),
    };
    if (lastMove.rook) {
      origins[lastMove.rook.to] = squareToCell(lastMove.rook.from, orientation);
    }

    setAnimateFrom(origins);
    const frame = requestAnimationFrame(() => setAnimateFrom({}));
    return () => cancelAnimationFrame(frame);
  }, [animateMoves, lastMove, orientation]);

  /* ---------------------------------------------------------------------- */
  /* Pointer input                                                          */
  /* ---------------------------------------------------------------------- */

  const squareFromPoint = useCallback(
    (clientX: number, clientY: number): string | null => {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return null;

      const col = Math.floor(((clientX - rect.left) / rect.width) * 8);
      const row = Math.floor(((clientY - rect.top) / rect.height) * 8);
      if (col < 0 || col > 7 || row < 0 || row > 7) return null;

      return cellToSquare(col, row, orientation);
    },
    [orientation],
  );

  const canPickUp = useCallback(
    (square: string) => {
      if (!movableColor) return false;
      return pieceBySquare.get(square)?.color === movableColor;
    },
    [movableColor, pieceBySquare],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, square: string) => {
      // Only a primary press starts a move; right-click is left to the browser.
      if (event.button !== 0) return;

      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect) return;

      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({
        from: square,
        pointerId: event.pointerId,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        hasMoved: false,
        canDrag: canPickUp(square),
      });
    },
    [canPickUp],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      setDrag((current) => {
        if (!current || current.pointerId !== event.pointerId) return current;

        const rect = boardRef.current?.getBoundingClientRect();
        if (!rect) return current;

        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        // Only a press that started on one of your own pieces can become a
        // drag; a press on an empty square stays a tap however far it wanders.
        const travelled =
          current.canDrag &&
          Math.abs(x - current.x) + Math.abs(y - current.y) > DRAG_THRESHOLD;

        return {
          ...current,
          x,
          y,
          hasMoved: current.hasMoved || travelled,
        };
      });
    },
    [],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, square: string) => {
      const current = drag;
      setDrag(null);
      if (!current || current.pointerId !== event.pointerId) return;

      if (!current.hasMoved) {
        // A press that never travelled is a tap: select, do not move.
        onSquareActivate(square);
        return;
      }

      const target = squareFromPoint(event.clientX, event.clientY);
      // An illegal or off-board drop simply returns the piece; the position is
      // unchanged, so the piece snaps back with no extra work.
      if (target && target !== current.from) onDragMove(current.from, target);
    },
    [drag, onDragMove, onSquareActivate, squareFromPoint],
  );

  const handlePointerCancel = useCallback(() => setDrag(null), []);

  /* ---------------------------------------------------------------------- */
  /* Keyboard                                                               */
  /* ---------------------------------------------------------------------- */

  const focusSquareElement = useCallback((square: string) => {
    boardRef.current
      ?.querySelector<HTMLButtonElement>(`[data-square="${square}"]`)
      ?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, square: string) => {
      const deltas: Record<string, [number, number]> = {
        ArrowRight: [1, 0],
        ArrowLeft: [-1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };

      const delta = deltas[event.key];
      if (!delta) return;

      event.preventDefault();
      const {col, row} = squareToCell(square, orientation);
      const nextCol = Math.min(7, Math.max(0, col + delta[0]));
      const nextRow = Math.min(7, Math.max(0, row + delta[1]));
      const next = cellToSquare(nextCol, nextRow, orientation);

      setFocusSquare(next);
      focusSquareElement(next);
    },
    [focusSquareElement, orientation],
  );

  /* Releasing outside the board still has to end the drag. */
  useEffect(() => {
    if (!drag) return;
    const cancel = () => setDrag(null);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
    };
  }, [drag]);

  const draggedPiece = drag?.hasMoved
    ? (pieceBySquare.get(drag.from) ?? null)
    : null;

  return (
    <div
      ref={boardRef}
      className="board-surface relative w-full"
      style={{containerType: "inline-size"}}
      data-testid="board"
    >
      {/* Interaction and accessibility layer: one real button per square. */}
      <div className="absolute inset-0 grid grid-cols-8 grid-rows-8">
        {squares.map((square) => {
          const piece = pieceBySquare.get(square) ?? null;
          const isTarget = targetSet.has(square);
          const isSelected = selectedSquare === square;
          const isLast =
            lastMove?.from === square ||
            lastMove?.to === square ||
            lastMove?.rook?.from === square ||
            lastMove?.rook?.to === square;

          return (
            <button
              key={square}
              type="button"
              data-square={square}
              tabIndex={square === focusSquare ? 0 : -1}
              onFocus={() => setFocusSquare(square)}
              aria-label={describeSquare({
                square,
                piece: piece ? {color: piece.color, type: piece.type} : null,
                isSelected,
                isLegalTarget: isTarget,
                isLastMove: isLast,
              })}
              aria-pressed={isSelected}
              className={[
                "relative touch-none focus-visible:z-10 focus-visible:outline-2",
                "focus-visible:outline-offset-[-3px] focus-visible:outline-focus",
                isLast ? "sq-last" : "",
                isSelected ? "sq-selected" : "",
                checkSquare === square ? "sq-check" : "",
                isTarget ? (piece ? "sq-capture" : "sq-dot") : "",
                movableColor && piece?.color === movableColor
                  ? "cursor-grab"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onPointerDown={(event) => handlePointerDown(event, square)}
              onPointerMove={handlePointerMove}
              onPointerUp={(event) => handlePointerUp(event, square)}
              onPointerCancel={handlePointerCancel}
              onKeyDown={(event) => handleKeyDown(event, square)}
              onClick={(event) => {
                // Pointer devices are handled on pointerup; this covers
                // keyboard activation and assistive technology clicks.
                if (event.detail === 0) onSquareActivate(square);
              }}
            />
          );
        })}
      </div>

      {/* Pieces. Purely visual — all input lands on the buttons above. */}
      <div className="pointer-events-none absolute inset-0">
        {pieces.map((piece) => {
          const cell =
            animateFrom[piece.square] ?? squareToCell(piece.square, orientation);
          const isDragging = drag?.hasMoved && drag.from === piece.square;

          return (
            <PieceSprite
              key={piece.square}
              color={piece.color}
              type={piece.type}
              col={cell.col}
              row={cell.row}
              isHidden={Boolean(isDragging)}
              animate={animateMoves}
            />
          );
        })}
      </div>

      {/* The piece under the pointer, tracking it exactly. */}
      {draggedPiece && drag ? (
        <img
          src={pieceAsset(draggedPiece.color, draggedPiece.type)}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="piece-sprite absolute left-0 top-0 z-20 w-[12.5%]"
          style={{
            transform: `translate3d(${drag.x}px, ${drag.y}px, 0) translate(-50%, -50%) scale(1.06)`,
          }}
        />
      ) : null}

      {showCoordinates ? <Coordinates orientation={orientation} /> : null}
    </div>
  );
}

/**
 * A single piece.
 *
 * Memoised on its own so dragging or re-highlighting squares does not re-render
 * 32 images. Position is a transform, so movement runs on the compositor and
 * never triggers layout.
 */
const PieceSprite = memo(function PieceSprite({
  color,
  type,
  col,
  row,
  isHidden,
  animate,
}: {
  color: PieceColor;
  type: PieceSymbol;
  col: number;
  row: number;
  isHidden: boolean;
  animate: boolean;
}) {
  return (
    <img
      src={pieceAsset(color, type)}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`piece-sprite absolute left-0 top-0 w-[12.5%] ${
        animate ? "piece-animated" : ""
      }`}
      style={{
        transform: `translate(${col * 100}%, ${row * 100}%)`,
        opacity: isHidden ? 0 : 1,
      }}
    />
  );
});

/**
 * Rank and file labels, inside the board like Lichess.
 *
 * Colour is chosen from the square underneath rather than the app theme,
 * because the wood does not change between light and dark mode.
 */
function Coordinates({orientation}: {orientation: PieceColor}) {
  const ranks = Array.from({length: 8}, (_, row) =>
    cellToSquare(0, row, orientation),
  );
  const files = Array.from({length: 8}, (_, col) =>
    cellToSquare(col, 7, orientation),
  );

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {ranks.map((square, row) => (
        <span
          key={`rank-${square}`}
          className={`coord left-[0.35cqw] ${
            isLightSquare(square) ? "coord-on-light" : "coord-on-dark"
          }`}
          style={{top: `calc(${row * 12.5}% + 0.35cqw)`}}
        >
          {square[1]}
        </span>
      ))}

      {files.map((square, col) => (
        <span
          key={`file-${square}`}
          className={`coord bottom-[0.35cqw] ${
            isLightSquare(square) ? "coord-on-light" : "coord-on-dark"
          }`}
          style={{left: `calc(${col * 12.5}% + 11cqw)`}}
        >
          {square[0]}
        </span>
      ))}
    </div>
  );
}
