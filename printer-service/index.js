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

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const FALLBACK_SHOP_NAME = process.env.SHOP_NAME || 'DIM SUM SHOP';

const LEGACY_PRINTER_IP = process.env.PRINTER_IP;
const PRINTERS = {
  kitchen: process.env.KITCHEN_PRINTER_IP || LEGACY_PRINTER_IP,
  bar:     process.env.BAR_PRINTER_IP     || LEGACY_PRINTER_IP,
  cashier: process.env.CASHIER_PRINTER_IP || LEGACY_PRINTER_IP,
};

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
function printerFor(station) {
  const ip = PRINTERS[station];
  if (!ip) return null;
  return new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://${ip}`,
  });
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
  }
}

// --- KITCHEN / BAR TICKET --------------------------------------------------
async function handleKitchen(job, station) {
  const itemIds = job.payload?.item_ids ?? [];
  if (!job.order_id || itemIds.length === 0) return;

  const [{ data: order }, { data: items }] = await Promise.all([
    supabase.from('orders').select('*').eq('id', job.order_id).single(),
    supabase.from('order_items').select('*').in('id', itemIds).order('id'),
  ]);
  if (!order || !items || items.length === 0) return;

  const timeStr = new Date().toLocaleTimeString('en-MY');
  const stationName = station === 'bar' ? 'BAR / 水吧' : 'KITCHEN / 廚房';
  const lines = [
    '===================================',
    `           ${stationName}`,
    '===================================',
    `TABLE ${order.table_number}   Order #${order.id}`,
    timeStr,
    '-----------------------------------',
    ...items.flatMap((i) => {
      const rows = [`  ${i.qty}x  ${i.name_snapshot}`];
      if (i.name_zh_snapshot) rows.push(`         ${i.name_zh_snapshot}`);
      return rows;
    }),
    '===================================',
  ];

  const printer = printerFor(station);
  if (!printer) return consoleFallback(station, 'kitchen', lines);

  printer.alignCenter();
  printer.bold(true);
  printer.setTextSize(1, 1);
  printer.println(stationName);
  printer.setTextNormal();
  printer.bold(false);
  printer.println(`TABLE ${order.table_number}`);
  printer.println(`Order #${order.id}`);
  printer.println(timeStr);
  printer.drawLine();
  printer.alignLeft();
  items.forEach((i) => {
    printer.bold(true);
    printer.println(`${i.qty}x  ${i.name_snapshot}`);
    printer.bold(false);
    if (i.name_zh_snapshot) printer.println(`     ${i.name_zh_snapshot}`);
  });
  printer.cut();
  await printer.execute();
  console.log(`🖨️  ${station} ticket printed for order #${order.id} (${items.length} items)`);
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
  const total = Number(order.total) || 0;
  const when = new Date().toLocaleString('en-MY');
  const isReprint = !!(order.paid_at && job.payload?.reprint);

  const lines = [
    '===================================',
    `         ${settings.shop_name}`,
    ...(settings.shop_name_zh ? [`         ${settings.shop_name_zh}`] : []),
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
    if (i.name_zh_snapshot) lines.push(`     ${i.name_zh_snapshot}`);
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
  printer.println(settings.shop_name);
  printer.bold(false);
  if (settings.shop_name_zh) printer.println(settings.shop_name_zh);
  settings.address.split('\n').filter(Boolean).forEach((l) => printer.println(l));
  printer.println(`Table ${order.table_number} — Order #${order.id}`);
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
    printer.tableCustom([
      { text: `${i.qty}x ${i.name_snapshot}`, width: 0.7 },
      { text: `RM ${lineTotal.toFixed(2)}`, width: 0.3, align: 'RIGHT' },
    ]);
    if (i.name_zh_snapshot) printer.println(`   ${i.name_zh_snapshot}`);
  });
  printer.drawLine();
  row(printer, 'Subtotal', subtotal);
  if (svc > 0) row(printer, `Service ${settings.service_charge_pct}%`, svc);
  if (tax > 0) row(printer, `SST ${settings.sst_pct}%`, tax);
  if (rounding !== 0) row(printer, 'Rounding', rounding);
  printer.bold(true);
  row(printer, 'TOTAL', total);
  printer.bold(false);
  printer.println(`Method: ${order.payment_method || 'cash'}`);
  printer.drawLine();
  printer.alignCenter();
  printer.println('Thank you — 多謝');
  printer.cut();
  await printer.execute();
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
    ...(item.name_zh_snapshot ? [`     ${item.name_zh_snapshot}`] : []),
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
  printer.println(`${item.qty}x  ${item.name_snapshot}`);
  if (item.name_zh_snapshot) printer.println(`     ${item.name_zh_snapshot}`);
  printer.println(`Reason: ${reason}`);
  printer.cut();
  await printer.execute();
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
  printer.println(`Reason: ${reason}`);
  printer.println(`By: ${by}`);
  printer.drawLine();
  printer.cut();
  await printer.execute();
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
    ...(nameZh ? [`     ${nameZh}`] : []),
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
  printer.println(stationName);
  printer.println(time);
  printer.drawLine();
  printer.alignLeft();
  printer.bold(true);
  printer.setTextSize(1, 1);
  printer.println(name);
  printer.setTextNormal();
  if (nameZh) printer.println(nameZh);
  printer.bold(false);
  if (qty) printer.println(`Qty:  ${qty}`);
  if (note) printer.println(`Note: ${note}`);
  if (by) printer.println(`By:   ${by}`);
  printer.drawLine();
  printer.cut();
  await printer.execute();
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

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n👋 Printer service stopping.');
  process.exit(0);
});
