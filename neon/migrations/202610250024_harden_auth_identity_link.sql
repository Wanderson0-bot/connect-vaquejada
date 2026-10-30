-- Harden mapping of verified Neon Auth identities to imported Connect users.
-- Run after the post-import legacy access cutover. Never pick an arbitrary
-- app_users row when imported email spellings differ only by case/whitespace.

do $$
begin
  if exists (
    select lower(btrim(email))
      from public.app_users
     group by lower(btrim(email))
    having count(*) > 1
  ) then
    raise exception 'Cannot harden Neon Auth identity linking: normalized app user emails are duplicated. Resolve the duplicate Connect identities before continuing.'
      using errcode = '23505';
  end if;
end;
$$;

create unique index app_users_email_normalized_uidx
  on public.app_users (lower(btrim(email)));

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

  if not v_is_email_verified then
    raise exception 'Verify the email before linking this Neon identity' using errcode = '42501';
  end if;

  select identity.app_user_id into v_app_user_id
    from public.neon_auth_identity_map as identity
   where identity.neon_subject = p_neon_subject;

  if v_app_user_id is null then
    insert into public.app_users as existing_user (id, email, email_confirmed_at)
    values (gen_random_uuid(), v_current_email, now())
    on conflict ((lower(btrim(email)))) do update
      set email = excluded.email,
          email_confirmed_at = coalesce(existing_user.email_confirmed_at, excluded.email_confirmed_at)
    returning id into v_app_user_id;

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
