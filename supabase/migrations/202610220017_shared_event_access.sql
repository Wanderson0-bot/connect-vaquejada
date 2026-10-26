-- Shared operational credentials are event-scoped and never identify a natural person.
alter table public.event_staff_memberships
  drop constraint event_staff_memberships_role_check;
alter table public.event_staff_memberships
  add constraint event_staff_memberships_role_check
  check (role in ('office','announcer','judge','track_operator','event_supervisor'));

create table public.event_role_credentials (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  role text not null check (role in ('office','announcer','event_supervisor')),
  user_id uuid not null unique references auth.users(id) on delete restrict,
  access_code_hash bytea not null unique,
  pin_hash bytea not null,
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index event_role_credentials_active_role_uidx
  on public.event_role_credentials(event_id,role) where revoked_at is null;
create index event_role_credentials_active_event_idx
  on public.event_role_credentials(event_id,expires_at) where revoked_at is null;
alter table public.event_role_credentials enable row level security;
revoke all on public.event_role_credentials from public, anon, authenticated, service_role;

create table public.event_role_access_audit (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events(id) on delete restrict,
  role text not null check (role in ('office','announcer','event_supervisor')),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('provision','rotate','revoke')),
  subject_user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now()
);
alter table public.event_role_access_audit enable row level security;
revoke all on public.event_role_access_audit from public, anon, authenticated, service_role;
revoke all on sequence public.event_role_access_audit_id_seq from public, anon, authenticated, service_role;

create table public.event_role_login_attempts (
  credential_id uuid not null references public.event_role_credentials(id) on delete cascade,
  client_fingerprint_hash bytea not null,
  attempts integer not null default 0 check (attempts >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (credential_id,client_fingerprint_hash)
);
alter table public.event_role_login_attempts enable row level security;
revoke all on public.event_role_login_attempts from public, anon, authenticated, service_role;

create or replace function public.has_event_permission(p_event_id uuid,p_permission text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare target_park uuid; park_status text; event_status text; staff_role text; staff_expiry timestamptz;
begin
  if auth.uid() is null or p_event_id is null then return false; end if;
  select e.park_id,e.operational_status,p.access_status into target_park,event_status,park_status
    from public.events e join public.parks p on p.id=e.park_id where e.id=p_event_id;
  if target_park is null then return false; end if;
  if public.has_park_permission(target_park,'park.manage') then
    if park_status <> 'active' and p_permission not in ('event.read','entry.read','result.read','track.read','standings.read','report.read','audit.read','payment.read') then return false; end if;
    if event_status = 'closed' and p_permission not in ('event.read','entry.read','result.read','track.read','standings.read','report.read','audit.read','payment.read') then return false; end if;
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
    when 'office' then p_permission in ('event.read','entry.read','entry.create','entry.update','payment.read','payment.record','report.read')
    when 'announcer' then p_permission in ('event.read','entry.read','track.read','result.read','standings.read')
    when 'judge' then p_permission in ('event.read','entry.read','track.read','result.read','result.judge','result.return_decide')
    when 'track_operator' then p_permission in ('event.read','entry.read','track.read','track.queue','track.rotation_control')
    when 'event_supervisor' then p_permission in ('event.read','entry.read','result.read','track.read','standings.read','report.read','payment.read')
    else false
  end;
end;
$$;
revoke all on function public.has_event_permission(uuid,text) from public, anon;
grant execute on function public.has_event_permission(uuid,text) to authenticated;

create or replace function public.has_platform_permission(p_permission text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare platform_role text;
begin
  if auth.uid() is null then return false; end if;
  if exists (select 1 from public.platform_admins a where a.user_id=auth.uid()) then
    return p_permission in (
      'platform.admin','platform.staff.manage','platform.park.create','platform.park.read',
      'platform.park.manage','platform.park.suspend','platform.event.create','platform.event.read',
      'platform.event.manage','platform.event.staff.manage','platform.installation.read','platform.audit.read'
    );
  end if;
  select s.role into platform_role from public.connect_platform_staff s
   where s.user_id=auth.uid() and s.revoked_at is null;
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
    case when public.has_event_permission(e.event_id,'payment.read') or public.has_event_permission(e.event_id,'payment.record') then e.paid else null end,
    case when public.has_event_permission(e.event_id,'payment.read') or public.has_event_permission(e.event_id,'payment.record') then e.payment_status else null end,
    case when public.has_event_permission(e.event_id,'payment.read') or public.has_event_permission(e.event_id,'payment.record') then e.paid_amount else null end,
    case when public.has_event_permission(e.event_id,'payment.read') or public.has_event_permission(e.event_id,'payment.record') then e.payment_method else null end,
    case when public.has_event_permission(e.event_id,'payment.read') or public.has_event_permission(e.event_id,'payment.record') then e.paid_at else null end,
    case when public.has_event_permission(e.event_id,'payment.read') or public.has_event_permission(e.event_id,'payment.record') then e.paid_by else null end,
    e.status,e.status_reason,e.cancelled_at,e.cancelled_by,e.transfer_reason,e.transferred_at,e.transferred_by,e.created_at,e.updated_at
  from public.entries e
  where public.has_event_permission(e.event_id,'entry.read');
$$;
revoke all on function public.get_event_entries() from public, anon;
grant execute on function public.get_event_entries() to authenticated;

create or replace function public.get_entry_payment_state(p_entry_id uuid)
returns table(payment_status text,paid_amount numeric,payment_method text)
language plpgsql security definer set search_path = ''
as $$
declare target_event uuid;
begin
  select event_id into target_event from public.entries where id=p_entry_id;
  if target_event is null then return; end if;
  if not public.has_event_permission(target_event,'payment.read')
     and not public.has_event_permission(target_event,'payment.record') then
    raise exception 'Payment read denied' using errcode='42501';
  end if;
  return query select e.payment_status,e.paid_amount,e.payment_method from public.entries e where e.id=p_entry_id;
end;
$$;
revoke all on function public.get_entry_payment_state(uuid) from public, anon;
grant execute on function public.get_entry_payment_state(uuid) to authenticated;

create or replace function public.provision_event_role_access(
  p_actor_user_id uuid,p_event_id uuid,p_role text,p_user_id uuid,
  p_access_code text,p_pin text,p_expires_at timestamptz
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare event_end timestamptz; prior public.event_role_credentials; credential_id uuid;
begin
  if not (
    exists(select 1 from public.platform_admins a where a.user_id=p_actor_user_id)
    or exists(select 1 from public.connect_platform_staff s where s.user_id=p_actor_user_id and s.role='deployment' and s.revoked_at is null)
  ) then raise exception 'Event role access provisioning denied' using errcode='42501'; end if;
  if p_role is null or p_access_code is null or p_pin is null
     or p_role not in ('office','announcer','event_supervisor')
     or p_access_code !~ '^[A-Z2-9]{16}$' or p_pin !~ '^[0-9]{8}$'
     or p_user_id is null or p_actor_user_id is null then
    raise exception 'Event role credentials are invalid';
  end if;
  select e.ends_at into event_end from public.events e join public.parks p on p.id=e.park_id
   where e.id=p_event_id and e.operational_status='active' and p.access_status='active';
  if event_end is null or p_expires_at<=now() or p_expires_at>event_end then
    raise exception 'Access expiry must be future and no later than event end';
  end if;
  select c.* into prior from public.event_role_credentials c
   where c.event_id=p_event_id and c.role=p_role and c.revoked_at is null for update;
  if found then
    update public.event_role_credentials set revoked_at=now() where id=prior.id;
    update public.event_staff_memberships set revoked_at=now(),updated_at=now()
     where event_id=p_event_id and user_id=prior.user_id and revoked_at is null;
  end if;
  insert into public.event_staff_memberships(event_id,user_id,role,expires_at,created_by,revoked_at,updated_at)
   values(p_event_id,p_user_id,p_role,p_expires_at,p_actor_user_id,null,now())
   on conflict(event_id,user_id) do update set role=excluded.role,expires_at=excluded.expires_at,
     created_by=excluded.created_by,revoked_at=null,updated_at=now();
  insert into public.event_role_credentials(event_id,role,user_id,access_code_hash,pin_hash,expires_at,created_by)
   values(p_event_id,p_role,p_user_id,
     extensions.digest(convert_to(upper(trim(p_access_code)),'UTF8'),'sha256'),
     extensions.digest(convert_to(upper(trim(p_access_code))||':'||trim(p_pin),'UTF8'),'sha256'),
     p_expires_at,p_actor_user_id)
   returning id into credential_id;
  insert into public.event_role_access_audit(event_id,role,actor_user_id,action,subject_user_id)
   values(p_event_id,p_role,p_actor_user_id,case when prior.id is null then 'provision' else 'rotate' end,p_user_id);
  return credential_id;
end;
$$;
revoke all on function public.provision_event_role_access(uuid,uuid,text,uuid,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.provision_event_role_access(uuid,uuid,text,uuid,text,text,timestamptz) to service_role;

create or replace function public.verify_event_role_access(p_access_code text,p_pin text,p_fingerprint text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare credential public.event_role_credentials; attempt public.event_role_login_attempts;
  fingerprint_hash bytea;
begin
  if p_access_code is null or p_pin is null or p_fingerprint is null then return null; end if;
  fingerprint_hash := extensions.digest(convert_to(p_fingerprint,'UTF8'),'sha256');
  select c.* into credential from public.event_role_credentials c
   where c.access_code_hash=extensions.digest(convert_to(upper(trim(p_access_code)),'UTF8'),'sha256')
   for update;
  if not found then return null; end if;
  insert into public.event_role_login_attempts(credential_id,client_fingerprint_hash)
    values(credential.id,fingerprint_hash)
    on conflict(credential_id,client_fingerprint_hash) do nothing;
  select a.* into attempt from public.event_role_login_attempts a
   where a.credential_id=credential.id and a.client_fingerprint_hash=fingerprint_hash for update;
  if attempt.blocked_until>now() then return null; end if;
  if credential.revoked_at is not null or credential.expires_at<=now()
     or not exists(select 1 from public.events e join public.parks p on p.id=e.park_id
       where e.id=credential.event_id and e.operational_status='active' and p.access_status='active')
     or credential.pin_hash<>extensions.digest(convert_to(upper(trim(p_access_code))||':'||trim(p_pin),'UTF8'),'sha256') then
    update public.event_role_login_attempts set attempts=attempt.attempts+1,
      blocked_until=case when attempt.attempts+1>=5 then now()+interval '15 minutes' else null end,
      updated_at=now()
      where credential_id=credential.id and client_fingerprint_hash=fingerprint_hash;
    return null;
  end if;
  update public.event_role_login_attempts set attempts=0,blocked_until=null,updated_at=now()
   where credential_id=credential.id and client_fingerprint_hash=fingerprint_hash;
  return credential.user_id;
end;
$$;
revoke all on function public.verify_event_role_access(text,text,text) from public, anon, authenticated;
grant execute on function public.verify_event_role_access(text,text,text) to service_role;

create or replace function public.list_event_role_access(p_event_id uuid)
returns table(role text,created_at timestamptz,expires_at timestamptz,revoked_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_event_permission(p_event_id,'event.staff.manage') then
    raise exception 'Event staff management denied' using errcode='42501';
  end if;
  return query select c.role,c.created_at,c.expires_at,c.revoked_at
    from public.event_role_credentials c where c.event_id=p_event_id order by c.created_at desc;
end;
$$;
revoke all on function public.list_event_role_access(uuid) from public, anon;
grant execute on function public.list_event_role_access(uuid) to authenticated;

create or replace function public.revoke_event_role_access(p_event_id uuid,p_role text)
returns void language plpgsql security definer set search_path = ''
as $$
declare credential public.event_role_credentials;
begin
  if not public.has_event_permission(p_event_id,'event.staff.manage') then
    raise exception 'Event staff management denied' using errcode='42501';
  end if;
  select c.* into credential from public.event_role_credentials c
   where c.event_id=p_event_id and c.role=p_role and c.revoked_at is null for update;
  if not found then raise exception 'Active event role access not found'; end if;
  update public.event_role_credentials set revoked_at=now() where id=credential.id;
  update public.event_staff_memberships set revoked_at=now(),updated_at=now()
   where event_id=p_event_id and user_id=credential.user_id and revoked_at is null;
  insert into public.event_role_access_audit(event_id,role,actor_user_id,action,subject_user_id)
   values(p_event_id,p_role,auth.uid(),'revoke',credential.user_id);
end;
$$;
revoke all on function public.revoke_event_role_access(uuid,text) from public, anon;
grant execute on function public.revoke_event_role_access(uuid,text) to authenticated;

alter table public.event_role_access_audit replica identity full;
comment on table public.event_role_credentials is 'One shared, expiring login per event/function. The credential represents the function, not an individual person.';
comment on table public.event_role_access_audit is 'Administrative audit of shared event/function credential provisioning, rotation, and revocation.';
comment on function public.verify_event_role_access(text,text,text) is 'Service-role-only verifier for event/function code and PIN; never callable by browser clients.';
comment on function public.has_event_permission(uuid,text) is 'Resolves event and park permissions; event_supervisor is read-only, including payment visibility.';
