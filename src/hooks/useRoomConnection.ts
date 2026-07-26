import {useCallback, useEffect, useMemo, useRef, useState} from "react";

import type {
  ErrorCode,
  PieceSymbol,
  RoomSnapshot,
  ServerMessage,
} from "@shared/protocol";

import {applyServerEvent} from "@/lib/snapshotReducer";
import {mergeSeat, readSeat} from "@/lib/seatStorage";
import {eventMessage, gameBackend, ApiError, type RoomAction} from "@/services/gameBackend";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline" | "closed";

const FATAL_CODES: ReadonlySet<ErrorCode> = new Set([
  "room_not_found", "room_expired", "room_full", "invalid_invite", "invalid_code", "not_a_player",
]);

export interface InboundEvent {id: number; message: ServerMessage}

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
  fatalError: ErrorCode | null;
  transientError: ErrorCode | null;
  clearTransientError(): void;
  lastEvent: InboundEvent | null;
  isReady: boolean;
  actions: RoomActions;
}

type LocalAction =
  | {type: "submit_move"; from: string; to: string; promotion?: PieceSymbol}
  | {type: "confirm_move_copied"; moveSequence: number}
  | {type: "request_undo"; targetSequence: number}
  | {type: "respond_to_undo"; accepted: boolean}
  | {type: "offer_draw"}
  | {type: "respond_to_draw"; accepted: boolean}
  | {type: "resign"}
  | {type: "leave_room"};

function newActionId(): string { return crypto.randomUUID(); }

/**
 * One authoritative snapshot plus one private Broadcast channel per active
 * room. Supabase owns reconnecting; this hook only reconciles after it does.
 */
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
  const eventCounter = useRef(0);
  const seenEventIds = useRef(new Set<string>());
  const joinActionId = useRef(newActionId());
  const activeRoomId = useRef<string | null>(null);

  const publishMessage = useCallback((message: ServerMessage) => {
    eventCounter.current += 1;
    setLastEvent({id: eventCounter.current, message});
    setSnapshot((current) => applyServerEvent(current, message));
  }, []);

  const handleError = useCallback((error: unknown) => {
    const code: ErrorCode = error instanceof ApiError ? error.code : "internal_error";
    if (FATAL_CODES.has(code)) setFatalError(code);
    else setTransientError(code);
  }, []);

  // Resolve identity and room membership once. A stored room id means refresh;
  // otherwise room-join atomically validates the invite and takes the open seat.
  useEffect(() => {
    if (!enabled || !code) return;
    let cancelled = false;
    setStatus("connecting");

    void (async () => {
      try {
        await gameBackend.initializeIdentity();
        const stored = readSeat(code);
        const next = stored?.roomId
          ? await gameBackend.getSnapshot(stored.roomId)
          : await gameBackend.joinRoom({
              publicCode: code,
              ...(inviteSecret ? {inviteToken: inviteSecret} : {}),
              displayName: displayName ?? "Player 2",
              clientActionId: joinActionId.current,
            });
        if (cancelled) return;
        activeRoomId.current = next.roomId;
        mergeSeat(code, {seatToken: next.roomId, roomId: next.roomId, ...(inviteSecret ? {inviteSecret} : {})});
        setSnapshot(next);
      } catch (error) {
        if (!cancelled) handleError(error);
      }
    })();

    return () => { cancelled = true; activeRoomId.current = null; };
  }, [code, displayName, enabled, handleError, inviteSecret]);

  useEffect(() => {
    const roomId = snapshot?.roomId;
    if (!roomId || !enabled) return;
    let disposed = false;
    let unsubscribe: (() => Promise<void>) | null = null;

    void gameBackend.subscribeToRoom(roomId, {
      onStatus(next) {
        if (disposed) return;
        if (next === "subscribed") {
          setStatus("connected");
          // Initial subscribe and successful Supabase reconnection are the only
          // places a snapshot is refetched. There is no polling loop.
          void gameBackend.getSnapshot(roomId).then((fresh) => {
            if (!disposed) setSnapshot(fresh);
          }).catch(handleError);
        } else if (next === "reconnecting") setStatus(navigator.onLine ? "reconnecting" : "offline");
        else setStatus("closed");
      },
      onError: handleError,
      onEvent(event) {
        if (disposed || seenEventIds.current.has(event.eventId)) return;
        seenEventIds.current.add(event.eventId);
        const current = activeRoomId.current === roomId;
        if (!current) return;
        setSnapshot((previous) => {
          if (previous && event.version <= previous.version) return previous;
          if (previous && event.version > previous.version + 1) {
            void gameBackend.getSnapshot(roomId).then((fresh) => {
              if (!disposed) setSnapshot(fresh);
            }).catch(handleError);
            return previous;
          }
          const message = eventMessage(event);
          const next = message ? applyServerEvent(previous, message) : previous;
          return next ? {...next, version: event.version} : next;
        });
        const message = eventMessage(event);
        if (message) {
          eventCounter.current += 1;
          setLastEvent({id: eventCounter.current, message});
        }
      },
    }).then((stop) => {
      if (disposed) void stop();
      else unsubscribe = stop;
    }).catch(handleError);

    return () => {
      disposed = true;
      if (unsubscribe) void unsubscribe();
    };
  }, [enabled, handleError, snapshot?.roomId]);

  const perform = useCallback((action: LocalAction) => {
    const room = snapshot;
    if (!room) return;
    const complete = {...action, roomId: room.roomId, expectedVersion: room.version, clientActionId: newActionId()} as RoomAction;
    void gameBackend.performAction(complete).then((result) => {
      setSnapshot(result.snapshot);
      if (result.message) publishMessage(result.message);
    }).catch((error: unknown) => {
      const code: ErrorCode = error instanceof ApiError ? error.code : "internal_error";
      if (code === "room_version_conflict") {
        void gameBackend.getSnapshot(room.roomId).then(setSnapshot).catch(handleError);
      }
      handleError(error);
    });
  }, [handleError, publishMessage, snapshot]);

  const actions = useMemo<RoomActions>(() => ({
    submitMove: (from, to, promotion) => perform({type: "submit_move", from, to, ...(promotion ? {promotion} : {})}),
    confirmMoveCopied: (moveSequence) => perform({type: "confirm_move_copied", moveSequence}),
    requestUndo: (targetSequence) => perform({type: "request_undo", targetSequence}),
    respondToUndo: (accepted) => perform({type: "respond_to_undo", accepted}),
    offerDraw: () => perform({type: "offer_draw"}),
    respondToDraw: (accepted) => perform({type: "respond_to_draw", accepted}),
    resign: () => perform({type: "resign"}),
    leave: () => perform({type: "leave_room"}),
  }), [perform]);

  return {status, snapshot, fatalError, transientError, clearTransientError: () => setTransientError(null), lastEvent, isReady: snapshot !== null, actions};
}
