-- Cancellations are historical status changes. Ticket numbers stay assigned and
-- continue consuming capacity; they are never silently reused.
alter table public.entries
  add column status text not null default 'active',
  add column status_reason text,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.app_users(id) on delete set null,
  add constraint entries_status_valid check (status in ('active','cancelled')),
  add constraint entries_cancellation_fields check (
    (status = 'active' and status_reason is null and cancelled_at is null and cancelled_by is null)
    or (status = 'cancelled' and length(trim(status_reason)) >= 10 and cancelled_at is not null)
  );

create or replace function public.guard_entry_cancellation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'active' then raise exception 'New entries must start active'; end if;
    return new;
  end if;

  if old.status = 'cancelled' then
    if row(new.id,new.event_id,new.number,new.vaqueiro,new.horse,new.representation,new.category,new.created_at,
           new.paid,new.payment_status,new.paid_amount,new.payment_method,new.paid_at,new.paid_by,
           new.status,new.status_reason,new.cancelled_at,new.cancelled_by)
       is distinct from
       row(old.id,old.event_id,old.number,old.vaqueiro,old.horse,old.representation,old.category,old.created_at,
           old.paid,old.payment_status,old.paid_amount,old.payment_method,old.paid_at,old.paid_by,
           old.status,old.status_reason,old.cancelled_at,old.cancelled_by) then
      raise exception 'Cancelled entries are immutable';
    end if;
    return new;
  end if;

  if new.status = 'cancelled' then
    if length(trim(coalesce(new.status_reason,''))) < 10 then raise exception 'Cancellation reason must contain at least 10 characters'; end if;
    if exists (select 1 from public.run_results r where r.entry_id = old.id) then
      raise exception 'An entry with recorded results cannot be cancelled';
    end if;
    new.status_reason := trim(new.status_reason);
    new.cancelled_at := coalesce(new.cancelled_at, now());
    if new.cancelled_at > now() + interval '5 minutes' then raise exception 'Cancellation time cannot be in the future'; end if;
    new.cancelled_by := public.current_app_user_id();
    return new;
  end if;

  if new.status_reason is not null or new.cancelled_at is not null or new.cancelled_by is not null then
    raise exception 'Cancellation metadata can only be set by cancelling an active entry';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_entry_cancellation() from public, anon, authenticated;
create trigger entries_cancellation_guard
  before insert or update on public.entries
  for each row execute function public.guard_entry_cancellation();

create or replace function public.guard_result_entry_status()
returns trigger language plpgsql set search_path = ''
as $$
declare entry_status text;
begin
  -- Serialize result creation with cancellation on the same entry row.
  select e.status into entry_status from public.entries e where e.id = new.entry_id for update;
  if entry_status is distinct from 'active' then
    raise exception 'Results cannot be recorded for a cancelled entry';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_result_entry_status() from public, anon, authenticated;
create trigger run_results_active_entry
  before insert on public.run_results
  for each row execute function public.guard_result_entry_status();
