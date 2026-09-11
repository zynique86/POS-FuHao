# Real DuitNow QR — Fiuu or iPay88

The current cashier shows a **placeholder QR** and needs a manual
"Customer Paid — Confirm" tap. To make it auto-detect payment, you need
a payment gateway account. This doc lists the two viable options in
Malaysia, how to apply, and roughly what the code changes will look like
when the keys arrive.

## Which gateway?

Both are Bank-Negara-licensed and both support **dynamic DuitNow QR** —
a QR the customer scans with any Malaysian banking app.

| Gateway | Setup cost | Fees per txn | Settlement | Notes |
|---------|-----------|---------------|------------|-------|
| **Fiuu (formerly Molpay)** | RM 0 – 500 setup | 0.5% – 1.0% + RM 0.50 | T+1 or T+2 | Widely used, good docs |
| **iPay88** | RM 500 – 900 setup | 0.8% + RM 0.60 | T+1 | Older, more mature |

For a small dim sum shop, **Fiuu is cheaper day one**. Their
"UAT/staging" sandbox is free and works right away for testing.

## Apply — start now (2–5 business days)

1. Go to **https://www.fiuu.com** → **Get Started**.
2. You'll need:
   - **SSM registration** of your business
   - **Bank statement** (settlement account)
   - **Owner IC**
   - **Menu / product photos** (they'll ask what you're selling)
3. Sign the merchant agreement. Fiuu emails you **test credentials
   within 24 hours**; live credentials come after the docs are approved
   (2–5 business days).

While you wait, we can wire everything against the sandbox — flip a
switch to go live later.

## Code changes when credentials arrive

Small footprint:

1. **New env vars** in `.env.local` (Vercel) and `printer-service/.env`:
   ```
   FIUU_MERCHANT_ID=xxxx
   FIUU_VERIFY_KEY=xxxx
   FIUU_SECRET_KEY=xxxx
   FIUU_ENV=sandbox  # or production
   ```

2. **New API route** `app/api/duitnow/create/route.ts` — server-side POST
   that requests a QR from Fiuu, returns the QR image URL + transaction id.

3. **New API route** `app/api/duitnow/webhook/route.ts` — Fiuu POSTs here
   when the customer's payment lands. Verify the signature, then insert a
   `payments` row with status=`succeeded` and mark the order paid.

4. **Update `cashier/page.tsx`** DuitNow flow — instead of the fixed SVG
   placeholder, `<img src={qrUrl} />` from step 2, and poll the payments
   table (or subscribe via Realtime) for the incoming webhook so the
   confirmation button disappears automatically.

5. **Live indicator** — small "waiting for payment…" spinner beside the
   QR that flips to a green checkmark when Fiuu confirms.

**Estimated dev work:** one focused session (~3–4 hours) once you have
the sandbox keys. Half a day of testing before flipping to production.

## Fallback

Even after Fiuu is live, keep the "Customer Paid — Confirm" button as a
fallback for when the customer's app is slow or Fiuu is having an
outage. The cashier taps it manually if the auto-detect hasn't landed
within 30 seconds.

## Alternatives if Fiuu rejects you

- **iPay88** — same shape, slightly higher fees.
- **Stripe DuitNow (SG entity only for now)** — not available for MY
  merchants yet.
- **Direct with a bank** — Maybank / CIMB offer merchant DuitNow QR
  directly, cheaper (~0.3%) but higher setup barrier for a new shop.

Ping me once you have sandbox credentials and I'll wire everything.
