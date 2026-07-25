import {Alert, Button, Checkbox, Separator, Spinner} from "@heroui/react";

import {describeMove, formatSquare, pieceName} from "@shared/moveLanguage";
import type {PieceSymbol, RoomSnapshot, SerializedMove} from "@shared/protocol";

import {PieceIcon} from "@/components/PieceIcon";
import {resultReasonText, resultSentence, type PlayView} from "@/lib/gameView";
import {MoveInstruction} from "./MoveInstruction";

export interface TurnPanelProps {
  view: PlayView;
  snapshot: RoomSnapshot;
  opponentName: string;
  /** The move being confirmed before it is sent, if any. */
  pendingMove: SerializedMove | null;
  selectedSquare: string | null;
  selectedPiece: PieceSymbol | null;
  checkedSteps: string[];
  isBusy: boolean;
  isConnected: boolean;
  onSend: () => void;
  onChangeMove: () => void;
  onClearSelection: () => void;
  onConfirmCopied: () => void;
  onStepsChange: (steps: string[]) => void;
  onReportMismatch: () => void;
  onPlayAgain: () => void;
  onDownloadPgn: () => void;
  onCopyGame: () => void;
  onLeave: () => void;
}

/**
 * The one contextual surface beside the board.
 *
 * Every state resolves to: a small label, one heading, one short instruction,
 * optional move detail, then exactly one dominant action. Nothing else competes
 * for attention, which is what makes the next step obvious without a tutorial.
 */
export function TurnPanel(props: TurnPanelProps) {
  const {view, isConnected} = props;

  return (
    <section className="flex h-full min-h-0 flex-col gap-5" aria-live="off">
      {!isConnected ? (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Trying to reconnect…</Alert.Title>
            <Alert.Description>
              Your game is safe. Nothing is lost while you are away.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {view.kind === "waiting_for_opponent" ? (
        <WaitingForOpponent />
      ) : view.kind === "game_over" ? (
        <GameOver {...props} />
      ) : props.pendingMove ? (
        <ConfirmMove {...props} pendingMove={props.pendingMove} />
      ) : view.kind === "copy_move" ? (
        <CopyMove {...props} move={view.move} />
      ) : view.kind === "move_sent" ? (
        <MoveSent {...props} move={view.move} />
      ) : view.kind === "your_turn" ? (
        <YourTurn {...props} />
      ) : (
        <OpponentTurn {...props} />
      )}
    </section>
  );
}

function StateLabel({children}: {children: string}) {
  return (
    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
      {children}
    </span>
  );
}

function Heading({children}: {children: string}) {
  return (
    <h2 className="text-2xl font-semibold tracking-tight text-balance">
      {children}
    </h2>
  );
}

/* -------------------------------------------------------------------------- */
/* Waiting for someone to join                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Deliberately sparse: the invite panel is already sitting over the board, and
 * repeating it here would give the screen two competing primary actions.
 */
function WaitingForOpponent() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <StateLabel>Waiting</StateLabel>
        <Heading>Nobody has joined yet</Heading>
        <p className="text-pretty text-muted">
          Send the invite. The game starts the moment they open it.
        </p>
      </div>
      <div className="flex-1" />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* State A — your turn                                                        */
/* -------------------------------------------------------------------------- */

function YourTurn({
  selectedSquare,
  selectedPiece,
  snapshot,
  onClearSelection,
}: TurnPanelProps) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <StateLabel>Your turn</StateLabel>
        <Heading>Make your move</Heading>
        <p className="text-pretty text-muted">
          {selectedSquare
            ? "Now tap the square you moved it to."
            : "Move a piece on your real board, then enter the same move here."}
        </p>
      </div>

      {snapshot.inCheck ? (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Your king is in check</Alert.Title>
          </Alert.Content>
        </Alert>
      ) : null}

      <div className="flex-1" />

      {selectedSquare && selectedPiece ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5 text-sm">
            <PieceIcon
              color={snapshot.turn}
              type={selectedPiece}
              className="size-7"
            />
            <span>
              <span className="capitalize">{snapshot.turn}</span>{" "}
              {pieceName(selectedPiece)} selected on{" "}
              <span className="tabular font-medium">
                {formatSquare(selectedSquare)}
              </span>
            </span>
          </div>
          <Button fullWidth variant="secondary" size="lg" onPress={onClearSelection}>
            Choose another piece
          </Button>
        </div>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Move selected — confirm before sending                                      */
/* -------------------------------------------------------------------------- */

function ConfirmMove({
  pendingMove,
  isBusy,
  isConnected,
  onSend,
  onChangeMove,
}: TurnPanelProps & {pendingMove: SerializedMove}) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <StateLabel>Check it</StateLabel>
        <Heading>Send this move?</Heading>
      </div>

      <MoveInstruction move={pendingMove} perspective="actor" />

      <div className="flex-1" />

      <div className="flex flex-col gap-2">
        {/* Nothing is sent on the second tap. A mis-tap beside a real board is
            the easiest way to desynchronise two physical positions. */}
        <Button
          fullWidth
          size="lg"
          isPending={isBusy}
          isDisabled={!isConnected}
          onPress={onSend}
        >
          {({isPending}) => (
            <>
              {isPending ? <Spinner color="current" size="sm" /> : null}
              Send move
            </>
          )}
        </Button>
        <Button
          fullWidth
          variant="secondary"
          size="lg"
          isDisabled={isBusy}
          onPress={onChangeMove}
        >
          Change move
        </Button>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* State B — move sent                                                         */
/* -------------------------------------------------------------------------- */

function MoveSent({
  move,
  opponentName,
  snapshot,
}: TurnPanelProps & {move: SerializedMove}) {
  const opponentColor = move.color === "white" ? "black" : "white";
  const isOpponentHere = snapshot[opponentColor]?.connected ?? false;

  return (
    <>
      <div className="flex flex-col gap-2">
        <StateLabel>Sent</StateLabel>
        <Heading>Move sent</Heading>
        <p className="text-pretty text-muted">
          {`Waiting for ${opponentName} to copy it onto their board.`}
        </p>
      </div>

      <MoveInstruction move={move} perspective="actor" size="sm" />

      <div className="flex-1" />

      {/* A quiet live indicator, not a spinner: nothing is loading. Someone is
          picking up a piece. */}
      <div className="flex items-center gap-2 text-sm text-muted">
        <span
          aria-hidden="true"
          className={`size-2 rounded-full ${
            isOpponentHere ? "animate-pulse bg-accent" : "bg-warning"
          }`}
        />
        {isOpponentHere
          ? `${opponentName} is here`
          : `${opponentName} is not connected. Your move is saved.`}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* State C — copy the opponent's move                                          */
/* -------------------------------------------------------------------------- */

function CopyMove({
  move,
  opponentName,
  checkedSteps,
  isBusy,
  isConnected,
  onConfirmCopied,
  onStepsChange,
  onReportMismatch,
}: TurnPanelProps & {move: SerializedMove}) {
  const instruction = describeMove(move, "copier");
  const needsChecklist = instruction.requiresMultipleActions;
  const allChecked = checkedSteps.length === instruction.steps.length;
  const canConfirm = isConnected && (!needsChecklist || allChecked);

  return (
    <>
      <div className="flex flex-col gap-2">
        <StateLabel>Their move</StateLabel>
        <Heading>{`${opponentName} moved`}</Heading>
      </div>

      <MoveInstruction move={move} perspective="copier" />

      {needsChecklist ? (
        <div className="flex flex-col gap-2">
          <Separator />
          <p className="text-sm text-muted">
            This move needs more than one piece moved.
          </p>
          <div className="flex flex-col gap-2">
            {instruction.steps.map((step, index) => (
              <Checkbox
                key={step.id}
                isSelected={checkedSteps.includes(step.id)}
                onChange={(isSelected) =>
                  onStepsChange(
                    isSelected
                      ? [...checkedSteps, step.id]
                      : checkedSteps.filter((id) => id !== step.id),
                  )
                }
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <span className="text-sm">{`${index + 1}. ${step.text}`}</span>
                </Checkbox.Content>
              </Checkbox>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex-1" />

      <div className="flex flex-col gap-2">
        <Button
          fullWidth
          size="lg"
          isPending={isBusy}
          isDisabled={!canConfirm}
          onPress={onConfirmCopied}
        >
          {({isPending}) => (
            <>
              {isPending ? <Spinner color="current" size="sm" /> : null}
              Done — I moved it
            </>
          )}
        </Button>
        <p className="text-center text-xs text-muted">
          {needsChecklist && !allChecked
            ? "Tick every step above to turn on this button."
            : "Copy this move onto your real board first."}
        </p>
        <Button fullWidth variant="ghost" size="sm" onPress={onReportMismatch}>
          Boards don’t match
        </Button>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Opponent thinking                                                           */
/* -------------------------------------------------------------------------- */

function OpponentTurn({opponentName, snapshot}: TurnPanelProps) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <StateLabel>Waiting</StateLabel>
        <Heading>{`${opponentName}’s turn`}</Heading>
        <p className="text-pretty text-muted">
          They are making a move on their board. Nothing to do yet.
        </p>
      </div>

      {snapshot.lastMove ? (
        <>
          <Separator />
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Last move</span>
            <MoveInstruction
              move={snapshot.lastMove}
              perspective="actor"
              size="sm"
            />
          </div>
        </>
      ) : null}

      <div className="flex-1" />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Game over                                                                   */
/* -------------------------------------------------------------------------- */

function GameOver({
  snapshot,
  onPlayAgain,
  onDownloadPgn,
  onCopyGame,
  onLeave,
}: TurnPanelProps) {
  const result = snapshot.result;
  if (!result) return null;

  const headline =
    result.reason === "checkmate"
      ? "Checkmate"
      : result.winner
        ? "Game over"
        : "Draw";

  return (
    <>
      <div className="flex flex-col gap-2">
        <StateLabel>Finished</StateLabel>
        <Heading>{headline}</Heading>
        <p className="text-lg font-medium">{resultSentence(result, snapshot)}</p>
        <p className="text-sm text-muted">{resultReasonText(result)}</p>
      </div>

      <div className="flex-1" />

      <div className="flex flex-col gap-2">
        <Button fullWidth size="lg" onPress={onPlayAgain}>
          Play again
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onPress={onDownloadPgn}>
            Download PGN
          </Button>
          <Button variant="secondary" className="flex-1" onPress={onCopyGame}>
            Copy game
          </Button>
        </div>
        <Button fullWidth variant="ghost" size="sm" onPress={onLeave}>
          Leave room
        </Button>
      </div>
    </>
  );
}
