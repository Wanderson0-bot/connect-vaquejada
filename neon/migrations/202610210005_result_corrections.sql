-- Authorized corrections append a replacement and reason, then mark the prior
-- official record superseded in the same transaction. The prior score remains.
alter table public.run_results drop constraint run_results_status_check;
alter table public.run_results add constraint run_results_status_check check (status in ('official','pending','superseded'));

create table public.run_result_corrections (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  original_result_id uuid not null unique references public.run_results(id) on delete restrict,
  replacement_result_id uuid not null unique references public.run_results(id) on delete restrict,
  reason text not null check (length(trim(reason)) >= 10),
  actor_user_id uuid not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (original_result_id <> replacement_result_id)
);
create index run_result_corrections_event_idx on public.run_result_corrections(event_id, created_at desc);
alter table public.run_result_corrections enable row level security;
create policy result_corrections_owner_read on public.run_result_corrections for select to authenticated
  using ((select public.owns_event(event_id)));
revoke all on public.run_result_corrections from public, anon, authenticated;
grant select on public.run_result_corrections to authenticated;

create trigger result_corrections_audit after insert or update or delete on public.run_result_corrections
  for each row execute function public.audit_operational_change();

create or replace function public.prevent_result_correction_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Correction history is append-only';
end;
$$;
revoke all on function public.prevent_result_correction_mutation() from public, anon, authenticated;
create trigger result_corrections_append_only before update or delete on public.run_result_corrections
  for each row execute function public.prevent_result_correction_mutation();

create or replace function public.guard_run_result_changes()
returns trigger language plpgsql set search_path = ''
as $$
declare mode text;
begin
  if tg_op = 'INSERT' then
    if public.current_app_user_id() is null then raise exception 'Authenticated operator required'; end if;
    select scoring_mode into mode from public.events where id = new.event_id;
    if mode = 'confirm' and new.status = 'official' then
      raise exception 'This event requires confirmation before publishing a result';
    end if;
    if new.status = 'superseded' then raise exception 'Superseded results can only be created by a correction'; end if;
    new.created_by := public.current_app_user_id();
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status in ('official','superseded') then
      raise exception 'Published results cannot be deleted';
    end if;
    return old;
  end if;

  if old.status = 'official' then
    if new.status <> 'superseded' or
       row(new.event_id, new.entry_id, new.rodizio, new.bull_number, new.result_type, new.points, new.created_at, new.created_by)
       is distinct from
       row(old.event_id, old.entry_id, old.rodizio, old.bull_number, old.result_type, old.points, old.created_at, old.created_by) or
       not exists (select 1 from public.run_result_corrections c
                   where c.original_result_id = old.id and c.actor_user_id = public.current_app_user_id()) then
      raise exception 'Official results can only be superseded by an authorized correction';
    end if;
    return new;
  end if;

  if old.status = 'superseded' then raise exception 'Superseded results are immutable'; end if;
  if row(new.event_id, new.entry_id, new.rodizio, new.bull_number, new.result_type, new.points, new.created_at, new.created_by)
     is distinct from
     row(old.event_id, old.entry_id, old.rodizio, old.bull_number, old.result_type, old.points, old.created_at, old.created_by) then
    raise exception 'Pending result content is immutable; register a correction';
  end if;
  if new.status <> 'official' then raise exception 'Pending results can only transition to official'; end if;
  return new;
end;
$$;
revoke all on function public.guard_run_result_changes() from public, anon, authenticated;

create or replace function public.correct_official_result(
  p_original_result_id uuid,
  p_rodizio text,
  p_bull_number integer,
  p_result_type text,
  p_points numeric,
  p_reason text
) returns public.run_results
language plpgsql security definer set search_path = ''
as $$
declare original public.run_results;
        replacement public.run_results;
        event_mode text;
        correction_status text;
begin
  if public.current_app_user_id() is null then raise exception 'Authentication required'; end if;
  if p_reason is null or length(trim(p_reason)) < 10 then raise exception 'Correction reason must contain at least 10 characters'; end if;
  if p_rodizio is null or trim(p_rodizio) = '' or p_bull_number is null or p_bull_number < 1 or p_points is null or p_points < 0 or
     p_result_type not in ('points','zero','return') then raise exception 'Corrected result fields are invalid'; end if;
  if p_result_type <> 'points' and p_points <> 0 then raise exception 'Non-scoring result types must have zero points'; end if;
  select * into original from public.run_results where id = p_original_result_id for update;
  if not found or original.status <> 'official' then raise exception 'Only an official result can be corrected'; end if;
  if not exists (select 1 from public.events e join public.parks p on p.id = e.park_id
                 where e.id = original.event_id and p.owner_user_id = public.current_app_user_id()) then
    raise exception 'Not authorized to correct this result';
  end if;
  select scoring_mode into event_mode from public.events where id = original.event_id;
  correction_status := case when event_mode = 'confirm' then 'pending' else 'official' end;
  insert into public.run_results(event_id, entry_id, rodizio, bull_number, result_type, points, status, created_by)
  values (original.event_id, original.entry_id, trim(p_rodizio), p_bull_number, p_result_type, p_points, correction_status, public.current_app_user_id())
  returning * into replacement;
  insert into public.run_result_corrections(event_id, original_result_id, replacement_result_id, reason, actor_user_id)
  values (original.event_id, original.id, replacement.id, trim(p_reason), public.current_app_user_id());
  update public.run_results set status = 'superseded' where id = original.id and status = 'official';
  return replacement;
end;
$$;
revoke all on function public.correct_official_result(uuid,text,integer,text,numeric,text) from public, anon;
grant execute on function public.correct_official_result(uuid,text,integer,text,numeric,text) to authenticated;
