import {adminClient} from "./auth.ts";

export interface RealtimeEvent {protocolVersion: number; roomId: string; eventId: string; version: number; moveSequence: number; serverTimestamp: string; type: string; payload: unknown}

export async function broadcast(event: RealtimeEvent): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("Supabase Edge Function secret is not configured.");
  const response = await fetch(`${url}/realtime/v1/api/broadcast`, {
    method: "POST", headers: {"Authorization": `Bearer ${key}`, "apikey": key, "Content-Type": "application/json"},
    body: JSON.stringify({messages: [{topic: `room:${event.roomId}:game`, event: "room_event", private: true, payload: event}]}),
  });
  if (!response.ok) console.error(JSON.stringify({function: "realtime", status: response.status, roomId: event.roomId}));
}

export function newEvent(roomId: string, version: number, moveSequence: number, type: string, payload: unknown): RealtimeEvent {
  return {protocolVersion: 1, roomId, eventId: crypto.randomUUID(), version, moveSequence, serverTimestamp: new Date().toISOString(), type, payload};
}
