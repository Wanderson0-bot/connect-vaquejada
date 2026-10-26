-- Serialize ticket reservations in the database so concurrent operators cannot
-- exceed the configured event capacity based on stale browser counts.
create table public.event_ticket_counters (
  event_id uuid primary key references public.events(id) on delete cascade,
  issued_count integer not null default 0 check (issued_count >= 0)
);
alter table public.event_ticket_counters enable row level security;
revoke all on public.event_ticket_counters from public, anon, authenticated;

insert into public.event_ticket_counters(event_id, issued_count)
select e.id, count(en.id)::integer
from public.events e left join public.entries en on en.event_id = e.id
group by e.id
on conflict (event_id) do update set issued_count = excluded.issued_count;

create or replace function public.initialize_event_ticket_counter()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.event_ticket_counters(event_id, issued_count) values (new.id, 0);
  return new;
end;
$$;
revoke all on function public.initialize_event_ticket_counter() from public, anon, authenticated;
create trigger events_initialize_ticket_counter after insert on public.events
  for each row execute function public.initialize_event_ticket_counter();

create or replace function public.reserve_event_ticket()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare reserved_event uuid;
begin
  if tg_op = 'UPDATE' then
    if new.event_id is distinct from old.event_id then
      raise exception 'An entry cannot be transferred between events';
    end if;
    return new;
  end if;

  update public.event_ticket_counters c
    set issued_count = c.issued_count + 1
    from public.events e
    where c.event_id = new.event_id and e.id = c.event_id
      and (e.ticket_quantity is null or c.issued_count < e.ticket_quantity)
    returning c.event_id into reserved_event;
  if reserved_event is null then
    raise exception 'Ticket capacity reached or event counter unavailable';
  end if;
  return new;
end;
$$;
revoke all on function public.reserve_event_ticket() from public, anon, authenticated;
create trigger entries_reserve_event_ticket before insert on public.entries
  for each row execute function public.reserve_event_ticket();
create trigger entries_cannot_move_event before update of event_id on public.entries
  for each row execute function public.reserve_event_ticket();

create or replace function public.release_event_ticket()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.event_ticket_counters
    set issued_count = greatest(issued_count - 1, 0)
    where event_id = old.event_id;
  return old;
end;
$$;
revoke all on function public.release_event_ticket() from public, anon, authenticated;
create trigger entries_release_event_ticket after delete on public.entries
  for each row execute function public.release_event_ticket();
