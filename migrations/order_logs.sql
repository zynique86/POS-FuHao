-- ============================================================================
--  FUHAO POS — order action log
--
--  Records WHO removed an order or changed its table, and WHY (reason).
--  Any signed-in user (staff or admin) can perform these actions; every one
--  is written here so there is an accountable trail.
--
--  Run in Supabase → SQL Editor → New query → paste → Run.  Idempotent.
-- ============================================================================

create table if not exists order_logs (
  id            bigserial primary key,
  order_id      bigint,
  table_number  int,
  action        text not null,          -- 'remove_order' | 'change_table' | 'remove_item'
  reason        text not null,
  actor_email   text,
  actor_name    text,
  details       jsonb,                  -- e.g. { "from_table": 3, "to_table": 7 }
  created_at    timestamptz not null default now()
);

alter table order_logs add column if not exists order_id     bigint;
alter table order_logs add column if not exists table_number int;
alter table order_logs add column if not exists action       text;
alter table order_logs add column if not exists reason       text;
alter table order_logs add column if not exists actor_email  text;
alter table order_logs add column if not exists actor_name   text;
alter table order_logs add column if not exists details      jsonb;
alter table order_logs add column if not exists created_at   timestamptz not null default now();

alter table order_logs drop constraint if exists order_logs_action_check;
alter table order_logs add constraint order_logs_action_check
  check (action in ('remove_order', 'change_table', 'remove_item'));

create index if not exists order_logs_date_idx   on order_logs (created_at desc);
create index if not exists order_logs_order_idx  on order_logs (order_id, created_at desc);
create index if not exists order_logs_action_idx on order_logs (action, created_at desc);

-- Row Level Security — any signed-in user may log and read.
alter table order_logs enable row level security;

do $$
declare pol record;
begin
  for pol in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'order_logs'
  loop
    execute format('drop policy if exists %I on public.order_logs', pol.policyname);
  end loop;
end $$;

create policy order_logs_select on order_logs
  for select to authenticated using (true);
create policy order_logs_insert on order_logs
  for insert to authenticated with check (true);

notify pgrst, 'reload schema';

-- ============================================================================
--  DONE.
-- ============================================================================
