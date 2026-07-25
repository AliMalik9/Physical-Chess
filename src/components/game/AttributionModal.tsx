import {Button, Link, Modal, Separator} from "@heroui/react";

/**
 * Attribution for the vendored Lichess artwork.
 *
 * Reachable from Settings rather than sitting on the game screen, but never
 * buried: the licences require credit, and CC BY-NC-SA in particular is a
 * condition anyone shipping this needs to have read.
 */
export function AttributionModal({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[30rem]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>About the board artwork</Modal.Heading>
          </Modal.Header>

          <Modal.Body className="gap-4 text-sm">
            <p className="text-muted">
              Chessboard artwork adapted from assets distributed by Lichess.
              BoardLink is not affiliated with, sponsored by, or endorsed by
              Lichess.
            </p>

            <Separator />

            <div className="flex flex-col gap-1">
              <span className="font-medium">Board — “Brown”</span>
              <p className="text-muted">
                By the lila authors and pirouetti. Licensed AGPLv3 or later.
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <span className="font-medium">Pieces — “Maestro”</span>
              <p className="text-muted">
                By sadsnake1. Licensed{" "}
                <Link
                  href="https://creativecommons.org/licenses/by-nc-sa/4.0/"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  CC BY-NC-SA 4.0
                </Link>
                . Non-commercial use only.
              </p>
            </div>

            <p className="text-xs text-muted">
              Both sets were copied unmodified from the{" "}
              <Link
                href="https://github.com/lichess-org/lila"
                target="_blank"
                rel="noreferrer noopener"
              >
                lichess-org/lila
              </Link>{" "}
              repository. Full details are in THIRD_PARTY_NOTICES.md.
            </p>
          </Modal.Body>

          <Modal.Footer>
            <Button slot="close">Close</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
