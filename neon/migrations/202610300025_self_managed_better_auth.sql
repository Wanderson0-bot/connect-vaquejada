-- Self-managed Better Auth schema for the Connect backend. This migration is
-- additive: it keeps neon_auth intact so the auth-data copy can be reviewed,
-- tested, and rolled back by switching the Data API back to Neon Auth.

create schema if not exists connect_auth;

create table if not exists connect_auth."user" (
  id text primary key,
  name text not null,
  email text not null unique,
  "emailVerified" boolean not null default false,
  image text,
  "createdAt" timestamptz not null,
  "updatedAt" timestamptz not null
);

create table if not exists connect_auth.session (
  id text primary key,
  "expiresAt" timestamptz not null,
  token text not null unique,
  "createdAt" timestamptz not null,
  "updatedAt" timestamptz not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references connect_auth."user"(id) on delete cascade
);
create index if not exists connect_auth_session_user_id_idx on connect_auth.session("userId");

create table if not exists connect_auth.account (
  id text primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references connect_auth."user"(id) on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope text,
  password text,
  "createdAt" timestamptz not null,
  "updatedAt" timestamptz not null
);
create index if not exists connect_auth_account_user_id_idx on connect_auth.account("userId");

create table if not exists connect_auth.verification (
  id text primary key,
  identifier text not null,
  value text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null,
  "updatedAt" timestamptz not null
);
create index if not exists connect_auth_verification_identifier_idx on connect_auth.verification(identifier);

create table if not exists connect_auth.jwks (
  id text primary key,
  "publicKey" text not null,
  "privateKey" text not null,
  "createdAt" timestamptz not null,
  "expiresAt" timestamptz,
  alg text,
  crv text
);

-- Managed Neon Auth and Better Auth both emit the JWT subject as the identity
-- key. Keep the existing application-user mapping, but stop re-querying the
-- Neon-managed auth schema after the subject has been synchronized.
create or replace function public.sync_current_app_user()
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

revoke all on function public.sync_current_app_user() from public;
revoke all on function public.sync_current_app_user() from anon;
grant execute on function public.sync_current_app_user() to authenticated;

comment on schema connect_auth is 'Self-managed Better Auth storage. Data is copied additively from neon_auth only after a reviewed backup and staging verification.';
