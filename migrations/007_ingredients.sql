-- ============================================================================
-- Dim Sum POS — Ingredients Migration
-- Tracks raw material purchase prices (the "modal") separately from the
-- menu item's own cost_price. A later migration will wire recipes that
-- compute item cost from ingredient list.
-- Run in Supabase SQL editor. Safe to re-run.
-- ============================================================================

create table if not exists ingredients (
  id             bigserial primary key,
  name           text not null,
  name_zh        text,
  supplier       text,
  cost_price     numeric(10,2) not null default 0,   -- purchase price per unit
  unit           text not null default 'kg',         -- kg, g, piece, ml, l, box, packet
  stock_qty      numeric(10,2),                       -- optional current stock
  low_stock_at   numeric(10,2),                       -- optional restock threshold
  note           text,
  active         boolean not null default true,
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create index if not exists ingredients_active_idx
  on ingredients (active, name);

alter table ingredients enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ingredients' and policyname = 'ingredients_read_auth') then
    create policy ingredients_read_auth on ingredients for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ingredients' and policyname = 'ingredients_write_auth') then
    create policy ingredients_write_auth on ingredients for all to authenticated using (true) with check (true);
  end if;
end $$;

-- Realtime so the ingredients list stays in sync across tablets.
do $$
begin
  begin
    alter publication supabase_realtime add table ingredients;
  exception when duplicate_object then null;
  end;
end $$;
