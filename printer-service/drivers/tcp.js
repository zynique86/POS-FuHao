// TCP driver — talks to an 80mm thermal printer over the network (port 9100)
// using node-thermal-printer. The whole node-thermal-printer surface — plus
// the quirks that come with it (socket timeouts, CJK via GB18030, retry on
// transient failures) — is kept inside this file so the rest of the service
// never imports node-thermal-printer directly. To add a USB or Bluetooth
// transport later, write a sibling file exposing the same methods.
//
// Shape returned by create():
//   { printOrderSummary, printVoid, printRefund,
//     printLayout, openDrawer, status }
//
// Config:
//   { transport: 'tcp', ip, station, width, printChinese, timeout, preorderPhones }
//
// If `ip` is missing, every method falls back to a labelled console log of
// what would have been printed — handy for development without hardware.

const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');
const iconv = require('iconv-lite');
const format = require('../layouts/format');

const CJK_REGEX = /[㐀-鿿豈-﫿]/;
const FS_AND    = Buffer.from([0x1C, 0x26]);  // enter Kanji mode
const FS_DOT    = Buffer.from([0x1C, 0x2E]);  // exit Kanji mode
const LF        = Buffer.from([0x0A]);
const CJK_STRIP = /[⺀-鿿豈-﫿＀-￯]/g;

const IGNORED_MESSAGES = ['Socket timeout', 'ECONNREFUSED', 'EHOSTUNREACH', 'ETIMEDOUT'];
function isNetError(err) {
  const msg = (err && err.message) ? String(err.message) : String(err || '');
  return IGNORED_MESSAGES.some((s) => msg.includes(s));
}

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

function money(v) {
  const n = Number(v) || 0;
  return (n < 0 ? '-' : '') + Math.abs(n).toFixed(2);
}

function padRow(left, right, width) {
  const l = String(left);
  const r = String(right);
  const gap = Math.max(1, width - l.length - r.length);
  return l + ' '.repeat(gap) + r;
}

function centerText(s, width) {
  const t = String(s);
  if (t.length >= width) return t;
  return ' '.repeat(Math.floor((width - t.length) / 2)) + t;
}

function stationLabel(station) {
  return station === 'kitchen' ? '📄 KITCHEN'
       : station === 'bar'     ? '🫖 BAR'
       : station === 'cashier' ? '🧾 CASHIER'
       : `📦 ${String(station || 'unknown').toUpperCase()}`;
}

function create(config) {
  const {
    ip,
    station = 'unknown',
    width = 42,
    printChinese = false,
    timeout = 15000,
    preorderPhones = [],
  } = config || {};

  function makePrinter() {
    if (!ip) return null;
    return new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: `tcp://${ip}:9100`,
      characterSet: 'PC437_USA',
      removeSpecialCharacters: false,
      lineCharacter: '-',
      width,
      options: { timeout },
    });
  }

  async function executeWithRetry(printer, label) {
    try {
      await printer.execute();
    } catch (err) {
      const msg = (err && err.message) || String(err);
      if (!isNetError({ message: msg })) throw err;
      console.warn(`   ↻ retrying ${label} after ${msg}…`);
      await new Promise((r) => setTimeout(r, 1500));
      await printer.execute();
    }
  }

  // Print one line — CJK is either sent as GB18030 in Kanji mode (when the
  // printer supports it) or stripped so the English stays readable.
  function say(printer, text) {
    if (text == null || text === '') { printer.newLine(); return; }
    const s = String(text);

    if (!printChinese) {
      let ascii = s.replace(CJK_STRIP, '');
      ascii = ascii.replace(/ +([,.;:])/g, '$1');
      ascii = ascii.replace(/(\S) {2,}/g, '$1 ');
      ascii = ascii.replace(/[\s/·|]+$/g, '');
      ascii = ascii.replace(/[ \t]+$/g, '');
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

  function printExtras(printer, item) {
    if (item.options) say(printer, `   - ${item.options}`);
    if (item.note)    say(printer, `   - ${item.note}`);
  }

  // Feed before cutting — the head sits above the cutter and the last line
  // ends up in that gap otherwise.
  function finish(printer) {
    for (let i = 0; i < 5; i++) printer.newLine();
    printer.cut();
  }

  function consoleFallback(kind, lines) {
    console.log(`\n${stationLabel(station)} · ${kind.toUpperCase()} (would print — no IP configured):\n` + lines.join('\n') + '\n');
  }

  // ---------- CUSTOMER COPY (no prices) -------------------------------------
  async function printOrderSummary(summary) {
    const { shopName, shopNameZh, tableNumber, orderId, when, takenByName, items } = summary;
    const lines = [
      centerText(shopName, width),
      ...(hasRealName(shopNameZh) ? [centerText(shopNameZh, width)] : []),
      centerText('CUSTOMER COPY / 顧客聯', width),
      '-'.repeat(width),
      padRow(`Table ${tableNumber}`, `Order #${orderId}`, width),
      when,
      '-'.repeat(width),
    ];
    items.forEach((i) => {
      lines.push(`${i.qty} x ${i.name}`);
      if (hasRealName(i.nameZh)) lines.push(`   ${i.nameZh}`);
      if (i.options) lines.push(`   - ${i.options}`);
      if (i.note)    lines.push(`   - ${i.note}`);
    });
    lines.push('-'.repeat(width));
    lines.push(centerText('** NOT A RECEIPT **', width));
    lines.push(centerText('Final bill at cashier', width));

    const printer = makePrinter();
    if (!printer) return consoleFallback('order_summary', lines);

    printer.alignCenter();
    printer.bold(true);
    printer.setTextSize(1, 1);
    say(printer, shopName);
    printer.setTextNormal();
    if (hasRealName(shopNameZh)) say(printer, shopNameZh);
    printer.newLine();
    say(printer, 'CUSTOMER COPY / 顧客聯');
    printer.bold(false);
    printer.drawLine();

    printer.alignLeft();
    printer.leftRight(`Table ${tableNumber}`, `Order #${orderId}`);
    printer.println(when);
    if (hasRealName(takenByName)) printer.println(`Served by: ${takenByName}`);
    printer.drawLine();

    items.forEach((i) => {
      printer.bold(true);
      say(printer, `${i.qty} x ${i.name}`);
      printer.bold(false);
      if (hasRealName(i.nameZh)) say(printer, `   ${i.nameZh}`);
      printExtras(printer, i);
    });

    printer.drawLine();
    printer.alignCenter();
    printer.bold(true);
    say(printer, '** NOT A RECEIPT **');
    printer.bold(false);
    say(printer, 'Final bill at cashier / 賬單以收銀為準');
    finish(printer);

    await executeWithRetry(printer, `customer copy`);
  }

  // ---------- VOID ---------------------------------------------------------
  async function printVoid(ticket) {
    const { time, orderId, qty, name, nameZh, reason } = ticket;
    const lines = [
      '###################################',
      '            *** VOID ***',
      '###################################',
      time,
      `Order #${orderId}`,
      `${qty}x  ${name}`,
      ...(hasRealName(nameZh) ? [`     ${nameZh}`] : []),
      `Reason: ${reason}`,
      '###################################',
    ];

    const printer = makePrinter();
    if (!printer) return consoleFallback('void', lines);

    printer.alignCenter();
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println('*** VOID ***');
    printer.setTextNormal();
    printer.bold(false);
    printer.println(time);
    printer.println(`Order #${orderId}`);
    printer.drawLine();
    say(printer, `${qty}x  ${name}`);
    if (hasRealName(nameZh)) say(printer, `     ${nameZh}`);
    say(printer, `Reason: ${reason}`);
    finish(printer);
    await executeWithRetry(printer, `void ticket`);
  }

  // ---------- REFUND -------------------------------------------------------
  async function printRefund(ticket) {
    const { when, orderId, amount, method, reason, by } = ticket;
    const lines = [
      '###################################',
      '           *** REFUND ***',
      '###################################',
      when,
      `Order #${orderId}`,
      `Amount refunded:   RM ${Number(amount).toFixed(2)}`,
      `Original method:   ${method || 'cash'}`,
      `Reason: ${reason}`,
      `By: ${by}`,
      '###################################',
    ];

    const printer = makePrinter();
    if (!printer) return consoleFallback('refund', lines);

    printer.alignCenter();
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println('*** REFUND ***');
    printer.setTextNormal();
    printer.bold(false);
    printer.println(when);
    printer.println(`Order #${orderId}`);
    printer.drawLine();
    printer.alignLeft();
    printer.tableCustom([
      { text: 'Amount refunded', width: 0.5 },
      { text: `RM ${Number(amount).toFixed(2)}`, width: 0.5, align: 'RIGHT' },
    ]);
    printer.println(`Method: ${method || 'cash'}`);
    say(printer, `Reason: ${reason}`);
    say(printer, `By: ${by}`);
    printer.drawLine();
    finish(printer);
    await executeWithRetry(printer, `refund slip`);
  }

  // ---------- GENERIC LAYOUT RENDERER --------------------------------------
  // Takes an array of entries (see printer-service/layouts/receipt.js for the
  // contract) and plays them against node-thermal-printer.  All ticket-shape
  // decisions live in the pure layouts; this method is the only place the
  // ESC/POS plumbing (bold, align, feed, cut) touches the hardware.
  async function printLayout(entries, label = 'ticket') {
    const list = Array.isArray(entries) ? entries : [];
    const printer = makePrinter();
    if (!printer) {
      const lines = list.map((e) => format.entryText(e));
      return consoleFallback(label, lines);
    }
    for (const e of list) renderEntry(printer, e);
    await executeWithRetry(printer, label);
  }

  function renderEntry(printer, e) {
    if (e == null) return;
    if (typeof e === 'string') {
      printer.alignLeft();
      say(printer, e);
      return;
    }
    if (e.rule) { printer.alignLeft(); printer.println(format.line(e.rule, width)); return; }
    if (e.feed != null) { for (let i = 0; i < Number(e.feed) || 0; i++) printer.newLine(); return; }
    if (e.cut) { printer.cut(); return; }
    if (e.align === 'center') printer.alignCenter();
    else if (e.align === 'right') printer.alignRight();
    else printer.alignLeft();
    if (e.bold)   printer.bold(true);
    if (e.double) printer.setTextSize(1, 1);
    say(printer, String(e.text ?? ''));
    if (e.double) printer.setTextNormal();
    if (e.bold)   printer.bold(false);
  }

  // ---------- DRAWER / STATUS ----------------------------------------------
  async function openDrawer() {
    const printer = makePrinter();
    if (!printer) {
      console.log(`${stationLabel(station)} openDrawer (no IP configured)`);
      return;
    }
    printer.openCashDrawer();
    await executeWithRetry(printer, `open drawer`);
  }

  async function status() {
    if (!ip) return { ok: false, reason: 'no-ip', station };
    const printer = makePrinter();
    try {
      const connected = await printer.isPrinterConnected();
      return { ok: !!connected, station, ip };
    } catch (err) {
      return { ok: false, station, ip, reason: (err && err.message) || String(err) };
    }
  }

  return {
    printOrderSummary,
    printVoid,
    printRefund,
    printLayout,
    openDrawer,
    status,
  };
}

module.exports = { create, isNetError };
