create or replace function public.list_connect_parks(
  p_search text default null,
  p_state text default null,
  p_city text default null,
  p_lifecycle_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  id uuid,
  connect_code text,
  name text,
  manager_name text,
  phone text,
  city text,
  state char(2),
  address text,
  access_status text,
  lifecycle_status text,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_platform_permission('platform.park.read') then
    raise exception 'Connect park registry access denied' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100
     or p_offset is null or p_offset < 0
     or coalesce(p_lifecycle_status, '') not in ('', 'provisioned', 'pending_configuration', 'suspended', 'archived')
     or coalesce(p_state, '') !~ '^[A-Za-z]{0,2}$' then
    raise exception 'Invalid park registry filters';
  end if;

  return query
  with park_state as (
    select p.*,
      case
        when p.access_status = 'suspended' then 'suspended'
        when p.access_status = 'closed' then 'archived'
        when p.owner_user_id is not null or exists (
          select 1 from public.park_memberships m
           where m.park_id = p.id and m.role = 'park_manager' and m.disabled_at is null
        ) then 'provisioned'
        else 'pending_configuration'
      end as derived_status
    from public.parks p
  ),
  filtered as (
    select ps.*
    from park_state ps
    where (
      nullif(trim(coalesce(p_search, '')), '') is null
      or ps.name ilike '%' || trim(p_search) || '%'
      or ps.connect_code ilike '%' || trim(p_search) || '%'
      or ps.city ilike '%' || trim(p_search) || '%'
    )
    and (nullif(trim(coalesce(p_state, '')), '') is null or upper(ps.state::text) = upper(trim(p_state)))
    and (nullif(trim(coalesce(p_city, '')), '') is null or lower(ps.city) = lower(trim(p_city)))
    and (nullif(trim(coalesce(p_lifecycle_status, '')), '') is null or ps.derived_status = p_lifecycle_status)
  )
  select f.id, f.connect_code, f.name, f.manager_name, f.phone, f.city, f.state, f.address,
         f.access_status, f.derived_status, f.created_at, f.updated_at, count(*) over()
    from filtered f
   order by f.created_at desc, f.id
   limit p_limit offset p_offset;
end;
$$;
revoke all on function public.list_connect_parks(text,text,text,text,integer,integer) from public, anon;
grant execute on function public.list_connect_parks(text,text,text,text,integer,integer) to authenticated;

create or replace function public.get_connect_park_profile(p_park_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.has_platform_permission('platform.park.read') then
    raise exception 'Connect park profile access denied' using errcode = '42501';
  end if;
  if p_park_id is null then raise exception 'A park is required'; end if;

  select jsonb_build_object(
    'park', jsonb_build_object(
      'id', p.id, 'connect_code', p.connect_code, 'name', p.name, 'manager_name', p.manager_name,
      'phone', p.phone, 'city', p.city, 'state', p.state, 'address', p.address,
      'access_status', p.access_status, 'created_at', p.created_at, 'updated_at', p.updated_at,
      'owner_user_id', p.owner_user_id,
      'owner_email', owner.email,
      'lifecycle_status', case
        when p.access_status = 'suspended' then 'suspended'
        when p.access_status = 'closed' then 'archived'
        when p.owner_user_id is not null or exists (
          select 1 from public.park_memberships active_manager
           where active_manager.park_id = p.id and active_manager.role = 'park_manager'
             and active_manager.disabled_at is null
        ) then 'provisioned'
        else 'pending_configuration'
      end
    ),
    'created_by_user_id', creator.actor_user_id,
    'created_by_email', creator_user.email,
    'created_by_at', creator.occurred_at,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'email', u.email, 'role', m.role,
        'created_at', m.created_at, 'disabled_at', m.disabled_at, 'source', 'park_membership'
      ) order by m.created_at desc)
      from public.park_memberships m
      left join auth.users u on u.id = m.user_id
      where m.park_id = p.id
    ), '[]'::jsonb),
    'event_staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_id', membership.event_id, 'event_name', e.name,
        'user_id', membership.user_id, 'email', u.email, 'role', membership.role,
        'created_at', membership.created_at, 'expires_at', membership.expires_at,
        'revoked_at', membership.revoked_at
      ) order by e.starts_at desc, membership.created_at desc)
      from public.event_staff_memberships membership
      join public.events e on e.id = membership.event_id
      left join auth.users u on u.id = membership.user_id
      where e.park_id = p.id
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', recent.id, 'name', recent.name, 'starts_at', recent.starts_at,
        'ends_at', recent.ends_at, 'operational_status', recent.operational_status
      ) order by recent.starts_at desc, recent.id)
      from (
        select e.id, e.name, e.starts_at, e.ends_at, e.operational_status
          from public.events e where e.park_id = p.id
         order by e.starts_at desc, e.id limit 50
      ) recent
    ), '[]'::jsonb),
    'event_count', (select count(*) from public.events e where e.park_id = p.id),
    'completed_event_count', (select count(*) from public.events e where e.park_id = p.id and e.ends_at < now())
  )
  into result
  from public.parks p
  left join auth.users owner on owner.id = p.owner_user_id
  left join lateral (
    select a.actor_user_id, a.occurred_at
      from public.connect_platform_audit a
     where a.park_id = p.id and a.action = 'park.provision'
     order by a.occurred_at, a.id limit 1
  ) creator on true
  left join auth.users creator_user on creator_user.id = creator.actor_user_id
  where p.id = p_park_id;

  if result is null then raise exception 'Park not found'; end if;
  return result;
end;
$$;
revoke all on function public.get_connect_park_profile(uuid) from public, anon;
grant execute on function public.get_connect_park_profile(uuid) to authenticated;

create or replace function public.provision_connect_park(
  p_connect_code text, p_name text, p_manager_name text, p_phone text,
  p_city text, p_state text, p_address text
) returns table(park_id uuid, connect_code text, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.parks;
  inserted boolean := false;
  normalized_code text := upper(trim(p_connect_code));
begin
  if not public.has_platform_permission('platform.park.create') then
    raise exception 'Park provisioning denied' using errcode = '42501';
  end if;
  if normalized_code !~ '^PDM-[A-Z0-9-]{3,48}$'
     or trim(p_name) = '' or trim(p_manager_name) = ''
     or trim(p_city) = '' or upper(trim(p_state)) !~ '^[A-Z]{2}$'
     or trim(p_address) = '' then
    raise exception 'Park data or Connect PDM code is invalid';
  end if;

  insert into public.parks(connect_code,name,manager_name,phone,city,state,address,owner_user_id)
  values(normalized_code,trim(p_name),trim(p_manager_name),trim(coalesce(p_phone,'')),trim(p_city),upper(trim(p_state)),trim(p_address),null)
  on conflict do nothing returning * into saved;
  inserted := found;
  if not inserted then
    select p.* into saved from public.parks p where upper(p.connect_code) = normalized_code for share;
  end if;
  if saved.id is null then raise exception 'Unable to recover provisioned park'; end if;

  insert into public.connect_platform_audit(actor_user_id,park_id,action,details)
  values(
    auth.uid(), saved.id, case when inserted then 'park.provision' else 'park.recover' end,
    jsonb_build_object('connect_code',saved.connect_code,'created',inserted)
  );
  return query select saved.id,saved.connect_code,inserted;
end;
$$;
revoke all on function public.provision_connect_park(text,text,text,text,text,text,text) from public, anon;
grant execute on function public.provision_connect_park(text,text,text,text,text,text,text) to authenticated;

create or replace function public.update_connect_park(
  p_park_id uuid,p_name text,p_manager_name text,p_phone text,p_city text,p_state text,p_address text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare before_row public.parks;
begin
  if not public.has_platform_permission('platform.park.manage') then
    raise exception 'Park management denied' using errcode = '42501';
  end if;
  if p_park_id is null or nullif(trim(coalesce(p_name, '')), '') is null
     or nullif(trim(coalesce(p_manager_name, '')), '') is null
     or nullif(trim(coalesce(p_city, '')), '') is null
     or upper(trim(coalesce(p_state, ''))) !~ '^[A-Z]{2}$'
     or nullif(trim(coalesce(p_address, '')), '') is null then
    raise exception 'Park data is invalid';
  end if;

  select p.* into before_row from public.parks p where p.id = p_park_id for update;
  if not found then raise exception 'Park not found'; end if;
  update public.parks
     set name = trim(p_name), manager_name = trim(p_manager_name), phone = trim(coalesce(p_phone, '')),
         city = trim(p_city), state = upper(trim(p_state)), address = trim(p_address), updated_at = now()
   where id = p_park_id;
  insert into public.connect_platform_audit(actor_user_id,park_id,action,details)
  values(auth.uid(),p_park_id,'park.update',jsonb_build_object(
    'before',jsonb_build_object(
      'name',before_row.name,'manager_name',before_row.manager_name,'phone',before_row.phone,
      'city',before_row.city,'state',before_row.state,'address',before_row.address
    ),
    'after',jsonb_build_object(
      'name',trim(p_name),'manager_name',trim(p_manager_name),'phone',trim(coalesce(p_phone,'')),
      'city',trim(p_city),'state',upper(trim(p_state)),'address',trim(p_address)
    )
  ));
end;
$$;
revoke all on function public.update_connect_park(uuid,text,text,text,text,text,text) from public, anon;
grant execute on function public.update_connect_park(uuid,text,text,text,text,text,text) to authenticated;

create or replace function public.set_connect_park_status(p_park_id uuid,p_status text,p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare previous_status text;
begin
  if not public.has_platform_permission('platform.park.suspend') then
    raise exception 'Park access management denied' using errcode = '42501';
  end if;
  if p_park_id is null or p_status is null or p_status not in ('active','suspended','closed')
     or length(trim(coalesce(p_reason,''))) < 5 then
    raise exception 'Park status and justification are required';
  end if;
  select p.access_status into previous_status from public.parks p where p.id = p_park_id for update;
  if not found then raise exception 'Park not found'; end if;
  update public.parks set access_status=p_status,updated_at=now() where id=p_park_id;
  insert into public.connect_platform_audit(actor_user_id,park_id,action,reason,details)
    values(auth.uid(),p_park_id,'park.access_status',trim(p_reason),
      jsonb_build_object('before_status',previous_status,'status',p_status));
end;
$$;
revoke all on function public.set_connect_park_status(uuid,text,text) from public, anon;
grant execute on function public.set_connect_park_status(uuid,text,text) to authenticated;

drop function public.list_connect_platform_audit(uuid,integer);
create function public.list_connect_platform_audit(p_park_id uuid,p_limit integer default 100)
returns table(
  id bigint, actor_user_id uuid, event_id uuid, action text, reason text,
  details jsonb, occurred_at timestamptz, actor_email text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_platform_permission('platform.audit.read') then
    raise exception 'Platform audit access denied' using errcode='42501';
  end if;
  if p_park_id is null or p_limit is null or p_limit not between 1 and 200 then
    raise exception 'A park and a limit from 1 to 200 are required';
  end if;
  return query
    select a.id,a.actor_user_id,a.event_id,a.action,a.reason,a.details,a.occurred_at,u.email::text
      from public.connect_platform_audit a
      left join auth.users u on u.id = a.actor_user_id
     where a.park_id=p_park_id
     order by a.occurred_at desc,a.id desc
     limit p_limit;
end;
$$;
revoke all on function public.list_connect_platform_audit(uuid,integer) from public, anon;
grant execute on function public.list_connect_platform_audit(uuid,integer) to authenticated;
