#!/usr/bin/env node
// Preview the three 80mm ticket layouts to stdout, so you can see exactly
// what the printer will emit before putting paper in it.
//
//   node printer-service/bin/preview.js receipt
//   node printer-service/bin/preview.js kitchen
//   node printer-service/bin/preview.js bar
//   node printer-service/bin/preview.js all      (default)
//
// The fixture mirrors the three mockups one-to-one, so a diff against
// docs/mockups/*.txt is the quickest sanity check after any layout tweak.
// This script never talks to Supabase, the printer, or the network — it
// only exercises the pure layout functions in printer-service/layouts/.

const { receipt, kitchen, bar, format } = require('../layouts');

const FIXED_NOW = new Date('2026-10-07T06:32:00Z');  // 14:32 Asia/Kuala_Lumpur
const TZ = 'Asia/Kuala_Lumpur';

const ORDER = {
  id: 42,
  table: 12,
  tableLabel: 'T-12',
  type: 'Dine-In',
  server: 'Alex',
};

const ITEMS = [
  { qty: 1, name: 'Classic Wagyu Burger',   priceAtTime: 18.50,
    options: 'Temp: Medium Rare, +Extra Cheddar Cheese (+1.50)' },
  { qty: 1, name: 'Truffle Parmesan Fries', priceAtTime: 7.50 },
  { qty: 2, name: 'Iced Lemon Tea (@ 4.00)',priceAtTime: 4.00,
    options: 'Extra Ice, Less Sweet', category: 'drinks' },
  { qty: 1, name: 'Grilled Salmon Steak',   priceAtTime: 22.00,
    options: 'No Rice -> Sub Side Salad' },
];

// Flatten an entry stream to the lines a printer or stdout emits.
function render(entries) {
  const out = [];
  for (const e of entries) {
    if (e == null) continue;
    if (typeof e === 'string') { out.push(e); continue; }
    if (e.rule)  { out.push(format.line(e.rule)); continue; }
    if (e.feed != null) {
      for (let i = 0; i < Number(e.feed); i++) out.push('');
      continue;
    }
    if (e.cut) { out.push('[CUT]'); continue; }
    out.push(String(e.text ?? ''));
  }
  return out.join('\n');
}

function previewReceipt() {
  return render(receipt.build({
    shop: {
      name: 'THE GREEN BISTRO',
      addressLines: ['123 Culinary Way, Suite 4'],
      phone: '(555) 019-2834',
      taxId: '98-7654321',
    },
    order: ORDER,
    items: ITEMS,
    totals: {
      subtotal: 57.50,
      serviceCharge: 5.75, serviceChargePct: 10,
      tax: 3.45,          taxPct: 6,
      total: 66.70,
    },
    payment: { method: 'Visa Ending *4321', amountPaid: 66.70, changeDue: 0 },
    footer:  { wifiSsid: 'BistroGuest', wifiPassword: 'burger123' },
    tz: TZ,
    now: FIXED_NOW,
  }));
}

function previewKitchen() {
  return render(kitchen.build({
    order: ORDER,
    stationLabel: 'GRILL',
    items: ITEMS.filter((i) => i.category !== 'drinks'),
    tz: TZ,
    now: FIXED_NOW,
  }));
}

function previewBar() {
  return render(bar.build({
    order: ORDER,
    items: [
      { qty: 2, name: 'Iced Lemon Tea', options: 'Extra Ice, Less Sweet', category: 'drinks' },
      { qty: 1, name: 'Water',          note:    'w/ lemon slice',        category: 'drinks' },
      // A food item slipped in; the bar layout filters it out defensively.
      { qty: 1, name: 'Classic Wagyu Burger', category: 'noodles' },
    ],
    tz: TZ,
    now: FIXED_NOW,
  }));
}

function banner(title) {
  const bar = '─'.repeat(format.WIDTH);
  return `\n${bar}\n  ${title}\n${bar}\n`;
}

const which = (process.argv[2] || 'all').toLowerCase();
const parts = [];
if (which === 'receipt' || which === 'all') parts.push(banner('RECEIPT') + previewReceipt());
if (which === 'kitchen' || which === 'all') parts.push(banner('KITCHEN TICKET') + previewKitchen());
if (which === 'bar'     || which === 'all') parts.push(banner('BAR TICKET')     + previewBar());

if (parts.length === 0) {
  console.error(`usage: node printer-service/bin/preview.js [receipt|kitchen|bar|all]`);
  process.exit(2);
}
console.log(parts.join('\n'));
