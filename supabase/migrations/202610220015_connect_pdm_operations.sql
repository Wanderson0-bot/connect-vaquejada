-- Central Connect PDM provisioning and event-scoped temporary operational access.
-- Park/event identities and histories remain stable; no existing rows are deleted.

-- Fail closed before any schema/data mutation. Legacy park-level operational
-- assignments are not evidence of assignment to each event. Review them before
-- this migration; migration 016 provides the post-015 reconciliation workflow.
do $$
begin
  if exists (
    select 1 from public.park_memberships m
     where m.disabled_at is null and m.role in ('office','announcer','judge','track_operator')
  ) or exists (
    select 1 from public.park_invitations i
     where i.role in ('office','announcer','judge','track_operator')
       and i.accepted_at is null and i.revoked_at is null
  ) then
    raise exception 'Migration 015 blocked: legacy operational access needs review. Run the read-only preflight and reconcile assignments before retrying.';
  end if;
end;
$$;

alter table public.parks alter column owner_user_id drop not null;
alter table public.parks add column connect_code text;
update public.parks
   set connect_code = 'PDM-' || upper(replace(id::text, '-', ''))
 where connect_code is null;
alter table public.parks alter column connect_code set not null;
create unique index parks_connect_code_ci_uidx on public.parks(upper(connect_code));
alter table public.parks add column access_status text not null default 'active'
  check (access_status in ('active','suspended','closed'));

-- A deleted Auth owner must not cascade-delete the park and its event history.
alter table public.parks drop constraint parks_owner_user_id_fkey;
alter table public.parks add constraint parks_owner_user_id_fkey
  foreign key (owner_user_id) references auth.users(id) on delete set null;

alter table public.events add column operational_status text not null default 'active'
  check (operational_status in ('active','closed'));

create table public.connect_platform_audit (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  park_id uuid references public.parks(id) on delete restrict,
  event_id uuid references public.events(id) on delete restrict,
  action text not null,
  reason text,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
alter table public.connect_platform_audit enable row level security;
revoke all on public.connect_platform_audit from public, anon, authenticated, service_role;

-- Internal Connect PDM roles are provisioned by a trusted database operator or
-- by a current platform administrator. These records are never client-writable.
create table public.connect_platform_staff (
  user_id uuid primary key references auth.users(id) on delete restrict,
  role text not null check (role in ('deployment','support')),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.connect_platform_staff enable row level security;
revoke all on public.connect_platform_staff from public, anon, authenticated, service_role;

create table public.connect_platform_staff_audit (
  id bigint generated always as identity primary key,
  subject_user_id uuid not null references auth.users(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('grant','change','revoke')),
  before_role text,
  after_role text,
  occurred_at timestamptz not null default now()
);
alter table public.connect_platform_staff_audit enable row level security;
revoke all on public.connect_platform_staff_audit from public, anon, authenticated, service_role;
revoke all on public.platform_admins from public, anon, authenticated, service_role;
revoke all on public.park_memberships, public.park_invitations from service_role;

create or replace function public.has_platform_permission(p_permission text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare platform_role text;
begin
  if auth.uid() is null then return false; end if;
  if exists (select 1 from public.platform_admins a where a.user_id = auth.uid()) then
    return p_permission in (
      'platform.admin','platform.staff.manage','platform.park.create','platform.park.read',
      'platform.park.manage','platform.park.suspend','platform.event.create','platform.event.read',
      'platform.event.manage','platform.event.staff.manage','platform.installation.read','platform.audit.read'
    );
  end if;
  select s.role into platform_role from public.connect_platform_staff s
   where s.user_id = auth.uid() and s.revoked_at is null;
  return case platform_role
    when 'deployment' then p_permission in (
      'platform.park.create','platform.park.read','platform.park.manage','platform.park.suspend',
      'platform.event.create','platform.event.read','platform.event.manage','platform.event.staff.manage'
    )
    when 'support' then p_permission in ('platform.park.read','platform.installation.read','platform.audit.read')
    else false
  end;
end;
$$;
revoke all on function public.has_platform_permission(text) from public, anon;
grant execute on function public.has_platform_permission(text) to authenticated;

create or replace function public.get_my_platform_context()
returns table(role text)
language sql stable security definer set search_path = ''
as $$
  select case when exists (select 1 from public.platform_admins a where a.user_id = auth.uid())
              then 'platform_admin'
              else (select s.role from public.connect_platform_staff s
                     where s.user_id = auth.uid() and s.revoked_at is null) end
   where auth.uid() is not null
     and (exists (select 1 from public.platform_admins a where a.user_id = auth.uid())
          or exists (select 1 from public.connect_platform_staff s where s.user_id = auth.uid() and s.revoked_at is null));
$$;
revoke all on function public.get_my_platform_context() from public, anon;
grant execute on function public.get_my_platform_context() to authenticated;

create or replace function public.manage_connect_platform_staff(p_email text, p_role text)
returns void language plpgsql security definer set search_path = ''
as $$
declare target_user uuid;
begin
  if not public.has_platform_permission('platform.staff.manage') then
    raise exception 'Platform staff management denied' using errcode = '42501';
  end if;
  if p_role not in ('deployment','support') or p_email is null or position('@' in trim(p_email)) < 2 then
    raise exception 'Platform staff identity or role is invalid';
  end if;
  select u.id into target_user from auth.users u where lower(u.email) = lower(trim(p_email));
  if target_user is null then raise exception 'Create the individual Auth account before assigning platform access'; end if;
  insert into public.connect_platform_staff(user_id,role,granted_by,revoked_at,updated_at)
    values(target_user,p_role,auth.uid(),null,now())
  on conflict(user_id) do update set role = excluded.role, granted_by = excluded.granted_by,
    revoked_at = null, updated_at = now();
end;
$$;
revoke all on function public.manage_connect_platform_staff(text,text) from public, anon;
grant execute on function public.manage_connect_platform_staff(text,text) to authenticated;

create or replace function public.revoke_connect_platform_staff(p_email text)
returns void language plpgsql security definer set search_path = ''
as $$
declare target_user uuid; prior_role text;
begin
  if not public.has_platform_permission('platform.staff.manage') then
    raise exception 'Platform staff management denied' using errcode = '42501';
  end if;
  select u.id into target_user from auth.users u where lower(u.email) = lower(trim(p_email));
  if target_user is null then raise exception 'Platform staff identity not found'; end if;
  select s.role into prior_role from public.connect_platform_staff s
   where s.user_id = target_user and s.revoked_at is null for update;
  if prior_role is null then raise exception 'Platform staff access is already inactive'; end if;
  update public.connect_platform_staff set revoked_at = now(), updated_at = now() where user_id = target_user;
end;
$$;
revoke all on function public.revoke_connect_platform_staff(text) from public, anon;
grant execute on function public.revoke_connect_platform_staff(text) to authenticated;

-- Existing end-user self-service park creation is removed. Park codes are
-- assigned by Connect PDM and are the idempotent business lookup key.
drop policy if exists parks_self_create on public.parks;
drop policy if exists parks_owner_all on public.parks;
drop policy if exists parks_member_read on public.parks;
drop policy if exists parks_manager_update on public.parks;
create policy parks_member_read on public.parks for select to authenticated
  using ((select public.has_park_permission(id,'event.read')) or (select public.has_park_permission(id,'park.manage')));
create policy parks_manager_update on public.parks for update to authenticated
  using ((select public.has_park_permission(id,'park.manage')))
  with check ((select public.has_park_permission(id,'park.manage')));
revoke insert, delete on public.parks from public, anon, authenticated;
revoke all on function public.create_park_account(text,text,text,text,text,text) from public, anon, authenticated;

-- Park-wide staff invitations are restricted to optional park-manager access.
-- Operational roles must be granted for an individual event with an expiry.
create or replace function public.create_park_invitation(p_email text,p_role text)
returns table(invitation_id uuid,invitation_token uuid,expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare current_park uuid; token_value uuid := gen_random_uuid(); created public.park_invitations;
begin
  select p.id into current_park from public.parks p
   where p.owner_user_id=auth.uid() or p.id in (
     select m.park_id from public.park_memberships m where m.user_id=auth.uid() and m.role='park_manager' and m.disabled_at is null)
   order by (p.owner_user_id=auth.uid()) desc,p.created_at limit 1;
  if current_park is null or not public.has_park_permission(current_park,'users.manage') then
    raise exception 'User management denied' using errcode='42501';
  end if;
  if p_email is null or length(trim(p_email))<5 or position('@' in trim(p_email))<2 then raise exception 'Valid invitation email required'; end if;
  if p_role <> 'park_manager' then raise exception 'Operational access must be provisioned for an event with an expiry'; end if;
  update public.park_invitations i set revoked_at=now()
   where i.park_id=current_park and lower(i.email)=lower(trim(p_email)) and i.accepted_at is null and i.revoked_at is null;
  insert into public.park_invitations(park_id,email,role,token_hash,expires_at,created_by)
   values(current_park,lower(trim(p_email)),p_role,extensions.digest(convert_to(token_value::text,'UTF8'),'sha256'),now()+interval '7 days',auth.uid()) returning * into created;
  return query select created.id,token_value,created.expires_at;
end;
$$;
revoke all on function public.create_park_invitation(text,text) from public, anon;
grant execute on function public.create_park_invitation(text,text) to authenticated;

create or replace function public.accept_park_invitation(p_invitation_token uuid)
returns table(park_id uuid,role text)
language plpgsql security definer set search_path = ''
as $$
declare current_email text; invitation public.park_invitations; current_owner uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select lower(u.email) into current_email from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null;
  if current_email is null then raise exception 'Confirmed individual email required' using errcode='42501'; end if;
  select i.* into invitation from public.park_invitations i
   where i.token_hash=extensions.digest(convert_to(p_invitation_token::text,'UTF8'),'sha256')
     and lower(i.email)=current_email and (i.accepted_at is null or i.accepted_by=auth.uid())
     and i.revoked_at is null and i.expires_at>now()
   for update;
  if not found then raise exception 'Invitation invalid, expired, revoked, or issued to another identity' using errcode='42501'; end if;
  if invitation.role <> 'park_manager' then raise exception 'Operational access requires an event-scoped invitation' using errcode='42501'; end if;
  if invitation.accepted_at is not null then
    return query select m.park_id,m.role from public.park_memberships m
     where m.park_id=invitation.park_id and m.user_id=auth.uid() and m.disabled_at is null;
    if not found then raise exception 'Invitation consumed and manager access is no longer active' using errcode='42501'; end if;
    return;
  end if;
  select p.owner_user_id into current_owner from public.parks p where p.id=invitation.park_id;
  if current_owner=auth.uid() or exists(select 1 from public.parks p where p.owner_user_id=auth.uid()) then raise exception 'A park owner cannot accept a park manager invitation' using errcode='42501'; end if;
  if exists(select 1 from public.park_memberships m where m.user_id=auth.uid() and m.disabled_at is null) then raise exception 'Identity already has an active park membership'; end if;
  insert into public.park_memberships(park_id,user_id,role,created_by,disabled_at)
   values(invitation.park_id,auth.uid(),'park_manager',invitation.created_by,null)
   on conflict(park_id,user_id) do update set role='park_manager',created_by=excluded.created_by,updated_at=now(),disabled_at=null
   where public.park_memberships.disabled_at is not null;
  update public.park_invitations set accepted_by=auth.uid(),accepted_at=now() where id=invitation.id;
  return query select invitation.park_id,'park_manager'::text;
end;
$$;
revoke all on function public.accept_park_invitation(uuid) from public, anon;
grant execute on function public.accept_park_invitation(uuid) to authenticated;

create or replace function public.guard_park_create()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or new.owner_user_id is not null
     or not public.has_platform_permission('platform.park.create') then
    raise exception 'Park provisioning requires authorized Connect PDM staff' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.provision_connect_park(
  p_connect_code text, p_name text, p_manager_name text, p_phone text,
  p_city text, p_state text, p_address text
) returns table(park_id uuid, connect_code text, created boolean)
language plpgsql security definer set search_path = ''
as $$
declare saved public.parks; inserted boolean := false; normalized_code text := upper(trim(p_connect_code));
begin
  if not public.has_platform_permission('platform.park.create') then
    raise exception 'Park provisioning denied' using errcode = '42501';
  end if;
  if normalized_code !~ '^PDM-[A-Z0-9-]{3,48}$' or trim(p_name) = '' or trim(p_manager_name) = ''
     or trim(p_city) = '' or upper(trim(p_state)) !~ '^[A-Z]{2}$' or trim(p_address) = '' then
    raise exception 'Park data or Connect PDM code is invalid';
  end if;
  insert into public.parks(connect_code,name,manager_name,phone,city,state,address,owner_user_id)
  values(normalized_code,trim(p_name),trim(p_manager_name),trim(coalesce(p_phone,'')),trim(p_city),upper(trim(p_state)),trim(p_address),null)
  on conflict do nothing returning * into saved;
  inserted := found;
  if not inserted then select p.* into saved from public.parks p where upper(p.connect_code) = normalized_code for share; end if;
  if saved.id is null then raise exception 'Unable to recover provisioned park'; end if;
  if inserted then
    insert into public.connect_platform_audit(actor_user_id,park_id,action,details)
      values(auth.uid(),saved.id,'park.provision',jsonb_build_object('connect_code',saved.connect_code));
  end if;
  return query select saved.id,saved.connect_code,inserted;
end;
$$;
revoke all on function public.provision_connect_park(text,text,text,text,text,text,text) from public, anon;
grant execute on function public.provision_connect_park(text,text,text,text,text,text,text) to authenticated;

create or replace function public.find_connect_park(p_connect_code text)
returns table(id uuid,connect_code text,name text,manager_name text,phone text,city text,state char(2),address text,access_status text)
language sql stable security definer set search_path = ''
as $$
  select p.id,p.connect_code,p.name,p.manager_name,p.phone,p.city,p.state,p.address,p.access_status
    from public.parks p
   where upper(p.connect_code) = upper(trim(p_connect_code))
     and public.has_platform_permission('platform.park.manage');
$$;
revoke all on function public.find_connect_park(text) from public, anon;
grant execute on function public.find_connect_park(text) to authenticated;

create or replace function public.find_connect_park_installation(p_connect_code text)
returns table(id uuid,connect_code text,name text,city text,state char(2),access_status text)
language sql stable security definer set search_path = ''
as $$
  select p.id,p.connect_code,p.name,p.city,p.state,p.access_status
    from public.parks p
   where upper(p.connect_code)=upper(trim(p_connect_code))
     and public.has_platform_permission('platform.installation.read');
$$;
revoke all on function public.find_connect_park_installation(text) from public, anon;
grant execute on function public.find_connect_park_installation(text) to authenticated;

create or replace function public.list_connect_platform_audit(p_park_id uuid,p_limit integer default 100)
returns table(id bigint,actor_user_id uuid,event_id uuid,action text,reason text,details jsonb,occurred_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_platform_permission('platform.audit.read') then
    raise exception 'Platform audit access denied' using errcode='42501';
  end if;
  if p_park_id is null or p_limit is null or p_limit not between 1 and 200 then raise exception 'A park and a limit from 1 to 200 are required'; end if;
  return query
    select a.id,a.actor_user_id,a.event_id,a.action,a.reason,a.details,a.occurred_at
      from public.connect_platform_audit a
     where a.park_id=p_park_id
     order by a.occurred_at desc,a.id desc limit p_limit;
end;
$$;
revoke all on function public.list_connect_platform_audit(uuid,integer) from public, anon;
grant execute on function public.list_connect_platform_audit(uuid,integer) to authenticated;

create or replace function public.update_connect_park(
  p_park_id uuid,p_name text,p_manager_name text,p_phone text,p_city text,p_state text,p_address text
) returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_platform_permission('platform.park.manage') then
    raise exception 'Park management denied' using errcode = '42501';
  end if;
  if trim(p_name) = '' or trim(p_manager_name) = '' or trim(p_city) = ''
     or upper(trim(p_state)) !~ '^[A-Z]{2}$' or trim(p_address) = '' then raise exception 'Park data is invalid'; end if;
  update public.parks set name=trim(p_name),manager_name=trim(p_manager_name),phone=trim(coalesce(p_phone,'')),
    city=trim(p_city),state=upper(trim(p_state)),address=trim(p_address),updated_at=now()
   where id=p_park_id;
  if not found then raise exception 'Park not found'; end if;
  insert into public.connect_platform_audit(actor_user_id,park_id,action,details)
    values(auth.uid(),p_park_id,'park.update',jsonb_build_object('name',trim(p_name),'city',trim(p_city),'state',upper(trim(p_state))));
end;
$$;
revoke all on function public.update_connect_park(uuid,text,text,text,text,text,text) from public, anon;
grant execute on function public.update_connect_park(uuid,text,text,text,text,text,text) to authenticated;

create or replace function public.set_connect_park_status(p_park_id uuid,p_status text,p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_platform_permission('platform.park.suspend') then
    raise exception 'Park access management denied' using errcode = '42501';
  end if;
  if p_status not in ('active','suspended','closed') or length(trim(coalesce(p_reason,''))) < 5 then
    raise exception 'Park status and justification are required';
  end if;
  update public.parks set access_status=p_status,updated_at=now() where id=p_park_id;
  if not found then raise exception 'Park not found'; end if;
  insert into public.connect_platform_audit(actor_user_id,park_id,action,reason,details)
    values(auth.uid(),p_park_id,'park.access_status',trim(p_reason),jsonb_build_object('status',p_status));
end;
$$;
revoke all on function public.set_connect_park_status(uuid,text,text) from public, anon;
grant execute on function public.set_connect_park_status(uuid,text,text) to authenticated;

create or replace function public.create_connect_park_manager_invitation(p_park_id uuid,p_email text)
returns table(invitation_id uuid,invitation_token uuid,expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare token_value uuid := gen_random_uuid(); created public.park_invitations;
begin
  if not public.has_platform_permission('platform.park.manage') then
    raise exception 'Optional park manager invitation denied' using errcode='42501';
  end if;
  if p_email is null or length(trim(p_email))<5 or position('@' in trim(p_email))<2
     or not exists(select 1 from public.parks p where p.id=p_park_id) then raise exception 'Park manager invitation is invalid'; end if;
  update public.park_invitations i set revoked_at=now()
   where i.park_id=p_park_id and lower(i.email)=lower(trim(p_email)) and i.accepted_at is null and i.revoked_at is null;
  insert into public.park_invitations(park_id,email,role,token_hash,expires_at,created_by)
   values(p_park_id,lower(trim(p_email)),'park_manager',extensions.digest(convert_to(token_value::text,'UTF8'),'sha256'),now()+interval '7 days',auth.uid())
   returning * into created;
  insert into public.connect_platform_audit(actor_user_id,park_id,action,details)
    values(auth.uid(),p_park_id,'park.manager.invite',jsonb_build_object('expires_at',created.expires_at));
  return query select created.id,token_value,created.expires_at;
end;
$$;
revoke all on function public.create_connect_park_manager_invitation(uuid,text) from public, anon;
grant execute on function public.create_connect_park_manager_invitation(uuid,text) to authenticated;

create table public.event_staff_memberships (
  event_id uuid not null references public.events(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null check (role in ('office','announcer','judge','track_operator')),
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(event_id,user_id)
);
create index event_staff_active_idx on public.event_staff_memberships(event_id,role,expires_at) where revoked_at is null;
alter table public.event_staff_memberships enable row level security;
revoke all on public.event_staff_memberships from public, anon, authenticated;

create table public.event_staff_invitations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  email text not null,
  role text not null check (role in ('office','announcer','judge','track_operator')),
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  check (accepted_at is null or accepted_by is not null)
);
create index event_staff_invitations_active_idx on public.event_staff_invitations(event_id,email) where accepted_at is null and revoked_at is null;
alter table public.event_staff_invitations enable row level security;
revoke all on public.event_staff_invitations from public, anon, authenticated;

create table public.event_staff_audit (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events(id) on delete restrict,
  subject_user_id uuid not null references auth.users(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('grant','change','revoke')),
  before_role text,
  after_role text,
  occurred_at timestamptz not null default now()
);
alter table public.event_staff_audit enable row level security;
revoke all on public.event_staff_audit from public, anon, authenticated;

create or replace function public.has_event_permission(p_event_id uuid,p_permission text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare target_park uuid; park_status text; event_status text; staff_role text; staff_expiry timestamptz;
begin
  if auth.uid() is null or p_event_id is null then return false; end if;
  select e.park_id,e.operational_status,p.access_status into target_park,event_status,park_status
    from public.events e join public.parks p on p.id=e.park_id where e.id=p_event_id;
  if target_park is null then return false; end if;

  -- Park managers may administer their park. Operational park memberships from
  -- the legacy model no longer imply access to every present or future event.
  if public.has_park_permission(target_park,'park.manage') then
    if park_status <> 'active' and p_permission not in ('event.read','entry.read','result.read','track.read','standings.read','report.read','audit.read') then return false; end if;
    if event_status = 'closed' and p_permission not in ('event.read','entry.read','result.read','track.read','standings.read','report.read','audit.read') then return false; end if;
    return true;
  end if;
  if park_status <> 'active' or event_status <> 'active' then return false; end if;

  if p_permission = 'event.staff.manage' then
    return public.has_platform_permission('platform.event.staff.manage');
  end if;

  select m.role,m.expires_at into staff_role,staff_expiry from public.event_staff_memberships m
   where m.event_id=p_event_id and m.user_id=auth.uid() and m.revoked_at is null
   for share;
  if staff_role is null or staff_expiry <= now() then return false; end if;
  return case staff_role
    when 'office' then p_permission in ('event.read','entry.read','entry.create','entry.update','payment.record','report.read')
    when 'announcer' then p_permission in ('event.read','entry.read','track.read','result.read','standings.read')
    when 'judge' then p_permission in ('event.read','entry.read','track.read','result.read','result.judge','result.return_decide')
    when 'track_operator' then p_permission in ('event.read','entry.read','track.read','track.queue','track.rotation_control')
    else false
  end;
end;
$$;
revoke all on function public.has_event_permission(uuid,text) from public, anon;
grant execute on function public.has_event_permission(uuid,text) to authenticated;

create or replace function public.get_my_event_contexts()
returns table(event_id uuid,park_id uuid,park_name text,city text,state char(2),role text,expires_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select e.id,e.park_id,p.name,p.city,p.state,m.role,m.expires_at
    from public.event_staff_memberships m join public.events e on e.id=m.event_id
    join public.parks p on p.id=e.park_id
   where m.user_id=auth.uid() and m.revoked_at is null and m.expires_at>now()
     and e.operational_status='active' and p.access_status='active';
$$;
revoke all on function public.get_my_event_contexts() from public, anon;
grant execute on function public.get_my_event_contexts() to authenticated;

create or replace function public.create_connect_park_event(
  p_park_id uuid,p_id uuid,p_name text,p_location text,p_starts_at timestamptz,
  p_ends_at timestamptz,p_categories text[],p_ticket_quantity integer,p_ticket_price numeric
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare created_id uuid;
begin
  if not public.has_platform_permission('platform.event.create') then
    raise exception 'Event provisioning denied' using errcode = '42501';
  end if;
  if p_id is null or trim(p_name)='' or p_starts_at is null or p_ends_at<p_starts_at or coalesce(cardinality(p_categories),0)=0 then
    raise exception 'Event fields are invalid';
  end if;
  if not exists(select 1 from public.parks p where p.id=p_park_id and p.access_status='active') then
    raise exception 'An active park is required';
  end if;
  insert into public.events(id,park_id,name,location,starts_at,ends_at,categories,rules,category_rules,ticket_quantity,ticket_price,prizes,scoring_mode)
  values(coalesce(p_id,gen_random_uuid()),p_park_id,trim(p_name),coalesce(p_location,''),p_starts_at,p_ends_at,p_categories,'{}'::jsonb,'{}'::jsonb,p_ticket_quantity,p_ticket_price,'[]'::jsonb,'confirm')
  on conflict(id) do nothing returning id into created_id;
  if created_id is null then
    if exists(select 1 from public.events e where e.id=p_id and e.park_id=p_park_id
       and row(e.name,e.location,e.starts_at,e.ends_at,e.categories,e.ticket_quantity,e.ticket_price)
           is not distinct from row(trim(p_name),coalesce(p_location,''),p_starts_at,p_ends_at,p_categories,p_ticket_quantity,p_ticket_price)) then return p_id; end if;
    raise exception 'Event request id was already used for different event data';
  end if;
  insert into public.connect_platform_audit(actor_user_id,park_id,event_id,action,details)
    values(auth.uid(),p_park_id,created_id,'event.provision',jsonb_build_object('name',trim(p_name)));
  return created_id;
end;
$$;
revoke all on function public.create_connect_park_event(uuid,uuid,text,text,timestamptz,timestamptz,text[],integer,numeric) from public, anon;
grant execute on function public.create_connect_park_event(uuid,uuid,text,text,timestamptz,timestamptz,text[],integer,numeric) to authenticated;

create or replace function public.list_connect_park_events(p_park_id uuid)
returns table(id uuid,name text,starts_at timestamptz,ends_at timestamptz,operational_status text)
language sql stable security definer set search_path = ''
as $$
  select e.id,e.name,e.starts_at,e.ends_at,e.operational_status from public.events e
   where e.park_id=p_park_id and public.has_platform_permission('platform.event.read') order by e.starts_at desc;
$$;
revoke all on function public.list_connect_park_events(uuid) from public, anon;
grant execute on function public.list_connect_park_events(uuid) to authenticated;

create or replace function public.set_connect_event_status(p_event_id uuid,p_status text,p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_platform_permission('platform.event.manage') then
    raise exception 'Event provisioning access denied' using errcode = '42501';
  end if;
  if p_status not in ('active','closed') or length(trim(coalesce(p_reason,'')))<5 then
    raise exception 'Event status and justification are required';
  end if;
  update public.events set operational_status=p_status,updated_at=now() where id=p_event_id;
  if not found then raise exception 'Event not found'; end if;
  insert into public.connect_platform_audit(actor_user_id,park_id,event_id,action,reason,details)
    select auth.uid(),e.park_id,e.id,'event.operational_status',trim(p_reason),jsonb_build_object('status',p_status)
      from public.events e where e.id=p_event_id;
end;
$$;
revoke all on function public.set_connect_event_status(uuid,text,text) from public, anon;
grant execute on function public.set_connect_event_status(uuid,text,text) to authenticated;

create or replace function public.create_event_staff_invitation(
  p_event_id uuid,p_email text,p_role text,p_expires_at timestamptz
) returns table(invitation_id uuid,invitation_token uuid,expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare token_value uuid := gen_random_uuid(); created public.event_staff_invitations; event_end timestamptz;
begin
  if not public.has_event_permission(p_event_id,'event.staff.manage') then
    raise exception 'Event staff management denied' using errcode = '42501';
  end if;
  if p_role not in ('office','announcer','judge','track_operator') or p_email is null or position('@' in trim(p_email))<2 then raise exception 'Event staff invite is invalid'; end if;
  select e.ends_at into event_end from public.events e join public.parks p on p.id=e.park_id
   where e.id=p_event_id and e.operational_status='active' and p.access_status='active';
  if event_end is null or p_expires_at<=now() or p_expires_at>event_end then raise exception 'Access expiry must be future and no later than event end'; end if;
  update public.event_staff_invitations i set revoked_at=now()
   where i.event_id=p_event_id and lower(i.email)=lower(trim(p_email)) and i.accepted_at is null and i.revoked_at is null;
  insert into public.event_staff_invitations(event_id,email,role,token_hash,expires_at,created_by)
   values(p_event_id,lower(trim(p_email)),p_role,extensions.digest(convert_to(token_value::text,'UTF8'),'sha256'),p_expires_at,auth.uid()) returning * into created;
  insert into public.connect_platform_audit(actor_user_id,event_id,park_id,action,details)
    select auth.uid(),created.event_id,e.park_id,'event.staff.invite',jsonb_build_object('role',created.role,'expires_at',created.expires_at)
      from public.events e where e.id=created.event_id;
  return query select created.id,token_value,created.expires_at;
end;
$$;
revoke all on function public.create_event_staff_invitation(uuid,text,text,timestamptz) from public, anon;
grant execute on function public.create_event_staff_invitation(uuid,text,text,timestamptz) to authenticated;

create or replace function public.accept_event_staff_invitation(p_invitation_token uuid)
returns table(event_id uuid,role text,expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare current_email text; invitation public.event_staff_invitations; event_end timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select lower(u.email) into current_email from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null;
  if current_email is null then raise exception 'Confirmed individual email required' using errcode='42501'; end if;
  select i.* into invitation from public.event_staff_invitations i
   where i.token_hash=extensions.digest(convert_to(p_invitation_token::text,'UTF8'),'sha256')
     and lower(i.email)=current_email and (i.accepted_at is null or i.accepted_by=auth.uid())
     and i.revoked_at is null and i.expires_at>now()
   for update;
  if not found then raise exception 'Invitation invalid, expired, revoked, or issued to another identity' using errcode='42501'; end if;
  select e.ends_at into event_end from public.events e join public.parks p on p.id=e.park_id
   where e.id=invitation.event_id and e.operational_status='active' and p.access_status='active';
  if event_end is null then raise exception 'Event is closed or park access is suspended'; end if;
  if invitation.accepted_at is not null then
    return query select m.event_id,m.role,m.expires_at from public.event_staff_memberships m
     where m.event_id=invitation.event_id and m.user_id=auth.uid() and m.revoked_at is null and m.expires_at>now();
    if not found then raise exception 'Invitation was already consumed and access is no longer active' using errcode='42501'; end if;
    return;
  end if;
  insert into public.event_staff_memberships(event_id,user_id,role,expires_at,created_by,revoked_at,updated_at)
  values(invitation.event_id,auth.uid(),invitation.role,least(invitation.expires_at,event_end),auth.uid(),null,now())
   on conflict(event_id,user_id) do update set role=excluded.role,expires_at=excluded.expires_at,
     created_by=excluded.created_by,revoked_at=null,updated_at=now();
  update public.event_staff_invitations set accepted_by=auth.uid(),accepted_at=now() where id=invitation.id;
  return query select invitation.event_id,invitation.role,least(invitation.expires_at,event_end);
end;
$$;
revoke all on function public.accept_event_staff_invitation(uuid) from public, anon;
grant execute on function public.accept_event_staff_invitation(uuid) to authenticated;

create or replace function public.revoke_event_staff(p_event_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_event_permission(p_event_id,'event.staff.manage') then
    raise exception 'Event staff management denied' using errcode='42501';
  end if;
  update public.event_staff_memberships set revoked_at=now(),updated_at=now()
   where event_id=p_event_id and user_id=p_user_id and revoked_at is null;
  if not found then raise exception 'Active event access not found'; end if;
  update public.event_staff_invitations set revoked_at=now()
   where event_id=p_event_id and accepted_by=p_user_id and revoked_at is null;
  insert into public.connect_platform_audit(actor_user_id,event_id,park_id,action,details)
    select auth.uid(),e.id,e.park_id,'event.staff.revoke',jsonb_build_object('user_id',p_user_id)
      from public.events e where e.id=p_event_id;
end;
$$;
revoke all on function public.revoke_event_staff(uuid,uuid) from public, anon;
grant execute on function public.revoke_event_staff(uuid,uuid) to authenticated;

create or replace function public.list_event_staff(p_event_id uuid)
returns table(user_id uuid,role text,expires_at timestamptz,revoked_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select m.user_id,m.role,m.expires_at,m.revoked_at from public.event_staff_memberships m
   where m.event_id=p_event_id and public.has_event_permission(p_event_id,'event.staff.manage')
   order by m.created_at desc;
$$;
revoke all on function public.list_event_staff(uuid) from public, anon;
grant execute on function public.list_event_staff(uuid) to authenticated;

-- Revoke direct write access to temporary access records; all changes use audited RPCs.
revoke all on public.event_staff_memberships, public.event_staff_invitations, public.event_staff_audit from public, anon, authenticated, service_role;
revoke all on sequence public.connect_platform_audit_id_seq, public.connect_platform_staff_audit_id_seq,
  public.event_staff_audit_id_seq from public, anon, authenticated, service_role;

create or replace function public.audit_event_staff_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op='INSERT' then
    insert into public.event_staff_audit(event_id,subject_user_id,actor_user_id,action,after_role)
      values(new.event_id,new.user_id,auth.uid(),'grant',new.role);
  else
    insert into public.event_staff_audit(event_id,subject_user_id,actor_user_id,action,before_role,after_role)
      values(new.event_id,new.user_id,auth.uid(),case when old.revoked_at is null and new.revoked_at is not null then 'revoke' else 'change' end,old.role,new.role);
  end if;
  return new;
end;
$$;
create trigger event_staff_memberships_audit after insert or update on public.event_staff_memberships
  for each row execute function public.audit_event_staff_change();
revoke all on function public.audit_event_staff_change() from public, anon, authenticated;

create or replace function public.audit_platform_staff_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op='INSERT' then
    insert into public.connect_platform_staff_audit(subject_user_id,actor_user_id,action,after_role)
      values(new.user_id,auth.uid(),'grant',new.role);
  else
    insert into public.connect_platform_staff_audit(subject_user_id,actor_user_id,action,before_role,after_role)
      values(new.user_id,auth.uid(),case when old.revoked_at is null and new.revoked_at is not null then 'revoke' else 'change' end,old.role,new.role);
  end if;
  return new;
end;
$$;
create trigger connect_platform_staff_audit_trigger after insert or update on public.connect_platform_staff
  for each row execute function public.audit_platform_staff_change();
revoke all on function public.audit_platform_staff_change() from public, anon, authenticated;

-- Preserve active legacy operational assignments as event-scoped access for
-- currently configured active events only, then stop their park-wide reach.
-- The membership audit trigger preserves the prior roles and timestamps.
insert into public.event_staff_memberships(event_id,user_id,role,expires_at,created_by)
select e.id,m.user_id,m.role,e.ends_at,m.created_by
  from public.park_memberships m
  join public.events e on e.park_id=m.park_id
 where m.disabled_at is null and m.role in ('office','announcer','judge','track_operator')
   and e.operational_status='active' and e.ends_at>now()
on conflict(event_id,user_id) do nothing;
update public.park_memberships
   set disabled_at=now(),updated_at=now()
 where disabled_at is null and role in ('office','announcer','judge','track_operator');
update public.park_invitations
   set revoked_at=now()
 where role in ('office','announcer','judge','track_operator')
   and accepted_at is null and revoked_at is null;

comment on table public.parks is 'Stable park records provisioned with unique Connect PDM business codes; owner access is optional.';
comment on column public.parks.connect_code is 'Unique Connect PDM assigned business identifier; never derived from park name or device.';
comment on table public.event_staff_memberships is 'Time-bounded individual office/announcer access scoped to one event.';
comment on function public.has_event_permission(uuid,text) is 'Resolves park or time-bounded event membership from auth.uid(); platform roles do not grant event data access.';

