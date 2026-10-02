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

// Broad CJK range (incl. full-width punctuation) used to STRIP Chinese when the
// printer can't render it.
const CJK_STRIP = /[⺀-鿿豈-﫿＀-￯]/g;

// Many budget thermal printers (XPrinter and clones) do NOT render GB18030
// Chinese — they print garbage bytes instead.  So by DEFAULT we print English
// only: any Chinese in a string is stripped, leaving the readable Latin text
// (e.g. "No chilli 不辣" -> "No chilli", "ALL DONE 完成" -> "ALL DONE").  This
// guarantees the kitchen and the customer see the right words.  If your printer
// genuinely supports Chinese, set PRINT_CHINESE=true in .env.
const PRINT_CHINESE = process.env.PRINT_CHINESE === 'true';

/**
 * Print one line.  With PRINT_CHINESE off (default) any CJK is stripped so the
 * English stays readable; with it on, CJK is sent as GB18030 in Kanji mode.
 */
function say(printer, text) {
  if (text == null || text === '') { printer.newLine(); return; }
  const s = String(text);

  if (!PRINT_CHINESE) {
    let ascii = s.replace(CJK_STRIP, '');
    ascii = ascii.replace(/ +([,.;:])/g, '$1');     // "chilli ," -> "chilli,"
    ascii = ascii.replace(/(\S) {2,}/g, '$1 ');      // collapse inner runs, keep indent
    ascii = ascii.replace(/[\s/·|]+$/g, '');         // drop dangling separators left by a stripped "/ 中文"
    ascii = ascii.replace(/[ \t]+$/g, '');           // trim trailing spaces
    // Nothing readable left (the line was pure Chinese) -> print nothing.
    if (!/[A-Za-z0-9]/.test(ascii)) return;
    printer.println(ascii);
    return;
  }

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

// ---------------------------------------------------------------------------
// Receipt formatting helpers
//
// An 80mm thermal printer fits ~48 characters per line in Font A.  These
// helpers keep every slip aligned the same way: a left label and a
// right-aligned amount, or centered header text.  They're used BOTH for the
// console-fallback text and (conceptually) mirror the on-printer tableCustom
// columns, so the preview and the paper match.
// ---------------------------------------------------------------------------
// Characters per line.  80mm printers are usually 48, but many wrap the last
// column off the edge, so we default to a safe 42 and let .env override it
// (RECEIPT_WIDTH).  Used for BOTH the printer layout and the console fallback.
const RECEIPT_WIDTH = Number(process.env.RECEIPT_WIDTH) || 42;
const COL_L = 0.62;                // left column width (printer tableCustom)
const COL_R = 0.38;                // right column width (printer tableCustom)

// Money, always 2dp, negative shown as "-12.00" (no currency symbol in the
// amount column — the column header carries "RM").
function money(v) {
  const n = Number(v) || 0;
  return (n < 0 ? '-' : '') + Math.abs(n).toFixed(2);
}

// Left text + right text padded to a fixed width (for console fallback).
function padRow(left, right, width = RECEIPT_WIDTH) {
  const l = String(left);
  const r = String(right);
  const gap = Math.max(1, width - l.length - r.length);
  return l + ' '.repeat(gap) + r;
}

function centerText(s, width = RECEIPT_WIDTH) {
  const t = String(s);
  if (t.length >= width) return t;
  return ' '.repeat(Math.floor((width - t.length) / 2)) + t;
}

// One two-column row on the printer (label left, amount right), optionally bold.
function amountRow(printer, label, value, bold = false) {
  if (bold) printer.bold(true);
  printer.tableCustom([
    { text: String(label), width: COL_L },
    { text: money(value), width: COL_R, align: 'RIGHT' },
  ]);
  if (bold) printer.bold(false);
}

// Print an item's special requests (modifiers + free-text note) indented
// under the item.  THIS is the "no spicy / less sugar" line the customer
// asked for — it must appear on every customer-facing slip.
function printExtras(printer, item) {
  if (item.options) say(printer, `   - ${item.options}`);
  if (item.note)    say(printer, `   - ${item.note}`);
}

// Feed several blank lines THEN cut.  The print head sits ~1-2cm above the
// cutter, so without enough feed the last printed line ends up in that gap and
// shows at the TOP of the next slip.  Feeding first clears it, so every ticket
// starts clean.
function finish(printer) {
  for (let i = 0; i < 5; i++) printer.newLine();
  printer.cut();
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
    width: RECEIPT_WIDTH,  // columns per line — keeps the amount column on-paper
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
  finish(printer);
  await executeWithRetry(printer, `${station} kitchen ticket`);
  console.log(`🖨️  ${station} ticket printed for order #${order.id} (${items.length} items)`);
}

// --- CUSTOMER COPY (order summary sent to the cashier printer) -------------
//
// Printed the moment an order is sent, so the waiter can hand the customer a
// copy of EVERYTHING they ordered this round (kitchen + counter + bar), with
// every special request.  It shows prices and a round subtotal but is clearly
// marked "not a receipt" — the final bill prints at payment time.
async function handleOrderSummary(job, station) {
  const itemIds = job.payload?.item_ids ?? [];
  if (!job.order_id || itemIds.length === 0) return;

  const [{ data: order }, { data: items }] = await Promise.all([
    supabase.from('orders').select('*').eq('id', job.order_id).single(),
    supabase.from('order_items').select('*').in('id', itemIds).order('id'),
  ]);
  if (!order || !items || items.length === 0) return;

  const when = new Date().toLocaleString('en-MY');
  const roundSubtotal = items.reduce(
    (s, i) => s + Number(i.price_at_time) * Number(i.qty), 0
  );

  // ---- console-fallback text (mirrors the printed layout) ----
  const W = RECEIPT_WIDTH;
  const lines = [
    centerText(settings.shop_name, W),
    ...(hasRealName(settings.shop_name_zh) ? [centerText(settings.shop_name_zh, W)] : []),
    centerText('CUSTOMER COPY / 顧客聯', W),
    '-'.repeat(W),
    padRow(`Table ${order.table_number}`, `Order #${order.id}`, W),
    when,
    '-'.repeat(W),
    padRow('ITEM', 'RM', W),
    '-'.repeat(W),
  ];
  items.forEach((i) => {
    lines.push(padRow(`${i.qty} x ${i.name_snapshot}`, money(Number(i.price_at_time) * i.qty), W));
    if (hasRealName(i.name_zh_snapshot)) lines.push(`   ${i.name_zh_snapshot}`);
    if (i.options) lines.push(`   - ${i.options}`);
    if (i.note)    lines.push(`   - ${i.note}`);
  });
  lines.push('-'.repeat(W));
  lines.push(padRow('Subtotal', money(roundSubtotal), W));
  lines.push('');
  lines.push(centerText('** NOT A RECEIPT **', W));
  lines.push(centerText('Final bill at cashier', W));

  const printer = printerFor(station);
  if (!printer) return consoleFallback(station, 'order_summary', lines);

  // ---- printer ----
  printer.alignCenter();
  printer.bold(true);
  printer.setTextSize(1, 1);
  say(printer, settings.shop_name);
  printer.setTextNormal();
  if (hasRealName(settings.shop_name_zh)) say(printer, settings.shop_name_zh);
  printer.newLine();
  say(printer, 'CUSTOMER COPY / 顧客聯');
  printer.bold(false);
  printer.drawLine();

  printer.alignLeft();
  printer.leftRight(`Table ${order.table_number}`, `Order #${order.id}`);
  printer.println(when);
  if (hasRealName(order.taken_by_name)) printer.println(`Served by: ${order.taken_by_name}`);
  printer.drawLine();

  printer.bold(true);
  printer.tableCustom([
    { text: 'ITEM', width: COL_L },
    { text: 'RM', width: COL_R, align: 'RIGHT' },
  ]);
  printer.bold(false);
  printer.drawLine();

  items.forEach((i) => {
    printer.tableCustom([
      { text: `${i.qty} x ${i.name_snapshot}`, width: COL_L },
      { text: money(Number(i.price_at_time) * i.qty), width: COL_R, align: 'RIGHT' },
    ]);
    if (hasRealName(i.name_zh_snapshot)) say(printer, `   ${i.name_zh_snapshot}`);
    printExtras(printer, i);
  });

  printer.drawLine();
  amountRow(printer, 'Subtotal', roundSubtotal, true);
  printer.newLine();
  printer.alignCenter();
  printer.bold(true);
  say(printer, '** NOT A RECEIPT **');
  printer.bold(false);
  say(printer, 'Final bill at cashier / 賬單以收銀為準');
  finish(printer);

  await executeWithRetry(printer, `customer copy`);
  console.log(`📋 Customer copy printed for order #${order.id} at ${station}`);
}

// --- CUSTOMER RECEIPT ------------------------------------------------------
// The final, itemised bill handed to the customer at payment.  Formatted like
// a proper retail receipt: centered header, aligned item + amount columns,
// aligned totals block, payment + change, and every special request shown.
async function handleReceipt(job, station) {
  if (!job.order_id) return;

  const [{ data: order }, { data: allItems }, { data: pays }] = await Promise.all([
    supabase.from('orders').select('*').eq('id', job.order_id).single(),
    supabase.from('order_items').select('*').eq('order_id', job.order_id).order('id'),
    supabase.from('payments').select('*').eq('order_id', job.order_id).order('id'),
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

  const method = order.payment_method || ((pays && pays[0]) ? pays[0].method : 'cash');
  const lastPay = (pays || []).filter((p) => Number(p.amount) > 0).slice(-1)[0];
  const received = lastPay && lastPay.received != null ? Number(lastPay.received) : null;
  const change = lastPay && lastPay.change_given != null ? Number(lastPay.change_given) : null;

  const addressLines = (settings.address || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const svcLabel = `Service${settings.service_charge_pct ? ' ' + settings.service_charge_pct + '%' : ''}`;
  const taxLabel = `SST${settings.sst_pct ? ' ' + settings.sst_pct + '%' : ''}`;

  // ---- console-fallback text (mirrors the printed layout) ----
  const W = RECEIPT_WIDTH;
  const lines = [
    centerText(settings.shop_name, W),
    ...(hasRealName(settings.shop_name_zh) ? [centerText(settings.shop_name_zh, W)] : []),
    ...addressLines.map((l) => centerText(l, W)),
    centerText(isReprint ? 'RECEIPT (REPRINT)' : 'RECEIPT', W),
    '='.repeat(W),
    padRow(`Table ${order.table_number}`, `Order #${order.id}`, W),
    when,
    ...(hasRealName(order.taken_by_name) ? [`Served by: ${order.taken_by_name}`] : []),
    '-'.repeat(W),
    padRow('ITEM', 'RM', W),
    '-'.repeat(W),
  ];
  items.forEach((i) => {
    lines.push(padRow(`${i.qty} x ${i.name_snapshot}`, money(Number(i.price_at_time) * i.qty), W));
    if (hasRealName(i.name_zh_snapshot)) lines.push(`   ${i.name_zh_snapshot}`);
    if (i.options) lines.push(`   - ${i.options}`);
    if (i.note)    lines.push(`   - ${i.note}`);
  });
  lines.push('-'.repeat(W));
  lines.push(padRow('Subtotal', money(subtotal), W));
  if (svc > 0) lines.push(padRow(svcLabel, money(svc), W));
  if (tax > 0) lines.push(padRow(taxLabel, money(tax), W));
  if (discount > 0) lines.push(padRow(`Discount${discountReason ? ' (' + discountReason + ')' : ''}`, money(-discount), W));
  if (rounding !== 0) lines.push(padRow('Rounding', money(rounding), W));
  lines.push('='.repeat(W));
  lines.push(padRow('TOTAL', money(total), W));
  lines.push('='.repeat(W));
  lines.push(padRow('Payment', String(method).toUpperCase(), W));
  if (received != null) lines.push(padRow('Cash', money(received), W));
  if (change != null) lines.push(padRow('Change', money(change), W));
  lines.push('');
  lines.push(centerText('Thank You! 多謝惠顧', W));
  lines.push(centerText('Please come again', W));

  const printer = printerFor(station);
  if (!printer) return consoleFallback(station, 'receipt', lines);

  // ---- printer ----
  printer.alignCenter();
  printer.bold(true);
  printer.setTextSize(1, 1);
  say(printer, settings.shop_name);
  printer.setTextNormal();
  if (hasRealName(settings.shop_name_zh)) say(printer, settings.shop_name_zh);
  printer.bold(false);
  addressLines.forEach((l) => say(printer, l));
  printer.newLine();
  printer.bold(true);
  say(printer, isReprint ? 'RECEIPT (REPRINT)' : 'RECEIPT');
  printer.bold(false);
  printer.drawLine();

  printer.alignLeft();
  printer.leftRight(`Table ${order.table_number}`, `Order #${order.id}`);
  printer.println(when);
  if (hasRealName(order.taken_by_name)) printer.println(`Served by: ${order.taken_by_name}`);
  printer.drawLine();

  printer.bold(true);
  printer.tableCustom([
    { text: 'ITEM', width: COL_L },
    { text: 'RM', width: COL_R, align: 'RIGHT' },
  ]);
  printer.bold(false);
  printer.drawLine();

  items.forEach((i) => {
    printer.tableCustom([
      { text: `${i.qty} x ${i.name_snapshot}`, width: COL_L },
      { text: money(Number(i.price_at_time) * i.qty), width: COL_R, align: 'RIGHT' },
    ]);
    if (hasRealName(i.name_zh_snapshot)) say(printer, `   ${i.name_zh_snapshot}`);
    printExtras(printer, i);
  });

  printer.drawLine();
  amountRow(printer, 'Subtotal', subtotal);
  if (svc > 0) amountRow(printer, svcLabel, svc);
  if (tax > 0) amountRow(printer, taxLabel, tax);
  if (discount > 0) amountRow(printer, `Discount${discountReason ? ' (' + discountReason + ')' : ''}`, -discount);
  if (rounding !== 0) amountRow(printer, 'Rounding', rounding);
  printer.drawLine();
  amountRow(printer, 'TOTAL', total, true);
  printer.drawLine();

  printer.leftRight('Payment', String(method).toUpperCase());
  if (received != null) amountRow(printer, 'Cash', received);
  if (change != null) amountRow(printer, 'Change', change);

  printer.newLine();
  printer.alignCenter();
  printer.bold(true);
  say(printer, 'Thank You! 多謝惠顧');
  printer.bold(false);
  say(printer, 'Please come again');
  finish(printer);
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
  finish(printer);
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
  finish(printer);
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
  finish(printer);
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
    if (c === 'drinks') return 'bar';
    if (c === 'noodles' || c === 'fried' || c === 'noodles & fried' || c === 'noodles / fried') return 'kitchen';
    return 'cashier';
  },
  __setTestClient,
};
