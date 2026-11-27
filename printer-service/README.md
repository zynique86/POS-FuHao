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
| `BUSINESS_TZ` | optional | IANA timezone used for the receipt date and the `YYYYMMDD-NNNN` receipt number (default `Asia/Kuala_Lumpur`). |
| `KITCHEN_STATION_LABEL` | optional | Footer station label on kitchen tickets (default `GRILL`). |
| `CASHIER_STATION_LABEL` | optional | Footer station label on front-kitchen tickets (default `DIM-SUM`). |
| `BAR_STATION_LABEL` | optional | Footer station label on bar tickets (default `BAR`). |

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

## Testing the printers

The cashier screen has a **Test printers** button. It queues one `test` print
job per station (cashier/front kitchen, back kitchen, bar); this service sends
a short test slip to that printer once, with no retry, and writes the outcome
back to the job so the button can show Working or Failed with the reason
(refused connection, no answer, no IP set in `.env`). If the service itself is
not running, the button reports "No reply from the printer service" after 30
seconds. Test jobs older than 2 minutes are closed without printing.

"Working" means the printer accepted the data over the network. Network
printers don't report paper-out back, so check the slip actually came out.

Preview the slip with `node printer-service/bin/preview.js test`.

## Previewing layouts

The customer receipt, kitchen ticket, and bar ticket layouts live in
`printer-service/layouts/` as pure functions — no Supabase, no printer, no
network. The preview CLI exercises them against a canonical fixture that
matches the mockups so you can eyeball exactly what the printer will emit
before loading paper:

```
node printer-service/bin/preview.js receipt
node printer-service/bin/preview.js kitchen
node printer-service/bin/preview.js bar
node printer-service/bin/preview.js all      # the default
```

Every line is capped at 42 columns (3-column safety margin on each side of
48-col 80mm paper); the `WIDTH` constant in `layouts/format.js` is the single
source of truth. There is no automated test suite — use the preview CLI above.

Receipt header and footer (shop name, address, phone, tax ID, wifi, thank-you
lines) come from Admin > Settings (`shop_settings`), not from `.env`.
