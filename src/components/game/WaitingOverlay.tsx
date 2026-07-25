import {Button, Separator, Spinner} from "@heroui/react";
import {useState} from "react";

import {formatRoomCode} from "@shared/roomCode";

/**
 * The invite panel, floating over the board rather than replacing it.
 *
 * Kept compact so the board stays visible behind it: the first thing a new
 * player should understand is that this product is about that board.
 */
export function WaitingOverlay({
  code,
  inviteUrl,
}: {
  code: string;
  inviteUrl: string | null;
}) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function handleShare() {
    if (!inviteUrl) return;
    try {
      await navigator.share({
        title: "Play chess with me on BoardLink",
        url: inviteUrl,
      });
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") return;
      setFeedback("Sharing is not available here. Use Copy link instead.");
    }
  }

  async function handleCopy() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setFeedback("Link copied.");
      window.setTimeout(() => setFeedback(null), 2500);
    } catch {
      setFeedback("Your browser blocked copying. Select the link and copy it.");
    }
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
      <div className="pointer-events-auto w-full max-w-[22rem] rounded-2xl border border-border bg-overlay p-5 shadow-[var(--overlay-shadow)]">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-xl font-semibold tracking-tight">
              Invite someone to play
            </h2>
            <p className="text-sm text-muted">
              They do not need an account. Anyone with this link can take the
              other seat.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">Game code</span>
            <span className="tabular text-2xl font-semibold tracking-wide">
              {formatRoomCode(code)}
            </span>
          </div>

          <Separator />

          <div className="flex flex-col gap-2">
            {canShare ? (
              <Button size="lg" isDisabled={!inviteUrl} onPress={handleShare}>
                Share invite
              </Button>
            ) : null}
            <Button
              size="lg"
              variant={canShare ? "secondary" : "primary"}
              isDisabled={!inviteUrl}
              onPress={handleCopy}
            >
              Copy link
            </Button>
          </div>

          {feedback ? (
            <p className="text-center text-xs text-muted" role="status">
              {feedback}
            </p>
          ) : null}

          <div
            className="flex items-center justify-center gap-2 text-sm text-muted"
            role="status"
          >
            <Spinner size="sm" />
            Waiting for the other player…
          </div>
        </div>
      </div>
    </div>
  );
}
