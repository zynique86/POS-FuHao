-- ============================================================================
--  FUHAO POS  —  ADD 'order_summary' PRINT-JOB KIND
--
--  Adds a new print job kind so the cashier printer can print an
--  "order summary" (customer-facing overview) at the same moment the
--  kitchen ticket is created, without waiting for payment.
--
--  Run in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================================

alter table print_jobs drop constraint if exists print_jobs_kind_check;
alter table print_jobs add constraint print_jobs_kind_check
  check (kind in ('kitchen', 'receipt', 'void', 'refund', 'restock', 'order_summary'));

notify pgrst, 'reload schema';
