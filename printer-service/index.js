// Printer service — runs continuously on a Raspberry Pi or the counter mini-PC.
// Subscribes to new orders via Supabase Realtime, prints them on a thermal printer.
// If PRINTER_IP is not set, logs the ticket to the console instead (useful for
// developing without hardware).

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const PRINTER_IP = process.env.PRINTER_IP; // e.g. "192.168.1.87"
const SHOP_NAME = process.env.SHOP_NAME || 'DIM SUM SHOP';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function fetchOrder(orderId) {
  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();
  const { data: items } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId);
  return { order, items: items ?? [] };
}

// Print (or log) a KITCHEN ticket — big, no prices, just what to cook
async function printKitchenTicket(order, items) {
  const lines = [];
  lines.push('===================================');
  lines.push(`   TABLE ${order.table_number}   Order #${order.id}`);
  lines.push('===================================');
  lines.push(new Date(order.created_at).toLocaleTimeString('en-MY'));
  lines.push('-----------------------------------');
  items.forEach((i) => {
    lines.push(`  ${i.qty}x  ${i.name_snapshot}`);
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
    printer.println(new Date(order.created_at).toLocaleTimeString('en-MY'));
    printer.drawLine();
    printer.alignLeft();
    printer.setTextSize(1, 1);
    items.forEach((i) => {
      printer.println(`${i.qty}x  ${i.name_snapshot}`);
    });
    printer.setTextNormal();
    printer.cut();
    await printer.execute();
    console.log(`🖨️  Printed kitchen ticket for order #${order.id}`);
  } catch (err) {
    console.error('❌ Kitchen print failed:', err.message);
  }
}

// Print (or log) a CUSTOMER RECEIPT — with prices, total, tax
async function printReceipt(order, items) {
  const total = Number(order.total);
  const lines = [];
  lines.push('===================================');
  lines.push(`         ${SHOP_NAME}`);
  lines.push('===================================');
  lines.push(`Table ${order.table_number}   Order #${order.id}`);
  lines.push(new Date().toLocaleString('en-MY'));
  lines.push('-----------------------------------');
  items.forEach((i) => {
    const lineTotal = Number(i.price_at_time) * i.qty;
    lines.push(
      `${i.qty}x ${i.name_snapshot.padEnd(20)} RM ${lineTotal.toFixed(2)}`
    );
  });
  lines.push('-----------------------------------');
  lines.push(`TOTAL:                  RM ${total.toFixed(2)}`);
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
    printer.println(SHOP_NAME);
    printer.bold(false);
    printer.println(`Table ${order.table_number} — Order #${order.id}`);
    printer.println(new Date().toLocaleString('en-MY'));
    printer.drawLine();
    printer.alignLeft();
    items.forEach((i) => {
      const lineTotal = Number(i.price_at_time) * i.qty;
      printer.tableCustom([
        { text: `${i.qty}x ${i.name_snapshot}`, width: 0.7 },
        { text: `RM ${lineTotal.toFixed(2)}`, width: 0.3, align: 'RIGHT' },
      ]);
    });
    printer.drawLine();
    printer.bold(true);
    printer.tableCustom([
      { text: 'TOTAL', width: 0.5 },
      { text: `RM ${total.toFixed(2)}`, width: 0.5, align: 'RIGHT' },
    ]);
    printer.bold(false);
    printer.println(`Method: ${order.payment_method || 'cash'}`);
    printer.drawLine();
    printer.alignCenter();
    printer.println('Thank you — 多謝');
    printer.cut();
    await printer.execute();
    console.log(`🖨️  Printed receipt for order #${order.id}`);
  } catch (err) {
    console.error('❌ Receipt print failed:', err.message);
  }
}

console.log('🥟 Printer service starting…');
console.log(
  PRINTER_IP
    ? `   Printer IP: ${PRINTER_IP}`
    : '   No PRINTER_IP set — tickets will be logged to console only'
);

// Subscribe to new orders → kitchen ticket
supabase
  .channel('printer-orders')
  .on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'orders' },
    async (payload) => {
      const orderId = payload.new.id;
      // small delay so the child order_items rows land before we query
      await new Promise((r) => setTimeout(r, 500));
      const { order, items } = await fetchOrder(orderId);
      if (order && items.length > 0) {
        await printKitchenTicket(order, items);
      }
    }
  )
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
      const { order, items } = await fetchOrder(orderId);
      if (order) {
        await printReceipt(order, items);
      }
    }
  )
  .subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      console.log('✅ Subscribed to new orders. Waiting…\n');
    }
  });

process.on('SIGINT', () => {
  console.log('\n👋 Printer service stopping.');
  process.exit(0);
});
