# Hardware Shopping List — Dim Sum POS

Rough budget: **RM 1,600 – RM 2,800** for a small hawker/kopitiam-style
dim sum shop. Everything below is picked to work with the printer-service
and the existing POS with no code changes beyond putting an IP address in
`.env`.

---

## The essentials (spend here first)

### 1. Thermal receipt printer — ~RM 250 – 700

You need an **80 mm ESC/POS network (Ethernet) printer**. The
printer-service uses `node-thermal-printer` which speaks ESC/POS over TCP.

| Model | Price (Shopee/Lazada MY, approx) | Notes |
|-------|---------|-------|
| **Xprinter XP-N160II** | RM 250 – 320 | Budget pick, network + USB. Works out of the box with `PrinterTypes.EPSON` setting. |
| **Xprinter XP-T80A** | RM 300 – 380 | Slightly faster cut, LAN + USB. |
| **Epson TM-T82X-i** (Ethernet) | RM 650 – 780 | Premium build, quieter, official Epson driver. Overkill for a small shop but bulletproof. |

**Buy 2 rolls of 80 mm x 80 mm thermal paper per week.** Get a pack of
10 rolls for ~RM 25.

**Search terms on Shopee MY:** `80mm thermal printer LAN Ethernet ESC POS`

---

### 2. Cash drawer — ~RM 180 – 250

Any **RJ11 / RJ12 cash drawer** (they all look the same). The printer
opens it via its DK port when a receipt prints.

- **Xprinter 4-bill 5-coin cash drawer** (RM 180 – 220) — standard.
- **HS-410** or **HS-460** style (RM 200 – 260) — sturdier for busy shops.

Comes with the RJ11 cable. Plug printer's DK port → cash drawer.

**Search:** `cash drawer POS RJ11 4 bill 5 coin`

---

### 3. The always-on box for the printer service — ~RM 300 – 500

The printer-service needs to run 24/7 on the shop's LAN. Options:

- **Raspberry Pi 4 (2 GB)** — RM 320. Buy: `Raspberry Pi 4 official kit`
  with case + power adapter (~RM 450 total). Install Raspberry Pi OS Lite,
  Node 20, `pm2`. It sips power and runs forever.
- **Old MacBook / Windows laptop** — free if you have one lying around.
- **Mini PC (Beelink S12 / N100)** — RM 700 – 900 if you want proper
  screen/keyboard for occasional debugging.

Any of these works — the code is the same.

---

### 4. Tablets — RM 500 – 1 500 each

You need **at least 2**:

- **Waiter tablet** (POS) — 10" is the sweet spot. Runs the web POS in
  Chrome/Safari.
- **Kitchen display** (KDS) — mount on the wall in the kitchen, runs the
  `/kitchen` page.

Recommended:

- **Refurbished iPad 9th/10th gen** — RM 900 – 1 300. Best experience,
  survives grease when in a case.
- **Redmi Pad SE / Samsung Tab A9** — RM 500 – 700. Cheaper, still fine.
- Optionally: **third tablet for the counter cashier** — RM 500 – 700.

Add **silicone shockproof cases** (~RM 30 each) — they will drop.

---

### 5. Wi-Fi router — you likely have one

The printer needs to be on the same LAN as the mini-PC. If your shop
Wi-Fi is flaky, buy a **TP-Link Archer C6** (RM 130) for stability.

---

## Optional / later

| Item | Price | When to buy |
|------|-------|-------------|
| Second thermal printer for kitchen | RM 250 – 350 | Once you route hot vs cold to different stations |
| Barcode scanner | RM 100 – 150 | Only if you add packaged items with barcodes |
| Card EDC terminal | Free (rented from bank) | When you want to accept card. Apply through Maybank/CIMB. ~2 – 5 business days. |
| POS stand for tablet | RM 60 – 150 | Nicer for counter cashier |
| Small UPS (uninterruptible power) | RM 150 – 300 | Keeps printer + Pi alive through power dips |

---

## Wiring diagram

```
                ┌─────────────────┐
                │    Router       │
                │ (shop Wi-Fi)    │
                └──┬────┬─────────┘
       Ethernet    │    │  Wi-Fi
                   │    ├─── Waiter tablet  (POS)
                   │    ├─── Kitchen tablet (KDS)
                   │    └─── Counter tablet (Cashier, optional)
                   │
                   ├─── Raspberry Pi / mini-PC  (runs printer-service)
                   │
                   └─── Thermal printer  (static IP, e.g. 192.168.1.87)
                            │
                            └─── RJ11 ──→ Cash drawer
```

Everything else (Supabase, Vercel) lives on the internet — the shop just
needs a working router.

---

## Setup order

1. Plug in and power on the router.
2. Plug the thermal printer into the router by Ethernet.
3. Log into the router admin page (usually `192.168.0.1` or `192.168.1.1`).
   Find the printer's IP address in the DHCP client list. Set a **static
   IP** for it so it never changes.
4. Plug the cash drawer RJ11 into the printer's DK port.
5. Set up the Raspberry Pi / mini-PC:
   ```bash
   git clone <your repo>
   cd pos/printer-service
   npm install
   cp .env.example .env
   # edit .env: put the real Supabase URL, key, and PRINTER_IP
   npm install -g pm2
   pm2 start index.js --name pos-printer
   pm2 startup    # follow the instructions it prints
   pm2 save
   ```
6. Open the Vercel URL on both tablets. Bookmark it. Add to home screen so
   it acts like an app.

Do a test order end-to-end. Receipt should print, drawer should pop.

---

## Rough grand total

| Tier | What | Total |
|------|------|-------|
| **Minimum** | Xprinter + cash drawer + Pi + 2 refurbished Android tablets | ~RM 1 600 |
| **Comfortable** | Xprinter T80 + cash drawer + Pi + 2 iPads | ~RM 2 800 |
| **Nice** | Epson TM-T82X + Xprinter kitchen + cash drawer + Pi + 3 iPads | ~RM 4 500 |

Start at the minimum tier. You can always upgrade the printer without
touching a line of code.
