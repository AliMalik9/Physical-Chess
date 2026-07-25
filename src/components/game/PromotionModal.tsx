import {Modal} from "@heroui/react";

import {friendlyPieceName} from "@shared/moveLanguage";
import type {PieceColor, PieceSymbol} from "@shared/protocol";

import {PieceIcon} from "@/components/PieceIcon";

const CHOICES: PieceSymbol[] = ["q", "r", "b", "n"];

/**
 * Asks which piece the pawn became.
 *
 * Never silently defaults to a queen: on a physical board the player has to put
 * an actual piece down, and a wrong assumption here desynchronises the two
 * boards from that move onward.
 */
export function PromotionModal({
  isOpen,
  color,
  onChoose,
  onCancel,
}: {
  isOpen: boolean;
  color: PieceColor;
  onChoose: (piece: PieceSymbol) => void;
  onCancel: () => void;
}) {
  return (
    <Modal.Backdrop
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[24rem]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>Your pawn reached the end</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <p className="text-sm text-muted">
              Which piece did you put there?
            </p>
            <div className="grid grid-cols-2 gap-2 pt-2">
              {CHOICES.map((piece) => (
                <button
                  key={piece}
                  type="button"
                  onClick={() => onChoose(piece)}
                  className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface px-3 py-4 transition-colors duration-150 hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  <PieceIcon color={color} type={piece} className="size-12" />
                  {/* Always text-labelled, never icon-only. */}
                  <span className="text-sm font-medium">
                    {friendlyPieceName(piece)}
                  </span>
                </button>
              ))}
            </div>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
