# Printer service

Runs continuously on a Raspberry Pi or counter mini-PC behind the shop
counter. Listens for new rows in `print_jobs` on Supabase and sends each
one to the right thermal printer (kitchen / bar / cashier).

## Required environment

Copy these into `.env` beside `index.js`. **Never commit `.env`.**

| Var | Required | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | yes | Also accepts `NEXT_PUBLIC_SUPABASE_URL`. |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | **MUST be the service-role key, not the anon key.** The service runs on a trusted machine behind the counter and needs to read every pending print job and mark it printed. Copy it from Supabase → Project Settings → API → `service_role`. The service refuses to start without it. |
| `KITCHEN_PRINTER_IP` | optional | IP of the back-kitchen printer. |
| `BAR_PRINTER_IP` | optional | IP of the bar printer. |
| `CASHIER_PRINTER_IP` | optional | IP of the counter printer. |
| `PRINTER_IP` | optional | Legacy single-printer fallback when a station IP is unset. |
| `SHOP_NAME` | optional | Fallback header name if `shop_settings` is empty. |
| `RECEIPT_WIDTH` | optional | Columns per line (default 42). |
| `PREORDER_PHONES` | optional | Comma-separated phone numbers printed at the foot of each receipt. |
| `PRINT_CHINESE` | optional | `true` to send GB18030 CJK; default is English-only. |

## Why service-role?

- Reads `print_jobs` that RLS policies hide from the anon key.
- Marks jobs as printed from behind the counter — not from a browser —
  so the anon key would be the wrong surface here anyway.
- The service refuses to boot if `SUPABASE_SERVICE_ROLE_KEY` is unset:
  silently falling back to the anon key would appear to "work" (jobs
  enqueue, nothing prints) while leaking the anon surface onto a device
  nobody is actively monitoring.

## Running

```
npm install
node index.js
```

Keep it supervised (systemd, pm2, etc.) so it restarts after power cuts.
