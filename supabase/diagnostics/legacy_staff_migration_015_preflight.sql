-- READ ONLY. Run against the intended database before any deployment that
-- could apply migration 202610220015_connect_pdm_operations.sql.
-- Any returned active membership or open operational invitation is a hard stop:
-- 015 would otherwise deactivate/revoke it and derive event access by park only.

select case when exists (
         select 1 from public.park_memberships m
          where m.disabled_at is null and m.role in ('office','announcer','judge','track_operator')
       ) or exists (
         select 1 from public.park_invitations i
          where i.role in ('office','announcer','judge','track_operator')
            and i.accepted_at is null and i.revoked_at is null
       ) then 'BLOCK' else 'PASS' end as migration_015_preflight,
       (select count(*)::integer from public.park_memberships m where m.disabled_at is null and m.role in ('office','announcer','judge','track_operator')) as active_memberships,
       (select count(*)::integer from public.park_invitations i where i.role in ('office','announcer','judge','track_operator') and i.accepted_at is null and i.revoked_at is null) as open_invitations;

select m.park_id, m.user_id, m.role, m.created_at, m.disabled_at,
       count(e.id)::integer as future_event_candidates,
       coalesce(array_agg(e.id order by e.starts_at) filter (where e.id is not null), '{}'::uuid[]) as candidate_event_ids,
       'BLOCK 015: park membership is not proof of event assignment'::text as disposition
  from public.park_memberships m
  left join public.events e on e.park_id=m.park_id and e.ends_at>now()
 where m.disabled_at is null and m.role in ('office','announcer','judge','track_operator')
 group by m.park_id,m.user_id,m.role,m.created_at,m.disabled_at
 order by m.park_id,m.user_id;

select i.park_id, i.id as invitation_id, i.role, i.created_at, i.expires_at,
       i.accepted_by, i.accepted_at, i.revoked_at,
       'BLOCK 015: park invitation has no event scope'::text as disposition
  from public.park_invitations i
 where i.role in ('office','announcer','judge','track_operator')
   and i.accepted_at is null and i.revoked_at is null
 order by i.park_id,i.created_at;
