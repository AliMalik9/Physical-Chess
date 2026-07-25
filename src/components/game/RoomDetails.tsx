import {Button, Separator} from "@heroui/react";
import {useState} from "react";

import {formatRoomCode} from "@shared/roomCode";

import {PieceColorDot} from "@/components/PieceColorDot";
import type {PieceColor, RoomSnapshot} from "@shared/protocol";

/**
 * Room metadata, kept behind a control rather than sitting on the game screen.
 * None of it helps you make a move, so none of it earns permanent space.
 */
export function RoomDetails({
  snapshot,
  code,
  inviteUrl,
}: {
  snapshot: RoomSnapshot;
  code: string;
  inviteUrl: string | null;
}) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  async function copy(value: string, kind: "code" | "link") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted">Game code</span>
        <div className="flex items-center justify-between gap-2">
          <span className="tabular text-lg font-semibold tracking-wide">
            {formatRoomCode(code)}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onPress={() => copy(formatRoomCode(code), "code")}
          >
            {copied === "code" ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>

      {inviteUrl ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Invite link</span>
          <p className="break-all rounded-md bg-default px-2 py-1.5 text-xs text-muted">
            {inviteUrl}
          </p>
          <Button
            size="sm"
            variant="secondary"
            onPress={() => copy(inviteUrl, "link")}
          >
            {copied === "link" ? "Link copied" : "Copy link"}
          </Button>
        </div>
      ) : null}

      <Separator />

      <div className="flex flex-col gap-2">
        <PlayerRow snapshot={snapshot} color="white" />
        <PlayerRow snapshot={snapshot} color="black" />
      </div>
    </div>
  );
}

function PlayerRow({
  snapshot,
  color,
}: {
  snapshot: RoomSnapshot;
  color: PieceColor;
}) {
  const player = snapshot[color];

  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="flex items-center gap-2">
        <PieceColorDot color={color} className="size-3" />
        <span className="capitalize text-muted">{color}</span>
      </span>
      <span className="flex items-center gap-2">
        <span className="truncate">{player?.displayName ?? "Empty seat"}</span>
        {player ? (
          <span
            className={`text-xs ${
              player.connected ? "text-success" : "text-warning"
            }`}
          >
            {player.connected ? "Here" : "Away"}
          </span>
        ) : null}
      </span>
    </div>
  );
}
