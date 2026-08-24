# Printer Service

A tiny always-on Node.js service that listens for new POS orders and prints them.

## What it prints

- **New order** → kitchen ticket (big text, no prices) fires immediately when the waiter hits Send.
- **Order marked paid** → customer receipt (itemized, with total and payment method).

## Setup (no printer yet)

```bash
cd printer-service
npm install
cp .env.example .env
# edit .env — paste your Supabase URL + anon key
# leave PRINTER_IP blank
npm start
```

You'll see tickets logged to the console every time an order is placed or paid.
Perfect for testing without hardware.

## Setup (with a real printer)

1. Buy an 80mm network thermal printer (Epson TM-m30, Xprinter XP-N160II).
2. Plug it into your router with an Ethernet cable.
3. Log into your router admin panel — find the printer's IP and set it as static.
4. Add that IP to `.env` as `PRINTER_IP=192.168.1.87`.
5. Restart: `npm start`.

Test print will appear on paper next time an order comes in.

## Running it long-term

For a Raspberry Pi in the shop, use a process manager so it restarts on reboot:

```bash
npm install -g pm2
pm2 start index.js --name pos-printer
pm2 startup    # follow the printed instructions
pm2 save
```
