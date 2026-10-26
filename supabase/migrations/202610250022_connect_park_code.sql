-- Park codes are administrative references, never credentials or access tokens.
alter table public.parks add column if not exists connect_code text;

-- The existing park identity guard requires an authenticated park manager for
-- every row update. Allow only this exact, deterministic backfill while still
-- denying any update that changes another field or assigns a different code.
create or replace function public.prevent_park_owner_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'Park identity is immutable';
  end if;
  if (to_jsonb(new) - 'connect_code') = (to_jsonb(old) - 'connect_code')
     and new.connect_code = 'CV-' || upper(new.id::text) then
    return new;
  end if;
  if not public.has_park_permission(old.id, 'park.manage') then
    raise exception 'Park management denied' using errcode = '42501';
  end if;
  return new;
end;
$$;

update public.parks
   set connect_code = 'CV-' || upper(id::text)
 where connect_code is null or trim(connect_code) = '';

create unique index if not exists parks_connect_code_ci_uidx
  on public.parks (upper(trim(connect_code)));

create or replace function public.assign_connect_park_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if nullif(trim(coalesce(new.connect_code, '')), '') is null then
    new.connect_code := 'CV-' || upper(new.id::text);
  else
    new.connect_code := upper(trim(new.connect_code));
  end if;
  return new;
end;
$$;

drop trigger if exists parks_assign_connect_code on public.parks;
create trigger parks_assign_connect_code
before insert or update of connect_code on public.parks
for each row execute function public.assign_connect_park_code();

drop function if exists public.list_connect_parks(text,text,text,text,integer,integer);
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
    select ps.* from park_state ps
    where (
      nullif(trim(coalesce(p_search, '')), '') is null
      or ps.connect_code ilike '%' || trim(p_search) || '%'
      or ps.name ilike '%' || trim(p_search) || '%'
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

create or replace function public.get_connect_park_code(p_park_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result text;
begin
  if not public.has_platform_permission('platform.park.read') then
    raise exception 'Connect park profile access denied' using errcode = '42501';
  end if;
  select p.connect_code into result from public.parks p where p.id = p_park_id;
  if result is null then raise exception 'Park not found'; end if;
  return result;
end;
$$;
revoke all on function public.get_connect_park_code(uuid) from public, anon;
grant execute on function public.get_connect_park_code(uuid) to authenticated;
