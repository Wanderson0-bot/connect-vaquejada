-- Individual park membership and server-enforced action permissions.
-- Platform administrators are provisioned only by a trusted database operator.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.platform_admins (
  user_id uuid primary key references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users(id) on delete set null
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from public, anon, authenticated;

create table public.park_memberships (
  park_id uuid not null references public.parks(id) on delete restrict,
  user_id uuid not null unique references public.app_users(id) on delete restrict,
  role text not null check (role in ('park_manager','office','announcer','judge','track_operator')),
  created_by uuid not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz,
  primary key (park_id,user_id)
);
create index park_memberships_active_idx on public.park_memberships(park_id,role) where disabled_at is null;
alter table public.park_memberships enable row level security;
revoke insert, update, delete on public.park_memberships from public, anon, authenticated;
grant select on public.park_memberships to authenticated;

create table public.park_membership_audit (
  id bigint generated always as identity primary key,
  park_id uuid not null references public.parks(id) on delete restrict,
  subject_user_id uuid not null references public.app_users(id) on delete restrict,
  actor_user_id uuid references public.app_users(id) on delete set null,
  action text not null check (action in ('INSERT','UPDATE')),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index park_membership_audit_park_created_idx on public.park_membership_audit(park_id,created_at desc);
alter table public.park_membership_audit enable row level security;
revoke all on public.park_membership_audit from public,anon;
grant select on public.park_membership_audit to authenticated;
create or replace function public.audit_park_membership_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op='INSERT' then
    insert into public.park_membership_audit(park_id,subject_user_id,actor_user_id,action,before_data,after_data)
     values(new.park_id,new.user_id,public.current_app_user_id(),tg_op,null,to_jsonb(new));
  else
    insert into public.park_membership_audit(park_id,subject_user_id,actor_user_id,action,before_data,after_data)
     values(new.park_id,new.user_id,public.current_app_user_id(),tg_op,to_jsonb(old),to_jsonb(new));
  end if;
  return new;
end;
$$;
create trigger park_memberships_audit after insert or update on public.park_memberships for each row execute function public.audit_park_membership_change();
revoke all on function public.audit_park_membership_change() from public,anon,authenticated;

create table public.park_invitations (
  id uuid primary key default gen_random_uuid(),
  park_id uuid not null references public.parks(id) on delete restrict,
  email text not null,
  role text not null check (role in ('park_manager','office','announcer','judge','track_operator')),
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  created_by uuid not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  accepted_by uuid references public.app_users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  check (accepted_at is null or accepted_by is not null)
);
create index park_invitations_active_idx on public.park_invitations(park_id,email) where accepted_at is null and revoked_at is null;
alter table public.park_invitations enable row level security;
revoke all on public.park_invitations from public, anon, authenticated;
grant select on public.park_invitations to authenticated;

create or replace function public.has_park_permission(p_park_id uuid,p_permission text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare member_role text; is_owner boolean;
begin
  if public.current_app_user_id() is null or p_park_id is null then return false; end if;
  if p_permission = 'platform.admin' then
    return exists(select 1 from public.platform_admins a where a.user_id=public.current_app_user_id());
  end if;
  select exists(select 1 from public.parks p where p.id=p_park_id and p.owner_user_id=public.current_app_user_id()) into is_owner;
  if is_owner then return true; end if;
  -- Lock the authorization row for the duration of this statement/transaction. A concurrent
  -- role change or deactivation waits, so an already-authorized write is serialized first.
  select m.role into member_role from public.park_memberships m
   where m.park_id=p_park_id and m.user_id=public.current_app_user_id() and m.disabled_at is null
   for share;
  if member_role is null then return false; end if;
  if member_role='park_manager' then return true; end if;
  return case p_permission
    when 'event.read' then member_role in ('office','announcer','judge','track_operator')
    when 'entry.read' then member_role in ('office','announcer','judge','track_operator')
    when 'entry.create' then member_role='office'
    when 'entry.update' then member_role='office'
    when 'payment.record' then member_role='office'
    when 'report.read' then member_role in ('office','announcer')
    when 'track.read' then member_role in ('announcer','judge','track_operator')
    when 'track.queue' then member_role='track_operator'
    when 'track.rotation_control' then member_role='track_operator'
    when 'result.read' then member_role in ('announcer','judge')
    when 'result.judge' then member_role='judge'
    when 'result.return_decide' then member_role='judge'
    when 'standings.read' then member_role='announcer'
    else false
  end;
end;
$$;
revoke all on function public.has_park_permission(uuid,text) from public,anon;
grant execute on function public.has_park_permission(uuid,text) to authenticated;
create policy park_membership_audit_manager_read on public.park_membership_audit for select to authenticated
 using ((select public.has_park_permission(park_id,'users.manage')));

create or replace function public.has_event_permission(p_event_id uuid,p_permission text)
returns boolean language sql security definer set search_path = ''
as $$
  select coalesce((select public.has_park_permission(e.park_id,p_permission) from public.events e where e.id=p_event_id),false);
$$;
revoke all on function public.has_event_permission(uuid,text) from public,anon;
grant execute on function public.has_event_permission(uuid,text) to authenticated;

create or replace function public.require_event_permission(p_event_id uuid,p_permission text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if public.current_app_user_id() is null or not public.has_event_permission(p_event_id,p_permission) then
    raise exception 'Permission denied for event operation' using errcode='42501';
  end if;
end;
$$;
revoke all on function public.require_event_permission(uuid,text) from public,anon,authenticated;

create or replace function public.get_my_park_context()
returns table(id uuid,owner_user_id uuid,name text,manager_name text,phone text,city text,state char(2),address text,access_role text)
language sql stable security definer set search_path = ''
as $$
  select p.id,p.owner_user_id,p.name,p.manager_name,p.phone,p.city,p.state,p.address,
         case when p.owner_user_id=public.current_app_user_id() then 'park_manager' else m.role end
    from public.parks p
    left join public.park_memberships m on m.park_id=p.id and m.user_id=public.current_app_user_id() and m.disabled_at is null
   where public.current_app_user_id() is not null and (p.owner_user_id=public.current_app_user_id() or m.user_id=public.current_app_user_id())
   order by (p.owner_user_id=public.current_app_user_id()) desc,p.created_at
   limit 1;
$$;
revoke all on function public.get_my_park_context() from public,anon;
grant execute on function public.get_my_park_context() to authenticated;

-- RLS is row-scoped. Remove direct access to financial entry columns and expose them
-- only through a server function that checks the current park permission.
revoke select on public.entries from authenticated;
grant select (id,event_id,number,vaqueiro,partner_name,horse,representation,category,status,status_reason,cancelled_at,cancelled_by,transfer_reason,transferred_at,transferred_by,created_at,updated_at)
  on public.entries to authenticated;

create or replace function public.get_event_entries()
returns table(
  id uuid,event_id uuid,number integer,vaqueiro text,partner_name text,horse text,representation text,category text,
  paid boolean,payment_status text,paid_amount numeric,payment_method text,paid_at timestamptz,paid_by uuid,
  status text,status_reason text,cancelled_at timestamptz,cancelled_by uuid,transfer_reason text,transferred_at timestamptz,
  transferred_by uuid,created_at timestamptz,updated_at timestamptz
)
language sql security definer set search_path = ''
as $$
  select e.id,e.event_id,e.number,e.vaqueiro,e.partner_name,e.horse,e.representation,e.category,
    case when public.has_event_permission(e.event_id,'payment.record') then e.paid else null end,
    case when public.has_event_permission(e.event_id,'payment.record') then e.payment_status else null end,
    case when public.has_event_permission(e.event_id,'payment.record') then e.paid_amount else null end,
    case when public.has_event_permission(e.event_id,'payment.record') then e.payment_method else null end,
    case when public.has_event_permission(e.event_id,'payment.record') then e.paid_at else null end,
    case when public.has_event_permission(e.event_id,'payment.record') then e.paid_by else null end,
    e.status,e.status_reason,e.cancelled_at,e.cancelled_by,e.transfer_reason,e.transferred_at,e.transferred_by,e.created_at,e.updated_at
  from public.entries e
  where public.has_event_permission(e.event_id,'entry.read');
$$;
revoke all on function public.get_event_entries() from public,anon;
grant execute on function public.get_event_entries() to authenticated;

create or replace function public.get_entry_payment_state(p_entry_id uuid)
returns table(payment_status text,paid_amount numeric,payment_method text)
language plpgsql security definer set search_path = ''
as $$
declare target_event uuid;
begin
  select event_id into target_event from public.entries where id=p_entry_id;
  if target_event is null then return; end if;
  perform public.require_event_permission(target_event,'payment.record');
  return query select e.payment_status,e.paid_amount,e.payment_method from public.entries e where e.id=p_entry_id;
end;
$$;
revoke all on function public.get_entry_payment_state(uuid) from public,anon;
grant execute on function public.get_entry_payment_state(uuid) to authenticated;

create or replace function public.create_park_invitation(p_email text,p_role text)
returns table(invitation_id uuid,invitation_token uuid,expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare current_park uuid; token_value uuid := gen_random_uuid(); created public.park_invitations;
begin
  select p.id into current_park from public.parks p
   where p.owner_user_id=public.current_app_user_id() or (p.id in (select m.park_id from public.park_memberships m where m.user_id=public.current_app_user_id() and m.role='park_manager' and m.disabled_at is null))
   order by (p.owner_user_id=public.current_app_user_id()) desc,p.created_at limit 1;
  if current_park is null or not public.has_park_permission(current_park,'users.manage') then raise exception 'User management denied' using errcode='42501'; end if;
  if p_email is null or length(trim(p_email))<5 or position('@' in trim(p_email))<2 then raise exception 'Valid invitation email required'; end if;
  if p_role not in ('park_manager','office','announcer','judge','track_operator') then raise exception 'Role cannot be assigned by a park'; end if;
  if exists(select 1 from public.app_users u join public.parks p on p.owner_user_id=u.id where lower(u.email)=lower(trim(p_email))) then raise exception 'Park owners cannot be assigned to another park'; end if;
  update public.park_invitations i set revoked_at=now()
   where i.park_id=current_park and lower(i.email)=lower(trim(p_email)) and i.accepted_at is null and i.revoked_at is null;
  insert into public.park_invitations(park_id,email,role,token_hash,expires_at,created_by)
   values(current_park,lower(trim(p_email)),p_role,extensions.digest(convert_to(token_value::text,'UTF8'),'sha256'),now()+interval '7 days',public.current_app_user_id()) returning * into created;
  return query select created.id,token_value,created.expires_at;
end;
$$;
revoke all on function public.create_park_invitation(text,text) from public,anon;
grant execute on function public.create_park_invitation(text,text) to authenticated;

create or replace function public.accept_park_invitation(p_invitation_token uuid)
returns table(park_id uuid,role text)
language plpgsql security definer set search_path = ''
as $$
declare current_email text; invitation public.park_invitations; current_owner uuid;
begin
  if public.current_app_user_id() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select lower(u.email) into current_email from public.app_users u where u.id=public.current_app_user_id() and u.email_confirmed_at is not null;
  if current_email is null then raise exception 'Confirmed individual email required' using errcode='42501'; end if;
  select i.* into invitation from public.park_invitations i
   where i.token_hash=extensions.digest(convert_to(p_invitation_token::text,'UTF8'),'sha256')
     and lower(i.email)=current_email and i.accepted_at is null and i.revoked_at is null and i.expires_at>now()
   for update;
  if not found then raise exception 'Invitation invalid, expired, revoked, or issued to another identity' using errcode='42501'; end if;
  select p.owner_user_id into current_owner from public.parks p where p.id=invitation.park_id;
  if current_owner=public.current_app_user_id() or exists(select 1 from public.parks p where p.owner_user_id=public.current_app_user_id()) then raise exception 'Park owners cannot accept a staff invitation' using errcode='42501'; end if;
  if exists(select 1 from public.park_memberships m where m.user_id=public.current_app_user_id() and m.disabled_at is null) then raise exception 'User already has an active park membership'; end if;
  insert into public.park_memberships(park_id,user_id,role,created_by,disabled_at)
   values(invitation.park_id,public.current_app_user_id(),invitation.role,invitation.created_by,null)
   on conflict(park_id,user_id) do update set role=excluded.role,created_by=excluded.created_by,updated_at=now(),disabled_at=null
   where public.park_memberships.disabled_at is not null;
  update public.park_invitations set accepted_by=public.current_app_user_id(),accepted_at=now() where id=invitation.id;
  return query select invitation.park_id,invitation.role;
end;
$$;
revoke all on function public.accept_park_invitation(uuid) from public,anon;
grant execute on function public.accept_park_invitation(uuid) to authenticated;

create or replace function public.deactivate_park_member(p_user_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare target_park uuid;
begin
  select m.park_id into target_park from public.park_memberships m where m.user_id=p_user_id and m.disabled_at is null;
  if target_park is null or p_user_id=public.current_app_user_id() or not public.has_park_permission(target_park,'users.manage') then raise exception 'Member management denied' using errcode='42501'; end if;
  update public.park_memberships set disabled_at=now(),updated_at=now() where user_id=p_user_id and park_id=target_park and disabled_at is null;
  update public.park_invitations set revoked_at=now() where park_id=target_park and accepted_by=p_user_id and revoked_at is null;
end;
$$;
revoke all on function public.deactivate_park_member(uuid) from public,anon;
grant execute on function public.deactivate_park_member(uuid) to authenticated;

create policy park_memberships_read_self_or_manager on public.park_memberships for select to authenticated
 using (user_id=(select public.current_app_user_id()) or (select public.has_park_permission(park_id,'users.manage')));
create policy park_invitations_manager_read on public.park_invitations for select to authenticated
 using ((select public.has_park_permission(park_id,'users.manage')));

create or replace function public.prevent_park_owner_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.owner_user_id is distinct from old.owner_user_id then raise exception 'Park identity is immutable'; end if;
  if not public.has_park_permission(old.id,'park.manage') then raise exception 'Park management denied' using errcode='42501'; end if;
  return new;
end;
$$;
create trigger parks_identity_guard before update on public.parks for each row execute function public.prevent_park_owner_change();
revoke all on function public.prevent_park_owner_change() from public,anon,authenticated;

create or replace function public.guard_park_create()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if public.current_app_user_id() is null or new.owner_user_id is distinct from public.current_app_user_id() then raise exception 'Park must belong to the authenticated user' using errcode='42501'; end if;
  if exists(select 1 from public.parks p where p.owner_user_id=public.current_app_user_id()) then raise exception 'This identity already owns a park'; end if;
  if exists(select 1 from public.park_memberships m where m.user_id=public.current_app_user_id() and m.disabled_at is null) then raise exception 'A staff identity cannot create a park'; end if;
  return new;
end;
$$;
create trigger parks_create_guard before insert on public.parks for each row execute function public.guard_park_create();
revoke all on function public.guard_park_create() from public,anon,authenticated;

create or replace function public.guard_entry_permission()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op='INSERT' then
    perform public.require_event_permission(new.event_id,'entry.create');
    if new.payment_status<>'pending' or coalesce(new.paid_amount,0)<>0 or new.payment_method is not null then perform public.require_event_permission(new.event_id,'payment.record'); end if;
    return new;
  end if;
  if new.event_id is distinct from old.event_id or new.number is distinct from old.number then raise exception 'Entry event and ticket identity are immutable'; end if;
  if new.status is distinct from old.status then
    if new.status='cancelled' then perform public.require_event_permission(old.event_id,'entry.cancel');
    else raise exception 'Entry status transition is not authorized'; end if;
  end if;
  if row(new.vaqueiro,new.partner_name,new.horse,new.representation,new.category) is distinct from row(old.vaqueiro,old.partner_name,old.horse,old.representation,old.category) then
    if new.transfer_reason is distinct from old.transfer_reason or new.transferred_at is distinct from old.transferred_at then perform public.require_event_permission(old.event_id,'entry.transfer');
    else perform public.require_event_permission(old.event_id,'entry.update'); end if;
  end if;
  if row(new.payment_status,new.paid,new.paid_amount,new.payment_method) is distinct from row(old.payment_status,old.paid,old.paid_amount,old.payment_method) then perform public.require_event_permission(old.event_id,'payment.record'); end if;
  return new;
end;
$$;
create trigger entries_00_authorization before insert or update on public.entries for each row execute function public.guard_entry_permission();
revoke all on function public.guard_entry_permission() from public,anon,authenticated;

create or replace function public.guard_result_permission()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op='INSERT' then perform public.require_event_permission(new.event_id,'result.judge'); return new; end if;
  if tg_op='DELETE' then raise exception 'Results cannot be deleted'; end if;
  if old.status='pending' and new.status='official' then perform public.require_event_permission(old.event_id,'result.confirm'); return new; end if;
  if old.status='official' and new.status='superseded' then perform public.require_event_permission(old.event_id,'result.correct'); return new; end if;
  if new.status is distinct from old.status then raise exception 'Result status transition is not authorized'; end if;
  if row(new.event_id,new.entry_id,new.rodizio,new.bull_number,new.result_type,new.points,new.created_at,new.created_by)
     is distinct from row(old.event_id,old.entry_id,old.rodizio,old.bull_number,old.result_type,old.points,old.created_at,old.created_by) then
    raise exception 'Result content is immutable; use the correction workflow';
  end if;
  return new;
end;
$$;
create trigger results_00_authorization before insert or update or delete on public.run_results for each row execute function public.guard_result_permission();
revoke all on function public.guard_result_permission() from public,anon,authenticated;

drop policy if exists parks_owner_all on public.parks;
drop policy if exists events_owner_all on public.events;
drop policy if exists entries_event_owner_all on public.entries;
drop policy if exists results_event_owner_all on public.run_results;
drop policy if exists audit_log_park_read on public.audit_log;
drop policy if exists ticket_reservations_owner_read on public.ticket_reservations;
drop policy if exists result_corrections_owner_read on public.run_result_corrections;
drop policy if exists event_track_states_owner_read on public.event_track_states;
drop policy if exists event_track_operations_owner_read on public.event_track_operations;

create policy parks_member_read on public.parks for select to authenticated using ((select public.has_park_permission(id,'event.read')) or (select public.has_park_permission(id,'park.manage')));
create policy parks_self_create on public.parks for insert to authenticated with check (owner_user_id=(select public.current_app_user_id()));
create policy parks_manager_update on public.parks for update to authenticated using ((select public.has_park_permission(id,'park.manage'))) with check ((select public.has_park_permission(id,'park.manage')));
create policy events_member_read on public.events for select to authenticated using ((select public.has_event_permission(id,'event.read')) or (select public.has_event_permission(id,'park.manage')));
create policy events_manager_insert on public.events for insert to authenticated with check ((select public.has_park_permission(park_id,'event.manage')));
create policy events_manager_update on public.events for update to authenticated using ((select public.has_event_permission(id,'event.manage'))) with check ((select public.has_park_permission(park_id,'event.manage')));
create policy entries_member_read on public.entries for select to authenticated using ((select public.has_event_permission(event_id,'entry.read')));
create policy entries_staff_insert on public.entries for insert to authenticated with check ((select public.has_event_permission(event_id,'entry.create')));
create policy entries_staff_update on public.entries for update to authenticated using ((select public.has_event_permission(event_id,'entry.update')) or (select public.has_event_permission(event_id,'payment.record')) or (select public.has_event_permission(event_id,'entry.cancel')) or (select public.has_event_permission(event_id,'entry.transfer'))) with check ((select public.has_event_permission(event_id,'entry.read')));
create policy results_member_read on public.run_results for select to authenticated using ((select public.has_event_permission(event_id,'result.read')));
create policy results_judge_insert on public.run_results for insert to authenticated with check ((select public.has_event_permission(event_id,'result.judge')));
create policy results_manager_confirm on public.run_results for update to authenticated using (status='pending' and (select public.has_event_permission(event_id,'result.confirm'))) with check (status='official' and (select public.has_event_permission(event_id,'result.confirm')));
create policy audit_member_read on public.audit_log for select to authenticated using ((select public.has_park_permission(park_id,'audit.read')));
create policy reservation_staff_read on public.ticket_reservations for select to authenticated using ((select public.has_event_permission(event_id,'entry.read')));
create policy result_corrections_manager_read on public.run_result_corrections for select to authenticated using ((select public.has_event_permission(event_id,'result.correct')));
create policy track_staff_read on public.event_track_states for select to authenticated using ((select public.has_event_permission(event_id,'track.read')));
create policy track_audit_read on public.event_track_operations for select to authenticated using ((select public.has_event_permission(event_id,'track.read')));

create or replace function public.owns_event(target_event uuid)
returns boolean language sql security definer set search_path = ''
as $$
  -- Legacy RPCs use this predicate for manager-only reservation and capacity actions.
  select coalesce(public.has_event_permission(target_event,'event.manage'),false);
$$;

create or replace function public.create_park_event(
  p_id uuid,p_name text,p_location text,p_starts_at timestamptz,p_ends_at timestamptz,p_categories text[],
  p_rules jsonb,p_category_rules jsonb,p_ticket_quantity integer,p_ticket_price numeric,p_prizes jsonb,p_scoring_mode text
) returns public.events language plpgsql security invoker set search_path = ''
as $$
declare created public.events; current_park_id uuid;
begin
  if public.current_app_user_id() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select p.id into current_park_id from public.parks p where p.owner_user_id=public.current_app_user_id() or public.has_park_permission(p.id,'event.manage') order by (p.owner_user_id=public.current_app_user_id()) desc,p.created_at limit 1;
  if current_park_id is null then raise exception 'Event management denied' using errcode='42501'; end if;
  if trim(p_name)='' or p_starts_at is null or p_ends_at<p_starts_at or coalesce(cardinality(p_categories),0)=0 then raise exception 'Event fields are invalid'; end if;
  insert into public.events(id,park_id,name,location,starts_at,ends_at,categories,rules,category_rules,ticket_quantity,ticket_price,prizes,scoring_mode)
  values(coalesce(p_id,gen_random_uuid()),current_park_id,trim(p_name),coalesce(p_location,''),p_starts_at,p_ends_at,p_categories,
    coalesce(p_rules,'{}'::jsonb),coalesce(p_category_rules,'{}'::jsonb),p_ticket_quantity,p_ticket_price,coalesce(p_prizes,'[]'::jsonb),coalesce(p_scoring_mode,'instant'))
  returning * into created;
  return created;
end;
$$;

create or replace function public.correct_official_result(
  p_original_result_id uuid,p_rodizio text,p_bull_number integer,p_result_type text,p_points numeric,p_reason text
) returns public.run_results language plpgsql security definer set search_path = ''
as $$
declare original public.run_results; replacement public.run_results; event_mode text; correction_status text;
begin
  select * into original from public.run_results where id=p_original_result_id for update;
  if not found or original.status<>'official' then raise exception 'Official result not found'; end if;
  perform public.require_event_permission(original.event_id,'result.correct');
  if p_reason is null or length(trim(p_reason))<10 then raise exception 'Correction reason must contain at least 10 characters'; end if;
  if p_rodizio is null or trim(p_rodizio)='' or p_bull_number is null or p_bull_number<1 or p_points is null or p_points<0 or p_result_type not in ('points','zero','return') then raise exception 'Corrected result fields are invalid'; end if;
  select scoring_mode into event_mode from public.events where id=original.event_id;
  correction_status:=case when event_mode='confirm' then 'pending' else 'official' end;
  insert into public.run_results(event_id,entry_id,rodizio,bull_number,result_type,points,status)
    values(original.event_id,original.entry_id,trim(p_rodizio),p_bull_number,p_result_type,p_points,correction_status) returning * into replacement;
  insert into public.run_result_corrections(event_id,original_result_id,replacement_result_id,reason,actor_user_id)
    values(original.event_id,original.id,replacement.id,trim(p_reason),public.current_app_user_id());
  update public.run_results set status='superseded',updated_at=now() where id=original.id;
  return replacement;
end;
$$;

create or replace function public.apply_event_track_operation(
  p_event_id uuid,p_operation_id uuid,p_base_version bigint,p_action text,p_state jsonb,p_actor_label text
) returns table(version bigint,duplicate boolean)
language plpgsql security definer set search_path = ''
as $$
declare current_version bigint; saved_state jsonb; prior public.event_track_operations; target_park uuid; next_version bigint; history_count integer; initializing boolean; permission_name text;
begin
  permission_name:=case p_action
    when 'rotation.pause' then 'track.rotation_control' when 'rotation.resume' then 'track.rotation_control'
    when 'rotation.close' then 'track.rotation_close' when 'rotation.reopen' then 'track.rotation_reopen'
    when 'call.create' then 'track.queue' when 'call.present' then 'track.queue' when 'call.absent' then 'track.queue' when 'call.move_tail' then 'track.queue'
    when 'race.start' then 'track.queue' when 'race.judge' then 'result.judge' when 'return.decide' then 'result.return_decide'
    when 'return.create_race' then 'result.return_decide' when 'result.confirm' then 'result.confirm' when 'result.correct' then 'result.correct' else null end;
  if permission_name is null then raise exception 'Track action is not allowed' using errcode='42501'; end if;
  perform public.require_event_permission(p_event_id,permission_name);
  if p_operation_id is null or p_base_version<0 or length(trim(coalesce(p_actor_label,'')))=0 then raise exception 'Operation id, base version and actor are required'; end if;
  if p_state->>'eventId' is distinct from p_event_id::text or p_state->>'id' is distinct from p_event_id::text then raise exception 'Track state event mismatch'; end if;
  if jsonb_typeof(p_state->'history') is distinct from 'array' or jsonb_typeof(p_state->'races') is distinct from 'array' or jsonb_typeof(p_state->'calls') is distinct from 'array' then raise exception 'Track state collections are invalid'; end if;
  history_count:=jsonb_array_length(p_state->'history');
  if history_count<1 or p_state->'history'->(history_count-1)->>'operationId' is distinct from p_operation_id::text
    or p_state->'history'->(history_count-1)->>'action' is distinct from p_action
    or p_state->'history'->(history_count-1)->>'operator' is distinct from trim(p_actor_label) then raise exception 'Track operation does not match its audit record'; end if;
  select * into prior from public.event_track_operations where operation_id=p_operation_id;
  if found then
    if prior.event_id<>p_event_id or prior.state<>p_state then raise exception 'Operation id reused with different content'; end if;
    return query select prior.resulting_version,true; return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_event_id::text,0));
  select park_id into target_park from public.events where id=p_event_id;
  select s.version,s.state into current_version,saved_state from public.event_track_states s where s.event_id=p_event_id for update;
  initializing:=not found;
  if initializing then current_version:=0;saved_state:=null;end if;
  if current_version<>p_base_version then raise exception 'Track version conflict' using errcode='40001';end if;
  next_version:=current_version+1;
  if (p_state->>'version')::bigint is distinct from next_version then raise exception 'Track state version does not match expected version';end if;
  if (initializing and history_count<>1) or (not initializing and (history_count<>jsonb_array_length(saved_state->'history')+1 or (p_state->'history'-(history_count-1))<>saved_state->'history')) then raise exception 'Track history must append exactly one immutable operation';end if;
  if exists(select 1 from jsonb_array_elements(p_state->'races') as x(value) where x.value->>'eventId' is distinct from p_event_id::text or not exists(select 1 from public.entries e where e.id::text=x.value->>'entryId' and e.event_id=p_event_id and e.number::text=x.value->>'ticketNumber'))
     or exists(select 1 from jsonb_array_elements(p_state->'calls') as x(value) where x.value->>'eventId' is distinct from p_event_id::text or not exists(select 1 from public.entries e where e.id::text=x.value->>'entryId' and e.event_id=p_event_id)) then raise exception 'Track state contains an entry from another event or a mismatched ticket';end if;
   if exists(select 1 from jsonb_array_elements(coalesce(saved_state->'races','[]'::jsonb)) as oldr(value) where oldr.value->>'resultStatus'='official' and not exists(select 1 from jsonb_array_elements(p_state->'races') as newr(value) where newr.value->>'id'=oldr.value->>'id' and (newr.value=oldr.value or (p_action='result.correct' and p_state->'history'->(history_count-1)->'before'=oldr.value)))) then raise exception 'Official track results cannot be removed or silently replaced';end if;
  if initializing then insert into public.event_track_states(event_id,park_id,version,state,updated_at) values(p_event_id,target_park,next_version,p_state,now());
  else update public.event_track_states set version=next_version,state=p_state,updated_at=now() where event_id=p_event_id;end if;
  insert into public.event_track_operations(operation_id,event_id,base_version,resulting_version,action,state,actor_label,actor_user_id) values(p_operation_id,p_event_id,p_base_version,next_version,p_action,p_state,left(trim(p_actor_label),120),public.current_app_user_id());
  return query select next_version,false;
end;
$$;

-- Remove platform-wide entry points; park-scoped RPCs remain available to authenticated users.
revoke all on function public.create_park_event(uuid,text,text,timestamptz,timestamptz,text[],jsonb,jsonb,integer,numeric,jsonb,text) from public,anon;
grant execute on function public.create_park_event(uuid,text,text,timestamptz,timestamptz,text[],jsonb,jsonb,integer,numeric,jsonb,text) to authenticated;
revoke all on function public.correct_official_result(uuid,text,integer,text,numeric,text) from public,anon;
grant execute on function public.correct_official_result(uuid,text,integer,text,numeric,text) to authenticated;
revoke all on function public.apply_event_track_operation(uuid,uuid,bigint,text,jsonb,text) from public,anon;
grant execute on function public.apply_event_track_operation(uuid,uuid,bigint,text,jsonb,text) to authenticated;
