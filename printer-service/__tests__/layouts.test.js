// Snapshot-style tests for the three 80mm ticket layouts.
//
// Each `assert.equal(..., `...`)` block is the EXACT byte stream the printer
// (or the preview CLI) emits for a canonical fixture.  Reviewers can diff the
// template literal against the mockup side-by-side.  Keep snapshots inline —
// a separate .snap file would hide formatting changes behind a Jest noise
// layer the rest of the codebase does not use.
//
// Imports stay narrow (just the pure layouts) so this file does NOT pull
// printer-service/index.js — that module requires Supabase env at load time
// and would short-circuit the suite.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { receipt, kitchen, bar, restock, format } = require('../layouts');
const { WIDTH, entryText } = format;

// A fixed "now" so the time/date are stable across machines.  Chosen so that
// Asia/Kuala_Lumpur renders as 07/Oct/2026 14:32 — matches the mockup.
const FIXED_NOW = new Date('2026-10-07T06:32:00Z');
const TZ = 'Asia/Kuala_Lumpur';

// Flatten an entry stream to the exact lines a printer or stdout would emit.
// Mirrors the preview CLI so a passing test is proof the preview matches too.
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

function assertAllFitWidth(entries) {
  for (const e of entries) {
    const t = entryText(e);
    assert.ok(
      t.length <= WIDTH,
      `line exceeds ${WIDTH} cols (len=${t.length}): ${JSON.stringify(t)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Fixture — covers every variation shown in the three mockups.
// ---------------------------------------------------------------------------
const FIXTURE_ORDER = {
  id: 42,
  table: 12,
  tableLabel: 'T-12',
  type: 'Dine-In',
  server: 'Alex',
};

const FIXTURE_ITEMS = [
  // Priced item with modifiers + an add-on carrying an upcharge.
  {
    qty: 1,
    name: 'Classic Wagyu Burger',
    priceAtTime: 18.50,
    options: 'Temp: Medium Rare, +Extra Cheddar Cheese (+1.50)',
  },
  // Priced item, no modifiers.
  {
    qty: 1,
    name: 'Truffle Parmesan Fries',
    priceAtTime: 7.50,
  },
  // Multi-qty item with "@ unit price" display.
  {
    qty: 2,
    name: 'Iced Lemon Tea (@ 4.00)',
    priceAtTime: 4.00,
    options: 'Extra Ice, Less Sweet',
    category: 'drinks',
  },
  // Priced item with a swap modifier.
  {
    qty: 1,
    name: 'Grilled Salmon Steak',
    priceAtTime: 22.00,
    options: 'No Rice -> Sub Side Salad',
  },
];

// ---------------------------------------------------------------------------
// RECEIPT
// ---------------------------------------------------------------------------

test('receipt layout — every produced line fits WIDTH', () => {
  const entries = receipt.build({
    shop: {
      name: 'THE GREEN BISTRO',
      addressLines: ['123 Culinary Way, Suite 4'],
      phone: '(555) 019-2834',
      taxId: '98-7654321',
    },
    order: FIXTURE_ORDER,
    items: FIXTURE_ITEMS,
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
  });
  assertAllFitWidth(entries);
});

test('receipt layout — canonical snapshot matches the mockup', () => {
  const entries = receipt.build({
    shop: {
      name: 'THE GREEN BISTRO',
      addressLines: ['123 Culinary Way, Suite 4'],
      phone: '(555) 019-2834',
      taxId: '98-7654321',
    },
    order: FIXTURE_ORDER,
    items: FIXTURE_ITEMS,
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
  });

  const expected = [
    '==========================================',
    '             THE GREEN BISTRO',
    '        123 Culinary Way, Suite 4',
    '           Tel: (555) 019-2834',
    '          GST/Tax ID: 98-7654321',
    '==========================================',
    '',
    'Date: 07/Oct/2026              Time: 14:32',
    'Receipt #: 20261007-0042    Order: Dine-In',
    'Server: Alex                   Table: T-12',
    '------------------------------------------',
    'QTY  ITEM                       PRICE (RM)',
    '------------------------------------------',
    ' 1   Classic Wagyu Burger            18.50',
    '     - Temp: Medium Rare',
    '     - Extra Cheddar Cheese (+1.50)',
    ' 1   Truffle Parmesan Fries           7.50',
    ' 2   Iced Lemon Tea (@ 4.00)          8.00',
    '     - Extra Ice',
    '     - Less Sweet',
    ' 1   Grilled Salmon Steak            22.00',
    '     - No Rice -> Sub Side Salad',
    '------------------------------------------',
    '              SUBTOTAL:           RM 57.50',
    '              Svc Charge (10%):    RM 5.75',
    '              SST / Tax (6%):      RM 3.45',
    '              ----------------------------',
    '              TOTAL:              RM 66.70',
    '',
    'Payment Method: Visa Ending *4321',
    'Amount Paid:  RM 66.70',
    'Change Due:   RM 0.00',
    '------------------------------------------',
    '   Wifi: BistroGuest / Pass: burger123',
    '      Thank you for dining with us!',
    '          Please Come Again Soon',
    '==========================================',
    '',
    '',
    '',
    '[CUT]',
  ].join('\n');

  assert.equal(render(entries), expected);
});

test('receipt layout — drops shop lines when the field is empty', () => {
  const entries = receipt.build({
    shop: { name: 'FU HAO DIM SUM' }, // no address, no phone, no taxId
    order: FIXTURE_ORDER,
    items: FIXTURE_ITEMS.slice(0, 1),
    totals: { subtotal: 18.50, total: 18.50 },
    payment: { method: 'CASH', amountPaid: 20, changeDue: 1.50 },
    footer: {},
    tz: TZ,
    now: FIXED_NOW,
  });
  const rendered = render(entries);
  assert.ok(!rendered.includes('Tel:'),   'phone line should be absent');
  assert.ok(!rendered.includes('GST/Tax ID:'), 'tax id line should be absent');
  assert.ok(!rendered.includes('Wifi:'),  'wifi line should be absent');
  assertAllFitWidth(entries);
});

// ---------------------------------------------------------------------------
// KITCHEN
// ---------------------------------------------------------------------------

test('kitchen layout — every produced line fits WIDTH', () => {
  const entries = kitchen.build({
    order: FIXTURE_ORDER,
    stationLabel: 'GRILL',
    items: FIXTURE_ITEMS.filter((i) => i.category !== 'drinks'),
    tz: TZ,
    now: FIXED_NOW,
  });
  assertAllFitWidth(entries);
});

test('kitchen layout — canonical snapshot matches the mockup', () => {
  const entries = kitchen.build({
    order: FIXTURE_ORDER,
    stationLabel: 'GRILL',
    items: FIXTURE_ITEMS.filter((i) => i.category !== 'drinks'),
    tz: TZ,
    now: FIXED_NOW,
  });

  const expected = [
    '==========================================',
    '[KITCHEN TICKET]           TICKET #: #0042',
    '------------------------------------------',
    'TABLE: T-12                 ORDER: Dine-In',
    'TIME: 14:32                   SERVER: Alex',
    '==========================================',
    '',
    '[1] CLASSIC WAGYU BURGER',
    '    *** TEMP: MEDIUM RARE ***',
    '    + EXTRA CHEDDAR CHEESE',
    '',
    '[1] TRUFFLE PARMESAN FRIES',
    '',
    '[1] GRILLED SALMON STEAK',
    '    *** MOD: NO RICE -> SUB SIDE SALAD ***',
    '',
    '==========================================',
    'Total Items: 3              Station: GRILL',
    '==========================================',
    '',
    '',
    '',
    '[CUT]',
  ].join('\n');

  assert.equal(render(entries), expected);
});

// ---------------------------------------------------------------------------
// BAR
// ---------------------------------------------------------------------------

test('bar layout — every produced line fits WIDTH', () => {
  const entries = bar.build({
    order: FIXTURE_ORDER,
    items: [
      { qty: 2, name: 'Iced Lemon Tea', options: 'Extra Ice, Less Sweet',    category: 'drinks' },
      { qty: 1, name: 'Water',          note:    'W/ lemon slice',           category: 'drinks' },
      // A rogue food item slips in — the layout must filter it out.
      { qty: 1, name: 'Classic Wagyu Burger', category: 'noodles' },
    ],
    tz: TZ,
    now: FIXED_NOW,
  });
  assertAllFitWidth(entries);
});

test('bar layout — canonical snapshot matches the mockup', () => {
  const entries = bar.build({
    order: FIXTURE_ORDER,
    items: [
      { qty: 2, name: 'Iced Lemon Tea', options: 'Extra Ice, Less Sweet', category: 'drinks' },
      { qty: 1, name: 'Water',          note:    'w/ lemon slice',        category: 'drinks' },
      { qty: 1, name: 'Classic Wagyu Burger', category: 'noodles' },  // filtered out
    ],
    tz: TZ,
    now: FIXED_NOW,
  });

  const expected = [
    '==========================================',
    '[BAR ORDER]                TICKET #: #0042',
    '------------------------------------------',
    'TABLE: T-12                 ORDER: Dine-In',
    'TIME: 14:32                   SERVER: Alex',
    '==========================================',
    '',
    '[2] ICED LEMON TEA',
    '    *** MOD: EXTRA ICE ***',
    '    *** MOD: LESS SWEET ***',
    '',
    '[1] WATER',
    '    - W/ LEMON SLICE',
    '',
    '==========================================',
    'Total Drinks: 3               Station: BAR',
    '==========================================',
    '',
    '',
    '',
    '[CUT]',
  ].join('\n');

  assert.equal(render(entries), expected);
});

// ---------------------------------------------------------------------------
// RESTOCK
// ---------------------------------------------------------------------------
// Deliberately laid out the same way as the kitchen ticket (header strip,
// bold item block, footer rule) — see layouts/restock.js.

test('restock layout — every produced line fits WIDTH', () => {
  const entries = restock.build({
    stationLabel: 'GRILL',
    request: {
      id: 7,
      name: 'Har Gow',
      nameZh: '蝦餃',
      qty: 20,
      note: 'Running low for lunch rush',
      by: 'Alex',
    },
    tz: TZ,
    now: FIXED_NOW,
  });
  assertAllFitWidth(entries);
});

test('restock layout — canonical snapshot mirrors the kitchen ticket shape', () => {
  const entries = restock.build({
    stationLabel: 'GRILL',
    request: {
      id: 7,
      name: 'Har Gow',
      nameZh: '蝦餃',
      qty: 20,
      note: 'Running low for lunch rush',
      by: 'Alex',
    },
    tz: TZ,
    now: FIXED_NOW,
  });

  const expected = [
    '==========================================',
    '[RESTOCK REQUEST]          TICKET #: #0007',
    '------------------------------------------',
    'TIME: 14:32                       BY: Alex',
    '==========================================',
    '',
    '[20] HAR GOW',
    '    蝦餃',
    '    NOTE: RUNNING LOW FOR LUNCH RUSH',
    '',
    '==========================================',
    'RESTOCK                     Station: GRILL',
    '==========================================',
    '',
    '',
    '',
    '[CUT]',
  ].join('\n');

  assert.equal(render(entries), expected);
});

test('restock layout — omits BY / note / Chinese name when absent', () => {
  const entries = restock.build({
    stationLabel: 'BAR',
    request: { id: 8, name: 'Lemon Tea', qty: 5 },
    tz: TZ,
    now: FIXED_NOW,
  });
  const rendered = render(entries);
  assert.ok(rendered.includes('BY: -'));
  assert.ok(!rendered.includes('NOTE:'));
  assertAllFitWidth(entries);
});

// ---------------------------------------------------------------------------
// Format helpers — small but critical, so unit tests pin them.
// ---------------------------------------------------------------------------

test('format.receiptNumber zero-pads the id and uses the business date', () => {
  assert.equal(format.receiptNumber(42,   FIXED_NOW, TZ), '20261007-0042');
  assert.equal(format.receiptNumber(9999, FIXED_NOW, TZ), '20261007-9999');
  assert.equal(format.receiptNumber(1,    FIXED_NOW, TZ), '20261007-0001');
});

test('format.twoCol truncates the left when both do not fit', () => {
  const row = format.twoCol('A very very very very long label indeed', 'TAIL', 20);
  assert.equal(row.length, 20);
  assert.ok(row.endsWith('TAIL'));
  assert.ok(row.includes('…'));
});

test('format.wrap breaks long words so no line overflows WIDTH', () => {
  const lines = format.wrap('x'.repeat(100), 10);
  for (const l of lines) assert.ok(l.length <= 10, `len=${l.length}`);
});

test('format.assertWidth throws when a line is over WIDTH', () => {
  assert.throws(() => format.assertWidth(['x'.repeat(WIDTH + 1)]));
  assert.doesNotThrow(() => format.assertWidth(['x'.repeat(WIDTH)]));
});
