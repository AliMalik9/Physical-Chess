import {Button, Drawer, Popover, Tooltip} from "@heroui/react";
import {Check, Copy, ListOrdered, Settings, Share2} from "lucide-react";
import {useState} from "react";

import {formatRoomCode} from "@shared/roomCode";
import type {RoomSnapshot} from "@shared/protocol";

import {Wordmark} from "@/components/Wordmark";
import type {ConnectionStatus} from "@/hooks/useRoomConnection";
import type {GameSettings} from "@/hooks/useGameSettings";
import {MoveHistory} from "./MoveHistory";
import {RoomDetails} from "./RoomDetails";
import {SettingsSurface, type GameAction} from "./SettingsSurface";

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  offline: "Offline",
  closed: "Not connected",
};

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  connecting: "bg-muted",
  connected: "bg-success",
  reconnecting: "bg-warning animate-pulse",
  offline: "bg-warning",
  closed: "bg-danger",
};

/**
 * Compact by design: a wordmark, where you are, whether you are connected, and
 * two controls. No navigation, no account, no page title — the board is the
 * page.
 */
export function GameTopBar({
  snapshot,
  code,
  inviteUrl,
  status,
  settings,
  updateSettings,
  supportsHaptics,
  gameActions,
  isWide,
  onShowAttribution,
  onLeave,
}: {
  snapshot: RoomSnapshot;
  code: string;
  inviteUrl: string | null;
  status: ConnectionStatus;
  settings: GameSettings;
  updateSettings: (patch: Partial<GameSettings>) => void;
  supportsHaptics: boolean;
  gameActions: GameAction[];
  isWide: boolean;
  onShowAttribution: () => void;
  onLeave: () => void;
}) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const statusLabel = STATUS_TEXT[status];

  return (
    <header className="safe-top flex shrink-0 items-center justify-between gap-3 px-3 py-2.5 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <Wordmark showText={isWide} />

        <Popover>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Room ${formatRoomCode(code)}. Show room details.`}
          >
            <span className="tabular text-xs font-medium tracking-wide">
              {formatRoomCode(code)}
            </span>
          </Button>
          <Popover.Content className="w-[19rem] p-4">
            <RoomDetails snapshot={snapshot} code={code} inviteUrl={inviteUrl} />
          </Popover.Content>
        </Popover>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {/*
          Status is a dot *and* a label — never colour alone. The label is real
          text rather than an aria-label, which is prohibited on a generic
          element; it simply becomes visible once there is room for it.
        */}
        <span className="flex items-center gap-1.5 rounded-md px-1.5 py-1">
          <span
            aria-hidden="true"
            className={`size-2 rounded-full ${STATUS_COLOR[status]}`}
          />
          <span className="sr-only text-xs text-muted sm:not-sr-only">
            {`Connection: ${statusLabel}`}
          </span>
        </span>

        <ShareButton inviteUrl={inviteUrl} />

        <Tooltip delay={300}>
          <Button
            isIconOnly
            variant="ghost"
            aria-label="Move history"
            onPress={() => setIsHistoryOpen(true)}
          >
            <ListOrdered aria-hidden="true" className="size-[1.15rem]" />
          </Button>
          <Tooltip.Content>Move history</Tooltip.Content>
        </Tooltip>

        {/*
         * A Popover rather than a Dropdown: this surface holds switches, and a
         * menu whose items are toggles is the wrong role for assistive tech.
         * On narrow screens the same content becomes a Drawer.
         */}
        {isWide ? (
          <Popover isOpen={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
            <Button isIconOnly variant="ghost" aria-label="Settings">
              <Settings aria-hidden="true" className="size-[1.15rem]" />
            </Button>
            <Popover.Content className="w-[18rem] p-4">
              <SettingsSurface
                settings={settings}
                update={updateSettings}
                supportsHaptics={supportsHaptics}
                gameActions={gameActions}
                onShowAttribution={onShowAttribution}
                onLeave={onLeave}
                onClose={() => setIsSettingsOpen(false)}
              />
            </Popover.Content>
          </Popover>
        ) : (
          <Button
            isIconOnly
            variant="ghost"
            aria-label="Settings"
            onPress={() => setIsSettingsOpen(true)}
          >
            <Settings aria-hidden="true" className="size-[1.15rem]" />
          </Button>
        )}
      </div>

      {!isWide ? (
        <Drawer.Backdrop isOpen={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
          <Drawer.Content placement="bottom">
            <Drawer.Dialog>
              <Drawer.CloseTrigger />
              <Drawer.Header>
                <Drawer.Heading>Settings</Drawer.Heading>
              </Drawer.Header>
              <Drawer.Body className="safe-bottom">
                <SettingsSurface
                  settings={settings}
                  update={updateSettings}
                  supportsHaptics={supportsHaptics}
                  gameActions={gameActions}
                  onShowAttribution={onShowAttribution}
                  onLeave={onLeave}
                  onClose={() => setIsSettingsOpen(false)}
                />
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      ) : null}

      <Drawer.Backdrop isOpen={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <Drawer.Content placement={isWide ? "right" : "bottom"}>
          <Drawer.Dialog>
            <Drawer.CloseTrigger />
            <Drawer.Header>
              <Drawer.Heading>Moves</Drawer.Heading>
            </Drawer.Header>
            <Drawer.Body className="safe-bottom">
              <MoveHistory snapshot={snapshot} />
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </header>
  );
}

function ShareButton({inviteUrl}: {inviteUrl: string | null}) {
  const [copied, setCopied] = useState(false);
  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function handleShare() {
    if (!inviteUrl) return;

    if (canShare) {
      try {
        await navigator.share({title: "Play chess on BoardLink", url: inviteUrl});
        return;
      } catch (error) {
        // Dismissing the share sheet is not a failure; fall through to copying
        // only if sharing genuinely broke.
        if ((error as DOMException)?.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const label = canShare ? "Share invite link" : "Copy invite link";

  return (
    <Tooltip delay={300}>
      <Button
        isIconOnly
        variant="ghost"
        aria-label={label}
        isDisabled={!inviteUrl}
        onPress={handleShare}
      >
        {copied ? (
          <Check aria-hidden="true" className="size-[1.15rem] text-success" />
        ) : canShare ? (
          <Share2 aria-hidden="true" className="size-[1.15rem]" />
        ) : (
          <Copy aria-hidden="true" className="size-[1.15rem]" />
        )}
      </Button>
      <Tooltip.Content>{copied ? "Link copied" : label}</Tooltip.Content>
    </Tooltip>
  );
}
