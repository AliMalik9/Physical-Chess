import {useCallback, useEffect, useMemo, useRef, useState} from "react";

import {
  LIMITS,
  PROTOCOL_VERSION,
  type ClientEventBody,
  type ErrorCode,
  type PieceSymbol,
  type RoomSnapshot,
  type ServerMessage,
} from "@shared/protocol";

import {socketUrl} from "@/lib/api";
import {applyServerEvent} from "@/lib/snapshotReducer";
import {mergeSeat, readSeat} from "@/lib/seatStorage";

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
  | "closed";

/** Failures that mean retrying will never help, so the socket gives up. */
const FATAL_CODES: ReadonlySet<ErrorCode> = new Set([
  "room_not_found",
  "room_expired",
  "room_full",
  "invalid_invite",
  "invalid_code",
  "protocol_mismatch",
  "not_a_player",
]);

const BASE_RETRY_MS = 600;
const MAX_RETRY_MS = 8_000;

export interface InboundEvent {
  /** Monotonic, so effects can react to repeats of the same event type. */
  id: number;
  message: ServerMessage;
}

export interface RoomActions {
  submitMove(from: string, to: string, promotion?: PieceSymbol): void;
  confirmMoveCopied(sequence: number): void;
  requestUndo(targetSequence: number): void;
  respondToUndo(accept: boolean): void;
  offerDraw(): void;
  respondToDraw(accept: boolean): void;
  resign(): void;
  leave(): void;
}

export interface RoomConnection {
  status: ConnectionStatus;
  snapshot: RoomSnapshot | null;
  /** Stops the game. Rendered as a full-screen explanation. */
  fatalError: ErrorCode | null;
  /** Recoverable; rendered as a toast or inline note. */
  transientError: ErrorCode | null;
  clearTransientError(): void;
  lastEvent: InboundEvent | null;
  /** True once an authoritative snapshot has arrived at least once. */
  isReady: boolean;
  actions: RoomActions;
}

function newActionId(): string {
  return crypto.randomUUID();
}

export function useRoomConnection(options: {
  code: string;
  inviteSecret: string | null;
  displayName: string | null;
  enabled: boolean;
}): RoomConnection {
  const {code, inviteSecret, displayName, enabled} = options;

  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [fatalError, setFatalError] = useState<ErrorCode | null>(null);
  const [transientError, setTransientError] = useState<ErrorCode | null>(null);
  const [lastEvent, setLastEvent] = useState<InboundEvent | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const eventCounterRef = useRef(0);
  const closedByUsRef = useRef(false);

  // Kept in refs so reconnecting never re-runs the connect effect and tears
  // down a healthy socket just because the player renamed themselves.
  const joinRef = useRef({inviteSecret, displayName});
  joinRef.current = {inviteSecret, displayName};

  const send = useCallback((body: ClientEventBody) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;

    socket.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        roomId: "",
        eventId: newActionId(),
        ts: Date.now(),
        ...body,
      }),
    );
    return true;
  }, []);

  useEffect(() => {
    if (!enabled || !code) return;

    let disposed = false;
    closedByUsRef.current = false;

    const clearTimers = () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (heartbeatTimerRef.current !== null) {
        window.clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed || closedByUsRef.current) return;

      if (!navigator.onLine) {
        setStatus("offline");
        return;
      }

      const attempt = retryCountRef.current;
      retryCountRef.current = attempt + 1;
      // Exponential with jitter, so two players dropped by the same flaky
      // network do not stampede back at the same instant.
      const delay = Math.min(BASE_RETRY_MS * 2 ** attempt, MAX_RETRY_MS);
      const jitter = Math.random() * 0.3 * delay;

      retryTimerRef.current = window.setTimeout(() => connect(), delay + jitter);
    };

    const connect = () => {
      if (disposed) return;

      setStatus((current) =>
        current === "connected" ? "reconnecting" : current,
      );

      let socket: WebSocket;
      try {
        socket = new WebSocket(socketUrl(code));
      } catch {
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (disposed) return;
        retryCountRef.current = 0;
        setStatus("connected");

        const stored = readSeat(code);
        const secret = joinRef.current.inviteSecret ?? stored?.inviteSecret;

        // Always a join, never a bare resume: the server decides whether this
        // device already owns a seat, and answers with a full snapshot either
        // way. The client never assumes what it was.
        send({
          type: "join_room",
          actionId: newActionId(),
          ...(stored?.seatToken ? {seatToken: stored.seatToken} : {}),
          ...(secret ? {inviteSecret: secret} : {}),
          ...(joinRef.current.displayName
            ? {displayName: joinRef.current.displayName}
            : {}),
        });

        heartbeatTimerRef.current = window.setInterval(() => {
          send({type: "heartbeat"});
        }, LIMITS.heartbeatIntervalMs);
      });

      socket.addEventListener("message", (event) => {
        if (disposed || typeof event.data !== "string") return;

        let message: ServerMessage;
        try {
          message = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }

        eventCounterRef.current += 1;
        setLastEvent({id: eventCounterRef.current, message});

        if (message.type === "room_snapshot" && message.seatToken) {
          // First snapshot after a seat is granted. Persisting it here is what
          // makes a refresh keep the same side of the board.
          mergeSeat(code, {
            seatToken: message.seatToken,
            ...(joinRef.current.inviteSecret
              ? {inviteSecret: joinRef.current.inviteSecret}
              : {}),
          });
        }

        if (message.type === "error" || message.type === "move_rejected") {
          if (FATAL_CODES.has(message.code)) {
            closedByUsRef.current = true;
            setFatalError(message.code);
            socket.close();
            return;
          }
          setTransientError(message.code);
        }

        setSnapshot((current) => applyServerEvent(current, message));
      });

      const handleGone = () => {
        if (disposed) return;
        if (heartbeatTimerRef.current !== null) {
          window.clearInterval(heartbeatTimerRef.current);
          heartbeatTimerRef.current = null;
        }
        if (closedByUsRef.current) {
          setStatus("closed");
          return;
        }
        setStatus("reconnecting");
        scheduleReconnect();
      };

      socket.addEventListener("close", handleGone);
      socket.addEventListener("error", handleGone);
    };

    // A phone coming off standby, a tab returning to the foreground, or a
    // switch from wifi to mobile data all land here. Reconnect immediately
    // instead of waiting out the backoff.
    const revive = () => {
      if (disposed || closedByUsRef.current) return;
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) return;
      retryCountRef.current = 0;
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      connect();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") revive();
    };

    window.addEventListener("online", revive);
    document.addEventListener("visibilitychange", handleVisibility);

    connect();

    return () => {
      disposed = true;
      closedByUsRef.current = true;
      clearTimers();
      window.removeEventListener("online", revive);
      document.removeEventListener("visibilitychange", handleVisibility);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [code, enabled, send]);

  const actions = useMemo<RoomActions>(
    () => ({
      submitMove(from, to, promotion) {
        send({
          type: "submit_move",
          actionId: newActionId(),
          from,
          to,
          ...(promotion ? {promotion} : {}),
          // Sending the sequence the client is looking at is what stops a move
          // typed against a stale board from landing on the live one.
          expectedSequence: snapshot?.moveSequence ?? 0,
        });
      },
      confirmMoveCopied(sequence) {
        send({type: "confirm_move_copied", actionId: newActionId(), sequence});
      },
      requestUndo(targetSequence) {
        send({type: "request_undo", actionId: newActionId(), targetSequence});
      },
      respondToUndo(accept) {
        send({type: "respond_to_undo", actionId: newActionId(), accept});
      },
      offerDraw() {
        send({type: "offer_draw", actionId: newActionId()});
      },
      respondToDraw(accept) {
        send({type: "respond_to_draw", actionId: newActionId(), accept});
      },
      resign() {
        send({type: "resign", actionId: newActionId()});
      },
      leave() {
        send({type: "leave_room"});
      },
    }),
    [send, snapshot?.moveSequence],
  );

  const clearTransientError = useCallback(() => setTransientError(null), []);

  return {
    status,
    snapshot,
    fatalError,
    transientError,
    clearTransientError,
    lastEvent,
    isReady: snapshot !== null,
    actions,
  };
}
