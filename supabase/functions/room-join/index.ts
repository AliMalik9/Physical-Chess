import {callerId, adminClient} from "../_shared/auth.ts";
import {corsHeaders, options} from "../_shared/cors.ts";
import {sha256} from "../_shared/crypto.ts";
import {apiError, rpcError} from "../_shared/errors.ts";
import {newEvent, broadcast} from "../_shared/realtime.ts";
import {snapshot} from "../_shared/snapshot.ts";
import {actionId, displayName} from "../_shared/validation.ts";

Deno.serve(async (request) => {
  const preflight = options(request); if (preflight) return preflight;
  const headers = corsHeaders(request);
  try {
    const userId = await callerId(request); if (!userId) return new Response((await apiError("AUTH_REQUIRED")).body, {status: 401, headers});
    const body = await request.json();
    const code = String(body.publicCode ?? "").toUpperCase().replace(/[^A-Z2-9]/g, "");
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) return new Response((await apiError("INVALID_INPUT")).body, {status: 400, headers});
    const admin = adminClient();
    const {data: prior} = await admin.from("room_players").select("room_id").eq("user_id", userId).limit(1);
    const tokenHash = body.inviteToken ? await sha256(String(body.inviteToken)) : null;
    const {data: roomId, error} = await admin.rpc("room_join", {p_user_id: userId, p_public_code: code, p_invite_hash: tokenHash, p_display_name: displayName(body.displayName, "Player 2"), p_client_action_id: actionId(body.clientActionId)});
    if (error) { const response = rpcError(error); return new Response(response.body, {status: response.status, headers}); }
    const room = await snapshot(admin, roomId as string, userId);
    // A duplicate retry has an existing membership; do not emit a second join.
    if (!prior?.some((item) => item.room_id === roomId)) {
      const message = {v: 1, roomId, eventId: crypto.randomUUID(), ts: Date.now(), type: "player_joined", player: room.you.color === "white" ? room.white : room.black} as const;
      await broadcast(newEvent(roomId as string, Number(room.version), Number(room.moveSequence), "player_joined", {message}));
    }
    return Response.json({snapshot: room}, {headers});
  } catch (error) {
    const response = error instanceof Error ? rpcError(error) : apiError("INTERNAL_ERROR");
    return new Response(response.body, {status: response.status, headers});
  }
});
