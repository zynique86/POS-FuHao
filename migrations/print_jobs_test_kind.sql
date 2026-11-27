-- Allow `test` print jobs (the "Test printers" button in the cashier screen).
-- The printer service prints a short test slip and writes the outcome into
-- payload.result; nothing else reads test jobs.
alter table public.print_jobs drop constraint print_jobs_kind_check;
alter table public.print_jobs add constraint print_jobs_kind_check
  check (kind = any (array['kitchen','receipt','void','refund','restock','order_summary','test']));
