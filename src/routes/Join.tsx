import {useState} from "react";
import {Alert, Button, Description, Input, Label, Spinner} from "@heroui/react";

import {extractRoomCode, formatRoomCode} from "@shared/roomCode";

import {AppLink} from "@/components/AppLink";
import {PageShell} from "@/components/PageShell";
import {ApiError, resolveRoom} from "@/lib/api";
import {errorCopy, type ErrorCopy} from "@/lib/errorCopy";
import {navigate} from "@/router";

export function Join() {
  const [value, setValue] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [problem, setProblem] = useState<ErrorCopy | null>(null);

  async function handleJoin() {
    // Accepts a bare code or a pasted invite URL, with any spacing or hyphens.
    const code = extractRoomCode(value);
    if (!code) {
      setProblem(errorCopy("invalid_code"));
      return;
    }

    setIsChecking(true);
    setProblem(null);

    try {
      const room = await resolveRoom(code);
      if (!room.hasOpenSeat) {
        setProblem(errorCopy("room_full"));
        setIsChecking(false);
        return;
      }
      navigate(`/room/${code}`);
    } catch (error) {
      setProblem(
        errorCopy(error instanceof ApiError ? error.code : "internal_error"),
      );
      setIsChecking(false);
    }
  }

  return (
    <PageShell maxWidth="26rem">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Join a game</h1>
        <p className="text-muted">Type the code your friend gave you.</p>
      </div>

      <div className="flex flex-col gap-4">
        {problem ? (
          <Alert status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{problem.title}</Alert.Title>
              <Alert.Description>{problem.body}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="room-code">Game code</Label>
          <Input
            id="room-code"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (problem) setProblem(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleJoin();
            }}
            placeholder="ABCD-EFGH"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="tabular text-center text-lg tracking-[0.18em] uppercase"
          />
          <Description>
            {value.trim()
              ? `Joining: ${formatRoomCode(value) || "—"}`
              : "Eight letters and numbers. Spaces and dashes are fine."}
          </Description>
        </div>

        <Button size="lg" isPending={isChecking} onPress={handleJoin}>
          {({isPending}) => (
            <>
              {isPending ? <Spinner color="current" size="sm" /> : null}
              Join game
            </>
          )}
        </Button>
      </div>

      <p className="text-center text-sm">
        <AppLink href="/">Start a new game</AppLink>
      </p>
    </PageShell>
  );
}
