-- Keep event edits from lowering ticket capacity beneath issued tickets.
-- Lock the same private counter rows used by ticket issuance to serialize edits
-- against concurrent entry creation.
create or replace function public.validate_event_capacity_update()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare current_issued integer;
begin
  if new.ticket_quantity is not distinct from old.ticket_quantity then return new; end if;

  select issued_count into current_issued
  from public.event_ticket_counters
  where event_id = new.id
  for update;

  if current_issued is null then
    select count(*)::integer into current_issued
    from public.entries where event_id = new.id;
  end if;

  if new.ticket_quantity is not null and new.ticket_quantity < current_issued then
    raise exception 'Event capacity cannot be lower than issued tickets';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_event_capacity_update() from public, anon, authenticated;
create trigger events_validate_capacity_update
  before update of ticket_quantity on public.events
  for each row execute function public.validate_event_capacity_update();
