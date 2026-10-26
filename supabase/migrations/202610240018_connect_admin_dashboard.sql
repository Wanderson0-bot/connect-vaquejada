create or replace function public.get_connect_admin_dashboard()
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
          'connect_code', recent.connect_code,
          'name', recent.name,
          'city', recent.city,
          'state', recent.state,
          'access_status', recent.access_status,
          'created_at', recent.created_at
        ) order by recent.created_at desc, recent.id
      )
      from (
        select p.id, p.connect_code, p.name, p.city, p.state, p.access_status, p.created_at
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
