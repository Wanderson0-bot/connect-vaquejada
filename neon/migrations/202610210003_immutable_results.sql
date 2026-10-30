-- Sport results are append-only once registered. A pending result may only be
-- confirmed; changing its sporting content requires a future audited correction flow.
create or replace function public.guard_run_result_changes()
returns trigger language plpgsql set search_path = ''
as $$
declare mode text;
begin
  if tg_op = 'INSERT' then
    if public.current_app_user_id() is null then raise exception 'Authenticated operator required'; end if;
    select scoring_mode into mode from public.events where id = new.event_id;
    if mode = 'confirm' and new.status <> 'pending' then
      raise exception 'This event requires confirmation before publishing a result';
    end if;
    new.created_by := public.current_app_user_id();
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'official' then
      raise exception 'Official results are immutable; use an authorized correction workflow';
    end if;
    return old;
  end if;

  if old.status = 'official' then
    raise exception 'Official results are immutable; use an authorized correction workflow';
  end if;
  if row(new.event_id, new.entry_id, new.rodizio, new.bull_number, new.result_type,
         new.points, new.created_at, new.created_by)
     is distinct from
     row(old.event_id, old.entry_id, old.rodizio, old.bull_number, old.result_type,
         old.points, old.created_at, old.created_by) then
    raise exception 'Pending result content is immutable; register a new result';
  end if;
  if new.status <> 'official' then
    raise exception 'Pending results can only transition to official';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_run_result_changes() from public, anon, authenticated;
create trigger run_results_guard
  before insert or update or delete on public.run_results
  for each row execute function public.guard_run_result_changes();
