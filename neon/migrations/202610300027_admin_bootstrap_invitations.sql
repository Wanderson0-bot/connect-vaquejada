-- One-time invitations for initial platform administrator provisioning.
create table public.admin_bootstrap_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  registration_started_at timestamptz,
  consumed_at timestamptz,
  consumed_by uuid references public.app_users(id) on delete set null
);
create unique index admin_bootstrap_invitation_pending_uidx
  on public.admin_bootstrap_invitations ((true)) where consumed_at is null;
alter table public.admin_bootstrap_invitations enable row level security;
revoke all on public.admin_bootstrap_invitations from public, anon, authenticated, service_role;
