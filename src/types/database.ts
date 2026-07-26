/**
 * Generated shape placeholder for the local Supabase schema. Refresh it with
 * `npm run supabase:types` after `supabase db reset` to obtain column-level
 * types from the running project.
 */
export interface Database {
  public: {
    Tables: {
      rooms: {Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: []};
      room_players: {Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: []};
      moves: {Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: []};
      room_action_audit: {Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: []};
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {room_status: "waiting_for_opponent" | "active" | "completed" | "expired"; turn_phase: "waiting_for_move" | "waiting_for_copy_confirmation"; player_color: "white" | "black"};
    CompositeTypes: Record<string, never>;
  };
}
