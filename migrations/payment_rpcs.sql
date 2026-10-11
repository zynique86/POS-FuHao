-- ============================================================================
--  FUHAO POS — atomic payment/discount/refund RPCs
--
--  Context: PayModal, DiscountModal and RefundModal in app/cashier/page.tsx
--  used to run as separate client-side round-trips (insert payment, re-query
--  the sum, then update the order) with no database-level guard. That meant:
--
--    - Two devices racing to pay the same order could both insert a full
--      payment before either side marked the order paid (double charge).
--    - Applying a discount recomputed the bill from the subtotal/service
--      charge/tax snapshot the modal opened with, not the order's current
--      row — an item added by a waiter while the modal was open could get
--      silently dropped from the final total.
--    - A double-click (or two tabs) on Refund had no guard against
--      refunding the same order twice.
--
--  These three SECURITY INVOKER functions close all three gaps the same
--  way send_order() does: lock the order row (`for update` / an atomic
--  `UPDATE ... WHERE status <> ...`) so the check and the act happen in one
--  transaction instead of two round-trips a second caller can race between.
--
--  Idempotent: re-running replaces each function body.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- record_payment() — atomic payment insert + conditional order close
-- ---------------------------------------------------------------------------
create or replace function public.record_payment(
  p_order_id bigint,
  p_method text,
  p_amount numeric,
  p_received numeric,
  p_change_given numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order record;
  v_paid_sum numeric;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'record_payment: order % not found', p_order_id;
  end if;
  if v_order.paid_at is not null then
    raise exception 'record_payment: order % is already paid', p_order_id;
  end if;
  if v_order.status in ('void', 'refunded') then
    raise exception 'record_payment: order % is % and cannot take payment', p_order_id, v_order.status;
  end if;

  insert into public.payments (order_id, method, amount, received, change_given, status)
  values (p_order_id, p_method, p_amount, p_received, p_change_given, 'succeeded');

  select coalesce(sum(amount), 0) into v_paid_sum
  from public.payments
  where order_id = p_order_id;

  if v_paid_sum + 0.001 >= v_order.total then
    update public.orders
    set paid_at = now(),
        payment_method = p_method,
        status = 'paid'
    where id = p_order_id;

    insert into public.print_jobs (order_id, kind, station, payload)
    values (p_order_id, 'receipt', 'cashier', jsonb_build_object('reprint', false));

    return jsonb_build_object('paid', true, 'remaining', 0);
  end if;

  return jsonb_build_object('paid', false, 'remaining', round(v_order.total - v_paid_sum, 2));
end;
$$;

grant execute on function public.record_payment(bigint, text, numeric, numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- apply_discount() — recompute against the order's CURRENT totals, not a
-- client-side snapshot. p_mode is 'amount' (flat RM) or 'pct' (% of gross).
-- ---------------------------------------------------------------------------
create or replace function public.apply_discount(
  p_order_id bigint,
  p_mode text,
  p_value numeric,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order record;
  v_round_to_5_sen boolean;
  v_gross numeric;
  v_discount numeric;
  v_final_gross numeric;
  v_total numeric;
  v_rounding numeric;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'apply_discount: order % not found', p_order_id;
  end if;
  if v_order.paid_at is not null or v_order.status in ('void', 'refunded') then
    raise exception 'apply_discount: order % is already settled', p_order_id;
  end if;

  select round_to_5_sen into v_round_to_5_sen from public.shop_settings where id = 1;

  v_gross := round(coalesce(v_order.subtotal, 0) + coalesce(v_order.service_charge, 0) + coalesce(v_order.tax, 0), 2);

  if p_mode = 'pct' then
    v_discount := round(v_gross * coalesce(p_value, 0) / 100, 2);
  else
    v_discount := round(coalesce(p_value, 0), 2);
  end if;
  v_discount := greatest(0, least(v_discount, v_gross));

  v_final_gross := greatest(0, round(v_gross - v_discount, 2));
  if coalesce(v_round_to_5_sen, true) then
    v_total := round(v_final_gross * 20) / 20;
  else
    v_total := v_final_gross;
  end if;
  v_rounding := round(v_total - v_final_gross, 2);

  update public.orders
  set discount = v_discount,
      discount_reason = case when v_discount > 0 then p_reason else null end,
      rounding = v_rounding,
      total = v_total
  where id = p_order_id;

  return jsonb_build_object('discount', v_discount, 'total', v_total, 'rounding', v_rounding);
end;
$$;

grant execute on function public.apply_discount(bigint, text, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- refund_order() — the WHERE status <> 'refunded' makes this atomic: a
-- second concurrent call's UPDATE matches zero rows and raises instead of
-- inserting a second negative payment.
-- ---------------------------------------------------------------------------
create or replace function public.refund_order(
  p_order_id bigint,
  p_reason text,
  p_by text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order record;
begin
  update public.orders
  set status = 'refunded',
      refunded_at = now(),
      refund_reason = p_reason,
      refunded_by = p_by
  where id = p_order_id
    and status <> 'refunded'
    and paid_at is not null
  returning * into v_order;

  if v_order is null then
    raise exception 'refund_order: order % is already refunded or was never paid', p_order_id;
  end if;

  insert into public.payments (order_id, method, amount, received, change_given, status)
  values (p_order_id, coalesce(v_order.payment_method, 'cash'), -v_order.total, -v_order.total, 0, 'refunded');

  insert into public.print_jobs (order_id, kind, station, payload)
  values (
    p_order_id, 'refund', 'cashier',
    jsonb_build_object('reason', p_reason, 'by', p_by, 'amount', v_order.total)
  );

  return jsonb_build_object('order_id', p_order_id, 'amount', v_order.total, 'method', v_order.payment_method);
end;
$$;

grant execute on function public.refund_order(bigint, text, text) to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
--  DONE. Run once in Supabase SQL Editor; idempotent on redeploy.
-- ============================================================================
