import {useState} from "react";
import {
  Alert,
  Button,
  Description,
  Input,
  Label,
  Modal,
  Radio,
  RadioGroup,
  Spinner,
} from "@heroui/react";

import {
  DEFAULT_NAMES,
  type GameSpeed,
  type PieceColor,
} from "@shared/protocol";

import {ApiError, createRoom} from "@/lib/api";
import {errorCopy} from "@/lib/errorCopy";
import {mergeSeat, readLastName, writeLastName} from "@/lib/seatStorage";
import {navigate} from "@/router";

type SideChoice = PieceColor | "surprise";

const SIDES: Array<{value: SideChoice; label: string; hint: string}> = [
  {value: "white", label: "White", hint: "You move first"},
  {value: "black", label: "Black", hint: "They move first"},
  {value: "surprise", label: "Surprise me", hint: "We pick for you"},
];

const SPEEDS: Array<{value: GameSpeed; label: string; hint: string}> = [
  {value: "none", label: "No clock", hint: "Take your time"},
  {value: "10", label: "10 minutes", hint: "Each player"},
  {value: "30", label: "30 minutes", hint: "Each player"},
];

/**
 * Three questions, all pre-answered. Pressing "Create game" without touching
 * anything gives a perfectly good game.
 */
export function StartGameModal({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(readLastName() ?? DEFAULT_NAMES.host);
  const [side, setSide] = useState<SideChoice>("surprise");
  const [speed, setSpeed] = useState<GameSpeed>("none");
  const [isCreating, setIsCreating] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function handleCreate() {
    setIsCreating(true);
    setFailure(null);

    try {
      const room = await createRoom({displayName: name, side, speed});
      writeLastName(name);
      // Stored before navigating: if the room page reloads before the socket
      // opens, this is what proves the device owns the seat.
      mergeSeat(room.publicCode, {
        seatToken: room.seatToken,
        roomId: room.roomId,
        inviteSecret: room.inviteSecret,
      });
      navigate(
        `/room/${room.publicCode}#${encodeURIComponent(room.inviteSecret)}`,
      );
    } catch (error) {
      const copy = errorCopy(
        error instanceof ApiError ? error.code : "internal_error",
      );
      setFailure(`${copy.title}. ${copy.body}`);
      setIsCreating(false);
    }
  }

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[26rem]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>Start a game</Modal.Heading>
          </Modal.Header>

          <Modal.Body className="gap-5">
            {failure ? (
              <Alert status="danger">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>Could not start the game</Alert.Title>
                  <Alert.Description>{failure}</Alert.Description>
                </Alert.Content>
              </Alert>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="player-name">Your name</Label>
              <Input
                id="player-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={DEFAULT_NAMES.host}
                autoComplete="off"
              />
              <Description>Your friend sees this. Nothing is saved.</Description>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Choose your side</Label>
              <RadioGroup
                aria-label="Choose your side"
                value={side}
                onChange={(value) => setSide(value as SideChoice)}
              >
                {SIDES.map((option) => (
                  <Radio key={option.value} value={option.value}>
                    <Radio.Content>
                      <Radio.Control>
                        <Radio.Indicator />
                      </Radio.Control>
                      {option.label}
                    </Radio.Content>
                    <Description>{option.hint}</Description>
                  </Radio>
                ))}
              </RadioGroup>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Game speed</Label>
              <RadioGroup
                aria-label="Game speed"
                value={speed}
                onChange={(value) => setSpeed(value as GameSpeed)}
              >
                {SPEEDS.map((option) => (
                  <Radio key={option.value} value={option.value}>
                    <Radio.Content>
                      <Radio.Control>
                        <Radio.Indicator />
                      </Radio.Control>
                      {option.label}
                    </Radio.Content>
                    <Description>{option.hint}</Description>
                  </Radio>
                ))}
              </RadioGroup>
            </div>
          </Modal.Body>

          <Modal.Footer>
            <Button slot="close" variant="secondary" isDisabled={isCreating}>
              Cancel
            </Button>
            <Button isPending={isCreating} onPress={handleCreate}>
              {({isPending}) => (
                <>
                  {isPending ? <Spinner color="current" size="sm" /> : null}
                  Create game
                </>
              )}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
