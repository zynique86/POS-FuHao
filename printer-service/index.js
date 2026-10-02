// Printer service — runs continuously on a Raspberry Pi or counter mini-PC.
//
// Multi-station routing:
//   station = 'kitchen' → kitchen printer (food orders + food restock + food voids)
//   station = 'bar'     → bar printer     (drinks + drink restock + drink voids)
//   station = 'cashier' → counter printer (customer receipts + refunds)
//
// Each station's printer IP goes in .env. If a station has no IP set, the
// legacy PRINTER_IP is used; if there's no PRINTER_IP either, tickets are
// logged to the console (useful for development).

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');
const iconv = require('iconv-lite');

// ---------------------------------------------------------------------------
// Keep the service alive no matter what.
//
// The thermal printer library sometimes rejects its internal socket-timeout
// promise AFTER our await has already resolved — Node treats that as an
// "unhandled promise rejection" and kills the whole process by default.
// We silently absorb those (we already surfaced the error in the job catch)
// so one offline printer never crashes the service AND the logs stay clean.
// ---------------------------------------------------------------------------
const IGNORED_MESSAGES = ['Socket timeout', 'ECONNREFUSED', 'EHOSTUNREACH', 'ETIMEDOUT'];

function isPrinterNetError(err) {
  const msg = (err && err.message) ? String(err.message) : String(err || '');
  return IGNORED_MESSAGES.some((s) => msg.includes(s));
}

process.on('unhandledRejection', (err) => {
  // Silently drop known printer timeouts — they're already reported per job.
  if (isPrinterNetError(err)) return;
  console.warn('⚠️  unhandledRejection:', (err && err.message) ? err.message : err);
});
process.on('uncaughtException', (err) => {
  if (isPrinterNetError(err)) return;
  console.warn('⚠️  uncaughtException:', (err && err.message) ? err.message : err);
});

// -------------------------------------------------------------------------
// Chinese-safe printing
//
// Thermal printers can't render UTF-8 Chinese out of the box.  They need
// two things: (1) the Kanji-mode ESC/POS command switched on, and (2) the
// text encoded in GB18030 (national standard, covers Simplified and
// Traditional).  Once we send `FS &` and GB18030 bytes, the printer renders
// the characters correctly.  After each line we send `FS .` to go back to
// ASCII mode so English lines print normally.
// -------------------------------------------------------------------------
const CJK_REGEX = /[㐀-鿿豈-﫿]/;
const FS_AND    = Buffer.from([0x1C, 0x26]);  // enter Kanji mode
const FS_DOT    = Buffer.from([0x1C, 0x2E]);  // exit Kanji mode
const LF        = Buffer.from([0x0A]);

/**
 * Print a line that may contain Chinese/CJK characters.
 * Falls back to normal `println` if the text is ASCII-only.
 */
function say(printer, text) {
  if (text == null || text === '') { printer.newLine(); return; }
  const s = String(text);
  if (!CJK_REGEX.test(s)) {
    printer.println(s);
    return;
  }
  printer.raw(FS_AND);
  printer.raw(iconv.encode(s, 'gb18030'));
  printer.raw(FS_DOT);
  printer.raw(LF);
}

/**
 * Returns true only if a value is a real Chinese/English name worth printing.
 *
 * Catches the common data-entry mistakes that would otherwise print a lonely
 * garbage line under every item:
 *   • null / undefined / empty / whitespace-only
 *   • placeholder "0", "-", "N/A", "null", "undefined"
 *   • strings that are only punctuation
 */
function hasRealName(s) {
  if (s == null) return false;
  const t = String(s).trim();
  if (t === '') return false;
  const low = t.toLowerCase();
  if (low === '0' || low === '-' || low === 'n/a' || low === 'na') return false;
  if (low === 'null' || low === 'undefined') return false;
  // All-punctuation / whitespace → not a name
  if (!/[\p{L}\p{N}]/u.test(t)) return false;
  return true;
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const FALLBACK_SHOP_NAME = process.env.SHOP_NAME || 'DIM SUM SHOP';

const LEGACY_PRINTER_IP = process.env.PRINTER_IP;
const PRINTERS = {
  kitchen: process.env.KITCHEN_PRINTER_IP || LEGACY_PRINTER_IP,
  bar:     process.env.BAR_PRINTER_IP     || LEGACY_PRINTER_IP,
  cashier: process.env.CASHIER_PRINTER_IP || LEGACY_PRINTER_IP,
};

// When this file is run directly it needs real Supabase credentials.  When it
// is required by a test harness, the test injects a fake client via
// __setTestClient() instead, so missing env vars there are fine.
if (require.main === module && (!SUPABASE_URL || !SUPABASE_ANON_KEY)) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env');
  process.exit(1);
}
let supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// --- settings cache --------------------------------------------------------
let settings = {
  shop_name: FALLBACK_SHOP_NAME,
  shop_name_zh: '',
  address: '',
  sst_pct: 0,
  service_charge_pct: 0,
  round_to_5_sen: true,
};

async function refreshSettings() {
  const { data } = await supabase.from('shop_settings').select('*').eq('id', 1).single();
  if (data) {
    settings = {
      shop_name: data.shop_name || FALLBACK_SHOP_NAME,
      shop_name_zh: data.shop_name_zh || '',
      address: data.address || '',
      sst_pct: Number(data.sst_pct) || 0,
      service_charge_pct: Number(data.service_charge_pct) || 0,
      round_to_5_sen: !!data.round_to_5_sen,
    };
  }
}

// --- printer helpers -------------------------------------------------------
// IMPORTANT: node-thermal-printer defaults to a 3-second socket timeout, which
// is too short for XPrinter 80mm units — they need 5-8s to finish the
// ESC/POS handshake, especially the cashier printer with longer receipts on
// a shared Wi-Fi network.  We bump it to 15s so a healthy-but-slow printer
// isn't mistaken for an offline one.  Port 9100 is spelled out explicitly
// because some library versions pick the wrong default when it's omitted.
function printerFor(station) {
  const ip = PRINTERS[station];
  if (!ip) return null;
  return new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://${ip}:9100`,
    characterSet: 'PC437_USA',
    removeSpecialCharacters: false,
    lineCharacter: '-',
    options: {
      timeout: 15000,  // 15s — long enough for slow XPrinter + Wi-Fi
    },
  });
}

// Try printing with a single retry if the first attempt is a transient
// Socket timeout.  Thermal printers sometimes drop the first TCP connection
// if they were idle for a long time; the second attempt almost always works.
async function executeWithRetry(printer, label) {
  try {
    await printer.execute();
  } catch (err) {
    const msg = (err && err.message) || String(err);
    // Only retry on network-ish errors, not on data errors
    if (!isPrinterNetError({ message: msg })) throw err;
    console.warn(`   ↻ retrying ${label} after ${msg}…`);
    // Small backoff — give the printer a breather
    await new Promise((r) => setTimeout(r, 1500));
    await printer.execute();
  }
}

function stationLabel(station) {
  return station === 'kitchen' ? '📄 KITCHEN'
       : station === 'bar'     ? '🫖 BAR'
       : station === 'cashier' ? '🧾 CASHIER'
       : `📦 ${station.toUpperCase()}`;
}

function consoleFallback(station, kind, lines) {
  console.log(`\n${stationLabel(station)} · ${kind.toUpperCase()} (would print — no IP configured):\n` + lines.join('\n') + '\n');
}

// --- dispatcher ------------------------------------------------------------
async function processJob(job) {
  try {
    const station = job.station || 'kitchen';
    if (job.kind === 'kitchen') await handleKitchen(job, station);
    else if (job.kind === 'receipt') await handleReceipt(job, station);
    else if (job.kind === 'order_summary') await handleOrderSummary(job, station);
    else if (job.kind === 'void') await handleVoid(job, station);
    else if (job.kind === 'refund') await handleRefund(job, station);
    else if (job.kind === 'restock') await handleRestock(job, station);
    else console.warn('Unknown job kind:', job.kind);

    await supabase
      .from('print_jobs')
      .update({ printed_at: new Date().toISOString() })
      .eq('id', job.id);
  } catch (err) {
    console.error(`❌ Job ${job.id} (${job.kind}/${job.station}) failed:`, err.message);
    // Mark the job as "attempted" by setting printed_at.  Keeps a bad job
    // (wrong printer IP, offline printer, etc.) from blocking every other
    // job behind it in the queue forever.
    try {
      await supabase
        .from('print_jobs')
        .update({ printed_at: new Date().toISOString() })
        .eq('id', job.id);
    } catch { /* ignore secondary error */ }
  }
}

// --- KITCHEN / BAR / COUNTER PREP TICKET -----------------------------------
// One function builds the prep ticket for any of the three stations.  The
// POS decides where each item line is sent (see stationForCategory in
// lib/types.ts); this function just prints what it was handed.
async function handleKitchen(job, station) {
  const itemIds = job.payload?.item_ids ?? [];
  if (!job.order_id || itemIds.length === 0) return;

  const [{ data: order }, { data: items }] = await Promise.all([
    supabase.from('orders').select('*').eq('id', job.order_id).single(),
    supabase.from('order_items').select('*').in('id', itemIds).order('id'),
  ]);
  if (!order || !items || items.length === 0) return;

  const timeStr = new Date().toLocaleTimeString('en-MY');
  // Header per station — the three physical printers in the shop.
  // Cashier prints a FRONT-COUNTER prep ticket for dim sum / buns / rice /
  // roasted / other (items plated at the front near the till).
  const stationName =
    station === 'bar'     ? 'BAR / 水吧'       :
    station === 'cashier' ? 'COUNTER / 前台'   :
                            'KITCHEN / 廚房';

  // Diagnostic — see exactly what each printer is being asked to make.
  // If "Siu Mai" shows up under "kitchen" below, the menu item's category
  // is wrong (should be "Dim Sum", not "Noodles") — fix it in Admin > Menu.
  console.log(
    `   → ${station.toUpperCase()} getting: ${items.map(i => i.name_snapshot).join(', ')}`
  );
  const lines = [
    '===================================',
    `           ${stationName}`,
    '===================================',
    `TABLE ${order.table_number}   Order #${order.id}`,
    timeStr,
    '-----------------------------------',
    ...items.flatMap((i) => {
      const rows = [`  ${i.qty}x  ${i.name_snapshot}`];
      if (hasRealName(i.name_zh_snapshot)) rows.push(`         ${i.name_zh_snapshot}`);
      if (i.options) rows.push(`         >> ${i.options}`);
      if (i.note)    rows.push(`         >> NOTE: ${i.note}`);
      return rows;
    }),
    '===================================',
  ];

  const printer = printerFor(station);
  if (!printer) return consoleFallback(station, 'kitchen', lines);

  printer.alignCenter();
  printer.bold(true);
  printer.setTextSize(1, 1);
  say(printer, stationName);
  printer.setTextNormal();
  printer.bold(false);
  printer.println(`TABLE ${order.table_number}`);
  printer.println(`Order #${order.id}`);
  printer.println(timeStr);
  printer.drawLine();
  printer.alignLeft();
  items.forEach((i) => {
    // [ ] tick box in front of each item so the cook marks it as done.
    printer.bold(true);
    say(printer, `[ ] ${i.qty}x  ${i.name_snapshot}`);
    printer.bold(false);
    // Only print Chinese name if it's a real one — skip "0", "-", nulls, etc.
    // These would otherwise appear as a stray garbage line under each item.
    if (hasRealName(i.name_zh_snapshot)) {
      say(printer, `       ${i.name_zh_snapshot}`);
    }
    // Modifier chips the waiter picked (e.g. "No shrimp, Extra sauce").
    // These MUST reach the cook so the right dish is made — do not skip.
    if (i.options) {
      printer.bold(true);
      say(printer, `       >> ${i.options}`);
      printer.bold(false);
    }
    // Free-text kitchen note (e.g. "Rush this", "Allergic to peanuts").
    if (i.note) {
      printer.bold(true);
      say(printer, `       >> NOTE: ${i.note}`);
      printer.bold(false);
    }
  });
  printer.drawLine();
  // Big "ALL DONE" box at the bottom — cook ticks when the whole order
  // is plated and ready for the runner to pick up.
  printer.alignCenter();
  printer.bold(true);
  printer.setTextSize(1, 1);
  say(printer, '[  ]  ALL DONE  完成');
  printer.setTextNormal();
  printer.bold(false);
  printer.newLine();
  printer.newLine();
  printer.cut();
  await executeWithRetry(printer, `${station} kitchen ticket`);
  console.log(`🖨️  ${station} ticket printed for order #${order.id} (${items.length} items)`);
}

// --- ORDER SUMMARY (customer copy sent to cashier printer) -----------------
//
// Printed at the moment an order is sent to the kitchen so the customer
// can see what they ordered.  NO PRICES — the customer sees the final
// money at payment time on the receipt.  Just item names, modifiers and
// notes so there's a clear record of what was ordered.
async function handleOrderSummary(job, station) {
  const itemIds = job.payload?.item_ids ?? [];
  if (!job.order_id || itemIds.length === 0) return;

  const [{ data: order }, { data: items }] = await Promise.all([
    supabase.from('orders').select('*').eq('id', job.order_id).single(),
    supabase.from('order_items').select('*').in('id', itemIds).order('id'),
  ]);
  if (!order || !items || items.length === 0) return;

  const when = new Date().toLocaleString('en-MY');

  const lines = [
    `${settings.shop_name}`,
    `Table ${order.table_number} · Order #${order.id}`,
    `${when}`,
    '',
    '*** ORDER SUMMARY / 訂單概覽 ***',
    '',
    ...items.flatMap((i) => {
      const rows = [`${i.qty}x ${i.name_snapshot}`];
      if (hasRealName(i.name_zh_snapshot)) rows.push(`   ${i.name_zh_snapshot}`);
      if (i.options) rows.push(`   > ${i.options}`);
      if (i.note)    rows.push(`   > ${i.note}`);
      return rows;
    }),
    '',
    '(This is a preview — final bill at cashier)',
  ];

  const printer = printerFor(station);
  if (!printer) return consoleFallback(station, 'order_summary', lines);

  printer.alignCenter();
  printer.bold(true);
  say(printer, settings.shop_name);
  printer.bold(false);
  if (hasRealName(settings.shop_name_zh)) say(printer, settings.shop_name_zh);
  printer.println(`Table ${order.table_number} - Order #${order.id}`);
  printer.println(when);
  printer.drawLine();
  printer.bold(true);
  say(printer, '*** ORDER SUMMARY / 訂單概覽 ***');
  printer.bold(false);
  printer.drawLine();

  printer.alignLeft();
  items.forEach((i) => {
    // No prices — just item line (left-aligned) + Chinese name + any extras.
    say(printer, `${i.qty}x ${i.name_snapshot}`);
    if (hasRealName(i.name_zh_snapshot)) say(printer, `   ${i.name_zh_snapshot}`);
    if (i.options) say(printer, `   > ${i.options}`);
    if (i.note)    say(printer, `   > ${i.note}`);
  });

  printer.drawLine();
  printer.alignCenter();
  say(printer, 'This is a preview — final bill at cashier');
  say(printer, '這只是預覽 — 賬單以收銀為準');
  printer.newLine();
  printer.newLine();
  printer.cut();

  await executeWithRetry(printer, `order summary`);
  console.log(`📋 Order summary printed for order #${order.id} at ${station}`);
}

// --- CUSTOMER RECEIPT ------------------------------------------------------
async function handleReceipt(job, station) {
  if (!job.order_id) return;

  const [{ data: order }, { data: allItems }] = await Promise.all([
    supabase.from('orders').select('*').eq('id', job.order_id).single(),
    supabase.from('order_items').select('*').eq('order_id', job.order_id).order('id'),
  ]);
  if (!order) return;

  const items = (allItems ?? []).filter((i) => !i.voided_at);

  const subtotal = Number(order.subtotal ?? order.total) || 0;
  const svc = Number(order.service_charge) || 0;
  const tax = Number(order.tax) || 0;
  const rounding = Number(order.rounding) || 0;
  const discount = Number(order.discount) || 0;
  const discountReason = order.discount_reason;
  const total = Number(order.total) || 0;
  const when = new Date().toLocaleString('en-MY');
  const isReprint = !!(order.paid_at && job.payload?.reprint);

  const lines = [
    '===================================',
    `         ${settings.shop_name}`,
    ...(hasRealName(settings.shop_name_zh) ? [`         ${settings.shop_name_zh}`] : []),
    ...settings.address.split('\n').filter(Boolean).map((l) => `   ${l}`),
    '===================================',
    `Table ${order.table_number}   Order #${order.id}`,
    when,
    ...(isReprint ? ['*** REPRINT ***'] : []),
    '-----------------------------------',
  ];
  items.forEach((i) => {
    const lineTotal = Number(i.price_at_time) * i.qty;
    lines.push(`${i.qty}x ${i.name_snapshot.padEnd(20)} RM ${lineTotal.toFixed(2)}`);
    if (hasRealName(i.name_zh_snapshot)) lines.push(`     ${i.name_zh_snapshot}`);
    // Special requests the customer made — modifier chips and the free-text
    // note.  These MUST appear on the receipt so the customer can confirm
    // what they asked for (e.g. "No pork", "Allergic to peanut").
    if (i.options) lines.push(`     > ${i.options}`);
    if (i.note)    lines.push(`     > ${i.note}`);
  });
  lines.push('-----------------------------------');
  lines.push(`Subtotal:              RM ${subtotal.toFixed(2)}`);
  if (svc > 0) lines.push(`Service ${settings.service_charge_pct}%:          RM ${svc.toFixed(2)}`);
  if (tax > 0) lines.push(`SST ${settings.sst_pct}%:              RM ${tax.toFixed(2)}`);
  if (rounding !== 0) lines.push(`Rounding:              RM ${rounding.toFixed(2)}`);
  lines.push(`TOTAL:                 RM ${total.toFixed(2)}`);
  lines.push(`Method: ${order.payment_method || 'cash'}`);
  lines.push('===================================');
  lines.push('       Thank you — 多謝');
  lines.push('===================================');

  const printer = printerFor(station);
  if (!printer) return consoleFallback(station, 'receipt', lines);

  printer.alignCenter();
  printer.bold(true);
  say(printer, settings.shop_name);
  printer.bold(false);
  if (hasRealName(settings.shop_name_zh)) say(printer, settings.shop_name_zh);
  settings.address.split('\n').filter(Boolean).forEach((l) => say(printer, l));
  printer.println(`Table ${order.table_number} - Order #${order.id}`);
  printer.println(when);
  if (isReprint) {
    printer.bold(true);
    printer.println('*** REPRINT ***');
    printer.bold(false);
  }
  printer.drawLine();
  printer.alignLeft();
  items.forEach((i) => {
    const lineTotal = Number(i.price_at_time) * i.qty;
    // The tableCustom columns are ASCII-only (qty + English + price).
    printer.tableCustom([
      { text: `${i.qty}x ${i.name_snapshot}`, width: 0.7 },
      { text: `RM ${lineTotal.toFixed(2)}`, width: 0.3, align: 'RIGHT' },
    ]);
    if (hasRealName(i.name_zh_snapshot)) say(printer, `   ${i.name_zh_snapshot}`);
    if (i.options) say(printer, `   > ${i.options}`);
    if (i.note)    say(printer, `   > ${i.note}`);
  });
  printer.drawLine();
  row(printer, 'Subtotal', subtotal);
  if (svc > 0) row(printer, `Service ${settings.service_charge_pct}%`, svc);
  if (tax > 0) row(printer, `SST ${settings.sst_pct}%`, tax);
  if (discount > 0) {
    row(printer, `Discount${discountReason ? ' (' + discountReason + ')' : ''}`, -discount);
  }
  if (rounding !== 0) row(printer, 'Rounding', rounding);
  printer.bold(true);
  row(printer, 'TOTAL', total);
  printer.bold(false);
  printer.println(`Method: ${order.payment_method || 'cash'}`);
  printer.drawLine();
  printer.alignCenter();
  say(printer, 'Thank you - 多謝');
  printer.newLine();
  printer.newLine();
  printer.cut();
  await executeWithRetry(printer, `receipt`);
  console.log(`🖨️  Receipt printed for order #${order.id}${isReprint ? ' (reprint)' : ''}`);
}

// --- VOID NOTICE -----------------------------------------------------------
async function handleVoid(job, station) {
  const itemId = job.payload?.item_id;
  if (!itemId) return;
  const { data: item } = await supabase.from('order_items').select('*').eq('id', itemId).single();
  if (!item) return;

  const reason = job.payload?.reason || 'no reason given';
  const time = new Date().toLocaleTimeString('en-MY');
  const lines = [
    '###################################',
    '            *** VOID ***',
    '###################################',
    time,
    `Order #${item.order_id}`,
    `${item.qty}x  ${item.name_snapshot}`,
    ...(hasRealName(item.name_zh_snapshot) ? [`     ${item.name_zh_snapshot}`] : []),
    `Reason: ${reason}`,
    '###################################',
  ];

  const printer = printerFor(station);
  if (!printer) return consoleFallback(station, 'void', lines);

  printer.alignCenter();
  printer.bold(true);
  printer.setTextSize(1, 1);
  printer.println('*** VOID ***');
  printer.setTextNormal();
  printer.bold(false);
  printer.println(time);
  printer.println(`Order #${item.order_id}`);
  printer.drawLine();
  say(printer, `${item.qty}x  ${item.name_snapshot}`);
  if (hasRealName(item.name_zh_snapshot)) say(printer, `     ${item.name_zh_snapshot}`);
  say(printer, `Reason: ${reason}`);
  printer.newLine();
  printer.newLine();
  printer.cut();
  await executeWithRetry(printer, `void ticket`);
  console.log(`🚫 VOID ticket printed for item #${item.id} at ${station}`);
}

// --- REFUND SLIP -----------------------------------------------------------
async function handleRefund(job, station) {
  if (!job.order_id) return;
  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', job.order_id)
    .single();
  if (!order) return;

  const amount = Number(job.payload?.amount ?? order.total) || 0;
  const reason = job.payload?.reason || 'no reason given';
  const by = job.payload?.by || 'staff';
  const when = new Date().toLocaleString('en-MY');

  const lines = [
    '###################################',
    '           *** REFUND ***',
    '###################################',
    when,
    `Table ${order.table_number}   Order #${order.id}`,
    `Amount refunded:   RM ${amount.toFixed(2)}`,
    `Original method:   ${order.payment_method || 'cash'}`,
    `Reason: ${reason}`,
    `By: ${by}`,
    '###################################',
  ];

  const printer = printerFor(station);
  if (!printer) return consoleFallback(station, 'refund', lines);

  printer.alignCenter();
  printer.bold(true);
  printer.setTextSize(1, 1);
  printer.println('*** REFUND ***');
  printer.setTextNormal();
  printer.bold(false);
  printer.println(when);
  printer.println(`Order #${order.id}`);
  printer.drawLine();
  printer.alignLeft();
  row(printer, 'Amount refunded', amount);
  printer.println(`Method: ${order.payment_method || 'cash'}`);
  say(printer, `Reason: ${reason}`);
  say(printer, `By: ${by}`);
  printer.drawLine();
  printer.newLine();
  printer.newLine();
  printer.cut();
  await executeWithRetry(printer, `refund slip`);
  console.log(`↩️  Refund slip printed for order #${order.id}`);
}

// --- RESTOCK SLIP ----------------------------------------------------------
async function handleRestock(job, station) {
  const p = job.payload || {};
  const name = p.item_name || 'unknown item';
  const nameZh = p.item_name_zh;
  const qty = p.qty_wanted;
  const note = p.note;
  const by = p.by;
  const time = new Date().toLocaleTimeString('en-MY');
  const stationName = station === 'bar' ? 'BAR / 水吧' : 'KITCHEN / 廚房';

  const lines = [
    '###################################',
    '         *** RESTOCK ***',
    `         ${stationName}`,
    '###################################',
    time,
    '',
    `Item: ${name}`,
    ...(hasRealName(nameZh) ? [`     ${nameZh}`] : []),
    ...(qty ? [`Qty:  ${qty}`] : []),
    ...(note ? [`Note: ${note}`] : []),
    ...(by ? [`By:   ${by}`] : []),
    '###################################',
  ];

  const printer = printerFor(station);
  if (!printer) return consoleFallback(station, 'restock', lines);

  printer.alignCenter();
  printer.bold(true);
  printer.setTextSize(1, 2);
  printer.println('*** RESTOCK ***');
  printer.setTextNormal();
  printer.bold(false);
  say(printer, stationName);
  printer.println(time);
  printer.drawLine();
  printer.alignLeft();
  printer.bold(true);
  printer.setTextSize(1, 1);
  say(printer, name);
  printer.setTextNormal();
  if (hasRealName(nameZh)) say(printer, nameZh);
  printer.bold(false);
  if (qty) printer.println(`Qty:  ${qty}`);
  if (note) say(printer, `Note: ${note}`);
  if (by) printer.println(`By:   ${by}`);
  printer.drawLine();
  printer.newLine();
  printer.newLine();
  printer.cut();
  await executeWithRetry(printer, `restock slip`);
  console.log(`🔥 Restock slip printed for ${name} at ${station}`);
}

function row(printer, label, value) {
  printer.tableCustom([
    { text: label, width: 0.5 },
    { text: `RM ${value.toFixed(2)}`, width: 0.5, align: 'RIGHT' },
  ]);
}

// --- catch-up --------------------------------------------------------------
async function catchUp() {
  const { data: pending } = await supabase
    .from('print_jobs')
    .select('*')
    .is('printed_at', null)
    .order('created_at');
  if (!pending || pending.length === 0) return;
  console.log(`⏳ Catching up ${pending.length} pending print job(s)…`);
  for (const job of pending) await processJob(job);
}

// --- boot ------------------------------------------------------------------
async function main() {
  await refreshSettings();

  console.log('🥟 Printer service starting…');
  console.log(`   Shop: ${settings.shop_name}`);
  console.log(`   Kitchen printer: ${PRINTERS.kitchen || '(not set — will log)'}`);
  console.log(`   Bar printer:     ${PRINTERS.bar     || '(not set — will log)'}`);
  console.log(`   Cashier printer: ${PRINTERS.cashier || '(not set — will log)'}`);

  await catchUp();

  supabase
    .channel('printer-jobs')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'print_jobs' },
      (payload) => {
        processJob(payload.new).catch((e) =>
          console.error('processJob failed:', e.message)
        );
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'shop_settings' },
      () => refreshSettings()
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') console.log('✅ Subscribed. Waiting for print jobs…\n');
    });
}

// Only boot the live service when run directly (`node index.js`).  When a test
// requires this file it drives processJob() against a fake client instead.
if (require.main === module) {
  main().catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
  });

  process.on('SIGINT', () => {
    console.log('\n👋 Printer service stopping.');
    process.exit(0);
  });
}

// --- test hooks ------------------------------------------------------------
// Let a test swap in a fake Supabase client and preset settings without
// touching the network or a real printer (printers fall back to console when
// no station IP is configured).
function __setTestClient(client, testSettings) {
  supabase = client;
  if (testSettings) settings = { ...settings, ...testSettings };
}

module.exports = {
  processJob,
  handleKitchen,
  handleOrderSummary,
  handleReceipt,
  handleVoid,
  handleRefund,
  handleRestock,
  stationForCategory: (category) => {
    const c = (category || '').trim().toLowerCase();
    if (c === 'noodles' || c === 'fried' || c === 'noodles / fried') return 'kitchen';
    if (c === 'drinks') return 'bar';
    return 'cashier';
  },
  __setTestClient,
};
