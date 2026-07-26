import {callerId, adminClient} from "../_shared/auth.ts";
import {corsHeaders, options} from "../_shared/cors.ts";
import {secureToken, sha256, roomCode} from "../_shared/crypto.ts";
import {apiError, rpcError} from "../_shared/errors.ts";
import {snapshot} from "../_shared/snapshot.ts";
import {actionId, displayName} from "../_shared/validation.ts";

Deno.serve(async (request) => {
  const preflight = options(request); if (preflight) return preflight;
  const headers = corsHeaders(request);
  try {
    const userId = await callerId(request); if (!userId) return new Response((await apiError("AUTH_REQUIRED")).body, {status: 401, headers});
    const body = await request.json();
    const name = displayName(body.displayName, "Player 1");
    const preferred = body.preferredSide === "white" || body.preferredSide === "black" ? body.preferredSide : (crypto.getRandomValues(new Uint8Array(1))[0]! % 2 ? "white" : "black");
    const token = secureToken(); const tokenHash = await sha256(token); const clientActionId = actionId(body.clientActionId);
    const clock = body.clock?.type === "countdown" && Number.isInteger(body.clock.secondsPerPlayer) ? body.clock : {type: "none"};
    const admin = adminClient();
    let roomId: string | null = null;
    for (let attempt = 0; attempt < 5 && !roomId; attempt += 1) {
      const {data, error} = await admin.rpc("room_create", {p_user_id: userId, p_public_code: roomCode(), p_invite_hash: tokenHash, p_display_name: name, p_color: preferred, p_clock_config: clock, p_client_action_id: clientActionId});
      if (!error) roomId = data as string;
      else if (!/duplicate key/i.test(error.message)) return new Response((await rpcError(error)).body, {status: (await rpcError(error)).status, headers});
    }
    if (!roomId) return new Response((await apiError("INTERNAL_ERROR")).body, {status: 500, headers});
    const room = await snapshot(admin, roomId, userId);
    return Response.json({snapshot: room, inviteToken: token, assignedColor: preferred}, {headers});
  } catch (error) {
    const response = error instanceof Error && error.message === "INVALID_INPUT" ? apiError("INVALID_INPUT") : apiError("INTERNAL_ERROR");
    return new Response(response.body, {status: response.status, headers});
  }
});
