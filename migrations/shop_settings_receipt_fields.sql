-- Receipt header/footer details, editable in Admin > Settings and printed by
-- printer-service. All nullable/blank-by-default: a blank value leaves the
-- line off the receipt. Additive only — safe to run more than once.
alter table public.shop_settings
  add column if not exists phone text not null default '',
  add column if not exists tax_id text not null default '',
  add column if not exists wifi_ssid text not null default '',
  add column if not exists wifi_password text not null default '',
  add column if not exists receipt_thank_you text not null default '',
  add column if not exists receipt_come_again text not null default '';
