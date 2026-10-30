-- READ ONLY. Run against the intended database before any deployment that
-- could apply post-import legacy access cutover migration 202610250023_legacy_staff_access_cutover.sql.
-- Active memberships, open operational invitations, or duplicate normalized
-- app user emails are hard stops that require explicit review before cutover.

select case when exists (
         select 1 from public.park_memberships m
          where m.disabled_at is null and m.role in ('office','announcer','judge','track_operator')
       ) or exists (
         select 1 from public.park_invitations i
          where i.role in ('office','announcer','judge','track_operator')
            and i.accepted_at is null and i.revoked_at is null
       ) or exists (
         select 1 from public.app_users
          group by lower(btrim(email))
         having count(*) > 1
       ) then 'BLOCK' else 'PASS' end as legacy_access_cutover_preflight,
       (select count(*)::integer from public.park_memberships m where m.disabled_at is null and m.role in ('office','announcer','judge','track_operator')) as active_memberships,
       (select count(*)::integer from public.park_invitations i where i.role in ('office','announcer','judge','track_operator') and i.accepted_at is null and i.revoked_at is null) as open_invitations,
       (select count(*)::integer from (select lower(btrim(email)) from public.app_users group by lower(btrim(email)) having count(*) > 1) duplicate_email_groups) as duplicate_normalized_email_groups;

select m.park_id, m.user_id, m.role, m.created_at, m.disabled_at,
       count(e.id)::integer as future_event_candidates,
       coalesce(array_agg(e.id order by e.starts_at) filter (where e.id is not null), '{}'::uuid[]) as candidate_event_ids,
       'BLOCK cutover: park membership is not proof of event assignment'::text as disposition
  from public.park_memberships m
  left join public.events e on e.park_id=m.park_id and e.ends_at>now()
 where m.disabled_at is null and m.role in ('office','announcer','judge','track_operator')
 group by m.park_id,m.user_id,m.role,m.created_at,m.disabled_at
 order by m.park_id,m.user_id;

select i.park_id, i.id as invitation_id, i.role, i.created_at, i.expires_at,
       i.accepted_by, i.accepted_at, i.revoked_at,
       'BLOCK cutover: park invitation has no event scope'::text as disposition
  from public.park_invitations i
 where i.role in ('office','announcer','judge','track_operator')
   and i.accepted_at is null and i.revoked_at is null
 order by i.park_id,i.created_at;

-- Inventory application triggers for planning the staging data load.
-- This is descriptive only; it does not disable or modify any trigger.
select schema_name.nspname as schema_name,
       relation.relname as table_name,
       trg.tgname as trigger_name,
       case trg.tgenabled
         when 'O' then 'origin'
         when 'D' then 'disabled'
         when 'R' then 'replica'
         when 'A' then 'always'
       end as enabled_mode,
       pg_catalog.pg_get_triggerdef(trg.oid, true) as definition
  from pg_catalog.pg_trigger as trg
  join pg_catalog.pg_class as relation on relation.oid=trigger.tgrelid
  join pg_catalog.pg_namespace as schema_name on schema_name.oid=relation.relnamespace
 where schema_name.nspname='public'
   and not trg.tgisinternal
 order by relation.relname,trg.tgname;
