import type {FunctionsHttpError} from "@supabase/supabase-js";

import type {CreateRoomRequest, ErrorCode, RoomSnapshot, ServerMessage} from "@shared/protocol";

import {initializeAnonymousIdentity} from "@/lib/supabase/auth";
import {getSupabase} from "@/lib/supabase/client";

import {
  ApiError,
  type ActionResult,
  type CreateRoomResult,
  type GameBackend,
  type JoinRoomInput,
  type PlayerIdentity,
  type RoomAction,
  type RoomRealtimeEvent,
  type RoomSubscriptionHandlers,
  type Unsubscribe,
} from "./types";

interface FunctionFailure {code?: ErrorCode; retryable?: boolean; status?: number}

async function functionError(error: FunctionsHttpError | Error): Promise<ApiError> {
  if ("context" in error && error.context instanceof Response) {
    try {
      const body = (await error.context.json()) as FunctionFailure;
      return new ApiError(body.code ?? "internal_error", body.retryable ?? false, body.status ?? error.context.status);
    } catch {
      return new ApiError("internal_error", true, error.context.status);
    }
  }
  return new ApiError("internal_error", true, 503);
}

async function invoke<T>(name: string, body: unknown): Promise<T> {
  await initializeAnonymousIdentity();
  const {data, error} = await getSupabase().functions.invoke<T>(name, {body: body as Record<string, unknown>});
  if (error) throw await functionError(error);
  if (data === null) throw new ApiError("internal_error", true, 502);
  return data;
}

function messageFromEvent(event: RoomRealtimeEvent): ServerMessage | undefined {
  const payload = event.payload as {message?: ServerMessage} | null;
  return payload?.message;
}

export const supabaseBackend: GameBackend = {
  async initializeIdentity(): Promise<PlayerIdentity> {
    const user = await initializeAnonymousIdentity();
    return {id: user.id};
  },

  async createRoom(input: CreateRoomRequest & {clientActionId: string}): Promise<CreateRoomResult> {
    return invoke<CreateRoomResult>("room-create", {
      displayName: input.displayName,
      preferredSide: input.side === "surprise" ? "random" : input.side,
      clock: input.speed === "none" ? {type: "none"} : {type: "countdown", secondsPerPlayer: Number(input.speed) * 60},
      clientActionId: input.clientActionId,
    });
  },

  async joinRoom(input: JoinRoomInput): Promise<RoomSnapshot> {
    const result = await invoke<{snapshot: RoomSnapshot}>("room-join", input);
    return result.snapshot;
  },

  async getSnapshot(roomId: string): Promise<RoomSnapshot> {
    const result = await invoke<{snapshot: RoomSnapshot}>("room-snapshot", {roomId});
    return result.snapshot;
  },

  async performAction(action: RoomAction): Promise<ActionResult> {
    const result = await invoke<ActionResult>("room-action", action);
    return result;
  },

  async subscribeToRoom(roomId: string, handlers: RoomSubscriptionHandlers): Promise<Unsubscribe> {
    await initializeAnonymousIdentity();
    const supabase = getSupabase();
    const channel = supabase.channel(`room:${roomId}:game`, {
      config: {private: true, presence: {key: (await supabase.auth.getUser()).data.user?.id}},
    });

    channel
      .on("broadcast", {event: "room_event"}, ({payload}) => {
        const event = payload as RoomRealtimeEvent;
        if (event.protocolVersion !== 1 || event.roomId !== roomId) return;
        handlers.onEvent(event);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          handlers.onStatus("subscribed");
          void channel.track({online: true});
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          handlers.onStatus("reconnecting");
        } else if (status === "CLOSED") {
          handlers.onStatus("closed");
        }
      });

    return async () => {
      await supabase.removeChannel(channel);
    };
  },
};

export function eventMessage(event: RoomRealtimeEvent): ServerMessage | undefined {
  return messageFromEvent(event);
}
