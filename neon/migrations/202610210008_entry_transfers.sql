-- Transfer the same ticket to a new participant without changing its event,
-- category choices or ticket number; the existing audit log keeps each revision.
alter table public.entries
  add column transfer_reason text,
  add column transferred_at timestamptz,
  add column transferred_by uuid references public.app_users(id) on delete set null,
  add constraint entries_transfer_fields check (
    (transfer_reason is null and transferred_at is null and transferred_by is null)
    or (length(trim(transfer_reason)) >= 10 and transferred_at is not null)
  );

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

  identity_changed := row(new.vaqueiro,new.horse,new.representation,new.category)
    is distinct from row(old.vaqueiro,old.horse,old.representation,old.category);

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
    if exists (select 1 from public.run_results r where r.entry_id = old.id) then
      raise exception 'An entry with recorded results cannot be transferred';
    end if;
    new.transfer_reason := trim(new.transfer_reason);
    new.transferred_at := coalesce(new.transferred_at, now());
    if new.transferred_at > now() + interval '5 minutes' then raise exception 'Transfer time cannot be in the future'; end if;
    new.transferred_by := public.current_app_user_id();
  elsif row(new.transfer_reason,new.transferred_at,new.transferred_by)
       is distinct from row(old.transfer_reason,old.transferred_at,old.transferred_by) then
    raise exception 'Transfer metadata can only be set when participant data changes';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_entry_transfer() from public, anon, authenticated;
create trigger entries_transfer_guard
  before insert or update on public.entries
  for each row execute function public.guard_entry_transfer();
