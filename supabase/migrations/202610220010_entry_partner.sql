-- Add the second participant without changing existing entry identities or rows.
alter table public.entries
  add column if not exists partner_name text not null default '';

create or replace function public.require_entry_participants()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if length(trim(coalesce(new.vaqueiro,'')))=0 or length(trim(coalesce(new.partner_name,'')))=0 then
    raise exception 'Both entry participants are required';
  end if;
  new.vaqueiro := trim(new.vaqueiro);
  new.partner_name := trim(new.partner_name);
  return new;
end;
$$;
create trigger entries_require_participants
  before insert or update of vaqueiro,partner_name on public.entries
  for each row execute function public.require_entry_participants();

create or replace function public.guard_entry_transfer()
returns trigger language plpgsql set search_path = ''
as $$
declare identity_changed boolean;
begin
  if tg_op = 'INSERT' then
    if new.transfer_reason is not null or new.transferred_at is not null or new.transferred_by is not null then
      raise exception 'New entries cannot include transfer history';
    end if;
    return new;
  end if;
  identity_changed := row(new.vaqueiro,new.partner_name,new.horse,new.representation,new.category)
    is distinct from row(old.vaqueiro,old.partner_name,old.horse,old.representation,old.category);
  if old.status = 'cancelled' then
    if identity_changed or row(new.transfer_reason,new.transferred_at,new.transferred_by)
       is distinct from row(old.transfer_reason,old.transferred_at,old.transferred_by) then
      raise exception 'Cancelled entries are immutable';
    end if;
    return new;
  end if;
  if identity_changed then
    if old.status <> 'active' then raise exception 'Only active entries can be transferred'; end if;
    if length(trim(coalesce(new.transfer_reason,''))) < 10 then raise exception 'Transfer reason must contain at least 10 characters'; end if;
    if exists (select 1 from public.run_results r where r.entry_id = old.id) then raise exception 'An entry with recorded results cannot be transferred'; end if;
    new.transfer_reason := trim(new.transfer_reason);
    new.transferred_at := coalesce(new.transferred_at, now());
    if new.transferred_at > now() + interval '5 minutes' then raise exception 'Transfer time cannot be in the future'; end if;
    new.transferred_by := auth.uid();
  elsif row(new.transfer_reason,new.transferred_at,new.transferred_by)
       is distinct from row(old.transfer_reason,old.transferred_at,old.transferred_by) then
    raise exception 'Transfer metadata can only be set when participant data changes';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_entry_transfer() from public, anon, authenticated;

-- Reservation conversion overload carries both participant names. The previous
-- RPC remains available for older clients and uses the empty default.
create or replace function public.create_entry_from_ticket_reservation(
  p_entry_id uuid,p_reservation_id uuid,p_vaqueiro text,p_partner_name text,
  p_horse text,p_representation text,p_category text,p_payment_status text,
  p_paid_amount numeric,p_payment_method text
) returns public.entries
language plpgsql security definer set search_path = ''
as $$
declare target_event uuid; reservation public.ticket_reservations; created public.entries;
begin
  select event_id into target_event from public.ticket_reservations where id=p_reservation_id;
  if target_event is null or auth.uid() is null or not public.owns_event(target_event) then raise exception 'Reservation not found'; end if;
  perform 1 from public.event_ticket_counters where event_id=target_event for update;
  perform public.expire_ticket_reservations_locked(target_event);
  select * into reservation from public.ticket_reservations where id=p_reservation_id for update;
  if reservation.status <> 'active' or reservation.expires_at <= now() then raise exception 'Reservation expired or inactive'; end if;
  if length(trim(coalesce(p_vaqueiro,'')))=0 or length(trim(coalesce(p_partner_name,'')))=0 or p_category is null or p_payment_status is null or p_payment_status not in ('pending','paid','exempt')
     or coalesce(p_paid_amount,0)<0 then raise exception 'Entry fields are invalid'; end if;
  update public.ticket_reservations set status='converted' where id=p_reservation_id;
  update public.event_ticket_counters set reserved_count=greatest(reserved_count-1,0) where event_id=target_event;
  insert into public.entries(id,event_id,number,vaqueiro,partner_name,horse,representation,category,payment_status,paid,paid_amount,payment_method)
  values (coalesce(p_entry_id,gen_random_uuid()),target_event,reservation.number,trim(p_vaqueiro),coalesce(trim(p_partner_name),''),coalesce(trim(p_horse),''),coalesce(trim(p_representation),''),p_category,
          p_payment_status,p_payment_status='paid',case when p_payment_status='paid' then coalesce(p_paid_amount,0) else 0 end,
          case when p_payment_status='paid' then p_payment_method else null end)
  returning * into created;
  return created;
end;
$$;
revoke all on function public.create_entry_from_ticket_reservation(uuid,uuid,text,text,text,text,text,text,numeric,text) from public, anon;
grant execute on function public.create_entry_from_ticket_reservation(uuid,uuid,text,text,text,text,text,text,numeric,text) to authenticated;
