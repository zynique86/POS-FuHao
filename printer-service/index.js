// Printer service — runs continuously on a Raspberry Pi or counter mini-PC.
//
// All printing is driven by inserts into the `print_jobs` table:
//   kind = 'kitchen'  → payload: {item_ids: [..]}  (the batch to print)
//   kind = 'receipt'  → full itemised bill for the order
//   kind = 'void'     → payload: {item_id, reason} — void notice to kitchen
//
// The printer marks each job as printed (sets printed_at) after success.
// If PRINTER_IP is unset, jobs are logged to the console instead.

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const PRINTER_IP = process.env.PRINTER_IP;
const FALLBACK_SHOP_NAME = process.env.SHOP_NAME || 'DIM SUM SHOP';

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

// --- printer helper --------------------------------------------------------
function newPrinter() {
  return new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://${PRINTER_IP}`,
  });
}

// --- job dispatcher --------------------------------------------------------
async function processJob(job) {
  try {
    if (job.kind === 'kitchen') await handleKitchen(job);
    else if (job.kind === 'receipt') await handleReceipt(job);
    else if (job.kind === 'void') await handleVoid(job);
    else console.warn('Unknown job kind:', job.kind);

    await supabase
      .from('print_jobs')
      .update({ printed_at: new Date().toISOString() })
      .eq('id', job.id);
  } catch (err) {
    console.error(`❌ Job ${job.id} (${job.kind}) failed:`, err.message);
  }
}

// --- KITCHEN TICKET --------------------------------------------------------
async function handleKitchen(job) {
  const itemIds = job.payload?.item_ids ?? [];
  if (!job.order_id || itemIds.length === 0) return;

  const [{ data: order }, { data: items }] = await Promise.all([
    supabase.from('orders').select('*').eq('id', job.order_id).single(),
    supabase.from('order_items').select('*').in('id', itemIds).order('id'),
  ]);
  if (!order || !items || items.length === 0) return;

  const timeStr = new Date().toLocaleTimeString('en-MY');
  const lines = [
    '===================================',
    `   TABLE ${order.table_number}   Order #${order.id}`,
    '===================================',
    timeStr,
    '-----------------------------------',
    ...items.flatMap((i) => {
      const rows = [`  ${i.qty}x  ${i.name_snapshot}`];
      if (i.name_zh_snapshot) rows.push(`         ${i.name_zh_snapshot}`);
      return rows;
    }),
    '===================================',
  ];

  if (!PRINTER_IP) {
    console.log('\n📄 KITCHEN TICKET (would print):\n' + lines.join('\n') + '\n');
    return;
  }

  const printer = newPrinter();
  printer.alignCenter();
  printer.setTextSize(1, 1);
  printer.bold(true);
  printer.println(`TABLE ${order.table_number}`);
  printer.setTextNormal();
  printer.bold(false);
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
  console.log(`🖨️  Kitchen ticket printed for order #${order.id} (${items.length} items)`);
}

// --- CUSTOMER RECEIPT ------------------------------------------------------
async function handleReceipt(job) {
  if (!job.order_id) return;

  const [{ data: order }, { data: allItems }] = await Promise.all([
    supabase.from('orders').select('*').eq('id', job.order_id).single(),
    supabase.from('order_items').select('*').eq('order_id', job.order_id).order('id'),
  ]);
  if (!order) return;

  // exclude voided items from the receipt
  const items = (allItems ?? []).filter((i) => !i.voided_at);

  const subtotal = Number(order.subtotal ?? order.total) || 0;
  const svc = Number(order.service_charge) || 0;
  const tax = Number(order.tax) || 0;
  const rounding = Number(order.rounding) || 0;
  const total = Number(order.total) || 0;
  const when = new Date().toLocaleString('en-MY');
  const isReprint = !!order.paid_at;

  const lines = [
    '===================================',
    `         ${settings.shop_name}`,
    ...(settings.shop_name_zh ? [`         ${settings.shop_name_zh}`] : []),
    ...settings.address.split('\n').filter(Boolean).map((l) => `   ${l}`),
    '===================================',
    `Table ${order.table_number}   Order #${order.id}`,
    when,
    ...(isReprint && job.payload?.reprint ? ['*** REPRINT ***'] : []),
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

  if (!PRINTER_IP) {
    console.log('\n🧾 RECEIPT (would print):\n' + lines.join('\n') + '\n');
    return;
  }

  const printer = newPrinter();
  printer.alignCenter();
  printer.bold(true);
  printer.println(settings.shop_name);
  printer.bold(false);
  if (settings.shop_name_zh) printer.println(settings.shop_name_zh);
  settings.address.split('\n').filter(Boolean).forEach((l) => printer.println(l));
  printer.println(`Table ${order.table_number} — Order #${order.id}`);
  printer.println(when);
  if (isReprint && job.payload?.reprint) {
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
async function handleVoid(job) {
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
    `Table ${item.order_id ? '' : ''}Order #${item.order_id}`,
    `${item.qty}x  ${item.name_snapshot}`,
    ...(item.name_zh_snapshot ? [`     ${item.name_zh_snapshot}`] : []),
    `Reason: ${reason}`,
    '###################################',
  ];

  if (!PRINTER_IP) {
    console.log('\n🚫 VOID (would print):\n' + lines.join('\n') + '\n');
    return;
  }

  const printer = newPrinter();
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
  console.log(`🚫 VOID ticket printed for item #${item.id}`);
}

function row(printer, label, value) {
  printer.tableCustom([
    { text: label, width: 0.5 },
    { text: `RM ${value.toFixed(2)}`, width: 0.5, align: 'RIGHT' },
  ]);
}

// --- catch-up: print any jobs missed while the service was offline --------
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
  console.log(
    PRINTER_IP
      ? `   Printer IP: ${PRINTER_IP}`
      : '   No PRINTER_IP set — tickets will be logged to console only'
  );

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
