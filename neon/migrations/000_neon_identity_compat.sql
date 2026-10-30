-- Compatibility layer for the existing Connect schema.
-- Run after enabling Neon Auth, before converted numbered migrations. Enable
-- the Data API before testing browser access to the application.
-- Import the legacy auth.users projection into public.app_users before importing
-- application rows, then let sync_current_app_user() link verified Neon users.

create extension if not exists pg_session_jwt;

-- The Data API selects these roles from the JWT `role` claim. Keep the former
-- Supabase service_role as a non-login database role for translated ACLs only.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  -- Neon Data API's default unauthenticated role is `anonymous`; preserve the
  -- Supabase/PostgREST `anon` grants and policies through role inheritance.
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anonymous') then
    create role anonymous nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end;
$$;

grant anon to anonymous;

create table if not exists public.app_users (
  id uuid primary key,
  email text not null unique,
  email_confirmed_at timestamptz
);

create table if not exists public.neon_auth_identity_map (
  neon_subject text primary key,
  app_user_id uuid not null unique references public.app_users(id) on delete cascade,
  email text not null,
  synced_at timestamptz not null default now()
);

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select identity.app_user_id
    from public.neon_auth_identity_map as identity
   where identity.neon_subject = auth.user_id();
$$;

create or replace function public.link_neon_auth_identity(p_neon_subject text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, neon_auth
as $$
declare
  v_current_email text;
  v_is_email_verified boolean;
  v_app_user_id uuid;
  v_existing_subject text;
begin
  if p_neon_subject is null then
    raise exception 'Authenticated Neon user with an email is required' using errcode = '42501';
  end if;

  select lower(trim(neon_user.email)), coalesce(neon_user."emailVerified", false)
    into v_current_email, v_is_email_verified
    from neon_auth."user" as neon_user
   where neon_user.id::text = p_neon_subject;

  if v_current_email is null or v_current_email = '' then
    raise exception 'Authenticated Neon user with an email is required' using errcode = '42501';
  end if;

  select identity.app_user_id into v_app_user_id
    from public.neon_auth_identity_map as identity
   where identity.neon_subject = p_neon_subject;

  if not v_is_email_verified then
    raise exception 'Verify the email before linking this Neon identity' using errcode = '42501';
  end if;

  if v_app_user_id is null then
    select users.id into v_app_user_id
      from public.app_users as users
     where lower(users.email) = v_current_email;

    if v_app_user_id is null then
      insert into public.app_users (id, email, email_confirmed_at)
      values (gen_random_uuid(), v_current_email, now())
      returning id into v_app_user_id;
    else
      update public.app_users
         set email = v_current_email,
             email_confirmed_at = coalesce(email_confirmed_at, now())
       where id = v_app_user_id;
    end if;

    select identity.neon_subject into v_existing_subject
      from public.neon_auth_identity_map as identity
     where identity.app_user_id = v_app_user_id;

    if v_existing_subject is null then
      insert into public.neon_auth_identity_map (neon_subject, app_user_id, email)
      values (p_neon_subject, v_app_user_id, v_current_email);
    elsif v_existing_subject <> p_neon_subject and not exists (
      select 1 from neon_auth."user" as prior_user where prior_user.id::text = v_existing_subject
    ) then
      update public.neon_auth_identity_map
         set neon_subject = p_neon_subject, email = v_current_email, synced_at = now()
       where app_user_id = v_app_user_id;
    elsif v_existing_subject <> p_neon_subject then
      raise exception 'This application account is already linked to another Neon identity' using errcode = '42501';
    end if;
  else
    update public.neon_auth_identity_map
       set email = v_current_email, synced_at = now()
       where neon_auth_identity_map.neon_subject = p_neon_subject;
    update public.app_users
       set email = v_current_email,
           email_confirmed_at = coalesce(email_confirmed_at, now())
     where id = v_app_user_id;
  end if;

  return v_app_user_id;
end;
$$;

create or replace function public.sync_current_app_user()
returns uuid
language sql
volatile
security definer
set search_path = pg_catalog, public
as $$
  select public.link_neon_auth_identity(auth.user_id());
$$;

revoke all on public.app_users, public.neon_auth_identity_map from public;
revoke all on public.app_users, public.neon_auth_identity_map from anon, authenticated, service_role;
revoke all on function public.current_app_user_id() from public;
revoke all on function public.link_neon_auth_identity(text) from public;
revoke all on function public.sync_current_app_user() from public;
grant execute on function public.current_app_user_id() to authenticated;
grant execute on function public.link_neon_auth_identity(text) to service_role;
grant execute on function public.sync_current_app_user() to authenticated;
