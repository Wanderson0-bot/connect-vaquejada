-- Connect PDM multi-park foundation (Supabase/PostgreSQL).
-- Each authenticated account owns exactly one park; park users are represented by auth.users.
create table public.parks (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null,
  manager_name text not null,
  phone text not null,
  city text not null,
  state char(2) not null,
  address text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  park_id uuid not null references public.parks(id) on delete cascade,
  name text not null,
  location text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  categories text[] not null check (cardinality(categories) > 0 and array_position(categories, null) is null),
  rules jsonb not null default '{}'::jsonb,
  category_rules jsonb not null default '{}'::jsonb,
  ticket_quantity integer check (ticket_quantity is null or ticket_quantity >= 0),
  ticket_price numeric(12,2) check (ticket_price is null or ticket_price >= 0),
  prizes jsonb not null default '[]'::jsonb,
  scoring_mode text not null default 'instant' check (scoring_mode in ('instant','confirm')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, park_id),
  check (ends_at >= starts_at)
);

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  number integer not null check (number > 0),
  vaqueiro text not null,
  horse text not null default '',
  representation text not null default '',
  category text not null,
  paid boolean not null default false,
  payment_status text not null default 'pending' constraint entries_payment_status_valid check (payment_status in ('pending','paid','exempt')),
  paid_amount numeric(12,2) not null default 0 constraint entries_paid_amount_nonnegative check (paid_amount >= 0),
  payment_method text constraint entries_payment_method_valid check (payment_method is null or payment_method in ('cash','pix','transfer','card','other')),
  paid_at timestamptz,
  paid_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entries_paid_matches_status check ((payment_status = 'paid') = paid),
  constraint entries_paid_has_timestamp check (payment_status <> 'paid' or paid_at is not null),
  unique (event_id, number),
  unique (id, event_id)
);

create table public.run_results (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  entry_id uuid not null,
  rodizio text not null default 'A',
  bull_number integer not null check (bull_number > 0),
  result_type text not null check (result_type in ('points','zero','return')),
  points numeric(8,2) not null default 0 check (points >= 0),
  status text not null default 'official' check (status in ('official','pending')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (entry_id, event_id) references public.entries(id, event_id) on delete cascade
);

-- Append-only change history for operational records; clients receive read-only access.
create table public.audit_log (
  id bigint generated always as identity primary key,
  park_id uuid not null references public.parks(id) on delete restrict,
  event_id uuid,
  record_table text not null,
  record_id uuid not null,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  actor_user_id uuid references auth.users(id) on delete set null,
  before_data jsonb,
  after_data jsonb,
  occurred_at timestamptz not null default now()
);
create index audit_log_park_time_idx on public.audit_log(park_id, occurred_at desc);
alter table public.audit_log enable row level security;
create policy audit_log_park_read on public.audit_log for select to authenticated
  using (exists (select 1 from public.parks p where p.id = park_id and p.owner_user_id = (select auth.uid())));
grant select on public.audit_log to authenticated;

create or replace function public.audit_operational_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  row_data jsonb;
  prior_data jsonb;
  target_park uuid;
  target_event uuid;
  target_id uuid;
begin
  row_data := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  prior_data := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  if tg_table_name = 'parks' then
    target_park := coalesce((row_data->>'id')::uuid, (prior_data->>'id')::uuid);
  elsif tg_table_name = 'events' then
    target_park := coalesce((row_data->>'park_id')::uuid, (prior_data->>'park_id')::uuid);
    target_event := coalesce((row_data->>'id')::uuid, (prior_data->>'id')::uuid);
  else
    target_event := coalesce((row_data->>'event_id')::uuid, (prior_data->>'event_id')::uuid);
    select park_id into target_park from public.events where id = target_event;
  end if;
  target_id := coalesce((row_data->>'id')::uuid, (prior_data->>'id')::uuid);
  insert into public.audit_log(park_id,event_id,record_table,record_id,action,actor_user_id,before_data,after_data)
  values (target_park,target_event,tg_table_name,target_id,tg_op,auth.uid(),prior_data,row_data);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.prevent_category_removal_with_entries()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if exists (select 1 from public.entries e where e.event_id = new.id and not (e.category = any(new.categories))) then
    raise exception 'Remove or transfer affected entries before disabling their category';
  end if;
  return new;
end;
$$;
create trigger event_categories_keep_entries_valid
  before update of categories on public.events
  for each row execute function public.prevent_category_removal_with_entries();

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger parks_touch_updated_at before update on public.parks for each row execute function public.touch_updated_at();
create trigger events_touch_updated_at before update on public.events for each row execute function public.touch_updated_at();
create trigger entries_touch_updated_at before update on public.entries for each row execute function public.touch_updated_at();
create trigger results_touch_updated_at before update on public.run_results for each row execute function public.touch_updated_at();
revoke all on function public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.audit_operational_change() from public, anon, authenticated;

create trigger parks_audit after insert or update or delete on public.parks
  for each row execute function public.audit_operational_change();
create trigger events_audit after insert or update or delete on public.events
  for each row execute function public.audit_operational_change();
create trigger entries_audit after insert or update or delete on public.entries
  for each row execute function public.audit_operational_change();
create trigger results_audit after insert or update or delete on public.run_results
  for each row execute function public.audit_operational_change();

-- Keep entry category choices inside the categories enabled on their event.
create or replace function public.validate_entry_category()
returns trigger language plpgsql set search_path = ''
as $$
declare enabled_categories text[];
begin
  select categories into enabled_categories from public.events where id = new.event_id;
  if enabled_categories is null or new.category is null or not (new.category = any(enabled_categories)) then
    raise exception 'Entry category is not enabled for this event';
  end if;
  return new;
end;
$$;
create trigger entries_category_enabled
  before insert or update of event_id, category on public.entries
  for each row execute function public.validate_entry_category();

create or replace function public.normalize_entry_payment()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.payment_status = 'paid' then
    if auth.uid() is null then raise exception 'Authenticated operator required to record payment'; end if;
    new.paid := true;
    if tg_op = 'INSERT' or old.payment_status <> 'paid' then
      new.paid_at := now();
      new.paid_by := auth.uid();
    elsif tg_op = 'UPDATE' then
      new.paid_at := old.paid_at;
      new.paid_by := coalesce(old.paid_by, auth.uid());
    end if;
  else
    new.paid := false;
    new.paid_amount := 0;
    new.payment_method := null;
    new.paid_at := null;
    new.paid_by := null;
  end if;
  return new;
end;
$$;
create trigger entries_payment_state before insert or update of payment_status, paid, paid_amount, payment_method, paid_at, paid_by
  on public.entries for each row execute function public.normalize_entry_payment();
revoke all on function public.normalize_entry_payment() from public, anon, authenticated;

create index events_park_dates_idx on public.events(park_id, starts_at desc);
create index entries_event_category_idx on public.entries(event_id, category, number);
create index results_event_entry_idx on public.run_results(event_id, entry_id, created_at);

-- Single park creation is tied to the authenticated session, never a client-supplied owner id.
create or replace function public.create_park_account(
  p_name text, p_manager_name text, p_phone text,
  p_city text, p_state text, p_address text
) returns public.parks
language plpgsql security invoker set search_path = ''
as $$
declare created public.parks;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if trim(p_name) = '' or trim(p_manager_name) = '' or trim(p_phone) = ''
     or trim(p_city) = '' or trim(p_address) = '' or upper(trim(p_state)) !~ '^[A-Z]{2}$' then
    raise exception 'Park profile fields are invalid';
  end if;
  insert into public.parks(owner_user_id, name, manager_name, phone, city, state, address)
  values (auth.uid(), trim(p_name), trim(p_manager_name), trim(p_phone), trim(p_city), upper(trim(p_state)), trim(p_address))
  returning * into created;
  return created;
end;
$$;
revoke all on function public.create_park_account(text,text,text,text,text,text) from public, anon;

-- Event ownership is resolved from the current account in the database.
create or replace function public.create_park_event(
  p_id uuid, p_name text, p_location text, p_starts_at timestamptz,
  p_ends_at timestamptz, p_categories text[], p_rules jsonb, p_category_rules jsonb,
  p_ticket_quantity integer, p_ticket_price numeric, p_prizes jsonb,
  p_scoring_mode text
) returns public.events
language plpgsql security invoker set search_path = ''
as $$
declare created public.events;
        current_park_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select id into current_park_id from public.parks where owner_user_id = auth.uid();
  if current_park_id is null then raise exception 'Create the park profile before its events'; end if;
  if trim(p_name) = '' or p_starts_at is null or p_ends_at < p_starts_at
     or coalesce(cardinality(p_categories), 0) = 0 then
    raise exception 'Event fields are invalid';
  end if;
  insert into public.events(
    id, park_id, name, location, starts_at, ends_at, categories, rules, category_rules,
    ticket_quantity, ticket_price, prizes, scoring_mode
  ) values (
    coalesce(p_id, gen_random_uuid()), current_park_id, trim(p_name), coalesce(p_location, ''),
    p_starts_at, p_ends_at, p_categories, coalesce(p_rules, '{}'::jsonb), coalesce(p_category_rules, '{}'::jsonb),
    p_ticket_quantity, p_ticket_price, coalesce(p_prizes, '[]'::jsonb), coalesce(p_scoring_mode, 'instant')
  ) returning * into created;
  return created;
end;
$$;
revoke all on function public.create_park_event(uuid,text,text,timestamptz,timestamptz,text[],jsonb,jsonb,integer,numeric,jsonb,text) from public, anon;

alter table public.parks enable row level security;
alter table public.events enable row level security;
alter table public.entries enable row level security;
alter table public.run_results enable row level security;

create policy parks_owner_all on public.parks for all to authenticated
  using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()));

-- SECURITY DEFINER is narrowly scoped to a boolean ownership check to avoid policy recursion.
create or replace function public.owns_event(target_event uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.events e join public.parks p on p.id = e.park_id
    where e.id = target_event and p.owner_user_id = auth.uid()
  );
$$;
revoke all on function public.owns_event(uuid) from public, anon;
grant execute on function public.owns_event(uuid) to authenticated;

create policy events_owner_all on public.events for all to authenticated
  using (exists (select 1 from public.parks p where p.id = park_id and p.owner_user_id = (select auth.uid())))
  with check (exists (select 1 from public.parks p where p.id = park_id and p.owner_user_id = (select auth.uid())));
create policy entries_event_owner_all on public.entries for all to authenticated
  using ((select public.owns_event(event_id))) with check ((select public.owns_event(event_id)));
create policy results_event_owner_all on public.run_results for all to authenticated
  using ((select public.owns_event(event_id))) with check ((select public.owns_event(event_id)));

grant select, update on public.parks to authenticated;
grant insert on public.parks to authenticated;
grant select, insert, update on public.events, public.entries, public.run_results to authenticated;
grant execute on function public.create_park_account(text,text,text,text,text,text) to authenticated;
grant execute on function public.create_park_event(uuid,text,text,timestamptz,timestamptz,text[],jsonb,jsonb,integer,numeric,jsonb,text) to authenticated;

