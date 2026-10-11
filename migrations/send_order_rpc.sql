-- ============================================================================
--  FUHAO POS — atomic order submission via send_order() + category routing table
--
--  Context: the POS used to run three separate round-trips to send an order
--  (insert order → insert order_items → insert print_jobs).  A failure
--  mid-flight left orphan rows and the kitchen printer missed the ticket.
--
--  This migration introduces:
--
--  1) category_station_routing — a tiny lookup table that is the single
--     source of truth for "which printer station does this menu category
--     print at".  Previously this lived only in lib/types.ts
--     (stationForCategory); now the TS helper hydrates from this table at
--     app boot so SQL and TS can never disagree.
--
--  2) send_order() — a SECURITY INVOKER function that performs the whole
--     "send to kitchen" flow in one transaction:
--        - find or create the open order on this table,
--        - append order_items,
--        - insert one order_summary print_job (cashier) and one kitchen
--          print_job per station the new items touch,
--        - update the order's totals and its taken_by_name so Kitchen /
--          Bar / Cashier screens show who sent THIS ticket (fixes the bug
--          where resend-by-another-waiter kept the original name).
--
--  Run once in Supabase → SQL Editor (or via `supabase db push`) on next
--  deploy.  Idempotent: re-running replaces the function body and reseeds
--  the routing table.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) category → station routing table
-- ---------------------------------------------------------------------------
create table if not exists public.category_station_routing (
  category text primary key,
  station  text not null check (station in ('kitchen', 'cashier', 'bar'))
);

-- Readable by anyone signed in; writable only via SQL Editor / service role.
alter table public.category_station_routing enable row level security;

drop policy if exists category_station_routing_select on public.category_station_routing;
create policy category_station_routing_select
  on public.category_station_routing
  for select
  to authenticated, anon
  using (true);

grant select on public.category_station_routing to authenticated, anon;

-- Seed / reseed the mapping.  Keep in sync with lib/types.ts CATEGORY_STATION;
-- the TS copy is a cached mirror of this table loaded at app boot.
insert into public.category_station_routing (category, station) values
  ('noodles',          'kitchen'),
  ('noodles / fried',  'kitchen'),
  ('fried',            'kitchen'),
  ('rice',             'kitchen'),
  ('drinks',           'bar'),
  ('dim sum',          'cashier'),
  ('buns',             'cashier'),
  ('roasted',          'cashier'),
  ('other',            'cashier')
on conflict (category) do update set station = excluded.station;

-- ---------------------------------------------------------------------------
-- 2) send_order() RPC — atomic order submit
-- ---------------------------------------------------------------------------
-- p_items is a JSON array of line specs the client builds today, e.g.:
--   [{ "menu_item_id": 12, "name_snapshot": "Har Gow", "name_zh_snapshot": "蝦餃",
--      "price_at_time": 7.50, "options": "No pork", "note": null, "qty": 2 }, ...]
--
-- Returns: { "order_id": <bigint>, "existing": <bool> }
--
-- SECURITY INVOKER so existing RLS on orders / order_items / print_jobs
-- continues to apply exactly as it did with the client-side inserts.
create or replace function public.send_order(
  p_table_number    integer,
  p_items           jsonb,
  p_subtotal        numeric,
  p_service_charge  numeric,
  p_tax             numeric,
  p_rounding        numeric,
  p_total           numeric,
  p_taken_by_email  text,
  p_taken_by_name   text,
  p_discount        numeric default 0
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order_id      bigint;
  v_existing      boolean := false;
  v_item          jsonb;
  v_inserted_id   bigint;
  v_menu_item_id  bigint;
  v_station       text;
  v_all_ids       bigint[] := array[]::bigint[];
  v_station_map   jsonb := '{}'::jsonb;
  v_station_key   text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'send_order: p_items must be a non-empty JSON array';
  end if;

  -- Find existing open order on this table (same lookup the POS did
  -- client-side), else create one.
  select id into v_order_id
  from public.orders
  where table_number = p_table_number
    and paid_at is null
    and status in ('open', 'closed')
  order by created_at desc
  limit 1;

  if v_order_id is not null then
    v_existing := true;
    -- Resend / append — refresh totals AND the sender's name so KDS/BDS
    -- shows who sent THIS ticket, not whoever opened the table.
    update public.orders
    set subtotal       = p_subtotal,
        service_charge = p_service_charge,
        tax            = p_tax,
        rounding       = p_rounding,
        total          = p_total,
        discount       = coalesce(p_discount, discount, 0),
        status         = 'open',
        taken_by_email = coalesce(p_taken_by_email, taken_by_email),
        taken_by_name  = coalesce(p_taken_by_name,  taken_by_name)
    where id = v_order_id;
  else
    insert into public.orders (
      table_number, subtotal, service_charge, tax, rounding, total, discount,
      status, taken_by_email, taken_by_name
    ) values (
      p_table_number, p_subtotal, p_service_charge, p_tax, p_rounding, p_total, coalesce(p_discount, 0),
      'open', p_taken_by_email, p_taken_by_name
    )
    returning id into v_order_id;
  end if;

  -- Insert each line and tally its station for the prep-ticket print jobs.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_menu_item_id := nullif(v_item->>'menu_item_id', '')::bigint;

    insert into public.order_items (
      order_id, menu_item_id, name_snapshot, name_zh_snapshot,
      price_at_time, options, note, qty
    ) values (
      v_order_id,
      v_menu_item_id,
      v_item->>'name_snapshot',
      v_item->>'name_zh_snapshot',
      (v_item->>'price_at_time')::numeric,
      nullif(v_item->>'options', ''),
      nullif(v_item->>'note', ''),
      (v_item->>'qty')::integer
    )
    returning id into v_inserted_id;

    -- Resolve the printer station from this item's menu category via the
    -- routing table (normalised to lower-case / trimmed, same as the TS
    -- helper).  Unknown categories fall back to 'cashier' (front counter).
    v_station := 'cashier';
    if v_menu_item_id is not null then
      select coalesce(csr.station, 'cashier')
      into v_station
      from public.menu_items mi
      left join public.category_station_routing csr
        on lower(trim(csr.category)) = lower(trim(mi.category))
      where mi.id = v_menu_item_id;
      if v_station is null then v_station := 'cashier'; end if;
    end if;

    v_all_ids := array_append(v_all_ids, v_inserted_id);
    v_station_map := jsonb_set(
      v_station_map,
      array[v_station],
      coalesce(v_station_map -> v_station, '[]'::jsonb) || to_jsonb(v_inserted_id),
      true
    );
  end loop;

  -- 1) Customer-copy summary at the cashier first — carries every new line
  --    so the diner sees the full ticket before per-station prep slips.
  if array_length(v_all_ids, 1) > 0 then
    insert into public.print_jobs (order_id, station, kind, payload)
    values (
      v_order_id,
      'cashier',
      'order_summary',
      jsonb_build_object('item_ids', to_jsonb(v_all_ids))
    );
  end if;

  -- 2) Then one prep ticket per station the new items touch.
  for v_station_key in select jsonb_object_keys(v_station_map)
  loop
    insert into public.print_jobs (order_id, station, kind, payload)
    values (
      v_order_id,
      v_station_key,
      'kitchen',
      jsonb_build_object('item_ids', v_station_map -> v_station_key)
    );
  end loop;

  return jsonb_build_object(
    'order_id', v_order_id,
    'existing', v_existing
  );
end;
$$;

grant execute on function public.send_order(
  integer, jsonb, numeric, numeric, numeric, numeric, numeric, text, text
) to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
--  DONE.  After running, the POS can call supabase.rpc('send_order', { ... })
--  and get an all-or-nothing commit for the order + items + print jobs.
-- ============================================================================
