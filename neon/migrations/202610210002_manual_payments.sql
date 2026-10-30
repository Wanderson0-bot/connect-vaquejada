-- Upgrade an installation that already has the original single paid flag.
alter table public.entries add column if not exists payment_status text not null default 'pending';
alter table public.entries add column if not exists paid_amount numeric(12,2) not null default 0;
alter table public.entries add column if not exists payment_method text;
alter table public.entries add column if not exists paid_at timestamptz;
alter table public.entries add column if not exists paid_by uuid references public.app_users(id) on delete set null;

-- Preserve old paid/pending records. Historical receiver identity is unknown and remains null.
update public.entries
set payment_status = case when paid then 'paid' else 'pending' end,
    paid_at = case when paid and paid_at is null then created_at else paid_at end,
    paid_amount = case when paid then coalesce(paid_amount, 0) else 0 end;

DO $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.entries'::regclass and conname = 'entries_payment_status_valid') then
    alter table public.entries add constraint entries_payment_status_valid check (payment_status in ('pending','paid','exempt'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.entries'::regclass and conname = 'entries_paid_amount_nonnegative') then
    alter table public.entries add constraint entries_paid_amount_nonnegative check (paid_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.entries'::regclass and conname = 'entries_payment_method_valid') then
    alter table public.entries add constraint entries_payment_method_valid check (payment_method is null or payment_method in ('cash','pix','transfer','card','other'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.entries'::regclass and conname = 'entries_paid_matches_status') then
    alter table public.entries add constraint entries_paid_matches_status check ((payment_status = 'paid') = paid);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.entries'::regclass and conname = 'entries_paid_has_timestamp') then
    alter table public.entries add constraint entries_paid_has_timestamp check (payment_status <> 'paid' or paid_at is not null);
  end if;
end $$;

create or replace function public.normalize_entry_payment()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.payment_status = 'paid' then
    if public.current_app_user_id() is null then raise exception 'Authenticated operator required to record payment'; end if;
    new.paid := true;
    if tg_op = 'INSERT' or old.payment_status <> 'paid' then
      new.paid_at := now();
      new.paid_by := public.current_app_user_id();
    elsif tg_op = 'UPDATE' then
      new.paid_at := old.paid_at;
      new.paid_by := coalesce(old.paid_by, public.current_app_user_id());
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
DROP TRIGGER IF EXISTS entries_payment_state on public.entries;
create trigger entries_payment_state before insert or update of payment_status, paid, paid_amount, payment_method, paid_at, paid_by
  on public.entries for each row execute function public.normalize_entry_payment();
