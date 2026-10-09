// Customer receipt (front-of-house) layout.
//
// Returns an array of entries that the driver renders to the printer or dumps
// to stdout for preview.  An entry is one of:
//   - a plain string           → single left-aligned line (length <= WIDTH)
//   - { text, bold, align }    → one formatted line (align: 'left'|'center'|'right')
//   - { rule: '=' | '-' }      → a full-width horizontal rule
//   - { feed: n }              → n blank lines
//   - { cut: true }            → paper cut
//
// All strings have length <= WIDTH, enforced by assertWidth() in the tests.

const {
  WIDTH, DEFAULT_TZ, line, centre, twoCol, wrap,
  money, amount, fmtDate, fmtTime, receiptNumber,
} = require('./format');

function hasText(s) {
  return s != null && String(s).trim() !== '';
}

// Render one item block: price-bearing line + modifier lines indented with "-".
// A modifier may carry an upcharge in parentheses, e.g. "Extra Cheese (+1.50)".
function itemLines(item) {
  const qty = String(item.qty ?? 1);
  // "QTY  ITEM"  → 2-char qty column, 2-space gap, then name.
  const left = `${qty.padStart(2, ' ')}   ${item.name ?? ''}`;
  const right = amount(Number(item.priceAtTime ?? 0) * Number(item.qty ?? 1));
  const out = [twoCol(left, right, WIDTH)];
  for (const mod of modifiersOf(item)) out.push(`     - ${mod.text}`);
  if (hasText(item.note)) out.push(`     - ${item.note}`);
  return out;
}

// Normalise item.options into [{text}] with upcharge glued on, so the layout
// does not have to care whether the shop stores modifiers as a plain comma
// string ("Medium Rare, Extra Cheese") or already prefixed ("+Extra Cheese").
function modifiersOf(item) {
  if (!item || !item.options) return [];
  const raw = String(item.options);
  const parts = raw.split(/,|\n/).map((s) => s.trim()).filter(Boolean);
  return parts.map((p) => {
    // Strip a leading "+" or "- " waiter-ism so the display stays uniform;
    // the printed "-" bullet is added by itemLines() above.
    let text = p.replace(/^\+\s*/, '').replace(/^-\s*/, '').trim();
    return { text };
  });
}

// Right-aligned totals block (mockup columns ~14..42) — label on the left of
// the block, amount flush to the right margin.  The 14-column prefix is just
// visual: the whole block is wrapped by twoCol so it still fits WIDTH.
function totalsRow(label, value) {
  return twoCol(' '.repeat(14) + label + ':', money(value), WIDTH);
}

// A full-width payment line, "Label:   RM X.XX" — reads flush left to balance
// the right-aligned totals above it.
function payLine(label, value) {
  const l = (label + ':').padEnd(14);
  return l + money(value);
}

function build(data) {
  const {
    shop = {},
    order = {},
    items = [],
    totals = {},
    payment = {},
    footer = {},
    tz = DEFAULT_TZ,
    now = new Date(),
    isReprint = false,
  } = data || {};

  const out = [];

  // --- Header -------------------------------------------------------------
  out.push({ rule: '=' });
  for (const l of wrap(shop.name || 'SHOP', WIDTH)) {
    out.push({ text: centre(l, WIDTH), bold: true });
  }
  if (hasText(shop.nameZh)) {
    for (const l of wrap(shop.nameZh, WIDTH)) out.push(centre(l, WIDTH));
  }
  for (const addr of (shop.addressLines || []).filter(hasText)) {
    for (const l of wrap(addr, WIDTH)) out.push(centre(l, WIDTH));
  }
  if (hasText(shop.phone))  out.push(centre(`Tel: ${shop.phone}`, WIDTH));
  if (hasText(shop.taxId))  out.push(centre(`GST/Tax ID: ${shop.taxId}`, WIDTH));
  if (isReprint)            out.push(centre('*** REPRINT ***', WIDTH));
  out.push({ rule: '=' });
  out.push({ feed: 1 });

  // --- Metadata strip (date/time, receipt#/order-type, server/table) ------
  const dateStr = fmtDate(now, tz);
  const timeStr = fmtTime(now, tz);
  const rcpt    = receiptNumber(order.id, now, tz);
  const orderType = order.type || 'Dine-In';
  const table   = order.tableLabel || (order.table != null ? `T-${order.table}` : '-');
  const server  = order.server || '-';

  out.push(twoCol(`Date: ${dateStr}`, `Time: ${timeStr}`, WIDTH));
  // "Order Type:" is the mockup wording, but 24-char receipt# + the full
  // label pushes past WIDTH on 80mm; abbreviate to "Order:" so a 4-digit
  // id still fits with margin to spare.
  out.push(twoCol(`Receipt #: ${rcpt}`, `Order: ${orderType}`, WIDTH));
  out.push(twoCol(`Server: ${server}`, `Table: ${table}`, WIDTH));
  out.push({ rule: '-' });

  // --- Item column header -------------------------------------------------
  out.push({ text: twoCol('QTY  ITEM', 'PRICE (RM)', WIDTH), bold: true });
  out.push({ rule: '-' });

  for (const it of items) {
    for (const l of itemLines(it)) out.push(l);
  }

  out.push({ rule: '-' });

  // --- Totals block (right-aligned) ---------------------------------------
  const subtotal = Number(totals.subtotal) || 0;
  const svc      = Number(totals.serviceCharge) || 0;
  const svcPct   = totals.serviceChargePct;
  const tax      = Number(totals.tax) || 0;
  const taxPct   = totals.taxPct;
  const discount = Number(totals.discount) || 0;
  const rounding = Number(totals.rounding) || 0;
  const total    = Number(totals.total) || 0;

  out.push(totalsRow('SUBTOTAL', subtotal));
  if (svc > 0) {
    const label = svcPct ? `Svc Charge (${svcPct}%)` : 'Svc Charge';
    out.push(totalsRow(label, svc));
  }
  if (tax > 0) {
    const label = taxPct ? `SST / Tax (${taxPct}%)` : 'SST / Tax';
    out.push(totalsRow(label, tax));
  }
  if (discount > 0) {
    const label = totals.discountReason
      ? `Discount (${totals.discountReason})`
      : 'Discount';
    out.push(totalsRow(label, -discount));
  }
  if (rounding !== 0) out.push(totalsRow('Rounding', rounding));
  // Underline above TOTAL — a short dashes rule inside the right block.
  out.push(' '.repeat(14) + '-'.repeat(WIDTH - 14));
  out.push({ text: totalsRow('TOTAL', total), bold: true });
  out.push({ feed: 1 });

  // --- Payment block (left-aligned) ---------------------------------------
  if (payment.method) {
    const label = payment.detail
      ? `Payment Method: ${payment.method} ${payment.detail}`
      : `Payment Method: ${payment.method}`;
    // Wrap long card detail lines so they never clip at the right margin.
    for (const l of wrap(label, WIDTH)) out.push(l);
  }
  if (payment.amountPaid != null) out.push(payLine('Amount Paid',  payment.amountPaid));
  if (payment.changeDue != null)  out.push(payLine('Change Due',   payment.changeDue));

  // --- Footer -------------------------------------------------------------
  out.push({ rule: '-' });
  if (hasText(footer.wifiSsid)) {
    const wifi = hasText(footer.wifiPassword)
      ? `Wifi: ${footer.wifiSsid} / Pass: ${footer.wifiPassword}`
      : `Wifi: ${footer.wifiSsid}`;
    for (const l of wrap(wifi, WIDTH)) out.push(centre(l, WIDTH));
  }
  out.push(centre(footer.thankYou || 'Thank you for dining with us!', WIDTH));
  out.push(centre(footer.comeAgain || 'Please Come Again Soon', WIDTH));
  out.push({ rule: '=' });

  out.push({ feed: 3 });
  out.push({ cut: true });

  return out;
}

module.exports = { build };
