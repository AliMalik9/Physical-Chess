-- BoardLink's authoritative game store. Browser clients receive SELECT-only
-- access through membership RLS; every write below is invoked by an Edge
-- Function using the caller's verified identity and an optimistic version.
create extension if not exists pgcrypto;

do $$ begin
  create type public.room_status as enum ('waiting_for_opponent', 'active', 'completed', 'expired');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.turn_phase as enum ('waiting_for_move', 'waiting_for_copy_confirmation');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.player_color as enum ('white', 'black');
exception when duplicate_object then null; end $$;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique check (public_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  invite_token_hash text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  status public.room_status not null default 'waiting_for_opponent',
  turn_phase public.turn_phase not null default 'waiting_for_move',
  fen text not null,
  pgn text not null default '',
  version bigint not null default 1 check (version > 0),
  move_sequence bigint not null default 0 check (move_sequence >= 0),
  move_number integer not null default 1 check (move_number > 0),
  side_to_move public.player_color not null default 'white',
  last_move jsonb,
  previous_fen text,
  pending_action jsonb,
  clock_config jsonb not null default '{"type":"none"}'::jsonb,
  clock_state jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz
);

create table if not exists public.room_players (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  color public.player_color not null,
  display_name text not null check (char_length(display_name) between 1 and 24),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz,
  copied_through_sequence bigint not null default 0,
  primary key (room_id, user_id),
  unique (room_id, color)
);

create table if not exists public.moves (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  sequence bigint not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  client_action_id uuid not null,
  from_square text not null check (from_square ~ '^[a-h][1-8]$'),
  to_square text not null check (to_square ~ '^[a-h][1-8]$'),
  promotion text check (promotion is null or promotion in ('q','r','b','n')),
  san text not null,
  lan text,
  fen_before text not null,
  fen_after text not null,
  pgn_after text not null,
  plain_instruction text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  copied_at timestamptz,
  unique (room_id, sequence),
  unique (room_id, client_action_id)
);

create table if not exists public.room_action_audit (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  client_action_id uuid not null,
  action_type text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  unique (room_id, client_action_id)
);

create index if not exists rooms_public_code_idx on public.rooms(public_code);
create index if not exists rooms_expires_at_idx on public.rooms(expires_at);
create index if not exists room_players_user_id_idx on public.room_players(user_id);
create index if not exists room_players_room_id_idx on public.room_players(room_id);
create index if not exists moves_room_sequence_idx on public.moves(room_id, sequence);
create index if not exists moves_client_action_id_idx on public.moves(client_action_id);
create index if not exists action_audit_room_action_idx on public.room_action_audit(room_id, client_action_id);

create or replace function public.is_room_member(target_room uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.room_players where room_id = target_room and user_id = auth.uid());
$$;

alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.moves enable row level security;
alter table public.room_action_audit enable row level security;

create policy "members read their rooms" on public.rooms for select to authenticated using (public.is_room_member(id));
create policy "members read room players" on public.room_players for select to authenticated using (public.is_room_member(room_id));
create policy "members read moves" on public.moves for select to authenticated using (public.is_room_member(room_id));
-- No INSERT/UPDATE/DELETE policies: the browser cannot authoritatively write.

create or replace function public.room_create(
  p_user_id uuid, p_public_code text, p_invite_hash text, p_display_name text,
  p_color public.player_color, p_clock_config jsonb, p_client_action_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_room uuid; begin
  select room_id into v_room from public.room_action_audit where actor_id=p_user_id and client_action_id=p_client_action_id and action_type='create_room';
  if v_room is not null then return v_room; end if;
  insert into public.rooms(public_code, invite_token_hash, created_by, fen, expires_at, clock_config)
  values (p_public_code, p_invite_hash, p_user_id, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', now() + interval '1 hour', p_clock_config)
  returning id into v_room;
  insert into public.room_players(room_id,user_id,color,display_name,last_seen_at) values(v_room,p_user_id,p_color,p_display_name,now());
  insert into public.room_action_audit(room_id,actor_id,client_action_id,action_type) values(v_room,p_user_id,p_client_action_id,'create_room');
  return v_room;
end $$;

create or replace function public.room_join(
  p_user_id uuid, p_public_code text, p_invite_hash text, p_display_name text, p_client_action_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_room public.rooms; v_existing uuid; v_color public.player_color; begin
  select room_id into v_existing from public.room_action_audit where actor_id=p_user_id and client_action_id=p_client_action_id and action_type='join_room';
  if v_existing is not null then return v_existing; end if;
  select * into v_room from public.rooms where public_code=p_public_code for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_room.expires_at <= now() or v_room.status='expired' then raise exception 'ROOM_EXPIRED'; end if;
  if exists(select 1 from public.room_players where room_id=v_room.id and user_id=p_user_id) then return v_room.id; end if;
  if p_invite_hash is not null and v_room.invite_token_hash <> p_invite_hash then raise exception 'INVALID_INVITE'; end if;
  if v_room.status <> 'waiting_for_opponent' then raise exception 'ROOM_FULL'; end if;
  v_color := case when exists(select 1 from public.room_players where room_id=v_room.id and color='white') then 'black'::public.player_color else 'white'::public.player_color end;
  insert into public.room_players(room_id,user_id,color,display_name,last_seen_at) values(v_room.id,p_user_id,v_color,p_display_name,now());
  update public.rooms set status='active', updated_at=now(), expires_at=now()+interval '24 hours', version=version+1 where id=v_room.id;
  insert into public.room_action_audit(room_id,actor_id,client_action_id,action_type) values(v_room.id,p_user_id,p_client_action_id,'join_room');
  return v_room.id;
end $$;

create or replace function public.require_room_action(p_room_id uuid, p_actor_id uuid, p_version bigint, p_action_id uuid, p_action_type text)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare v_room public.rooms; begin
  select * into v_room from public.rooms where id=p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if not exists(select 1 from public.room_players where room_id=p_room_id and user_id=p_actor_id) then raise exception 'NOT_A_ROOM_MEMBER'; end if;
  if v_room.expires_at <= now() or v_room.status='expired' then raise exception 'ROOM_EXPIRED'; end if;
  if exists(select 1 from public.room_action_audit where room_id=p_room_id and client_action_id=p_action_id) then return v_room; end if;
  if v_room.version <> p_version then raise exception 'ROOM_VERSION_CONFLICT'; end if;
  insert into public.room_action_audit(room_id,actor_id,client_action_id,action_type) values(p_room_id,p_actor_id,p_action_id,p_action_type);
  return v_room;
end $$;

create or replace function public.room_submit_move(
  p_room_id uuid,p_actor_id uuid,p_expected_version bigint,p_client_action_id uuid,
  p_move jsonb,p_fen text,p_pgn text,p_result jsonb,p_clock_state jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare v_room public.rooms; v_color public.player_color; begin
  v_room := public.require_room_action(p_room_id,p_actor_id,p_expected_version,p_client_action_id,'submit_move');
  if exists(select 1 from public.moves where room_id=p_room_id and client_action_id=p_client_action_id) then return; end if;
  select color into v_color from public.room_players where room_id=p_room_id and user_id=p_actor_id;
  if v_room.status <> 'active' then raise exception 'GAME_ALREADY_OVER'; end if;
  if v_room.turn_phase <> 'waiting_for_move' then raise exception 'INVALID_TURN_PHASE'; end if;
  if v_room.side_to_move <> v_color then raise exception 'NOT_YOUR_TURN'; end if;
  insert into public.moves(room_id,sequence,actor_id,client_action_id,from_square,to_square,promotion,san,lan,fen_before,fen_after,pgn_after,plain_instruction,metadata)
  values(p_room_id,v_room.move_sequence+1,p_actor_id,p_client_action_id,p_move->>'from',p_move->>'to',nullif(p_move->>'promotion',''),p_move->>'san',p_move->>'lan',p_move->>'fenBefore',p_move->>'fenAfter',p_pgn,p_move->>'plainInstruction',p_move);
  update public.rooms set fen=p_fen,pgn=p_pgn,last_move=p_move,previous_fen=v_room.fen,move_sequence=v_room.move_sequence+1,
    move_number=(p_move->>'moveNumber')::integer,side_to_move=case when v_room.side_to_move='white' then 'black' else 'white' end,
    turn_phase='waiting_for_copy_confirmation',result=p_result,clock_state=p_clock_state,status=case when p_result is null then 'active' else 'completed' end,
    completed_at=case when p_result is null then null else now() end,updated_at=now(),expires_at=case when p_result is null then now()+interval '24 hours' else now()+interval '24 hours' end,version=v_room.version+1
  where id=p_room_id;
end $$;

create or replace function public.room_confirm_copy(
  p_room_id uuid,p_actor_id uuid,p_expected_version bigint,p_client_action_id uuid,p_sequence bigint,p_clock_state jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare v_room public.rooms; v_actor public.player_color; v_mover public.player_color; begin
  v_room := public.require_room_action(p_room_id,p_actor_id,p_expected_version,p_client_action_id,'confirm_move_copied');
  select color into v_actor from public.room_players where room_id=p_room_id and user_id=p_actor_id;
  select rp.color into v_mover from public.moves m join public.room_players rp on rp.room_id=m.room_id and rp.user_id=m.actor_id where m.room_id=p_room_id and m.sequence=p_sequence;
  if v_room.turn_phase <> 'waiting_for_copy_confirmation' then raise exception 'INVALID_TURN_PHASE'; end if;
  if p_sequence <> v_room.move_sequence then raise exception 'MOVE_ALREADY_COPIED'; end if;
  if v_actor = v_mover then raise exception 'NOT_YOUR_TURN'; end if;
  update public.moves set copied_at=now() where room_id=p_room_id and sequence=p_sequence;
  update public.room_players set copied_through_sequence=p_sequence,last_seen_at=now() where room_id=p_room_id and user_id=p_actor_id;
  update public.rooms set turn_phase='waiting_for_move',clock_state=p_clock_state,updated_at=now(),expires_at=now()+interval '24 hours',version=v_room.version+1 where id=p_room_id;
end $$;

create or replace function public.room_meta_action(
  p_room_id uuid,p_actor_id uuid,p_expected_version bigint,p_client_action_id uuid,p_action text,p_payload jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare v_room public.rooms; v_actor public.player_color; v_pending jsonb; begin
  v_room := public.require_room_action(p_room_id,p_actor_id,p_expected_version,p_client_action_id,p_action);
  select color into v_actor from public.room_players where room_id=p_room_id and user_id=p_actor_id;
  if p_action='request_undo' then
    if v_room.status <> 'active' or v_room.turn_phase <> 'waiting_for_move' then raise exception 'UNDO_NOT_AVAILABLE'; end if;
    update public.rooms set pending_action=jsonb_build_object('kind','undo','requestedBy',v_actor,'targetSequence',p_payload->>'targetSequence','requestedAt',extract(epoch from now())*1000),version=v_room.version+1,updated_at=now() where id=p_room_id;
  elsif p_action='respond_to_undo' then
    v_pending:=v_room.pending_action;
    if v_pending->>'kind' <> 'undo' then raise exception 'NO_UNDO_PENDING'; end if;
    if v_pending->>'requestedBy'=v_actor::text then raise exception 'NOT_YOUR_TURN'; end if;
    if coalesce((p_payload->>'accepted')::boolean,false) then
      delete from public.moves where room_id=p_room_id and sequence > (v_pending->>'targetSequence')::bigint;
      update public.rooms set pending_action=null,fen=p_payload->>'fen',pgn=p_payload->>'pgn',
        move_sequence=(v_pending->>'targetSequence')::bigint,move_number=(p_payload->>'moveNumber')::integer,
        side_to_move=(p_payload->>'sideToMove')::public.player_color,last_move=p_payload->'lastMove',
        previous_fen=p_payload->>'previousFen',turn_phase='waiting_for_move',result=null,status='active',
        version=v_room.version+1,updated_at=now(),expires_at=now()+interval '24 hours' where id=p_room_id;
    else
      update public.rooms set pending_action=null,version=v_room.version+1,updated_at=now() where id=p_room_id;
    end if;
  elsif p_action='offer_draw' then
    if v_room.status <> 'active' then raise exception 'GAME_ALREADY_OVER'; end if;
    update public.rooms set pending_action=jsonb_build_object('kind','draw','offeredBy',v_actor,'offeredAt',extract(epoch from now())*1000),version=v_room.version+1,updated_at=now() where id=p_room_id;
  elsif p_action='respond_to_draw' then
    v_pending:=v_room.pending_action;
    if v_pending->>'kind' <> 'draw' then raise exception 'NO_DRAW_PENDING'; end if;
    if v_pending->>'offeredBy'=v_actor::text then raise exception 'NOT_YOUR_TURN'; end if;
    update public.rooms set pending_action=null,status=case when coalesce((p_payload->>'accepted')::boolean,false) then 'completed' else 'active' end,
      result=case when coalesce((p_payload->>'accepted')::boolean,false) then jsonb_build_object('reason','draw_agreement','winner',null,'scoreline','1/2-1/2','endedAt',extract(epoch from now())*1000) else result end,
      completed_at=case when coalesce((p_payload->>'accepted')::boolean,false) then now() else completed_at end,version=v_room.version+1,updated_at=now() where id=p_room_id;
  elsif p_action='resign' then
    update public.rooms set status='completed',result=jsonb_build_object('reason','resignation','winner',case when v_actor='white' then 'black' else 'white' end,'scoreline',case when v_actor='white' then '0-1' else '1-0' end,'endedAt',extract(epoch from now())*1000),completed_at=now(),version=v_room.version+1,updated_at=now() where id=p_room_id;
  elsif p_action='leave_room' then
    update public.room_players set last_seen_at=now() where room_id=p_room_id and user_id=p_actor_id;
    update public.rooms set updated_at=now(),version=v_room.version+1 where id=p_room_id;
  else raise exception 'INVALID_INPUT'; end if;
end $$;

create or replace function public.expire_boardlink_rooms()
returns integer language plpgsql security definer set search_path=public as $$
declare changed integer; begin
 update public.rooms set status='expired',updated_at=now(),version=version+1
 where status in ('waiting_for_opponent','active') and expires_at <= now();
 get diagnostics changed = row_count;
 delete from public.rooms where status in ('completed','expired') and updated_at < now()-interval '24 hours';
 return changed;
end $$;

-- Private channels are enforced by the Realtime Authorization policy. Server
-- broadcasts use the function secret; unauthenticated/third-party clients
-- cannot subscribe to a topic without a matching room_players row.
create policy "room members receive private broadcasts" on realtime.messages for select to authenticated
using (realtime.topic() ~ '^room:[0-9a-f-]{36}:game$' and public.is_room_member(split_part(replace(realtime.topic(),'room:',''),':',1)::uuid));
