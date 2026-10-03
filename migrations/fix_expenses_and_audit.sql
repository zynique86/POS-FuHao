-- ============================================================================
--  FUHAO POS  —  DEFINITIVE FIX for expenses + audit_log
--
--  This creates or repairs both tables in a way that ALWAYS works:
--    • drops old constraints that might block inserts
--    • adds every column the app uses
--    • drops the removed `staff_id` column if it lingers
--    • resets Row Level Security policies (the most common silent failure)
--    • creates the storage bucket for receipt photos
--    • reloads the PostgREST cache so the API sees the changes immediately
--
--  100 % idempotent — run it as many times as you want.
--  Run in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================================


-- ============================================================================
--  1. EXPENSES table — schema
-- ============================================================================

create table if not exists expenses (
  id              bigserial primary key,
  kind            text not null,
  business_date   date not null,
  amount          numeric(10,2) not null,
  payment_method  text,
  description     text,
  supplier        text,
  receipt_url     text,
  staff_name      text,
  hours           numeric(6,2),
  normal_wage     numeric(10,2),
  ot_amount       numeric(10,2),
  other_amount    numeric(10,2),
  note            text,
  created_by      text,
  created_at      timestamptz not null default now()
);

-- Add any missing columns (safe if the table already existed but was
-- created from an older version).
alter table expenses add column if not exists kind           text;
alter table expenses add column if not exists business_date  date;
alter table expenses add column if not exists amount         numeric(10,2);
alter table expenses add column if not exists payment_method text;
alter table expenses add column if not exists description    text;
alter table expenses add column if not exists supplier       text;
alter table expenses add column if not exists receipt_url    text;
alter table expenses add column if not exists staff_name     text;
alter table expenses add column if not exists hours          numeric(6,2);
alter table expenses add column if not exists normal_wage    numeric(10,2);
alter table expenses add column if not exists ot_amount      numeric(10,2);
alter table expenses add column if not exists other_amount   numeric(10,2);
alter table expenses add column if not exists note           text;
alter table expenses add column if not exists created_by     text;
alter table expenses add column if not exists created_at     timestamptz not null default now();

-- Drop the removed staff_id column if it's still there (used to have an FK
-- to the deleted staff table).
alter table expenses drop column if exists staff_id;

-- Kind constraint — must match exactly what the app inserts.
alter table expenses drop constraint if exists expenses_kind_check;
alter table expenses add constraint expenses_kind_check
  check (kind in ('wages', 'meal', 'purchase', 'other', 'rent', 'utility'));

create index if not exists expenses_date_idx on expenses (business_date, kind);
create index if not exists expenses_kind_idx on expenses (kind, business_date);


-- ============================================================================
--  2. AUDIT_LOG table — schema
-- ============================================================================

create table if not exists audit_log (
  id           bigserial primary key,
  actor_email  text,
  actor_role   text,
  action       text not null,
  target_type  text,
  target_id    bigint,
  amount       numeric(10,2),
  reason       text,
  details      jsonb,
  created_at   timestamptz not null default now()
);

alter table audit_log add column if not exists actor_email text;
alter table audit_log add column if not exists actor_role  text;
alter table audit_log add column if not exists action      text;
alter table audit_log add column if not exists target_type text;
alter table audit_log add column if not exists target_id   bigint;
alter table audit_log add column if not exists amount      numeric(10,2);
alter table audit_log add column if not exists reason      text;
alter table audit_log add column if not exists details     jsonb;
alter table audit_log add column if not exists created_at  timestamptz not null default now();

create index if not exists audit_log_date_idx   on audit_log (created_at desc);
create index if not exists audit_log_action_idx on audit_log (action, created_at desc);


-- ============================================================================
--  3. ROW LEVEL SECURITY — the #1 silent-failure cause
-- ============================================================================

alter table expenses  enable row level security;
alter table audit_log enable row level security;

-- Nuke every existing policy to start clean.
do $$
declare pol record;
begin
  for pol in select policyname from pg_policies
    where schemaname = 'public' and tablename in ('expenses', 'audit_log')
  loop
    execute format('drop policy if exists %I on public.%I',
      pol.policyname,
      case when pol.policyname like 'audit%' then 'audit_log' else 'expenses' end);
  end loop;
end $$;

-- Signed-in users can do anything on either table.
create policy expenses_all_auth on expenses
  for all to authenticated using (true) with check (true);

create policy audit_select on audit_log
  for select to authenticated using (true);

create policy audit_insert on audit_log
  for insert to authenticated with check (true);


-- ============================================================================
--  4. STORAGE BUCKET for receipt photos
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'expense-receipts', 'expense-receipts', true, 8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'receipts_read_auth'
  ) then
    create policy receipts_read_auth on storage.objects
      for select to anon, authenticated using (bucket_id = 'expense-receipts');
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'receipts_insert_auth'
  ) then
    create policy receipts_insert_auth on storage.objects
      for insert to authenticated with check (bucket_id = 'expense-receipts');
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'receipts_delete_auth'
  ) then
    create policy receipts_delete_auth on storage.objects
      for delete to authenticated using (bucket_id = 'expense-receipts');
  end if;
end $$;


-- ============================================================================
--  5. Reload PostgREST cache so the API notices immediately.
-- ============================================================================

notify pgrst, 'reload schema';


-- ============================================================================
--  DONE.  After running this:
--    1. Hard-refresh your POS tab (Cmd/Ctrl + Shift + R)
--    2. /admin/expenses — the Save button should now work
--    3. /admin/audit-log — do a void/refund/discount at /cashier, then
--       come back and refresh; the action should appear at the top
-- ============================================================================
