-- Neon-only data migration. Run after importing application data into the complete schema.
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
    raise exception 'Legacy access cutover 023 blocked: legacy operational access needs review. Run the read-only preflight and reconcile assignments before retrying.';
  end if;
end;
$$;
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
