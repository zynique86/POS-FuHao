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
//
// This file is the orchestrator: subscribe to `print_jobs`, fetch the related
// rows from Supabase, shape them into plain ticket objects, and hand them to
// the per-station driver (see ./drivers/). All ESC/POS formatting and
// node-thermal-printer specifics live in the drivers.

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { createDriver } = require('./drivers');
const layouts = require('./layouts');

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
  if (isPrinterNetError(err)) return;
  console.warn('⚠️  unhandledRejection:', (err && err.message) ? err.message : err);
});
process.on('uncaughtException', (err) => {
  if (isPrinterNetError(err)) return;
  console.warn('⚠️  uncaughtException:', (err && err.message) ? err.message : err);
});

// Returns true only if a value is a real Chinese/English name worth printing.
// Used here to filter header strings; the drivers also apply this to per-item
// Chinese names at render time.
function hasRealName(s) {
  if (s == null) return false;
  const t = String(s).trim();
  if (t === '') return false;
  const low = t.toLowerCase();
  if (low === '0' || low === '-' || low === 'n/a' || low === 'na') return false;
  if (low === 'null' || low === 'undefined') return false;
  if (!/[\p{L}\p{N}]/u.test(t)) return false;
  return true;
}

// 80mm printers fit ~48 chars; many clip the last column so 42 is the safe
// default. Shared between the drivers and the console-fallback layout.
const RECEIPT_WIDTH = Number(process.env.RECEIPT_WIDTH) || 42;

// Many budget thermal printers (XPrinter and clones) do NOT render GB18030
// Chinese — they print garbage bytes instead. So by DEFAULT we print English
// only. Set PRINT_CHINESE=true in .env on a printer that actually supports it.
const PRINT_CHINESE = process.env.PRINT_CHINESE === 'true';

const PREORDER_PHONES = (process.env.PREORDER_PHONES || '0135711396, 0174968928')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Business-day timezone for date/receipt-number rendering.  Defaults to the
// one lib/datetime.ts already uses so a cashier opening a browser from
// another TZ still sees the shop's actual business day.
const BUSINESS_TZ = process.env.BUSINESS_TZ || 'Asia/Kuala_Lumpur';

// Map our three internal routing keys to the printed station label the
// kitchen mockup footer expects (and that an expeditor can read at a
// glance).  Overridable per-station via env for a kitchen with named lines.
const STATION_LABELS = {
  kitchen: process.env.KITCHEN_STATION_LABEL || 'GRILL',
  cashier: process.env.CASHIER_STATION_LABEL || 'DIM-SUM',
  bar:     process.env.BAR_STATION_LABEL     || 'BAR',
};

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
// Printer service MUST use the service-role key.  It reads print_jobs that
// RLS hides from the anon key and marks them printed from a trusted machine
// behind the counter, not from a browser — the anon key cannot do either
// safely.  No fallback: a misconfigured service that silently drops to anon
// would appear to work (jobs enqueue, nothing prints) and quietly leak the
// anon surface area to a device nobody is watching.
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FALLBACK_SHOP_NAME = process.env.SHOP_NAME || 'DIM SUM SHOP';

const LEGACY_PRINTER_IP = process.env.PRINTER_IP;
const STATION_IPS = {
  kitchen: process.env.KITCHEN_PRINTER_IP || LEGACY_PRINTER_IP,
  bar:     process.env.BAR_PRINTER_IP     || LEGACY_PRINTER_IP,
  cashier: process.env.CASHIER_PRINTER_IP || LEGACY_PRINTER_IP,
};

// Printer transport. For now only 'tcp' exists; set PRINTER_TRANSPORT=usb or
// bluetooth later and point ./drivers at a new file.
const PRINTER_TRANSPORT = process.env.PRINTER_TRANSPORT || 'tcp';

// One driver per station, created lazily on first use.
const DRIVERS = {};
function driverFor(station) {
  if (DRIVERS[station]) return DRIVERS[station];
  DRIVERS[station] = createDriver({
    transport: PRINTER_TRANSPORT,
    ip: STATION_IPS[station],
    station,
    width: RECEIPT_WIDTH,
    printChinese: PRINT_CHINESE,
    preorderPhones: PREORDER_PHONES,
  });
  return DRIVERS[station];
}

// When this file is run directly it needs real Supabase credentials. When it
// is required by a test harness, the test injects a fake client via
// __setTestClient() instead, so missing env vars there are fine. The service
// MUST use the service-role key (added in #3); the anon fallback was dropped.
if (require.main === module) {
  if (!SUPABASE_URL) {
    console.error('❌ Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) in .env');
    process.exit(1);
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY in .env');
    console.error('   The printer service MUST use the service-role key, not the anon key.');
    console.error('   Copy it from Supabase > Project Settings > API > service_role.');
    process.exit(1);
  }
}
let supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

// --- settings cache --------------------------------------------------------
let settings = {
  shop_name: FALLBACK_SHOP_NAME,
  shop_name_zh: '',
  address: '',
  phone: '',
  tax_id: '',
  wifi_ssid: '',
  wifi_password: '',
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
      // Optional fields — may not be in the schema today, which is fine:
      // reading an absent column returns undefined and we drop the line.
      phone: data.phone || '',
      tax_id: data.tax_id || '',
      wifi_ssid: data.wifi_ssid || '',
      wifi_password: data.wifi_password || '',
      sst_pct: Number(data.sst_pct) || 0,
      service_charge_pct: Number(data.service_charge_pct) || 0,
      round_to_5_sen: !!data.round_to_5_sen,
    };
  }
}

function itemView(i) {
  return {
    qty: i.qty,
    name: i.name_snapshot,
    nameZh: i.name_zh_snapshot,
    options: i.options,
    note: i.note,
    priceAtTime: i.price_at_time,
  };
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
    // Mark the job as "attempted" so one bad job (wrong IP, offline printer)
    // never blocks every other job behind it in the queue forever.
    try {
      await supabase
        .from('print_jobs')
        .update({ printed_at: new Date().toISOString() })
        .eq('id', job.id);
    } catch { /* ignore secondary error */ }
  }
}

async function handleKitchen(job, station) {
  const itemIds = job.payload?.item_ids ?? [];
  if (!job.order_id || itemIds.length === 0) return;

  const [{ data: order }, { data: items }] = await Promise.all([
    supabase.from('orders').select('*').eq('id', job.order_id).single(),
    supabase.from('order_items').select('*').in('id', itemIds).order('id'),
  ]);
  if (!order || !items || items.length === 0) return;

  console.log(
    `   → ${station.toUpperCase()} getting: ${items.map(i => i.name_snapshot).join(', ')}`
  );

  const layout = station === 'bar' ? layouts.bar : layouts.kitchen;
  const entries = layout.build({
    headerLabel: station === 'bar' ? '[BAR ORDER]' : '[KITCHEN TICKET]',
    stationLabel: STATION_LABELS[station] || station.toUpperCase(),
    order: {
      id: order.id,
      table: order.table_number,
      type: order.order_type || 'Dine-In',
      server: order.taken_by_name,
    },
    items: items.map(itemView),
    tz: BUSINESS_TZ,
    now: new Date(),
  });

  await driverFor(station).printLayout(entries, `${station} ticket`);
  console.log(`🖨️  ${station} ticket printed for order #${order.id} (${items.length} items)`);
}

async function handleOrderSummary(job, station) {
  const itemIds = job.payload?.item_ids ?? [];
  if (!job.order_id || itemIds.length === 0) return;

  const [{ data: order }, { data: items }] = await Promise.all([
    supabase.from('orders').select('*').eq('id', job.order_id).single(),
    supabase.from('order_items').select('*').in('id', itemIds).order('id'),
  ]);
  if (!order || !items || items.length === 0) return;

  await driverFor(station).printOrderSummary({
    shopName: settings.shop_name,
    shopNameZh: settings.shop_name_zh,
    tableNumber: order.table_number,
    orderId: order.id,
    when: new Date().toLocaleString('en-MY'),
    takenByName: order.taken_by_name,
    items: items.map(itemView),
  });
  console.log(`📋 Customer copy printed for order #${order.id} at ${station}`);
}

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
  const total = Number(order.total) || 0;
  const isReprint = !!(order.paid_at && job.payload?.reprint);

  const method = order.payment_method || ((pays && pays[0]) ? pays[0].method : 'cash');
  const lastPay = (pays || []).filter((p) => Number(p.amount) > 0).slice(-1)[0];
  const received = lastPay && lastPay.received != null ? Number(lastPay.received) : null;
  const change = lastPay && lastPay.change_given != null ? Number(lastPay.change_given) : null;

  const addressLines = (settings.address || '').split('\n').map((l) => l.trim()).filter(Boolean);

  const entries = layouts.receipt.build({
    shop: {
      name: settings.shop_name,
      nameZh: settings.shop_name_zh,
      addressLines,
      phone: settings.phone,
      taxId: settings.tax_id,
    },
    order: {
      id: order.id,
      table: order.table_number,
      type: order.order_type || 'Dine-In',
      server: order.taken_by_name,
    },
    items: items.map(itemView),
    totals: {
      subtotal,
      serviceCharge: svc,
      serviceChargePct: settings.service_charge_pct || undefined,
      tax,
      taxPct: settings.sst_pct || undefined,
      discount,
      discountReason: order.discount_reason,
      rounding,
      total,
    },
    payment: {
      method: String(method || '').toUpperCase(),
      amountPaid: received,
      changeDue: change,
    },
    footer: {
      wifiSsid: settings.wifi_ssid,
      wifiPassword: settings.wifi_password,
    },
    tz: BUSINESS_TZ,
    now: new Date(),
    isReprint,
  });

  await driverFor(station).printLayout(entries, isReprint ? 'receipt (reprint)' : 'receipt');
  console.log(`🖨️  Receipt printed for order #${order.id}${isReprint ? ' (reprint)' : ''}`);
}

async function handleVoid(job, station) {
  const itemId = job.payload?.item_id;
  if (!itemId) return;
  const { data: item } = await supabase.from('order_items').select('*').eq('id', itemId).single();
  if (!item) return;

  await driverFor(station).printVoid({
    time: new Date().toLocaleTimeString('en-MY'),
    orderId: item.order_id,
    qty: item.qty,
    name: item.name_snapshot,
    nameZh: item.name_zh_snapshot,
    reason: job.payload?.reason || 'no reason given',
  });
  console.log(`🚫 VOID ticket printed for item #${item.id} at ${station}`);
}

async function handleRefund(job, station) {
  if (!job.order_id) return;
  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', job.order_id)
    .single();
  if (!order) return;

  await driverFor(station).printRefund({
    when: new Date().toLocaleString('en-MY'),
    orderId: order.id,
    amount: Number(job.payload?.amount ?? order.total) || 0,
    method: order.payment_method || 'cash',
    reason: job.payload?.reason || 'no reason given',
    by: job.payload?.by || 'staff',
  });
  console.log(`↩️  Refund slip printed for order #${order.id}`);
}

async function handleRestock(job, station) {
  const p = job.payload || {};
  const name = p.item_name || 'unknown item';

  await driverFor(station).printRestock({
    time: new Date().toLocaleTimeString('en-MY'),
    stationName: station === 'bar' ? 'BAR / 水吧' : 'BACK KITCHEN / 後廚',
    name,
    nameZh: p.item_name_zh,
    qty: p.qty_wanted,
    note: p.note,
    by: p.by,
  });
  console.log(`🔥 Restock slip printed for ${name} at ${station}`);
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
  console.log(`   Transport: ${PRINTER_TRANSPORT}`);
  console.log(`   Kitchen printer: ${STATION_IPS.kitchen || '(not set — will log)'}`);
  console.log(`   Bar printer:     ${STATION_IPS.bar     || '(not set — will log)'}`);
  console.log(`   Cashier printer: ${STATION_IPS.cashier || '(not set — will log)'}`);

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
// touching the network or a real printer.
function __setTestClient(client, testSettings) {
  supabase = client;
  if (testSettings) settings = { ...settings, ...testSettings };
}

// Allow tests to inject a fake driver per station (bypasses hardware).
function __setTestDriver(station, driver) {
  DRIVERS[station] = driver;
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
    // Mirror of lib/types.ts: category → one of three printer stations.
    //   kitchen = back kitchen, cashier = front kitchen, bar = bar.
    const map = {
      'noodles': 'kitchen', 'noodles / fried': 'kitchen', 'fried': 'kitchen', 'rice': 'kitchen',
      'drinks': 'bar',
      'dim sum': 'cashier', 'buns': 'cashier', 'roasted': 'cashier', 'other': 'cashier',
    };
    return map[(category || '').trim().toLowerCase()] ?? 'cashier';
  },
  // Exposed for unit tests — these are pure helpers with no I/O.
  say,
  hasRealName,
  __setTestClient,
  __setTestDriver,
};
