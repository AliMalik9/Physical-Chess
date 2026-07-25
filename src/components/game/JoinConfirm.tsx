import {useState} from "react";
import {Button, Description, Input, Label, Spinner} from "@heroui/react";

import {DEFAULT_NAMES} from "@shared/protocol";

import {PageShell} from "@/components/PageShell";
import {readLastName} from "@/lib/seatStorage";

/**
 * The whole sign-up flow: one question, already answered.
 *
 * The guest is never asked which colour they want — the other seat is the only
 * one left, so asking would be a decision with one possible answer.
 */
export function JoinConfirm({
  hostName,
  onJoin,
  isJoining,
}: {
  hostName: string | null;
  onJoin: (displayName: string) => void;
  isJoining: boolean;
}) {
  const [name, setName] = useState(readLastName() ?? DEFAULT_NAMES.guest);

  return (
    <PageShell maxWidth="24rem">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          {hostName ? `Join ${hostName}’s game?` : "Join this game?"}
        </h1>
        <p className="text-muted">
          You will need your own chessboard, set up ready to play.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="guest-name">Your name</Label>
        <Input
          id="guest-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onJoin(name);
          }}
          placeholder={DEFAULT_NAMES.guest}
          autoComplete="off"
        />
        <Description>{`${hostName ?? "The other player"} sees this.`}</Description>
      </div>

      <Button size="lg" isPending={isJoining} onPress={() => onJoin(name)}>
        {({isPending}) => (
          <>
            {isPending ? <Spinner color="current" size="sm" /> : null}
            Join game
          </>
        )}
      </Button>
    </PageShell>
  );
}
