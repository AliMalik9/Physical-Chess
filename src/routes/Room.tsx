import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Chess, type Square} from "chess.js";
import {AlertDialog, Button, Spinner, toast} from "@heroui/react";

import {isPromotionMove, legalTargets, toColor, tryMove} from "@shared/chessEngine";
import {announceMove} from "@shared/moveLanguage";
import type {
  ErrorCode,
  PieceColor,
  PieceSymbol,
  ResolveCodeResponse,
  SerializedMove,
} from "@shared/protocol";

import {Board, type BoardMove} from "@/components/board/Board";
import {BoardFrame} from "@/components/board/BoardFrame";
import {findKing, piecesFromFen} from "@/components/board/geometry";
import {PageShell} from "@/components/PageShell";
import {AttributionModal} from "@/components/game/AttributionModal";
import {GameTopBar} from "@/components/game/GameTopBar";
import {JoinConfirm} from "@/components/game/JoinConfirm";
import {PlayerStrip} from "@/components/game/PlayerStrip";
import {PromotionModal} from "@/components/game/PromotionModal";
import {SyncRecoveryModal} from "@/components/game/SyncRecoveryModal";
import {TurnPanel} from "@/components/game/TurnPanel";
import {WaitingOverlay} from "@/components/game/WaitingOverlay";
import type {GameAction} from "@/components/game/SettingsSurface";
import {useBoardAssets} from "@/hooks/useBoardAssets";
import {useFeedback} from "@/hooks/useFeedback";
import {useGameSettings} from "@/hooks/useGameSettings";
import {useMediaQuery} from "@/hooks/useMediaQuery";
import {useRoomConnection} from "@/hooks/useRoomConnection";
import {ApiError, inviteUrl, pgnUrl, resolveRoom} from "@/lib/api";
import {errorCopy} from "@/lib/errorCopy";
import {deriveView, opponentColorOf, playerName} from "@/lib/gameView";
import {readSeat, writeLastName} from "@/lib/seatStorage";
import {navigate, useInviteSecret} from "@/router";

export function Room({code}: {code: string}) {
  const isWide = useMediaQuery("(min-width: 1024px)");
  const inviteSecretFromUrl = useInviteSecret();
  const {settings, update: updateSettings} = useGameSettings();
  const {playTurnChime, vibrate} = useFeedback();
  const assets = useBoardAssets();

  // A device that already owns a seat reconnects straight away. A newcomer sees
  // the join confirmation first and only then opens a socket, so simply opening
  // a link never silently claims the second seat.
  const storedSeat = useMemo(() => readSeat(code), [code]);
  const [hasJoined, setHasJoined] = useState(Boolean(storedSeat?.seatToken));
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ResolveCodeResponse | null>(null);
  const [previewError, setPreviewError] = useState<ErrorCode | null>(null);

  const connection = useRoomConnection({
    code,
    inviteSecret: inviteSecretFromUrl ?? storedSeat?.inviteSecret ?? null,
    displayName,
    enabled: hasJoined,
  });
  const {snapshot, status, actions, lastEvent} = connection;

  /* ------------------------------ join preview ---------------------------- */

  useEffect(() => {
    if (hasJoined) return;
    let cancelled = false;

    void (async () => {
      try {
        const room = await resolveRoom(code);
        if (cancelled) return;
        if (!room.hasOpenSeat) {
          setPreviewError("room_full");
          return;
        }
        setPreview(room);
      } catch (error) {
        if (cancelled) return;
        setPreviewError(
          error instanceof ApiError ? error.code : "internal_error",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, hasJoined]);

  /* -------------------------------- state --------------------------------- */

  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<SerializedMove | null>(null);
  const [promotionDraft, setPromotionDraft] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [checkedSteps, setCheckedSteps] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState("");

  const [isSyncOpen, setIsSyncOpen] = useState(false);
  const [isAttributionOpen, setIsAttributionOpen] = useState(false);
  const [confirm, setConfirm] = useState<
    null | {kind: "resign" | "leave"; title: string; body: string}
  >(null);

  const myColor = snapshot?.you?.color ?? null;
  const isReadOnly = snapshot?.you?.isReadOnly ?? false;
  const view = snapshot && myColor ? deriveView(snapshot, myColor) : null;
  const opponentColor = myColor ? opponentColorOf(myColor) : null;

  const opponentName = useMemo(() => {
    if (!snapshot || !opponentColor) return "Your opponent";
    return playerName(snapshot, opponentColor, "Your opponent");
  }, [snapshot, opponentColor]);

  const isConnected = status === "connected";
  const canAct = isConnected && !isReadOnly;

  const orientation: PieceColor = useMemo(() => {
    const base = myColor ?? "white";
    if (settings.flipped === true) return base === "white" ? "black" : "white";
    return base;
  }, [myColor, settings.flipped]);

  const targets = useMemo(() => {
    if (!snapshot || !selectedSquare) return [];
    return legalTargets(snapshot.fen, selectedSquare);
  }, [snapshot, selectedSquare]);

  const selectedPiece = useMemo(() => {
    if (!snapshot || !selectedSquare) return null;
    return new Chess(snapshot.fen).get(selectedSquare as Square)?.type ?? null;
  }, [snapshot, selectedSquare]);

  const checkSquare = useMemo(() => {
    if (!snapshot?.inCheck) return null;
    return findKing(piecesFromFen(snapshot.fen), snapshot.turn);
  }, [snapshot]);

  const boardLastMove: BoardMove | null = useMemo(() => {
    const move = snapshot?.lastMove;
    if (!move) return null;

    if (!move.castle) return {from: move.from, to: move.to};

    // The rook moves too, so it has to travel with the king.
    const rank = move.color === "white" ? "1" : "8";
    return {
      from: move.from,
      to: move.to,
      rook:
        move.castle === "king"
          ? {from: `h${rank}`, to: `f${rank}`}
          : {from: `a${rank}`, to: `d${rank}`},
    };
  }, [snapshot?.lastMove]);

  // A new move means a fresh checklist; ticks must never carry over.
  useEffect(() => setCheckedSteps([]), [snapshot?.moveSequence]);

  /* --------------------------- inbound reactions --------------------------- */

  const wasReconnecting = useRef(false);
  useEffect(() => {
    if (status === "reconnecting" || status === "offline") {
      wasReconnecting.current = true;
      return;
    }
    if (status === "connected" && wasReconnecting.current) {
      wasReconnecting.current = false;
      toast("Back in the game.");
    }
  }, [status]);

  useEffect(() => {
    if (!lastEvent) return;
    const message = lastEvent.message;

    switch (message.type) {
      case "player_joined":
        toast(`${message.player.displayName} joined.`);
        break;

      case "move_received":
        setAnnouncement(announceMove(message.move, opponentName));
        if (settings.sound) playTurnChime();
        if (settings.haptics) vibrate(35);
        break;

      case "move_accepted":
        setIsBusy(false);
        setPendingMove(null);
        setSelectedSquare(null);
        if (settings.haptics) vibrate(15);
        break;

      case "move_rejected": {
        setIsBusy(false);
        const copy = errorCopy(message.code);
        // Announced, not focus-stealing: the player keeps their place.
        setAnnouncement(`${copy.title}. ${copy.body}`);
        toast(copy.title, {description: copy.body, variant: "danger"});
        setPendingMove(null);
        setSelectedSquare(null);
        break;
      }

      case "move_copied":
        setIsBusy(false);
        break;

      case "undo_resolved":
        setIsBusy(false);
        setPendingMove(null);
        setSelectedSquare(null);
        toast(
          message.accepted
            ? "The last move was taken back."
            : "The take-back was declined.",
        );
        break;

      case "game_completed":
        setPendingMove(null);
        setSelectedSquare(null);
        break;

      case "error": {
        const copy = errorCopy(message.code);
        setAnnouncement(`${copy.title}. ${copy.body}`);
        break;
      }

      default:
        break;
    }
  }, [lastEvent, opponentName, playTurnChime, settings, vibrate]);

  /* ------------------------------- handlers ------------------------------- */

  const beginMove = useCallback(
    (from: string, to: string) => {
      if (!snapshot) return;

      if (isPromotionMove(snapshot.fen, from, to)) {
        setPromotionDraft({from, to});
        return;
      }

      const attempt = tryMove({
        fen: snapshot.fen,
        from,
        to,
        sequence: snapshot.moveSequence + 1,
        playedAt: Date.now(),
      });

      if (!attempt) {
        const copy = errorCopy("illegal_move");
        setAnnouncement(`${copy.title}. ${copy.body}`);
        setSelectedSquare(null);
        return;
      }

      setPendingMove(attempt.move);
    },
    [snapshot],
  );

  const isMyTurn = view?.kind === "your_turn" && canAct && !pendingMove;

  const handleSquareActivate = useCallback(
    (square: string) => {
      if (!snapshot || !myColor || !isMyTurn) return;

      if (selectedSquare === square) {
        setSelectedSquare(null);
        return;
      }

      if (selectedSquare && targets.includes(square)) {
        beginMove(selectedSquare, square);
        return;
      }

      const piece = new Chess(snapshot.fen).get(square as Square);
      setSelectedSquare(
        piece && toColor(piece.color) === myColor ? square : null,
      );
    },
    [beginMove, isMyTurn, myColor, selectedSquare, snapshot, targets],
  );

  const handleDragMove = useCallback(
    (from: string, to: string) => {
      if (!snapshot || !isMyTurn) return;
      if (!legalTargets(snapshot.fen, from).includes(to)) {
        setSelectedSquare(from);
        return;
      }
      beginMove(from, to);
    },
    [beginMove, isMyTurn, snapshot],
  );

  const handleSend = useCallback(() => {
    if (!pendingMove) return;
    setIsBusy(true);
    actions.submitMove(
      pendingMove.from,
      pendingMove.to,
      pendingMove.promotion as PieceSymbol | undefined,
    );
  }, [actions, pendingMove]);

  const handleConfirmCopied = useCallback(() => {
    if (!snapshot) return;
    setIsBusy(true);
    actions.confirmMoveCopied(snapshot.moveSequence);
  }, [actions, snapshot]);

  const handleChoosePromotion = useCallback(
    (piece: PieceSymbol) => {
      if (!snapshot || !promotionDraft) return;

      const attempt = tryMove({
        fen: snapshot.fen,
        from: promotionDraft.from,
        to: promotionDraft.to,
        promotion: piece,
        sequence: snapshot.moveSequence + 1,
        playedAt: Date.now(),
      });

      setPromotionDraft(null);
      if (attempt) setPendingMove(attempt.move);
      else setSelectedSquare(null);
    },
    [promotionDraft, snapshot],
  );

  const handleJoin = useCallback((name: string) => {
    writeLastName(name);
    setDisplayName(name);
    setHasJoined(true);
  }, []);

  const seatToken = readSeat(code)?.seatToken ?? null;
  const inviteSecret = inviteSecretFromUrl ?? storedSeat?.inviteSecret ?? null;
  const shareUrl = inviteSecret ? inviteUrl(code, inviteSecret) : null;

  const handleDownloadPgn = useCallback(async () => {
    if (!seatToken) return;
    try {
      const response = await fetch(pgnUrl(code, seatToken));
      if (!response.ok) throw new Error(String(response.status));

      // Saved as a blob rather than navigated to: a plain navigation would
      // leave the game, and a failure would show a raw server response.
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `boardlink-${code}.pgn`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      toast("Could not download the game", {
        description: "Use Copy game instead, then paste it somewhere safe.",
        variant: "danger",
      });
    }
  }, [code, seatToken]);

  const handleCopyGame = useCallback(async () => {
    if (!snapshot) return;
    try {
      await navigator.clipboard.writeText(snapshot.pgn);
      toast("Game copied.");
    } catch {
      toast("Could not copy the game", {
        description: "Your browser blocked copying. Use Download PGN instead.",
        variant: "danger",
      });
    }
  }, [snapshot]);

  const gameActions = useMemo<GameAction[]>(() => {
    if (snapshot?.status !== "active") return [];
    return [
      {
        label: "Request take-back",
        onPress: () => actions.requestUndo(snapshot.moveSequence),
        isDisabled: !canAct || snapshot.moveSequence === 0,
      },
      {
        label: "Offer a draw",
        onPress: () => actions.offerDraw(),
        isDisabled: !canAct,
      },
      {label: "Boards don’t match", onPress: () => setIsSyncOpen(true)},
      {
        label: "Resign",
        onPress: () =>
          setConfirm({
            kind: "resign",
            title: "Resign this game?",
            body: `${opponentName} wins straight away. This cannot be undone.`,
          }),
        isDisabled: !canAct,
        isDestructive: true,
      },
    ];
  }, [actions, canAct, opponentName, snapshot]);

  const handleLeave = useCallback(() => {
    setConfirm({
      kind: "leave",
      title: "Leave this game?",
      body: "The game stays open. You can come back with the same link.",
    });
  }, []);

  /* ------------------------------- rendering ------------------------------ */

  if (previewError || connection.fatalError) {
    const copy = errorCopy(previewError ?? connection.fatalError!);
    return (
      <PageShell maxWidth="24rem">
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="text-muted">{copy.body}</p>
        </div>
        <Button
          size="lg"
          onPress={() =>
            connection.fatalError === "read_only_connection"
              ? window.location.reload()
              : navigate("/")
          }
        >
          {copy.action ?? "Start a new game"}
        </Button>
      </PageShell>
    );
  }

  if (!hasJoined) {
    return preview ? (
      <JoinConfirm
        hostName={preview.hostName}
        onJoin={handleJoin}
        isJoining={false}
      />
    ) : (
      <LoadingScreen label="Finding the game" />
    );
  }

  if (!snapshot || !myColor || !view || !assets.isReady) {
    if (assets.hasFailed) {
      return (
        <PageShell maxWidth="24rem">
          <div className="flex flex-col gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              The board could not load
            </h1>
            <p className="text-muted">
              Check your connection, then reload to try again.
            </p>
          </div>
          <Button size="lg" onPress={() => window.location.reload()}>
            Reload
          </Button>
        </PageShell>
      );
    }
    return <LoadingScreen label="Preparing the board" />;
  }

  const isWaiting = view.kind === "waiting_for_opponent";

  const board = (
    <div className="relative">
      <Board
        fen={snapshot.fen}
        orientation={orientation}
        movableColor={isMyTurn ? myColor : null}
        selectedSquare={selectedSquare}
        legalTargets={pendingMove ? [] : targets}
        lastMove={boardLastMove}
        checkSquare={checkSquare}
        showCoordinates={settings.coordinates}
        animateMoves={settings.animations}
        onSquareActivate={handleSquareActivate}
        onDragMove={handleDragMove}
      />
      {isWaiting ? <WaitingOverlay code={code} inviteUrl={shareUrl} /> : null}
    </div>
  );

  const strips = {
    top: (
      <PlayerStrip
        snapshot={snapshot}
        color={orientation === "white" ? "black" : "white"}
        myColor={myColor}
        view={view}
      />
    ),
    bottom: (
      <PlayerStrip
        snapshot={snapshot}
        color={orientation}
        myColor={myColor}
        view={view}
      />
    ),
  };

  const panel = (
    <TurnPanel
      view={view}
      snapshot={snapshot}
      opponentName={opponentName}
      pendingMove={pendingMove}
      selectedSquare={selectedSquare}
      selectedPiece={selectedPiece}
      checkedSteps={checkedSteps}
      isBusy={isBusy}
      isConnected={canAct}
      onSend={handleSend}
      onChangeMove={() => {
        setPendingMove(null);
        setSelectedSquare(null);
      }}
      onClearSelection={() => setSelectedSquare(null)}
      onConfirmCopied={handleConfirmCopied}
      onStepsChange={setCheckedSteps}
      onReportMismatch={() => setIsSyncOpen(true)}
      onPlayAgain={() => navigate("/")}
      onDownloadPgn={handleDownloadPgn}
      onCopyGame={handleCopyGame}
      onLeave={handleLeave}
    />
  );

  return (
    <div className="app-frame flex flex-col bg-background text-foreground">
      <GameTopBar
        snapshot={snapshot}
        code={code}
        inviteUrl={shareUrl}
        status={status}
        settings={settings}
        updateSettings={updateSettings}
        supportsHaptics={
          typeof navigator !== "undefined" && "vibrate" in navigator
        }
        gameActions={gameActions}
        isWide={isWide}
        onShowAttribution={() => setIsAttributionOpen(true)}
        onLeave={handleLeave}
      />

      {/*
       * Responsive contract:
       *   >= 1024px  board fills the height, 360px contextual panel beside it
       *   <  1024px  board first, action panel pinned under it in thumb reach
       */}
      <main className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-2 lg:flex-row lg:items-stretch lg:gap-6 lg:px-6 lg:pb-5">
        <BoardFrame top={strips.top} bottom={strips.bottom}>
          {board}
        </BoardFrame>

        <aside
          className={
            isWide
              ? "flex w-[22rem] shrink-0 flex-col justify-center py-2 xl:w-[24rem]"
              : "safe-bottom shrink-0 overflow-y-auto"
          }
          style={isWide ? undefined : {maxHeight: "42dvh"}}
        >
          {panel}
        </aside>
      </main>

      {/* Opponent moves are announced politely, never stealing focus. */}
      <p id="boardlink-announcer" aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>

      <PromotionModal
        isOpen={promotionDraft !== null}
        color={myColor}
        onChoose={handleChoosePromotion}
        onCancel={() => {
          setPromotionDraft(null);
          setSelectedSquare(null);
        }}
      />

      <SyncRecoveryModal
        isOpen={isSyncOpen}
        onOpenChange={setIsSyncOpen}
        snapshot={snapshot}
        onRequestUndo={() => actions.requestUndo(snapshot.moveSequence)}
        canRequestUndo={canAct && snapshot.moveSequence > 0}
      />

      <AttributionModal
        isOpen={isAttributionOpen}
        onOpenChange={setIsAttributionOpen}
      />

      <ConfirmDialog
        isOpen={
          snapshot.pendingUndo !== null &&
          snapshot.pendingUndo.requestedBy !== myColor
        }
        title={`${opponentName} wants to take back the last move.`}
        body="If you agree, put the pieces back the way they were before that move."
        confirmLabel="Allow take-back"
        cancelLabel="Keep the move"
        onConfirm={() => actions.respondToUndo(true)}
        onCancel={() => actions.respondToUndo(false)}
      />

      <ConfirmDialog
        isOpen={
          snapshot.pendingDraw !== null &&
          snapshot.pendingDraw.offeredBy !== myColor
        }
        title={`${opponentName} offers a draw.`}
        body="A draw ends the game with no winner."
        confirmLabel="Accept draw"
        cancelLabel="Keep playing"
        onConfirm={() => actions.respondToDraw(true)}
        onCancel={() => actions.respondToDraw(false)}
      />

      <ConfirmDialog
        isOpen={confirm !== null}
        title={confirm?.title ?? ""}
        body={confirm?.body ?? ""}
        confirmLabel={confirm?.kind === "resign" ? "Resign" : "Leave"}
        cancelLabel={confirm?.kind === "resign" ? "Keep playing" : "Stay"}
        isDestructive={confirm?.kind === "resign"}
        onConfirm={() => {
          if (confirm?.kind === "resign") actions.resign();
          else {
            actions.leave();
            navigate("/");
          }
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function LoadingScreen({label}: {label: string}) {
  return (
    <div className="app-frame flex flex-col items-center justify-center gap-4 bg-background text-foreground">
      {/* Board-shaped, so the layout does not jump when the real board arrives. */}
      <div className="aspect-square w-[min(22rem,70vw)] animate-pulse rounded-lg bg-default" />
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner size="sm" />
        {label}
      </div>
    </div>
  );
}

function ConfirmDialog({
  isOpen,
  title,
  body,
  confirmLabel,
  cancelLabel,
  isDestructive,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog.Backdrop
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialog.Container>
        <AlertDialog.Dialog className="sm:max-w-[26rem]">
          <AlertDialog.Header>
            <AlertDialog.Icon status={isDestructive ? "danger" : "accent"} />
            <AlertDialog.Heading>{title}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p>{body}</p>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button slot="close" variant="secondary" onPress={onCancel}>
              {cancelLabel}
            </Button>
            <Button
              slot="close"
              variant={isDestructive ? "danger" : "primary"}
              onPress={onConfirm}
            >
              {confirmLabel}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}
