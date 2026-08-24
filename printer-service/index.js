// Printer service — runs continuously on a Raspberry Pi or the counter mini-PC.
//
// Two things happen:
//   1. New items land on an order (INSERT into order_items) →
//      after a short debounce we print a KITCHEN ticket with the batch.
//      This means both brand-new orders AND "add-on" baskets to an
//      already-open table both produce a fresh kitchen ticket.
//   2. Order is marked paid (orders.status → 'paid') → print RECEIPT.
//
// If PRINTER_IP is not set, we log tickets to the console instead
// (useful for developing without hardware).

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const PRINTER_IP = process.env.PRINTER_IP; // e.g. "192.168.1.87"
const FALLBACK_SHOP_NAME = process.env.SHOP_NAME || 'DIM SUM SHOP';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --------------------------------------------------------------------------
// Settings — cached locally, refreshed on the shop_settings realtime channel
// --------------------------------------------------------------------------
let settings = {
  shop_name: FALLBACK_SHOP_NAME,
  shop_name_zh: '',
  address: '',
  sst_pct: 0,
  service_charge_pct: 0,
  round_to_5_sen: true,
};

async function refreshSettings() {
  const { data } = await supabase
    .from('shop_settings')
    .select('*')
    .eq('id', 1)
    .single();
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

// --------------------------------------------------------------------------
// Debounce: batch order_items inserts per order for 900ms so appended
// baskets print as ONE ticket rather than one line per row.
// --------------------------------------------------------------------------
const pendingByOrder = new Map(); // order_id → { itemIds: Set, timer }
const KITCHEN_DEBOUNCE_MS = 900;

function scheduleKitchenPrint(orderId, itemId) {
  let entry = pendingByOrder.get(orderId);
  if (!entry) {
    entry = { itemIds: new Set(), timer: null };
    pendingByOrder.set(orderId, entry);
  }
  entry.itemIds.add(itemId);
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => flushKitchen(orderId), KITCHEN_DEBOUNCE_MS);
}

async function flushKitchen(orderId) {
  const entry = pendingByOrder.get(orderId);
  if (!entry) return;
  pendingByOrder.delete(orderId);

  const itemIds = [...entry.itemIds];
  const [{ data: order }, { data: items }] = await Promise.all([
    supabase.from('orders').select('*').eq('id', orderId).single(),
    supabase.from('order_items').select('*').in('id', itemIds).order('id'),
  ]);
  if (!order || !items || items.length === 0) return;

  await printKitchenTicket(order, items);
}

async function fetchOrderWithItems(orderId) {
  const [{ data: order }, { data: items }] = await Promise.all([
    supabase.from('orders').select('*').eq('id', orderId).single(),
    supabase.from('order_items').select('*').eq('order_id', orderId).order('id'),
  ]);
  return { order, items: items ?? [] };
}

// --------------------------------------------------------------------------
// KITCHEN TICKET (per batch of new items)
// --------------------------------------------------------------------------
async function printKitchenTicket(order, items) {
  const timeStr = new Date().toLocaleTimeString('en-MY');
  const lines = [];
  lines.push('===================================');
  lines.push(`   TABLE ${order.table_number}   Order #${order.id}`);
  lines.push('===================================');
  lines.push(timeStr);
  lines.push('-----------------------------------');
  items.forEach((i) => {
    lines.push(`  ${i.qty}x  ${i.name_snapshot}`);
    if (i.name_zh_snapshot) lines.push(`         ${i.name_zh_snapshot}`);
  });
  lines.push('===================================');
  const output = lines.join('\n');

  if (!PRINTER_IP) {
    console.log('\n📄 KITCHEN TICKET (would print):\n' + output + '\n');
    return;
  }

  try {
    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: `tcp://${PRINTER_IP}`,
    });
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
      if (i.name_zh_snapshot) {
        printer.println(`     ${i.name_zh_snapshot}`);
      }
    });
    printer.cut();
    await printer.execute();
    console.log(`🖨️  Kitchen ticket printed for order #${order.id} (${items.length} items)`);
  } catch (err) {
    console.error('❌ Kitchen print failed:', err.message);
  }
}

// --------------------------------------------------------------------------
// CUSTOMER RECEIPT (on payment)
// --------------------------------------------------------------------------
async function printReceipt(order, items) {
  const subtotal = Number(order.subtotal ?? order.total) || 0;
  const svc = Number(order.service_charge) || 0;
  const tax = Number(order.tax) || 0;
  const rounding = Number(order.rounding) || 0;
  const total = Number(order.total) || 0;
  const when = new Date().toLocaleString('en-MY');

  const lines = [];
  lines.push('===================================');
  lines.push(`         ${settings.shop_name}`);
  if (settings.shop_name_zh) lines.push(`         ${settings.shop_name_zh}`);
  if (settings.address) {
    settings.address.split('\n').forEach((l) => lines.push(`   ${l}`));
  }
  lines.push('===================================');
  lines.push(`Table ${order.table_number}   Order #${order.id}`);
  lines.push(when);
  lines.push('-----------------------------------');
  items.forEach((i) => {
    const lineTotal = Number(i.price_at_time) * i.qty;
    lines.push(
      `${i.qty}x ${i.name_snapshot.padEnd(20)} RM ${lineTotal.toFixed(2)}`
    );
    if (i.name_zh_snapshot) lines.push(`     ${i.name_zh_snapshot}`);
  });
  lines.push('-----------------------------------');
  lines.push(`Subtotal:              RM ${subtotal.toFixed(2)}`);
  if (svc > 0) {
    lines.push(`Service ${settings.service_charge_pct}%:          RM ${svc.toFixed(2)}`);
  }
  if (tax > 0) {
    lines.push(`SST ${settings.sst_pct}%:              RM ${tax.toFixed(2)}`);
  }
  if (rounding !== 0) {
    lines.push(`Rounding:              RM ${rounding.toFixed(2)}`);
  }
  lines.push(`TOTAL:                 RM ${total.toFixed(2)}`);
  lines.push(`Method: ${order.payment_method || 'cash'}`);
  lines.push('===================================');
  lines.push('       Thank you — 多謝');
  lines.push('===================================');
  const output = lines.join('\n');

  if (!PRINTER_IP) {
    console.log('\n🧾 RECEIPT (would print):\n' + output + '\n');
    return;
  }

  try {
    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: `tcp://${PRINTER_IP}`,
    });
    printer.alignCenter();
    printer.bold(true);
    printer.println(settings.shop_name);
    printer.bold(false);
    if (settings.shop_name_zh) printer.println(settings.shop_name_zh);
    if (settings.address) {
      settings.address.split('\n').forEach((l) => printer.println(l));
    }
    printer.println(`Table ${order.table_number} — Order #${order.id}`);
    printer.println(when);
    printer.drawLine();
    printer.alignLeft();
    items.forEach((i) => {
      const lineTotal = Number(i.price_at_time) * i.qty;
      printer.tableCustom([
        { text: `${i.qty}x ${i.name_snapshot}`, width: 0.7 },
        { text: `RM ${lineTotal.toFixed(2)}`, width: 0.3, align: 'RIGHT' },
      ]);
      if (i.name_zh_snapshot) {
        printer.println(`   ${i.name_zh_snapshot}`);
      }
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
    console.log(`🖨️  Receipt printed for order #${order.id}`);
  } catch (err) {
    console.error('❌ Receipt print failed:', err.message);
  }
}

function row(printer, label, value) {
  printer.tableCustom([
    { text: label, width: 0.5 },
    { text: `RM ${value.toFixed(2)}`, width: 0.5, align: 'RIGHT' },
  ]);
}

// --------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------
async function main() {
  await refreshSettings();

  console.log('🥟 Printer service starting…');
  console.log(`   Shop: ${settings.shop_name}`);
  console.log(
    PRINTER_IP
      ? `   Printer IP: ${PRINTER_IP}`
      : '   No PRINTER_IP set — tickets will be logged to console only'
  );

  supabase
    .channel('printer-orders')
    // Kitchen ticket: any new item lands → schedule a batched print
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'order_items' },
      (payload) => {
        const row = payload.new;
        if (row && row.order_id != null) {
          scheduleKitchenPrint(row.order_id, row.id);
        }
      }
    )
    // Receipt: order becomes paid
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: 'status=eq.paid',
      },
      async (payload) => {
        const orderId = payload.new.id;
        const { order, items } = await fetchOrderWithItems(orderId);
        if (order) await printReceipt(order, items);
      }
    )
    // Live settings updates (shop name, tax %, rounding)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'shop_settings' },
      () => refreshSettings()
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ Subscribed. Waiting for orders…\n');
      }
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
