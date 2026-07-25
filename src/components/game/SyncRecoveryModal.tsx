import {Button, Modal, Separator} from "@heroui/react";

import {describeMove} from "@shared/moveLanguage";
import type {RoomSnapshot} from "@shared/protocol";

import {piecesFromFen} from "@/lib/fenReadout";

/**
 * "These boards don't match."
 *
 * The server's position is the truth, so the fix is always the same: read the
 * real position out and set the wooden board to match. A take-back is offered
 * too, because the usual cause is one move copied wrongly.
 *
 * There is deliberately no button that lets one player rewrite the room — a
 * client silently overwriting shared state is how boards diverge in the first
 * place.
 */
export function SyncRecoveryModal({
  isOpen,
  onOpenChange,
  snapshot,
  onRequestUndo,
  canRequestUndo,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: RoomSnapshot;
  onRequestUndo: () => void;
  canRequestUndo: boolean;
}) {
  const readout = piecesFromFen(snapshot.fen);
  const recent = [...snapshot.recentMoves].reverse();

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[32rem]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>These boards don’t match</Modal.Heading>
          </Modal.Header>

          <Modal.Body className="gap-4">
            <p className="text-sm text-muted">
              Set your board to the position below. It is the one BoardLink has.
            </p>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">
                White pieces
              </span>
              <p className="text-sm leading-relaxed">{readout.white}</p>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">
                Black pieces
              </span>
              <p className="text-sm leading-relaxed">{readout.black}</p>
            </div>

            <Separator />

            <p className="text-sm font-medium">
              {snapshot.turn === "white"
                ? "White moves next."
                : "Black moves next."}
            </p>

            <Separator />

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted">
                The last few moves
              </span>
              {recent.length === 0 ? (
                <p className="text-sm text-muted">No moves have been played yet.</p>
              ) : (
                <ol className="flex flex-col gap-1.5">
                  {recent.map((move) => (
                    <li key={move.sequence} className="flex gap-2 text-sm">
                      <span className="tabular shrink-0 text-muted">
                        {move.moveNumber}.
                      </span>
                      <span>{describeMove(move, "copier").headline}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Modal.Body>

          <Modal.Footer>
            <Button slot="close" variant="secondary">
              Close
            </Button>
            <Button
              isDisabled={!canRequestUndo}
              onPress={() => {
                onRequestUndo();
                onOpenChange(false);
              }}
            >
              Ask to go back one move
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
