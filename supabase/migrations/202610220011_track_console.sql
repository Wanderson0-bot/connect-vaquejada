-- Durable, versioned state for the track console. Existing event and result rows are untouched.
create table if not exists public.event_track_states (
  event_id uuid primary key references public.events(id) on delete cascade,
  park_id uuid not null references public.parks(id) on delete cascade,
  version bigint not null default 0 check (version >= 0),
  state jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.event_track_operations (
  operation_id uuid primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  base_version bigint not null,
  resulting_version bigint not null,
  action text not null,
  state jsonb not null,
  actor_label text not null default '',
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists event_track_operations_event_created_idx
  on public.event_track_operations(event_id, created_at);
alter table public.event_track_states enable row level security;
alter table public.event_track_operations enable row level security;
drop policy if exists event_track_states_owner_read on public.event_track_states;
create policy event_track_states_owner_read on public.event_track_states for select to authenticated
  using ((select public.owns_event(event_id)));
drop policy if exists event_track_operations_owner_read on public.event_track_operations;
create policy event_track_operations_owner_read on public.event_track_operations for select to authenticated
  using ((select public.owns_event(event_id)));
revoke insert, update, delete on public.event_track_states, public.event_track_operations from anon, authenticated;
grant select on public.event_track_states, public.event_track_operations to authenticated;

create or replace function public.apply_event_track_operation(
  p_event_id uuid, p_operation_id uuid, p_base_version bigint, p_action text,
  p_state jsonb, p_actor_label text
) returns table(version bigint, duplicate boolean)
language plpgsql security definer set search_path = ''
as $$
declare current_version bigint; saved_state jsonb; prior public.event_track_operations;
  target_park uuid; next_version bigint; history_count integer; initializing boolean;
begin
  if auth.uid() is null or not public.owns_event(p_event_id) then raise exception 'Event access denied'; end if;
  if p_operation_id is null or p_base_version < 0 or length(trim(coalesce(p_actor_label,''))) = 0 then raise exception 'Operation id, base version and actor are required'; end if;
  if p_state->>'eventId' is distinct from p_event_id::text or p_state->>'id' is distinct from p_event_id::text then raise exception 'Track state event mismatch'; end if;
  if jsonb_typeof(p_state->'history') is distinct from 'array' or jsonb_typeof(p_state->'races') is distinct from 'array' or jsonb_typeof(p_state->'calls') is distinct from 'array' then raise exception 'Track state collections are invalid'; end if;
  history_count := jsonb_array_length(p_state->'history');
  if history_count < 1 or (p_state->'history'->(history_count - 1)->>'operationId') is distinct from p_operation_id::text
    or (p_state->'history'->(history_count - 1)->>'action') is distinct from p_action
    or (p_state->'history'->(history_count - 1)->>'operator') is distinct from trim(p_actor_label) then raise exception 'Track operation does not match its audit record'; end if;
  if p_action not in ('rotation.pause','rotation.resume','rotation.close','rotation.reopen','call.create','call.present','call.absent','call.move_tail','race.start','race.judge','return.decide','return.create_race','result.confirm','result.correct') then raise exception 'Track action is not allowed'; end if;
  select * into prior from public.event_track_operations where operation_id=p_operation_id;
  if found then
    if prior.event_id <> p_event_id or prior.state <> p_state then raise exception 'Operation id reused with different content'; end if;
    return query select prior.resulting_version, true; return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_event_id::text,0));
  select park_id into target_park from public.events where id=p_event_id;
  select s.version,s.state into current_version,saved_state from public.event_track_states s where s.event_id=p_event_id for update;
  initializing := not found;
  if initializing then current_version := 0; saved_state := null; end if;
  if current_version <> p_base_version then raise exception 'Track version conflict' using errcode='40001'; end if;
  next_version := current_version + 1;
  if (p_state->>'version')::bigint is distinct from next_version then raise exception 'Track state version does not match expected version'; end if;
  if (initializing and history_count <> 1) or (not initializing and (
      history_count <> jsonb_array_length(saved_state->'history') + 1
      or (p_state->'history' - (history_count - 1)) <> saved_state->'history'
    )) then raise exception 'Track history must append exactly one immutable operation'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_state->'races') as item(value)
    where item.value->>'eventId' is distinct from p_event_id::text
      or not exists (select 1 from public.entries e where e.id::text=item.value->>'entryId' and e.event_id=p_event_id and e.number::text=item.value->>'ticketNumber')
  ) or exists (
    select 1 from jsonb_array_elements(p_state->'calls') as item(value)
    where item.value->>'eventId' is distinct from p_event_id::text
      or not exists (select 1 from public.entries e where e.id::text=item.value->>'entryId' and e.event_id=p_event_id)
  ) then raise exception 'Track state contains an entry from another event or a mismatched ticket'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(saved_state->'races','[]'::jsonb)) old_race
    where old_race->>'resultStatus' = 'official'
      and not exists (
        select 1 from jsonb_array_elements(p_state->'races') new_race
        where new_race->>'id' = old_race->>'id'
          and (new_race = old_race or (p_action='result.correct'
            and p_state->'history'->(history_count - 1)->'before' = old_race))
      )
  ) then raise exception 'Official track results cannot be removed or silently replaced'; end if;
  if initializing then
    insert into public.event_track_states(event_id,park_id,version,state,updated_at) values(p_event_id,target_park,next_version,p_state,now());
  else
    update public.event_track_states set version=next_version,state=p_state,updated_at=now() where event_id=p_event_id;
  end if;
  insert into public.event_track_operations(operation_id,event_id,base_version,resulting_version,action,state,actor_label,actor_user_id)
    values(p_operation_id,p_event_id,p_base_version,next_version,p_action,p_state,left(coalesce(p_actor_label,''),120),auth.uid());
  return query select next_version,false;
end;
$$;
revoke all on function public.apply_event_track_operation(uuid,uuid,bigint,text,jsonb,text) from public, anon;
grant execute on function public.apply_event_track_operation(uuid,uuid,bigint,text,jsonb,text) to authenticated;
