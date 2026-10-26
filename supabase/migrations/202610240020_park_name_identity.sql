do $$
begin
  if exists (
    select 1
      from public.parks
     group by lower(trim(name)), lower(trim(city)), upper(trim(state::text))
    having count(*) > 1
  ) then
    raise exception 'Duplicate parks share the same normalized name, city and state; resolve them before applying migration 020.';
  end if;
end;
$$;

drop function if exists public.find_connect_park(text);
drop function if exists public.find_connect_park_installation(text);
drop function if exists public.provision_connect_park(text,text,text,text,text,text,text);
drop function if exists public.get_connect_admin_dashboard();
drop function if exists public.list_connect_parks(text,text,text,text,integer,integer);
drop function if exists public.get_connect_park_profile(uuid);

drop index if exists public.parks_connect_code_ci_uidx;
alter table public.parks drop column connect_code;

create unique index parks_name_city_state_ci_uidx
  on public.parks(lower(trim(name)), lower(trim(city)), upper(trim(state::text)));

create function public.get_connect_admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare dashboard jsonb;
begin
  if not public.has_platform_permission('platform.park.read') then
    raise exception 'Connect dashboard access denied' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'park_count', (select count(*) from public.parks),
    'event_count', (select count(*) from public.events),
    'publication_count', null,
    'checked_at', now(),
    'recent_parks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', recent.id,
          'name', recent.name,
          'city', recent.city,
          'state', recent.state,
          'access_status', recent.access_status,
          'created_at', recent.created_at
        ) order by recent.created_at desc, recent.id
      )
      from (
        select p.id, p.name, p.city, p.state, p.access_status, p.created_at
          from public.parks p
         order by p.created_at desc, p.id
         limit 5
      ) recent
    ), '[]'::jsonb)
  ) into dashboard;

  return dashboard;
end;
$$;
revoke all on function public.get_connect_admin_dashboard() from public, anon;
grant execute on function public.get_connect_admin_dashboard() to authenticated;

create function public.list_connect_parks(
  p_search text default null,
  p_state text default null,
  p_city text default null,
  p_lifecycle_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  id uuid,
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
      or ps.city ilike '%' || trim(p_search) || '%'
    )
    and (nullif(trim(coalesce(p_state, '')), '') is null or upper(ps.state::text) = upper(trim(p_state)))
    and (nullif(trim(coalesce(p_city, '')), '') is null or lower(ps.city) = lower(trim(p_city)))
    and (nullif(trim(coalesce(p_lifecycle_status, '')), '') is null or ps.derived_status = p_lifecycle_status)
  )
  select f.id, f.name, f.manager_name, f.phone, f.city, f.state, f.address,
         f.access_status, f.derived_status, f.created_at, f.updated_at, count(*) over()
    from filtered f
   order by f.created_at desc, f.id
   limit p_limit offset p_offset;
end;
$$;
revoke all on function public.list_connect_parks(text,text,text,text,integer,integer) from public, anon;
grant execute on function public.list_connect_parks(text,text,text,text,integer,integer) to authenticated;

create function public.get_connect_park_profile(p_park_id uuid)
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
      'id', p.id, 'name', p.name, 'manager_name', p.manager_name,
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

create function public.provision_connect_park_by_name(
  p_name text, p_manager_name text, p_phone text, p_city text, p_state text, p_address text,
  p_existing_park_id uuid default null
) returns table(park_id uuid, park_name text, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.parks;
  match_count integer;
  inserted boolean := false;
  normalized_name text := lower(trim(coalesce(p_name, '')));
  normalized_city text := lower(trim(coalesce(p_city, '')));
  normalized_state text := upper(trim(coalesce(p_state, '')));
begin
  if not public.has_platform_permission('platform.park.create') then
    raise exception 'Park provisioning denied' using errcode = '42501';
  end if;
  if normalized_name = '' or trim(coalesce(p_manager_name, '')) = ''
     or normalized_city = '' or normalized_state !~ '^[A-Z]{2}$'
     or trim(coalesce(p_address, '')) = '' then
    raise exception 'Park name and registration data are required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    normalized_name || pg_catalog.chr(31) || normalized_city || pg_catalog.chr(31) || normalized_state, 0
  ));

  if p_existing_park_id is not null then
    select p.* into saved
      from public.parks p
     where p.id = p_existing_park_id
       and lower(trim(p.name)) = normalized_name
       and lower(trim(p.city)) = normalized_city
       and upper(trim(p.state::text)) = normalized_state
     for share;
    if not found then
      raise exception 'Selected park does not match the submitted name, city and state';
    end if;
  else
    select count(*) into match_count
      from public.parks p
     where lower(trim(p.name)) = normalized_name
       and lower(trim(p.city)) = normalized_city
       and upper(trim(p.state::text)) = normalized_state;
    if match_count > 1 then
      raise exception 'Multiple parks share this name, city and state; select a park explicitly';
    elsif match_count = 1 then
      select p.* into saved
        from public.parks p
       where lower(trim(p.name)) = normalized_name
         and lower(trim(p.city)) = normalized_city
         and upper(trim(p.state::text)) = normalized_state
       for share;
    else
      insert into public.parks(name,manager_name,phone,city,state,address,owner_user_id)
      values(trim(p_name),trim(p_manager_name),trim(coalesce(p_phone,'')),trim(p_city),normalized_state,trim(p_address),null)
      returning * into saved;
      inserted := true;
    end if;
  end if;

  if saved.id is null then raise exception 'Unable to provision or recover park'; end if;
  insert into public.connect_platform_audit(actor_user_id,park_id,action,details)
  values(
    auth.uid(), saved.id, case when inserted then 'park.provision' else 'park.recover' end,
    jsonb_build_object('name',saved.name,'city',saved.city,'state',saved.state,'created',inserted)
  );
  return query select saved.id,saved.name,inserted;
end;
$$;
revoke all on function public.provision_connect_park_by_name(text,text,text,text,text,text,uuid) from public, anon;
grant execute on function public.provision_connect_park_by_name(text,text,text,text,text,text,uuid) to authenticated;

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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    lower(trim(p_name)) || pg_catalog.chr(31) || lower(trim(p_city)) || pg_catalog.chr(31) || upper(trim(p_state)), 0
  ));
  select p.* into before_row from public.parks p where p.id = p_park_id for update;
  if not found then raise exception 'Park not found'; end if;
  if exists (
    select 1 from public.parks p
     where p.id <> p_park_id
       and lower(trim(p.name)) = lower(trim(p_name))
       and lower(trim(p.city)) = lower(trim(p_city))
       and upper(trim(p.state::text)) = upper(trim(p_state))
  ) then
    raise exception 'Another park already has this name, city and state';
  end if;

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
