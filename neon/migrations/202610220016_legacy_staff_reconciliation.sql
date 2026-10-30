-- Reconciliation for legacy park-level operational access.
-- This migration is safe only AFTER 015. It never changes legacy memberships
-- or invitations while preparing/reviewing a snapshot.

create table public.legacy_staff_reconciliation_batches (
  id uuid primary key,
  park_id uuid not null references public.parks(id) on delete restrict,
  prepared_by uuid not null references public.app_users(id) on delete restrict,
  prepared_at timestamptz not null default now(),
  source_migration text not null default '202610220015_connect_pdm_operations',
  snapshot_hash text not null
);
alter table public.legacy_staff_reconciliation_batches enable row level security;
revoke all on public.legacy_staff_reconciliation_batches from public, anon, authenticated, service_role;

create table public.legacy_staff_reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.legacy_staff_reconciliation_batches(id) on delete restrict,
  park_id uuid not null references public.parks(id) on delete restrict,
  source_kind text not null check (source_kind in ('park_membership','park_invitation')),
  source_user_id uuid references public.app_users(id) on delete restrict,
  source_invitation_id uuid references public.park_invitations(id) on delete restrict,
  source_role text not null check (source_role in ('office','announcer','judge','track_operator')),
  source_created_by uuid references public.app_users(id) on delete set null,
  source_created_at timestamptz not null,
  source_was_active boolean not null,
  source_membership_disabled_at timestamptz,
  candidate_event_id uuid references public.events(id) on delete restrict,
  candidate_event_status text check (candidate_event_status in ('active','closed')),
  candidate_event_ends_at timestamptz,
  classification text not null check (classification in ('proven','ambiguous','no_destination')),
  evidence_reference text,
  decision text not null default 'pending' check (decision in ('pending','approved','rejected','activated')),
  decision_reason text,
  reviewed_by uuid references public.app_users(id) on delete set null,
  reviewed_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  check ((source_kind='park_membership' and source_user_id is not null and source_invitation_id is null)
      or (source_kind='park_invitation' and source_invitation_id is not null)),
  check ((candidate_event_id is null and candidate_event_status is null and candidate_event_ends_at is null)
      or (candidate_event_id is not null and candidate_event_status is not null and candidate_event_ends_at is not null)),
  check ((classification='no_destination') = (candidate_event_id is null)),
  check (evidence_reference is null or evidence_reference ~ '^(event_invitation|event_staff_audit|review_document):[A-Za-z0-9._/-]{1,120}$'),
  check ((decision='pending' and reviewed_by is null and reviewed_at is null and activated_at is null)
      or (decision in ('approved','rejected') and reviewed_by is not null and reviewed_at is not null and activated_at is null)
      or (decision='activated' and reviewed_by is not null and reviewed_at is not null and activated_at is not null))
);
create unique index legacy_staff_item_membership_uidx
  on public.legacy_staff_reconciliation_items(batch_id,park_id,source_user_id,candidate_event_id)
  where source_kind='park_membership';
create unique index legacy_staff_item_invitation_uidx
  on public.legacy_staff_reconciliation_items(batch_id,park_id,source_invitation_id,candidate_event_id)
  where source_kind='park_invitation';
create index legacy_staff_items_review_idx
  on public.legacy_staff_reconciliation_items(batch_id,classification,decision);
alter table public.legacy_staff_reconciliation_items enable row level security;
revoke all on public.legacy_staff_reconciliation_items from public, anon, authenticated, service_role;

create table public.legacy_staff_reconciliation_audit (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.legacy_staff_reconciliation_batches(id) on delete restrict,
  item_id uuid references public.legacy_staff_reconciliation_items(id) on delete restrict,
  park_id uuid not null references public.parks(id) on delete restrict,
  event_id uuid references public.events(id) on delete restrict,
  actor_user_id uuid references public.app_users(id) on delete set null,
  action text not null check (action in ('prepared','reviewed','activated')),
  reason text,
  before_data jsonb,
  after_data jsonb,
  occurred_at timestamptz not null default now()
);
alter table public.legacy_staff_reconciliation_audit enable row level security;
revoke all on public.legacy_staff_reconciliation_audit from public, anon, authenticated, service_role;
revoke all on sequence public.legacy_staff_reconciliation_audit_id_seq from public, anon, authenticated, service_role;

create or replace function public.prepare_legacy_staff_reconciliation(p_batch_id uuid,p_park_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare existing_batch public.legacy_staff_reconciliation_batches; new_batch boolean := false; computed_hash text;
begin
  if public.current_app_user_id() is null or p_batch_id is null or p_park_id is null then
    raise exception 'Authenticated actor, batch id, and park are required' using errcode='42501';
  end if;
  if not public.has_platform_permission('platform.event.staff.manage')
     and not public.has_park_permission(p_park_id,'park.manage') then
    raise exception 'Legacy staff reconciliation preparation denied' using errcode='42501';
  end if;
  if not exists(select 1 from public.parks p where p.id=p_park_id) then raise exception 'Park not found'; end if;
  select md5(coalesce(string_agg(x.item_key,',' order by x.item_key),'')) into computed_hash from (
    select 'm:'||m.park_id::text||':'||m.user_id::text||':'||m.role||':'||m.created_at::text||':'||coalesce(m.disabled_at::text,'active') as item_key
      from public.park_memberships m where m.park_id=p_park_id and m.role in ('office','announcer','judge','track_operator')
    union all
    select 'i:'||i.id::text||':'||i.role||':'||i.created_by::text||':'||i.created_at::text||':'||i.expires_at::text||':'||coalesce(i.accepted_by::text,'')||':'||coalesce(i.revoked_at::text,'open')||':'||coalesce(i.accepted_at::text,'unaccepted')
      from public.park_invitations i where i.park_id=p_park_id and i.role in ('office','announcer','judge','track_operator')
    union all
    select 'e:'||e.id::text||':'||e.operational_status||':'||e.starts_at::text||':'||e.ends_at::text
      from public.events e where e.park_id=p_park_id
  ) x;
  insert into public.legacy_staff_reconciliation_batches(id,park_id,prepared_by,snapshot_hash)
    values(p_batch_id,p_park_id,public.current_app_user_id(),computed_hash) on conflict(id) do nothing;
  new_batch := found;
  select * into existing_batch from public.legacy_staff_reconciliation_batches b where b.id=p_batch_id for update;
  if existing_batch.park_id<>p_park_id or existing_batch.prepared_by<>public.current_app_user_id() then
    raise exception 'Batch idempotency key belongs to another actor or park' using errcode='23505';
  end if;
  if not new_batch then
    if existing_batch.snapshot_hash<>computed_hash then raise exception 'Source changed after this batch was prepared; create a new batch' using errcode='40001'; end if;
    return p_batch_id;
  end if;

  insert into public.legacy_staff_reconciliation_items(
    batch_id,park_id,source_kind,source_user_id,source_invitation_id,source_role,source_created_by,source_created_at,source_was_active,source_membership_disabled_at,
    candidate_event_id,candidate_event_status,candidate_event_ends_at,classification,evidence_reference
  )
  select p_batch_id,p_park_id,'park_membership',m.user_id,null::uuid,m.role,m.created_by,m.created_at,m.disabled_at is null,m.disabled_at,
         e.id,e.operational_status,e.ends_at,
         case when proof.evidence is not null then 'proven' else 'ambiguous' end,proof.evidence
    from public.park_memberships m
    join public.events e on e.park_id=m.park_id
    left join lateral (
      select proof_source.evidence
        from (
          select 'event_invitation:'||i.id::text as evidence,i.accepted_at as occurred_at
            from public.event_staff_invitations i
           where i.event_id=e.id and i.accepted_by=m.user_id and i.accepted_at is not null and i.revoked_at is null and i.role=m.role
             and exists(select 1 from public.event_staff_memberships em
                          where em.event_id=e.id and em.user_id=m.user_id and em.role=m.role
                            and em.revoked_at is null and em.expires_at>now())
          union all
          select 'event_staff_audit:'||a.id::text as evidence,a.occurred_at
            from public.event_staff_audit a
           where a.event_id=e.id and a.subject_user_id=m.user_id and a.actor_user_id is not null
             and a.action in ('grant','change') and a.after_role=m.role
             and exists(select 1 from public.event_staff_memberships em
                          where em.event_id=e.id and em.user_id=m.user_id and em.role=m.role
                            and em.revoked_at is null and em.expires_at>now())
             and not exists(select 1 from public.event_staff_audit later
                             where later.event_id=a.event_id and later.subject_user_id=a.subject_user_id
                               and (later.occurred_at,later.id)>(a.occurred_at,a.id))
        ) proof_source
       order by proof_source.occurred_at desc limit 1
    ) proof on true
   where m.park_id=p_park_id and m.role in ('office','announcer','judge','track_operator')
  union all
  select p_batch_id,p_park_id,'park_membership',m.user_id,null,m.role,m.created_by,m.created_at,m.disabled_at is null,m.disabled_at,
         null::uuid,null::text,null::timestamptz,'no_destination',null::text
    from public.park_memberships m
   where m.park_id=p_park_id and m.role in ('office','announcer','judge','track_operator')
     and not exists(select 1 from public.events e where e.park_id=m.park_id)
  union all
  select p_batch_id,p_park_id,'park_invitation',i.accepted_by,i.id,i.role,i.created_by,i.created_at,
         i.accepted_at is null and i.revoked_at is null and i.expires_at>now(),
         null,
         e.id,e.operational_status,e.ends_at,'ambiguous',null
    from public.park_invitations i
    join public.events e on e.park_id=i.park_id
   where i.park_id=p_park_id and i.role in ('office','announcer','judge','track_operator')
  union all
  select p_batch_id,p_park_id,'park_invitation',i.accepted_by,i.id,i.role,i.created_by,i.created_at,
         i.accepted_at is null and i.revoked_at is null and i.expires_at>now(),
         null,
         null::uuid,null::text,null::timestamptz,'no_destination',null::text
    from public.park_invitations i
   where i.park_id=p_park_id and i.role in ('office','announcer','judge','track_operator')
     and not exists(select 1 from public.events e where e.park_id=i.park_id);

  insert into public.legacy_staff_reconciliation_audit(batch_id,park_id,actor_user_id,action,reason,after_data)
    values(p_batch_id,p_park_id,public.current_app_user_id(),'prepared','Read-only snapshot; no access was changed',jsonb_build_object('snapshot_hash',computed_hash));
  return p_batch_id;
end;
$$;
revoke all on function public.prepare_legacy_staff_reconciliation(uuid,uuid) from public, anon, service_role;
grant execute on function public.prepare_legacy_staff_reconciliation(uuid,uuid) to authenticated;

create or replace function public.get_legacy_staff_reconciliation(p_batch_id uuid)
returns table(item_id uuid,park_id uuid,source_kind text,source_user_id uuid,source_invitation_id uuid,source_role text,
  source_created_by uuid,source_created_at timestamptz,source_was_active boolean,source_membership_disabled_at timestamptz,
  candidate_event_id uuid,candidate_event_status text,candidate_event_ends_at timestamptz,classification text,evidence_reference text,
  decision text,decision_reason text,reviewed_by uuid,reviewed_at timestamptz,activated_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare target_park uuid;
begin
  select b.park_id into target_park from public.legacy_staff_reconciliation_batches b where b.id=p_batch_id;
  if target_park is null or (not public.has_platform_permission('platform.event.staff.manage') and not public.has_park_permission(target_park,'park.manage')) then
    raise exception 'Legacy staff reconciliation read denied' using errcode='42501';
  end if;
  return query select i.id,i.park_id,i.source_kind,i.source_user_id,i.source_invitation_id,i.source_role,
    i.source_created_by,i.source_created_at,i.source_was_active,i.source_membership_disabled_at,
    i.candidate_event_id,i.candidate_event_status,i.candidate_event_ends_at,i.classification,i.evidence_reference,
    i.decision,i.decision_reason,i.reviewed_by,i.reviewed_at,i.activated_at
    from public.legacy_staff_reconciliation_items i where i.batch_id=p_batch_id order by i.source_kind,i.source_user_id,i.candidate_event_id;
end;
$$;
revoke all on function public.get_legacy_staff_reconciliation(uuid) from public, anon, service_role;
grant execute on function public.get_legacy_staff_reconciliation(uuid) to authenticated;

create or replace function public.get_legacy_staff_reconciliation_audit(p_batch_id uuid)
returns table(item_id uuid,park_id uuid,event_id uuid,actor_user_id uuid,action text,reason text,
  before_data jsonb,after_data jsonb,occurred_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare target_park uuid;
begin
  select b.park_id into target_park from public.legacy_staff_reconciliation_batches b where b.id=p_batch_id;
  if target_park is null or (not public.has_platform_permission('platform.event.staff.manage') and not public.has_park_permission(target_park,'park.manage')) then
    raise exception 'Legacy staff reconciliation audit read denied' using errcode='42501';
  end if;
  return query select a.item_id,a.park_id,a.event_id,a.actor_user_id,a.action,a.reason,a.before_data,a.after_data,a.occurred_at
    from public.legacy_staff_reconciliation_audit a where a.batch_id=p_batch_id order by a.occurred_at,a.id;
end;
$$;
revoke all on function public.get_legacy_staff_reconciliation_audit(uuid) from public, anon, service_role;
grant execute on function public.get_legacy_staff_reconciliation_audit(uuid) to authenticated;

create or replace function public.review_legacy_staff_mapping(p_item_id uuid,p_classification text,p_evidence_reference text,p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare item public.legacy_staff_reconciliation_items; before_row jsonb;
begin
  if public.current_app_user_id() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into item from public.legacy_staff_reconciliation_items where id=p_item_id for update;
  if not found then raise exception 'Reconciliation item not found'; end if;
  if not public.has_platform_permission('platform.event.staff.manage') and not public.has_park_permission(item.park_id,'park.manage') then
    raise exception 'Legacy staff mapping review denied' using errcode='42501';
  end if;
  if p_classification not in ('proven','ambiguous','no_destination') or length(trim(coalesce(p_reason,'')))<5 then
    raise exception 'Classification and review reason are required';
  end if;
  if p_classification='proven' and (item.source_kind<>'park_membership' or item.source_user_id is null
       or item.candidate_event_id is null or length(trim(coalesce(p_evidence_reference,'')))<3) then
    raise exception 'A specific event and evidence reference are required for a proven mapping';
  end if;
  if p_classification='proven' and trim(p_evidence_reference) !~ '^(event_invitation|event_staff_audit|review_document):[A-Za-z0-9._/-]{1,120}$' then
    raise exception 'Evidence must be a safe reference, not a token or free-form secret';
  end if;
  if p_classification='proven' and p_evidence_reference like 'event_invitation:%'
     and not exists (
       select 1 from public.event_staff_invitations i
        where i.id=split_part(p_evidence_reference,':',2)::uuid and i.event_id=item.candidate_event_id
          and i.accepted_by=item.source_user_id and i.accepted_at is not null and i.revoked_at is null and i.role=item.source_role
          and exists(select 1 from public.event_staff_memberships em where em.event_id=item.candidate_event_id
                       and em.user_id=item.source_user_id and em.role=item.source_role
                       and em.revoked_at is null and em.expires_at>now())
     ) then raise exception 'Event invitation evidence does not match this user, role, and event'; end if;
  if p_classification='proven' and p_evidence_reference like 'event_staff_audit:%'
     and not exists (
       select 1 from public.event_staff_audit a
        where a.id=split_part(p_evidence_reference,':',2)::bigint and a.event_id=item.candidate_event_id
          and a.subject_user_id=item.source_user_id and a.actor_user_id is not null
          and a.action in ('grant','change') and a.after_role=item.source_role
          and exists(select 1 from public.event_staff_memberships em where em.event_id=item.candidate_event_id
                       and em.user_id=item.source_user_id and em.role=item.source_role
                       and em.revoked_at is null and em.expires_at>now())
          and not exists(select 1 from public.event_staff_audit later where later.event_id=a.event_id
                           and later.subject_user_id=a.subject_user_id and (later.occurred_at,later.id)>(a.occurred_at,a.id))
     ) then raise exception 'Event staff audit evidence does not match this user, role, and event'; end if;
  if p_classification='no_destination' and item.candidate_event_id is not null then
    raise exception 'An event candidate cannot be classified as having no destination';
  end if;
  if item.decision='activated' then raise exception 'Activated mappings are immutable; prepare a new review batch'; end if;
  if item.decision='approved' and item.classification='proven'
     and item.evidence_reference is not distinct from p_evidence_reference
     and item.decision_reason is not distinct from trim(p_reason) then return; end if;
  before_row := to_jsonb(item);
  update public.legacy_staff_reconciliation_items set classification=p_classification,
    evidence_reference=nullif(trim(p_evidence_reference),''),decision=case when p_classification='proven' then 'approved' else 'rejected' end,
    decision_reason=trim(p_reason),reviewed_by=public.current_app_user_id(),reviewed_at=now()
   where id=p_item_id;
  insert into public.legacy_staff_reconciliation_audit(batch_id,item_id,park_id,event_id,actor_user_id,action,reason,before_data,after_data)
    values(item.batch_id,item.id,item.park_id,item.candidate_event_id,public.current_app_user_id(),'reviewed',trim(p_reason),before_row,
      (select to_jsonb(i) from public.legacy_staff_reconciliation_items i where i.id=p_item_id));
end;
$$;
revoke all on function public.review_legacy_staff_mapping(uuid,text,text,text) from public, anon, service_role;
grant execute on function public.review_legacy_staff_mapping(uuid,text,text,text) to authenticated;

create or replace function public.activate_legacy_staff_mapping(p_item_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare item public.legacy_staff_reconciliation_items; source_membership public.park_memberships; target_event public.events; existing public.event_staff_memberships; before_row jsonb;
begin
  if public.current_app_user_id() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into item from public.legacy_staff_reconciliation_items where id=p_item_id for update;
  if not found then raise exception 'Reconciliation item not found'; end if;
  if not public.has_platform_permission('platform.event.staff.manage') and not public.has_park_permission(item.park_id,'park.manage') then
    raise exception 'Legacy staff mapping activation denied' using errcode='42501';
  end if;
  if item.decision='activated' then
    if exists(select 1 from public.event_staff_memberships m where m.event_id=item.candidate_event_id and m.user_id=item.source_user_id and m.role=item.source_role and m.revoked_at is null) then return; end if;
    raise exception 'Previously activated mapping no longer has its active membership; manual review required' using errcode='40001';
  end if;
  if item.source_kind<>'park_membership' or item.source_user_id is null or item.candidate_event_id is null
     or item.classification<>'proven' or item.decision<>'approved' or item.reviewed_by is null
     or item.reviewed_by=public.current_app_user_id() or item.evidence_reference is null then
    raise exception 'Mapping needs proven evidence, independent review, and a membership source' using errcode='42501';
  end if;
  select * into source_membership from public.park_memberships m where m.park_id=item.park_id and m.user_id=item.source_user_id for share;
  if not found or source_membership.role<>item.source_role or source_membership.created_at<>item.source_created_at
     or source_membership.created_by is distinct from item.source_created_by
     or source_membership.disabled_at is distinct from item.source_membership_disabled_at then
    raise exception 'Legacy membership changed since inventory; prepare a new batch' using errcode='40001';
  end if;
  -- A disabled legacy source is never reactivated. This RPC creates only a new,
  -- explicitly reviewed event assignment; two-person approval is required below.
  select * into target_event from public.events e where e.id=item.candidate_event_id and e.park_id=item.park_id for share;
  if not found or target_event.operational_status<>'active' or target_event.ends_at<=now()
     or not exists(select 1 from public.parks p where p.id=item.park_id and p.access_status='active') then
    raise exception 'Candidate event is not active';
  end if;
  select * into existing from public.event_staff_memberships m where m.event_id=item.candidate_event_id and m.user_id=item.source_user_id for update;
  if found then
    if existing.role<>item.source_role or existing.revoked_at is not null or existing.expires_at<=now() then
      raise exception 'Conflicting or inactive event membership; manual review required' using errcode='23505';
    end if;
  else
    insert into public.event_staff_memberships(event_id,user_id,role,expires_at,created_by)
      values(item.candidate_event_id,item.source_user_id,item.source_role,target_event.ends_at,public.current_app_user_id())
      on conflict(event_id,user_id) do nothing;
    select * into existing from public.event_staff_memberships m where m.event_id=item.candidate_event_id and m.user_id=item.source_user_id for update;
    if not found or existing.role<>item.source_role or existing.revoked_at is not null or existing.expires_at<=now() then
      raise exception 'Concurrent or conflicting event membership; manual review required' using errcode='23505';
    end if;
  end if;
  before_row := to_jsonb(item);
  update public.legacy_staff_reconciliation_items set decision='activated',activated_at=now() where id=p_item_id;
  insert into public.legacy_staff_reconciliation_audit(batch_id,item_id,park_id,event_id,actor_user_id,action,reason,before_data,after_data)
    values(item.batch_id,item.id,item.park_id,item.candidate_event_id,public.current_app_user_id(),'activated','Approved explicit event mapping',before_row,
      (select to_jsonb(i) from public.legacy_staff_reconciliation_items i where i.id=p_item_id));
end;
$$;
revoke all on function public.activate_legacy_staff_mapping(uuid) from public, anon, service_role;
grant execute on function public.activate_legacy_staff_mapping(uuid) to authenticated;

create or replace function public.guard_legacy_staff_reconciliation_audit()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  raise exception 'Reconciliation audit is append-only';
end;
$$;
create trigger legacy_staff_reconciliation_audit_immutable
  before update or delete on public.legacy_staff_reconciliation_audit
  for each row execute function public.guard_legacy_staff_reconciliation_audit();
revoke all on function public.guard_legacy_staff_reconciliation_audit() from public, anon, authenticated, service_role;

comment on table public.legacy_staff_reconciliation_items is 'Read-only inventory of legacy assignments and event candidates; no access changes occur until independently reviewed activation.';
comment on function public.prepare_legacy_staff_reconciliation(uuid,uuid) is 'Idempotent read-only snapshot. Never grants/revokes park or event access.';
