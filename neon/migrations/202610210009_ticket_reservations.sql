-- Ticket reservations occupy event capacity but never create an entry/result.
-- Expiry and conversion are serialized on the same counter row as entry issue.
alter table public.event_ticket_counters
  add column reserved_count integer not null default 0 check (reserved_count >= 0);

create table public.ticket_reservations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  number integer not null check (number > 0),
  reserved_for text not null check (length(trim(reserved_for)) > 0),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active','expired','released','converted')),
  reason text,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_by uuid references public.app_users(id) on delete set null,
  release_reason text,
  unique (id,event_id),
  check ((status = 'released' and released_at is not null and length(trim(release_reason)) >= 10)
      or (status <> 'released' and released_at is null and released_by is null and release_reason is null))
);
create unique index ticket_reservations_active_number_idx
  on public.ticket_reservations(event_id,number) where status = 'active';
create index ticket_reservations_event_expiration_idx on public.ticket_reservations(event_id,expires_at);
alter table public.ticket_reservations enable row level security;
create policy ticket_reservations_owner_read on public.ticket_reservations for select to authenticated
  using ((select public.owns_event(event_id)));
grant select on public.ticket_reservations to authenticated;

create trigger ticket_reservations_audit after insert or update or delete on public.ticket_reservations
  for each row execute function public.audit_operational_change();

create or replace function public.expire_ticket_reservations_locked(target_event uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare expired_count integer;
begin
  update public.ticket_reservations
    set status = 'expired'
    where event_id = target_event and status = 'active' and expires_at <= now();
  get diagnostics expired_count = row_count;
  if expired_count > 0 then
    update public.event_ticket_counters
      set reserved_count = greatest(reserved_count - expired_count,0)
      where event_id = target_event;
  end if;
  return expired_count;
end;
$$;
revoke all on function public.expire_ticket_reservations_locked(uuid) from public, anon, authenticated;

create or replace function public.sweep_event_ticket_reservations(p_event_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if public.current_app_user_id() is null or not public.owns_event(p_event_id) then raise exception 'Event access denied'; end if;
  perform 1 from public.event_ticket_counters where event_id = p_event_id for update;
  perform public.expire_ticket_reservations_locked(p_event_id);
end;
$$;
revoke all on function public.sweep_event_ticket_reservations(uuid) from public, anon;
grant execute on function public.sweep_event_ticket_reservations(uuid) to authenticated;

create or replace function public.reserve_event_ticket_number(
  p_id uuid, p_event_id uuid, p_number integer, p_reserved_for text,
  p_expires_at timestamptz, p_reason text default null
) returns public.ticket_reservations
language plpgsql security definer set search_path = ''
as $$
declare created public.ticket_reservations; issued integer; reserved integer; capacity integer;
begin
  if public.current_app_user_id() is null or not public.owns_event(p_event_id) then raise exception 'Event access denied'; end if;
  if p_number is null or p_number < 1 or length(trim(coalesce(p_reserved_for,''))) = 0
     or p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception 'Reservation fields are invalid';
  end if;
  perform 1 from public.event_ticket_counters where event_id = p_event_id for update;
  perform public.expire_ticket_reservations_locked(p_event_id);
  select ticket_quantity into capacity from public.events where id = p_event_id;
  select issued_count,reserved_count into issued,reserved from public.event_ticket_counters where event_id = p_event_id;
  if exists (select 1 from public.entries where event_id = p_event_id and number = p_number)
     or exists (select 1 from public.ticket_reservations where event_id = p_event_id and number = p_number and status = 'active') then
    raise exception 'Ticket number is already assigned or reserved';
  end if;
  if capacity is not null and issued + reserved >= capacity then raise exception 'Ticket capacity reached'; end if;
  insert into public.ticket_reservations(id,event_id,number,reserved_for,expires_at,reason,created_by)
    values (coalesce(p_id,gen_random_uuid()),p_event_id,p_number,trim(p_reserved_for),p_expires_at,nullif(trim(coalesce(p_reason,'')),''),public.current_app_user_id())
    returning * into created;
  update public.event_ticket_counters set reserved_count = reserved_count + 1 where event_id = p_event_id;
  return created;
end;
$$;
revoke all on function public.reserve_event_ticket_number(uuid,uuid,integer,text,timestamptz,text) from public, anon;
grant execute on function public.reserve_event_ticket_number(uuid,uuid,integer,text,timestamptz,text) to authenticated;

create or replace function public.release_event_ticket_reservation(p_id uuid,p_reason text)
returns public.ticket_reservations
language plpgsql security definer set search_path = ''
as $$
declare target_event uuid; reservation public.ticket_reservations;
begin
  select event_id into target_event from public.ticket_reservations where id = p_id;
  if target_event is null or public.current_app_user_id() is null or not public.owns_event(target_event) then raise exception 'Reservation not found'; end if;
  if length(trim(coalesce(p_reason,''))) < 10 then raise exception 'Release reason must contain at least 10 characters'; end if;
  perform 1 from public.event_ticket_counters where event_id = target_event for update;
  perform public.expire_ticket_reservations_locked(target_event);
  select * into reservation from public.ticket_reservations where id = p_id for update;
  if reservation.status <> 'active' then raise exception 'Only active reservations can be released'; end if;
  update public.ticket_reservations set status='released',released_at=now(),released_by=public.current_app_user_id(),release_reason=trim(p_reason)
    where id=p_id returning * into reservation;
  update public.event_ticket_counters set reserved_count=greatest(reserved_count-1,0) where event_id=target_event;
  return reservation;
end;
$$;
revoke all on function public.release_event_ticket_reservation(uuid,text) from public, anon;
grant execute on function public.release_event_ticket_reservation(uuid,text) to authenticated;

create or replace function public.create_entry_from_ticket_reservation(
  p_entry_id uuid,p_reservation_id uuid,p_vaqueiro text,p_horse text,p_representation text,
  p_category text,p_payment_status text,p_paid_amount numeric,p_payment_method text
) returns public.entries
language plpgsql security definer set search_path = ''
as $$
declare target_event uuid; reservation public.ticket_reservations; created public.entries;
begin
  select event_id into target_event from public.ticket_reservations where id=p_reservation_id;
  if target_event is null or public.current_app_user_id() is null or not public.owns_event(target_event) then raise exception 'Reservation not found'; end if;
  perform 1 from public.event_ticket_counters where event_id=target_event for update;
  perform public.expire_ticket_reservations_locked(target_event);
  select * into reservation from public.ticket_reservations where id=p_reservation_id for update;
  if reservation.status <> 'active' or reservation.expires_at <= now() then raise exception 'Reservation expired or inactive'; end if;
  if length(trim(coalesce(p_vaqueiro,'')))=0 or p_category is null or p_payment_status is null or p_payment_status not in ('pending','paid','exempt')
     or coalesce(p_paid_amount,0)<0 then raise exception 'Entry fields are invalid'; end if;
  update public.ticket_reservations set status='converted' where id=p_reservation_id;
  update public.event_ticket_counters set reserved_count=greatest(reserved_count-1,0) where event_id=target_event;
  insert into public.entries(id,event_id,number,vaqueiro,horse,representation,category,payment_status,paid,paid_amount,payment_method)
  values (coalesce(p_entry_id,gen_random_uuid()),target_event,reservation.number,trim(p_vaqueiro),coalesce(trim(p_horse),''),coalesce(trim(p_representation),''),p_category,
          p_payment_status,p_payment_status='paid',case when p_payment_status='paid' then coalesce(p_paid_amount,0) else 0 end,
          case when p_payment_status='paid' then p_payment_method else null end)
  returning * into created;
  return created;
end;
$$;
revoke all on function public.create_entry_from_ticket_reservation(uuid,uuid,text,text,text,text,text,numeric,text) from public, anon;
grant execute on function public.create_entry_from_ticket_reservation(uuid,uuid,text,text,text,text,text,numeric,text) to authenticated;

-- Normal entry creation must respect both issued capacity and active reservations.
create or replace function public.reserve_event_ticket()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare reserved_event uuid; capacity integer;
begin
  if tg_op = 'UPDATE' then
    if new.event_id is distinct from old.event_id then raise exception 'An entry cannot be transferred between events'; end if;
    return new;
  end if;
  perform 1 from public.event_ticket_counters where event_id=new.event_id for update;
  perform public.expire_ticket_reservations_locked(new.event_id);
  if exists (select 1 from public.ticket_reservations r where r.event_id=new.event_id and r.number=new.number and r.status='active') then
    raise exception 'Ticket number is reserved';
  end if;
  update public.event_ticket_counters c set issued_count=c.issued_count+1
    from public.events e where c.event_id=new.event_id and e.id=c.event_id
      and (e.ticket_quantity is null or c.issued_count+c.reserved_count < e.ticket_quantity)
    returning c.event_id into reserved_event;
  if reserved_event is null then raise exception 'Ticket capacity reached or event counter unavailable'; end if;
  return new;
end;
$$;
revoke all on function public.reserve_event_ticket() from public, anon, authenticated;

-- Capacity edits serialize with reservations and ticket issuance.
create or replace function public.validate_event_capacity_update()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare issued integer; reserved integer;
begin
  if new.ticket_quantity is not distinct from old.ticket_quantity then return new; end if;
  select issued_count,reserved_count into issued,reserved from public.event_ticket_counters where event_id=new.id for update;
  if issued is null then select count(*)::integer into issued from public.entries where event_id=new.id; reserved:=0; end if;
  if new.ticket_quantity is not null and new.ticket_quantity < issued+reserved then
    raise exception 'Event capacity cannot be lower than issued or reserved tickets';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_event_capacity_update() from public, anon, authenticated;
