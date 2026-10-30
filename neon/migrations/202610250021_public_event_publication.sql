-- Public event information is released only through an explicit Connect review.
-- The public RPC exposes a strict allow-list and never returns entries, payments,
-- competition configuration, internal audit, or unapproved classification data.

create table public.connect_event_publications (
  event_id uuid primary key references public.events(id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'park_confirmed', 'changes_requested', 'approved', 'published', 'withdrawn')),
  public_description text not null default '',
  public_prizes jsonb not null default '[]'::jsonb check (jsonb_typeof(public_prizes) = 'array'),
  public_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(public_snapshot) = 'object'),
  park_confirmed_by uuid references public.app_users(id) on delete set null,
  park_confirmed_at timestamptz,
  reviewed_by uuid references public.app_users(id) on delete set null,
  reviewed_at timestamptz,
  published_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.connect_event_publications enable row level security;
revoke all on public.connect_event_publications from public, anon, authenticated, service_role;

create or replace function public.get_connect_admin_dashboard()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.has_platform_permission('platform.park.read') then
    raise exception 'Connect dashboard access denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'park_count', (select count(*) from public.parks),
    'event_count', (select count(*) from public.events),
    'publication_count', (select count(*) from public.connect_event_publications where status = 'published'),
    'checked_at', now(),
    'recent_parks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', recent.id, 'name', recent.name, 'city', recent.city, 'state', recent.state,
        'access_status', recent.access_status, 'created_at', recent.created_at
      ) order by recent.created_at desc, recent.id)
      from (
        select p.id, p.name, p.city, p.state, p.access_status, p.created_at
          from public.parks p order by p.created_at desc, p.id limit 5
      ) recent
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_connect_admin_dashboard() from public, anon;
grant execute on function public.get_connect_admin_dashboard() to authenticated;

create or replace function public.has_platform_permission(p_permission text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare platform_role text;
begin
  if public.current_app_user_id() is null then return false; end if;
  if exists (select 1 from public.platform_admins a where a.user_id = public.current_app_user_id()) then
    return p_permission in (
      'platform.admin','platform.staff.manage','platform.park.create','platform.park.read',
      'platform.park.manage','platform.park.suspend','platform.event.create','platform.event.read',
      'platform.event.manage','platform.event.staff.manage','platform.installation.read',
      'platform.audit.read','platform.publication.manage'
    );
  end if;
  select s.role into platform_role from public.connect_platform_staff s
   where s.user_id = public.current_app_user_id() and s.revoked_at is null;
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

create or replace function public.get_connect_publication_queue()
returns table (
  event_id uuid,
  park_id uuid,
  event_name text,
  location text,
  starts_at timestamptz,
  ends_at timestamptz,
  categories text[],
  prizes jsonb,
  park_name text,
  city text,
  state char(2),
  status text,
  public_description text,
  published_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.has_platform_permission('platform.publication.manage') then
    raise exception 'Connect publication access denied' using errcode = '42501';
  end if;
  return query
    select e.id, e.park_id,
           coalesce(pub.public_snapshot->>'event_name', e.name),
           coalesce(pub.public_snapshot->>'location', e.location),
           coalesce((pub.public_snapshot->>'starts_at')::timestamptz, e.starts_at),
           coalesce((pub.public_snapshot->>'ends_at')::timestamptz, e.ends_at),
           case when pub.public_snapshot ? 'categories'
             then array(select jsonb_array_elements_text(pub.public_snapshot->'categories'))
             else e.categories end,
           coalesce(pub.public_prizes, '[]'::jsonb),
           coalesce(pub.public_snapshot->>'park_name', p.name),
           coalesce(pub.public_snapshot->>'city', p.city),
           coalesce((pub.public_snapshot->>'state')::char(2), p.state),
           coalesce(pub.status, 'draft'), coalesce(pub.public_description, ''), pub.published_at
      from public.events e
      join public.parks p on p.id = e.park_id
      left join public.connect_event_publications pub on pub.event_id = e.id
     where p.access_status = 'active'
     order by e.starts_at desc, e.id;
end;
$$;
revoke all on function public.get_connect_publication_queue() from public, anon;
grant execute on function public.get_connect_publication_queue() to authenticated;

create or replace function public.confirm_park_event_publication(
  p_event_id uuid,
  p_public_description text,
  p_public_prizes jsonb default '[]'::jsonb
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare current_status text; target_park uuid; snapshot jsonb;
begin
  if not public.has_event_permission(p_event_id, 'event.manage') then
    raise exception 'Event publication confirmation denied' using errcode = '42501';
  end if;
  select e.park_id, jsonb_build_object(
    'event_name', e.name, 'location', e.location, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
    'categories', to_jsonb(e.categories), 'park_name', p.name, 'city', p.city, 'state', p.state
  ) into target_park, snapshot
    from public.events e join public.parks p on p.id=e.park_id where e.id = p_event_id;
  if target_park is null then raise exception 'Event not found'; end if;
  if length(trim(coalesce(p_public_description, ''))) > 1000
     or jsonb_typeof(coalesce(p_public_prizes, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_public_prizes, '[]'::jsonb)) > 50
     or exists (select 1 from jsonb_array_elements_text(coalesce(p_public_prizes, '[]'::jsonb)) as prize(value) where length(trim(value)) = 0 or length(value) > 200) then
    raise exception 'Public description or prize list is invalid';
  end if;
  select pub.status into current_status from public.connect_event_publications pub where pub.event_id = p_event_id for update;
  current_status := coalesce(current_status, 'draft');
  if current_status not in ('draft', 'park_confirmed', 'changes_requested', 'withdrawn') then
    raise exception 'Park details cannot be changed after Connect review has started';
  end if;
  insert into public.connect_event_publications(
    event_id, status, public_description, public_prizes, public_snapshot, park_confirmed_by, park_confirmed_at, updated_at
  ) values (
    p_event_id, 'park_confirmed', trim(coalesce(p_public_description, '')),
    coalesce(p_public_prizes, '[]'::jsonb), snapshot, public.current_app_user_id(), now(), now()
  ) on conflict(event_id) do update set
    status = 'park_confirmed', public_description = excluded.public_description,
    public_prizes = excluded.public_prizes, public_snapshot = excluded.public_snapshot, park_confirmed_by = public.current_app_user_id(),
    park_confirmed_at = now(), updated_at = now();
  insert into public.connect_platform_audit(actor_user_id, park_id, event_id, action, details)
  values (public.current_app_user_id(), target_park, p_event_id, 'event.publication.park_confirmed',
          jsonb_build_object('public_description', trim(coalesce(p_public_description, '')),
                             'public_prizes', coalesce(p_public_prizes, '[]'::jsonb)));
  return 'park_confirmed';
end;
$$;
revoke all on function public.confirm_park_event_publication(uuid, text, jsonb) from public, anon;
grant execute on function public.confirm_park_event_publication(uuid, text, jsonb) to authenticated;

create or replace function public.get_my_event_publication_statuses()
returns table (event_id uuid, status text, public_description text, public_prizes jsonb)
language sql stable security definer set search_path = ''
as $$
  select pub.event_id, pub.status, pub.public_description, pub.public_prizes
    from public.connect_event_publications pub
   where public.has_event_permission(pub.event_id, 'event.manage');
$$;
revoke all on function public.get_my_event_publication_statuses() from public, anon;
grant execute on function public.get_my_event_publication_statuses() to authenticated;

create or replace function public.set_connect_event_publication(
  p_event_id uuid,
  p_status text,
  p_public_description text default '',
  p_reason text default null
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  current_status text;
  target_park uuid;
  next_status text := trim(coalesce(p_status, ''));
  description text := trim(coalesce(p_public_description, ''));
begin
  if not public.has_platform_permission('platform.publication.manage') then
    raise exception 'Connect publication access denied' using errcode = '42501';
  end if;
  select e.park_id into target_park
    from public.events e join public.parks p on p.id = e.park_id
   where e.id = p_event_id and p.access_status = 'active';
  if target_park is null then raise exception 'Active park event not found'; end if;
  select pub.status into current_status from public.connect_event_publications pub where pub.event_id = p_event_id for update;
  current_status := coalesce(current_status, 'draft');

  if next_status = 'approved' and current_status <> 'park_confirmed' then
    raise exception 'Park confirmation is required before Connect approval';
  elsif next_status = 'changes_requested' and current_status <> 'park_confirmed' then
    raise exception 'Only park-confirmed event information can be returned for changes';
  elsif next_status = 'published' and current_status <> 'approved' then
    raise exception 'Event information must be approved before publication';
  elsif next_status = 'withdrawn' and current_status <> 'published' then
    raise exception 'Only published event information can be withdrawn';
  elsif next_status not in ('approved', 'published', 'withdrawn') then
    raise exception 'Unsupported event publication status';
  end if;
  if next_status in ('withdrawn', 'changes_requested') and length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'A reason of at least 10 characters is required';
  end if;

  insert into public.connect_event_publications (
    event_id, status, public_description, public_prizes, reviewed_by, reviewed_at, published_at, updated_at
  ) values (
    p_event_id, next_status, description,
    coalesce((select pub.public_prizes from public.connect_event_publications pub where pub.event_id = p_event_id), '[]'::jsonb),
    case when next_status = 'approved' then public.current_app_user_id() else null end,
    case when next_status = 'approved' then now() else null end,
    case when next_status = 'published' then now() else null end,
    now()
  )
  on conflict (event_id) do update set
    status = excluded.status,
    public_description = connect_event_publications.public_description,
    public_prizes = connect_event_publications.public_prizes,
    reviewed_by = case when next_status = 'approved' then public.current_app_user_id() else connect_event_publications.reviewed_by end,
    reviewed_at = case when next_status = 'approved' then now() else connect_event_publications.reviewed_at end,
    published_at = case when next_status = 'published' then now() else connect_event_publications.published_at end,
    updated_at = now();

  insert into public.connect_platform_audit(actor_user_id, park_id, event_id, action, reason, details)
  values (public.current_app_user_id(), target_park, p_event_id, 'event.publication.' || next_status,
          nullif(trim(coalesce(p_reason, '')), ''),
          jsonb_build_object('before_status', current_status, 'after_status', next_status,
                             'public_description', description));
  return next_status;
end;
$$;
revoke all on function public.set_connect_event_publication(uuid, text, text, text) from public, anon;
grant execute on function public.set_connect_event_publication(uuid, text, text, text) to authenticated;

create or replace function public.list_public_events()
returns table (
  event_id uuid,
  event_name text,
  location text,
  starts_at timestamptz,
  ends_at timestamptz,
  categories text[],
  prizes jsonb,
  public_description text,
  park_name text,
  city text,
  state char(2),
  published_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select e.id,
         pub.public_snapshot->>'event_name', pub.public_snapshot->>'location',
         (pub.public_snapshot->>'starts_at')::timestamptz, (pub.public_snapshot->>'ends_at')::timestamptz,
         array(select jsonb_array_elements_text(pub.public_snapshot->'categories')),
         pub.public_prizes, pub.public_description,
         pub.public_snapshot->>'park_name', pub.public_snapshot->>'city',
         (pub.public_snapshot->>'state')::char(2), pub.published_at
    from public.connect_event_publications pub
    join public.events e on e.id = pub.event_id
    join public.parks p on p.id = e.park_id
   where pub.status = 'published' and p.access_status = 'active'
   order by e.starts_at desc, e.id;
$$;
revoke all on function public.list_public_events() from public, authenticated;
grant execute on function public.list_public_events() to anon, authenticated;
