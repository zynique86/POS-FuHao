-- Shop payment QR (e.g. Touch 'n Go eWallet / DuitNow static QR) shown on
-- the cashier's QR payment screen. Admins upload the image in
-- Admin > Settings; it lands in the `payment-qr` storage bucket and its
-- public URL is saved on shop_settings.payment_qr_url.
--
-- Only admins (is_admin()) may write to the bucket, so a non-admin login
-- can't swap the shop's QR for their own account. Anyone may read it, the
-- same as menu photos, since the cashier/iPad screens need to display it.
-- Additive only — safe to run more than once.

alter table public.shop_settings
  add column if not exists payment_qr_url text not null default '';

insert into storage.buckets (id, name, public)
values ('payment-qr', 'payment-qr', true)
on conflict (id) do nothing;

drop policy if exists payment_qr_read_any on storage.objects;
create policy payment_qr_read_any on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'payment-qr');

drop policy if exists payment_qr_insert_admin on storage.objects;
create policy payment_qr_insert_admin on storage.objects
  for insert to authenticated
  with check (bucket_id = 'payment-qr' and public.is_admin());

drop policy if exists payment_qr_update_admin on storage.objects;
create policy payment_qr_update_admin on storage.objects
  for update to authenticated
  using (bucket_id = 'payment-qr' and public.is_admin())
  with check (bucket_id = 'payment-qr' and public.is_admin());

drop policy if exists payment_qr_delete_admin on storage.objects;
create policy payment_qr_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'payment-qr' and public.is_admin());
