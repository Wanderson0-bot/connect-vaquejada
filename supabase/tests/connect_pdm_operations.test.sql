begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(26);

-- Isolated disposable fixtures. These inserts run as the migration test owner.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values
 ('11111111-1111-4111-8111-111111111111','authenticated','authenticated','platform-test@example.invalid','',now(),'{}','{}'),
 ('22222222-2222-4222-8222-222222222222','authenticated','authenticated','office-test@example.invalid','',now(),'{}','{}'),
 ('33333333-3333-4333-8333-333333333333','authenticated','authenticated','announcer-test@example.invalid','',now(),'{}','{}'),
 ('44444444-4444-4444-8444-444444444444','authenticated','authenticated','judge-test@example.invalid','',now(),'{}','{}'),
 ('55555555-5555-4555-8555-555555555555','authenticated','authenticated','track-test@example.invalid','',now(),'{}','{}'),
 ('66666666-6666-4666-8666-666666666666','authenticated','authenticated','expired-test@example.invalid','',now(),'{}','{}'),
 ('77777777-7777-4777-8777-777777777777','authenticated','authenticated','revoked-test@example.invalid','',now(),'{}','{}')
on conflict(id) do nothing;
insert into public.platform_admins(user_id,created_by)
values('11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111') on conflict do nothing;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
insert into public.parks(id,name,manager_name,phone,city,state,address,owner_user_id)
values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Parque Teste A','Teste','', 'Teste','SP','Endereço fictício',null),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Parque Teste B','Teste','', 'Teste','SP','Endereço fictício',null)
on conflict(id) do nothing;
insert into public.events(id,park_id,name,location,starts_at,ends_at,categories,rules,category_rules,scoring_mode)
values
 ('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Evento teste A','',now()-interval '1 day',now()+interval '1 day',array['Amador'],'{}','{}','confirm'),
 ('bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Evento teste B','',now()-interval '1 day',now()+interval '1 day',array['Amador'],'{}','{}','confirm')
on conflict(id) do nothing;
insert into public.event_staff_memberships(event_id,user_id,role,expires_at,created_by,revoked_at)
values
 ('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','office',now()+interval '1 hour','11111111-1111-4111-8111-111111111111',null),
 ('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','announcer',now()+interval '1 hour','11111111-1111-4111-8111-111111111111',null),
 ('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444','judge',now()+interval '1 hour','11111111-1111-4111-8111-111111111111',null),
 ('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','55555555-5555-4555-8555-555555555555','track_operator',now()+interval '1 hour','11111111-1111-4111-8111-111111111111',null),
 ('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','66666666-6666-4666-8666-666666666666','office',now()-interval '1 hour','11111111-1111-4111-8111-111111111111',null),
 ('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','77777777-7777-4777-8777-777777777777','office',now()+interval '1 hour','11111111-1111-4111-8111-111111111111',now())
on conflict(event_id,user_id) do nothing;

select extensions.ok(public.has_platform_permission('platform.park.create'),'platform admin can perform platform provisioning');
select extensions.ok(public.has_platform_permission('platform.admin'),'platform administrator role is recognized');
select extensions.is((select created from public.provision_connect_park_by_name('Parque Teste A','Outro responsável','999','Teste','SP','Outro endereço')),false,'repeated park name and location recover instead of creating a duplicate');
select extensions.is((select manager_name from public.parks where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'Teste','park retry does not overwrite the existing registration');
select extensions.is((select created from public.provision_connect_park_by_name('Parque Teste A','Outro responsável','','Outra cidade','RJ','Outro endereço')),true,'the same park name is allowed in a different city and state');
select extensions.is(public.create_connect_park_event('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-0000-4000-8000-cccccccccccc','Evento futuro de teste','',now()+interval '3 days',now()+interval '4 days',array['Amador'],null,null), 'cccccccc-0000-4000-8000-cccccccccccc'::uuid,'a second event receives a stable independent identity');
select extensions.is(public.create_connect_park_event('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-0000-4000-8000-cccccccccccc','Evento futuro de teste','',now()+interval '3 days',now()+interval '4 days',array['Amador'],null,null), 'cccccccc-0000-4000-8000-cccccccccccc'::uuid,'event request replay is idempotent');
select extensions.is((select count(*)::integer from public.events where park_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),2,'creating another event preserves the prior event history');
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select extensions.ok(public.has_event_permission('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','entry.update'),'office can update entries within assigned event');
select extensions.ok(public.has_event_permission('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','payment.record'),'office can record authorized payments');
select extensions.ok(not public.has_event_permission('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','result.judge'),'office cannot judge results');
select extensions.ok(not public.has_event_permission('bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb','entry.update'),'office cannot cross event or park boundary');
select extensions.is((select count(*)::integer from public.events where id='bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb'),0,'RLS hides another park event');
select extensions.ok(not has_table_privilege('authenticated','public.event_track_states','INSERT'),'client role cannot write track state directly');
select extensions.ok(not has_function_privilege('authenticated','public.apply_event_track_operation(uuid,uuid,bigint,text,jsonb,text)','EXECUTE'),'legacy full-state track RPC remains suspended');
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
select extensions.ok(public.has_event_permission('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','standings.read'),'announcer can read event standings');
select extensions.ok(not public.has_event_permission('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','payment.record'),'announcer cannot read or edit payment operations');
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
select extensions.ok(public.has_event_permission('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','result.judge'),'judge can record an event judgment');
select extensions.ok(not public.has_event_permission('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','result.confirm'),'judge cannot confirm official results');
select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',true);
select extensions.ok(public.has_event_permission('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','track.queue'),'track operator can manage the assigned queue');
select extensions.ok(not public.has_event_permission('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','users.manage'),'track operator cannot administer users');
select extensions.ok(not has_table_privilege('authenticated','public.event_staff_memberships','UPDATE'),'client cannot self-edit event role or revocation');
select extensions.ok(not has_table_privilege('service_role','public.event_staff_memberships','UPDATE'),'service role cannot bypass event membership RPC');
select extensions.ok(not has_table_privilege('service_role','public.platform_admins','INSERT'),'service role cannot promote platform accounts through direct table writes');
select set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',true);
select extensions.ok(not public.has_event_permission('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','entry.read'),'expired event assignment is rejected');
select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',true);
select extensions.ok(not public.has_event_permission('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa','entry.read'),'revoked event assignment is rejected');
select * from extensions.finish();
rollback;
