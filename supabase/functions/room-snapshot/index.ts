import {callerId, adminClient} from "../_shared/auth.ts";
import {corsHeaders, options} from "../_shared/cors.ts";
import {apiError, rpcError} from "../_shared/errors.ts";
import {snapshot} from "../_shared/snapshot.ts";
import {uuid} from "../_shared/validation.ts";

Deno.serve(async (request) => {
  const preflight = options(request); if (preflight) return preflight;
  const headers = corsHeaders(request);
  try {
    const userId = await callerId(request); if (!userId) return new Response((await apiError("AUTH_REQUIRED")).body, {status: 401, headers});
    const room = await snapshot(adminClient(), uuid((await request.json()).roomId), userId);
    return Response.json({snapshot: room}, {headers});
  } catch (error) {
    const response = error instanceof Error ? rpcError(error) : apiError("INTERNAL_ERROR");
    return new Response(response.body, {status: response.status, headers});
  }
});
