import type {
  CreateRoomRequest,
  CreateRoomResponse,
  ResolveCodeResponse,
} from "@shared/protocol";

import {gameBackend, ApiError} from "@/services/gameBackend";

export {ApiError};

function actionId(): string {
  return crypto.randomUUID();
}

/** Creates a private room through the authenticated Edge Function. */
export async function createRoom(request: CreateRoomRequest): Promise<CreateRoomResponse> {
  const result = await gameBackend.createRoom({...request, clientActionId: actionId()});
  return {
    roomId: result.snapshot.roomId,
    publicCode: result.snapshot.publicCode,
    inviteSecret: result.inviteToken,
    // Kept for the existing component contract. Supabase auth, not this value,
    // proves ownership; it is intentionally never sent to the backend.
    seatToken: result.snapshot.roomId,
    color: result.assignedColor,
  };
}

/**
 * A code lookup is intentionally non-authoritative. Private room details are
 * revealed only by room-join after an invite credential is validated.
 */
export async function resolveRoom(code: string): Promise<ResolveCodeResponse> {
  return {roomId: "", publicCode: code, status: "waiting_for_opponent", hostName: null, hasOpenSeat: true};
}

/** Invite tokens remain in the URL fragment, outside HTTP logs and referrers. */
export function inviteUrl(code: string, inviteToken: string): string {
  return `${window.location.origin}/room/${code}#${encodeURIComponent(inviteToken)}`;
}
