begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(29);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values
 ('81000000-0000-4000-8000-000000000001','authenticated','authenticated','reconcile-admin-a@example.invalid','',now(),'{}','{}'),
 ('81000000-0000-4000-8000-000000000002','authenticated','authenticated','reconcile-admin-b@example.invalid','',now(),'{}','{}'),
 ('81000000-0000-4000-8000-000000000011','authenticated','authenticated','legacy-office@example.invalid','',now(),'{}','{}'),
 ('81000000-0000-4000-8000-000000000012','authenticated','authenticated','legacy-announcer@example.invalid','',now(),'{}','{}'),
 ('81000000-0000-4000-8000-000000000013','authenticated','authenticated','legacy-conflict@example.invalid','',now(),'{}','{}'),
 ('81000000-0000-4000-8000-000000000014','authenticated','authenticated','legacy-no-event@example.invalid','',now(),'{}','{}')
on conflict(id) do nothing;
insert into public.platform_admins(user_id,created_by)
values ('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001'),
       ('81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001')
on conflict do nothing;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
insert into public.parks(id,name,manager_name,phone,city,state,address,owner_user_id)
values
 ('81000000-aaaa-4000-8000-000000000001','Park Reconcile A','Manager','', 'Test','SP','Fictional',null),
 ('81000000-aaaa-4000-8000-000000000002','Park Reconcile B','Manager','', 'Test','SP','Fictional',null),
 ('81000000-aaaa-4000-8000-000000000003','Park Reconcile C','Manager','', 'Test','SP','Fictional',null)
on conflict(id) do nothing;
insert into public.events(id,park_id,name,location,starts_at,ends_at,categories,rules,category_rules,scoring_mode)
values
 ('81000000-bbbb-4000-8000-000000000001','81000000-aaaa-4000-8000-000000000001','Event A1','',now()-interval '1 day',now()+interval '1 day',array['Amador'],'{}','{}','confirm'),
 ('81000000-bbbb-4000-8000-000000000002','81000000-aaaa-4000-8000-000000000001','Event A2','',now()+interval '3 days',now()+interval '4 days',array['Amador'],'{}','{}','confirm'),
 ('81000000-bbbb-4000-8000-000000000003','81000000-aaaa-4000-8000-000000000002','Event B1','',now()+interval '3 days',now()+interval '4 days',array['Amador'],'{}','{}','confirm')
on conflict(id) do nothing;
insert into public.park_memberships(park_id,user_id,role,created_by,disabled_at)
values
 ('81000000-aaaa-4000-8000-000000000001','81000000-0000-4000-8000-000000000011','office','81000000-0000-4000-8000-000000000001',null),
 ('81000000-aaaa-4000-8000-000000000001','81000000-0000-4000-8000-000000000012','announcer','81000000-0000-4000-8000-000000000001',null),
 ('81000000-aaaa-4000-8000-000000000001','81000000-0000-4000-8000-000000000013','office','81000000-0000-4000-8000-000000000001',null),
 ('81000000-aaaa-4000-8000-000000000003','81000000-0000-4000-8000-000000000014','judge','81000000-0000-4000-8000-000000000001',null)
on conflict(park_id,user_id) do nothing;
insert into public.park_invitations(park_id,email,role,token_hash,expires_at,created_by)
values ('81000000-aaaa-4000-8000-000000000001','pending-old-invite@example.invalid','office',
        extensions.digest(convert_to('fixture-only-token','UTF8'),'sha256'),now()+interval '7 days','81000000-0000-4000-8000-000000000001')
on conflict do nothing;

select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
insert into public.event_staff_memberships(event_id,user_id,role,expires_at,created_by)
values ('81000000-bbbb-4000-8000-000000000001','81000000-0000-4000-8000-000000000011','office',now()+interval '1 day','81000000-0000-4000-8000-000000000002'),
       ('81000000-bbbb-4000-8000-000000000002','81000000-0000-4000-8000-000000000013','announcer',now()+interval '4 days','81000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
select extensions.is(public.prepare_legacy_staff_reconciliation('81000000-cccc-4000-8000-000000000001','81000000-aaaa-4000-8000-000000000001'),
                     '81000000-cccc-4000-8000-000000000001'::uuid,'preparation returns requested idempotency key');
select extensions.is(public.prepare_legacy_staff_reconciliation('81000000-cccc-4000-8000-000000000001','81000000-aaaa-4000-8000-000000000001'),
                     '81000000-cccc-4000-8000-000000000001'::uuid,'same preparation request returns same batch');
select extensions.is((select count(*)::integer from public.get_legacy_staff_reconciliation('81000000-cccc-4000-8000-000000000001')),8,'two events yield independent candidates for each legacy source');
select extensions.ok((select source_created_by is not null and source_created_at is not null from public.get_legacy_staff_reconciliation('81000000-cccc-4000-8000-000000000001') where source_user_id='81000000-0000-4000-8000-000000000011' limit 1),'report exposes source identity provenance and creation timestamp');
select extensions.is((select count(*)::integer from public.get_legacy_staff_reconciliation('81000000-cccc-4000-8000-000000000001') where classification='proven'),1,'only an event-scoped audited grant is automatically evidenced');
select extensions.is((select count(*)::integer from public.get_legacy_staff_reconciliation('81000000-cccc-4000-8000-000000000001') where classification='ambiguous'),7,'park-only memberships and invitations remain ambiguous');
select extensions.is((select count(*)::integer from public.get_legacy_staff_reconciliation('81000000-cccc-4000-8000-000000000001') where candidate_event_id='81000000-bbbb-4000-8000-000000000003'),0,'candidate events are isolated to the membership park');
reset role;
select extensions.is((select count(*)::integer from public.park_memberships where park_id='81000000-aaaa-4000-8000-000000000001' and disabled_at is null),3,'preparation preserves all active legacy memberships');
select extensions.is((select count(*)::integer from public.event_staff_memberships where event_id='81000000-bbbb-4000-8000-000000000002' and user_id='81000000-0000-4000-8000-000000000012'),0,'preparation does not grant the legacy announcer a second event');
select extensions.is((select count(*)::integer from public.event_staff_memberships where event_id='81000000-bbbb-4000-8000-000000000001' and user_id='81000000-0000-4000-8000-000000000011' and role='office'),1,'pre-existing explicit event membership is preserved');
set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000011',true);
select extensions.ok(public.has_event_permission('81000000-bbbb-4000-8000-000000000001','entry.read'),'explicit membership grants only its assigned event');
select extensions.ok(not public.has_event_permission('81000000-bbbb-4000-8000-000000000002','entry.read'),'same user receives no inferred access to another event');
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
select extensions.is(public.prepare_legacy_staff_reconciliation('81000000-cccc-4000-8000-000000000002','81000000-aaaa-4000-8000-000000000003'),
                     '81000000-cccc-4000-8000-000000000002'::uuid,'park with no events can be inventoried');
select extensions.is((select count(*)::integer from public.get_legacy_staff_reconciliation('81000000-cccc-4000-8000-000000000002') where classification='no_destination'),1,'source without events is explicitly no destination');
select extensions.lives_ok($$select public.review_legacy_staff_mapping(
  (select item_id from public.get_legacy_staff_reconciliation('81000000-cccc-4000-8000-000000000001') where source_user_id='81000000-0000-4000-8000-000000000012' and candidate_event_id='81000000-bbbb-4000-8000-000000000001'),
  'proven','review_document:roster-fixture-001','Fictional roster explicitly assigns this person to Event A1')$$,'reviewer can approve a referenced event-specific roster');
select extensions.is((select classification from public.get_legacy_staff_reconciliation('81000000-cccc-4000-8000-000000000001') where source_user_id='81000000-0000-4000-8000-000000000012' and candidate_event_id='81000000-bbbb-4000-8000-000000000001'),
                     'proven','review decision is visible and scoped to candidate event');
select extensions.is((select reviewed_by from public.get_legacy_staff_reconciliation('81000000-cccc-4000-8000-000000000001') where source_user_id='81000000-0000-4000-8000-000000000012' and candidate_event_id='81000000-bbbb-4000-8000-000000000001'),
                     '81000000-0000-4000-8000-000000000001'::uuid,'review records the individual reviewer');
select extensions.throws_ok($$select public.review_legacy_staff_mapping(
  (select item_id from public.get_legacy_staff_reconciliation('81000000-cccc-4000-8000-000000000001') where source_user_id='81000000-0000-4000-8000-000000000012' and candidate_event_id='81000000-bbbb-4000-8000-000000000001'),
  'proven','secret-token-value','invalid evidence')$$,
  'P0001','Evidence must be a safe reference, not a token or free-form secret','review rejects token-like free-form evidence');
select extensions.throws_ok($$select public.activate_legacy_staff_mapping(
  (select item_id from public.get_legacy_staff_reconciliation('81000000-cccc-4000-8000-000000000001') where source_user_id='81000000-0000-4000-8000-000000000012' and candidate_event_id='81000000-bbbb-4000-8000-000000000001'))$$,
  '42501','Mapping needs proven evidence, independent review, and a membership source','reviewer cannot activate their own approval');
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
select extensions.lives_ok($$select public.activate_legacy_staff_mapping(
  (select item_id from public.get_legacy_staff_reconciliation('81000000-cccc-4000-8000-000000000001') where source_user_id='81000000-0000-4000-8000-000000000012' and candidate_event_id='81000000-bbbb-4000-8000-000000000001'))$$,'a second authorized operator activates the approved mapping');
reset role;
select extensions.is((select count(*)::integer from public.event_staff_memberships where event_id='81000000-bbbb-4000-8000-000000000001' and user_id='81000000-0000-4000-8000-000000000012' and role='announcer' and revoked_at is null),1,'activation grants only the reviewed role on the reviewed event');
select extensions.lives_ok($$select public.activate_legacy_staff_mapping(
  (select item_id from public.get_legacy_staff_reconciliation('81000000-cccc-4000-8000-000000000001') where source_user_id='81000000-0000-4000-8000-000000000012' and candidate_event_id='81000000-bbbb-4000-8000-000000000001'))$$,'repeating activation is idempotent');
select extensions.is((select count(*)::integer from public.event_staff_memberships where event_id='81000000-bbbb-4000-8000-000000000001' and user_id='81000000-0000-4000-8000-000000000012'),1,'repeated activation creates no duplicate');
set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
select public.review_legacy_staff_mapping(
  (select item_id from public.get_legacy_staff_reconciliation('81000000-cccc-4000-8000-000000000001') where source_user_id='81000000-0000-4000-8000-000000000013' and candidate_event_id='81000000-bbbb-4000-8000-000000000002'),
  'proven','review_document:roster-conflict-001','Fictional roster assigns office to Event A2');
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
select extensions.throws_ok($$select public.activate_legacy_staff_mapping(
  (select item_id from public.get_legacy_staff_reconciliation('81000000-cccc-4000-8000-000000000001') where source_user_id='81000000-0000-4000-8000-000000000013' and candidate_event_id='81000000-bbbb-4000-8000-000000000002'))$$,
  '23505','Conflicting or inactive event membership; manual review required','conflicting role is never overwritten');
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000011',true);
select extensions.throws_ok($$select public.prepare_legacy_staff_reconciliation('81000000-cccc-4000-8000-000000000003','81000000-aaaa-4000-8000-000000000002')$$,
  '42501','Legacy staff reconciliation preparation denied','ordinary operator cannot inventory another park');
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
select extensions.is((select count(*)::integer from public.get_legacy_staff_reconciliation_audit('81000000-cccc-4000-8000-000000000001')),4,'preparation, both reviews, and activation remain in audit history');
select extensions.ok(not has_table_privilege('authenticated','public.legacy_staff_reconciliation_items','INSERT')
  and not has_table_privilege('service_role','public.legacy_staff_reconciliation_items','INSERT'),
  'client and service roles cannot directly write reconciliation items');

reset role;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
update public.event_staff_memberships set revoked_at=now(),updated_at=now()
 where event_id='81000000-bbbb-4000-8000-000000000001' and user_id='81000000-0000-4000-8000-000000000011';
set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
select public.prepare_legacy_staff_reconciliation('81000000-cccc-4000-8000-000000000004','81000000-aaaa-4000-8000-000000000001');
select extensions.is((select classification from public.get_legacy_staff_reconciliation('81000000-cccc-4000-8000-000000000004')
  where source_user_id='81000000-0000-4000-8000-000000000011' and candidate_event_id='81000000-bbbb-4000-8000-000000000001'),
  'ambiguous','historical grant followed by revocation is not current assignment evidence');
reset role;
select extensions.is((select count(*)::integer from public.event_staff_memberships
  where event_id='81000000-bbbb-4000-8000-000000000001' and user_id='81000000-0000-4000-8000-000000000011' and revoked_at is not null),
  1,'inventory leaves the pre-existing revocation and its audit intact');
select * from extensions.finish();
rollback;
