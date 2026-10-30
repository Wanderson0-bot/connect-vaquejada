-- Additive copy from Neon Auth to the self-managed Better Auth schema.
-- Source rows remain untouched. Sessions, verification tokens and signing
-- keys are intentionally not copied; users must establish new sessions.

do $$
begin
  if to_regclass('neon_auth."user"') is null or to_regclass('neon_auth.account') is null then
    raise exception 'Neon Auth user/account tables are required for the identity copy';
  end if;

  if exists (
    select 1 from neon_auth."user" source_user
    join connect_auth."user" target_user
      on lower(target_user.email)=lower(source_user.email)
     and target_user.id<>source_user.id::text
  ) then
    raise exception 'An email already belongs to a different self-managed identity; reconcile it before copying';
  end if;

  if exists (
    select 1
      from neon_auth."user" source_user
      left join public.neon_auth_identity_map identity
        on identity.neon_subject=source_user.id::text
      left join public.app_users email_user
        on lower(email_user.email)=lower(source_user.email)
      join public.app_users conflicting_email
        on lower(conflicting_email.email)=lower(source_user.email)
       and conflicting_email.id<>coalesce(identity.app_user_id,email_user.id,source_user.id)
  ) then
    raise exception 'An auth email maps to a different application user; reconcile identities before copying';
  end if;

  if exists (
    select 1
      from neon_auth."user" source_user
      left join public.neon_auth_identity_map identity
        on identity.neon_subject=source_user.id::text
      left join public.app_users email_user
        on lower(email_user.email)=lower(source_user.email)
      join public.neon_auth_identity_map conflicting_identity
        on conflicting_identity.app_user_id=coalesce(identity.app_user_id,email_user.id,source_user.id)
       and conflicting_identity.neon_subject<>source_user.id::text
  ) then
    raise exception 'An application user is linked to a different auth identity; reconcile the identity map before copying';
  end if;

  if exists (
    select 1 from neon_auth.account source_account
    join connect_auth.account target_account
      on target_account.id=source_account.id::text
     and (target_account."userId"<>source_account."userId"::text
       or target_account."providerId"<>source_account."providerId"
       or target_account."accountId"<>source_account."accountId")
  ) then
    raise exception 'An auth account id conflicts with different target account data';
  end if;
end;
$$;

with identity_source as (
  select source_user.*,
         coalesce(identity.app_user_id,email_user.id,source_user.id) as app_user_id
    from neon_auth."user" source_user
    left join public.neon_auth_identity_map identity
      on identity.neon_subject=source_user.id::text
    left join public.app_users email_user
      on lower(email_user.email)=lower(source_user.email)
)
insert into public.app_users(id,email,email_confirmed_at)
select app_user_id,lower(email),case when "emailVerified" then coalesce("updatedAt","createdAt",now()) else null end
  from identity_source
on conflict(id) do update
  set email=excluded.email,
      email_confirmed_at=coalesce(public.app_users.email_confirmed_at,excluded.email_confirmed_at);

with identity_source as (
  select source_user.*,
         coalesce(identity.app_user_id,email_user.id,source_user.id) as app_user_id
    from neon_auth."user" source_user
    left join public.neon_auth_identity_map identity
      on identity.neon_subject=source_user.id::text
    left join public.app_users email_user
      on lower(email_user.email)=lower(source_user.email)
)
insert into public.neon_auth_identity_map(neon_subject,app_user_id,email)
select id::text,app_user_id,lower(email)
  from identity_source
on conflict(neon_subject) do update
  set app_user_id=excluded.app_user_id,email=excluded.email,synced_at=now();

insert into connect_auth."user"(id,name,email,"emailVerified",image,"createdAt","updatedAt")
select id::text,name,lower(email),"emailVerified",image,"createdAt","updatedAt"
  from neon_auth."user"
on conflict(id) do nothing;

insert into connect_auth.account(
  id,"accountId","providerId","userId","accessToken","refreshToken","idToken",
  "accessTokenExpiresAt","refreshTokenExpiresAt",scope,password,"createdAt","updatedAt"
)
select id::text,"accountId","providerId","userId"::text,"accessToken","refreshToken","idToken",
       "accessTokenExpiresAt","refreshTokenExpiresAt",scope,password,"createdAt","updatedAt"
  from neon_auth.account
on conflict(id) do nothing;
