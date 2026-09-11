-- ============================================================================
-- Dim Sum POS — Restock Queue Migration
-- Adds the front-counter restock request workflow.
-- Run in Supabase SQL editor. Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. restock_requests — one row per "front counter ran out, kitchen make more"
-- ----------------------------------------------------------------------------
create table if not exists restock_requests (
  id                     bigserial primary key,
  menu_item_id           bigint not null references menu_items(id) on delete cascade,
  item_name_snapshot     text not null,
  item_name_zh_snapshot  text,
  qty_wanted             int,
  note                   text,
  requested_at           timestamptz not null default now(),
  requested_by           text,
  fulfilled_at           timestamptz,
  fulfilled_by           text
);

create index if not exists restock_pending_idx
  on restock_requests (requested_at) where fulfilled_at is null;

alter table restock_requests enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'restock_requests' and policyname = 'restock_read_any') then
    create policy restock_read_any on restock_requests for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'restock_requests' and policyname = 'restock_write_auth') then
    create policy restock_write_auth on restock_requests for all to authenticated using (true) with check (true);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. print_jobs: allow 'restock' kind.
-- ----------------------------------------------------------------------------
alter table print_jobs drop constraint if exists print_jobs_kind_check;
alter table print_jobs
  add constraint print_jobs_kind_check
  check (kind in ('kitchen', 'receipt', 'void', 'refund', 'restock'));

-- ----------------------------------------------------------------------------
-- 3. Realtime for the queue
-- ----------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table restock_requests;
  exception when duplicate_object then null;
  end;
end $$;
