begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(16);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values
 ('88888888-8888-4888-8888-888888888881','authenticated','authenticated','registry-admin@example.invalid','',now(),'{}','{}'),
 ('88888888-8888-4888-8888-888888888882','authenticated','authenticated','registry-manager@example.invalid','',now(),'{}','{}'),
 ('88888888-8888-4888-8888-888888888883','authenticated','authenticated','registry-staff@example.invalid','',now(),'{}','{}')
on conflict(id) do nothing;

insert into public.platform_admins(user_id,created_by)
values('88888888-8888-4888-8888-888888888881','88888888-8888-4888-8888-888888888881')
on conflict do nothing;
insert into public.connect_platform_staff(user_id,role,granted_by)
values('88888888-8888-4888-8888-888888888883','deployment','88888888-8888-4888-8888-888888888881')
on conflict(user_id) do update set role='deployment',revoked_at=null;

select set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888881',true);
create temporary table registry_test_ids(pending_id uuid, managed_id uuid, event_id uuid);
insert into registry_test_ids(pending_id)
select park_id from public.provision_connect_park_by_name(
  'Parque Pendente Registry','Responsável Registry','',
  'Cidade Registry','CE','Rua Registry'
);
insert into registry_test_ids(managed_id)
select park_id from public.provision_connect_park_by_name(
  'Parque Gerido Registry','Responsável Registry','',
  'Cidade Registry','CE','Rua Registry'
);

insert into public.park_memberships(park_id,user_id,role,created_by)
select managed_id,'88888888-8888-4888-8888-888888888882','park_manager','88888888-8888-4888-8888-888888888881'
from registry_test_ids;

insert into public.events(id,park_id,name,location,starts_at,ends_at,categories,rules,category_rules,scoring_mode)
select '88888888-8888-4888-8888-888888888884',managed_id,'Evento histórico Registry','',
       now()-interval '3 days',now()-interval '2 days',array['Amador'],'{}','{}','confirm'
from registry_test_ids;
update registry_test_ids set event_id='88888888-8888-4888-8888-888888888884';

insert into public.event_staff_memberships(event_id,user_id,role,expires_at,created_by)
select event_id,'88888888-8888-4888-8888-888888888883','office',now()+interval '1 day',
       '88888888-8888-4888-8888-888888888881'
from registry_test_ids;

set local role authenticated;
select extensions.is(
  (select total_count::integer from public.list_connect_parks('Parque Pendente Registry','CE','Cidade Registry','pending_configuration',25,0)),
  1,
  'registry applies name, state, city and lifecycle filters to server rows'
);
select extensions.is(
  (select lifecycle_status from public.list_connect_parks('Parque Pendente Registry',null,null,null,25,0)),
  'pending_configuration',
  'a park without an owner or active manager is pending configuration'
);
select extensions.is(
  public.get_connect_park_profile((select pending_id from registry_test_ids))->'park'->>'lifecycle_status',
  'pending_configuration',
  'profile lifecycle state is derived by the database'
);
select extensions.is(
  public.get_connect_park_profile((select pending_id from registry_test_ids))->>'created_by_email',
  'registry-admin@example.invalid',
  'provisioning history identifies the authenticated creator'
);
select extensions.is(
  public.get_connect_park_profile((select managed_id from registry_test_ids))->'park'->>'lifecycle_status',
  'provisioned',
  'an active park-manager membership marks the park provisioned'
);
select extensions.is(
  jsonb_array_length(public.get_connect_park_profile((select managed_id from registry_test_ids))->'members'),
  1,
  'profile lists the active park manager'
);
select extensions.is(
  jsonb_array_length(public.get_connect_park_profile((select managed_id from registry_test_ids))->'event_staff'),
  1,
  'profile lists event-scoped staff'
);
select extensions.is(
  (public.get_connect_park_profile((select managed_id from registry_test_ids))->>'event_count')::integer,
  1,
  'profile returns the real event count'
);
select extensions.is(
  (public.get_connect_park_profile((select managed_id from registry_test_ids))->>'completed_event_count')::integer,
  1,
  'profile counts events whose end time has passed'
);

select public.update_connect_park(
  (select pending_id from registry_test_ids),'Parque Pendente Editado','Responsável Editado','11999',
  'Cidade Nova','PE','Rua Nova'
);
select extensions.ok(
  exists(
    select 1 from public.list_connect_platform_audit((select pending_id from registry_test_ids),20) a
    where a.action='park.update'
      and a.actor_email='registry-admin@example.invalid'
      and a.details->'before'->>'name'='Parque Pendente Registry'
      and a.details->'after'->>'name'='Parque Pendente Editado'
  ),
  'park edits record actor, time and before/after data'
);

select public.set_connect_park_status((select managed_id from registry_test_ids),'suspended','Revisão administrativa');
select extensions.is(
  (select lifecycle_status from public.list_connect_parks('Parque Gerido Registry',null,null,'suspended',25,0)),
  'suspended',
  'suspension is reflected in filtered registry results'
);
select public.set_connect_park_status((select managed_id from registry_test_ids),'closed','Encerramento administrativo');
select extensions.is(
  public.get_connect_park_profile((select managed_id from registry_test_ids))->'park'->>'lifecycle_status',
  'archived',
  'closed access is represented as archived in the profile'
);

select extensions.is(
  (select created from public.provision_connect_park_by_name(
  'Parque Pendente Registry','Outro responsável','',
  'Cidade Registry','CE','Outro endereço'
  )),
  false,
  'recovering an existing name and location never creates or overwrites the park'
);
select extensions.ok(
  exists(
    select 1 from public.list_connect_platform_audit((select pending_id from registry_test_ids),20) a
    where a.action='park.recover' and a.actor_email='registry-admin@example.invalid'
  ),
  'recovering an existing park is recorded with the authenticated actor'
);
select set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888883',true);
select extensions.ok(
  not public.has_platform_permission('platform.audit.read'),
  'deployment operators retain the restricted audit permission boundary'
);
select set_config('request.jwt.claim.sub','',true);
select extensions.throws_ok(
  $$select * from public.list_connect_parks(null,null,null,null,25,0)$$,
  '42501',
  'Connect park registry access denied',
  'unauthenticated callers cannot list parks'
);

select * from extensions.finish();
rollback;
