// Bar Order Ticket.  Beverages only — bartenders don't need the food lines, so
// if an item carries a category snapshot it's filtered out when category !==
// 'drinks' (station-based routing in index.js already does this; the extra
// filter here is a belt-and-braces guard in case a mixed job slips through).
//
// Prices are deliberately omitted — the kitchen/bar tickets never show money.
// Entry shapes: see receipt.js.

const {
  WIDTH, DEFAULT_TZ, twoCol, wrap,
  fmtTime, ticketNumber,
} = require('./format');

// Modifier bullets for drinks: *** MOD: EXTRA ICE ***, with "- NOTE" for free
// text notes (per the mockup).  Add-on / temp aren't typical for drinks.
// Same 4-space gutter as kitchen.js — see the note there.
const GUTTER = '    ';

function modifierLine(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  return `${GUTTER}*** MOD: ${text.toUpperCase()} ***`;
}

function noteLine(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  return `${GUTTER}- ${text.toUpperCase()}`;
}

function isDrink(item) {
  // Items we route to the bar either carry explicit category 'drinks' or no
  // category snapshot at all (older rows).  Keep the latter so historical
  // orders still print.
  if (!item || !item.category) return true;
  return String(item.category).toLowerCase() === 'drinks';
}

function build(data) {
  const {
    order = {},
    items = [],
    tz = DEFAULT_TZ,
    now = new Date(),
    stationLabel = 'BAR',
    headerLabel = '[BAR ORDER]',
  } = data || {};

  const drinks = items.filter(isDrink);
  const out = [];

  // --- Header strip -------------------------------------------------------
  out.push({ rule: '=' });
  out.push({ text: twoCol(headerLabel, `TICKET #: ${ticketNumber(order.id)}`, WIDTH), bold: true });
  out.push({ rule: '-' });

  const table   = order.tableLabel || (order.table != null ? `T-${order.table}` : '-');
  const orderType = order.type || 'Dine-In';
  const timeStr = fmtTime(now, tz);
  const server  = order.server || '-';

  out.push(twoCol(`TABLE: ${table}`, `ORDER: ${orderType}`, WIDTH));
  out.push(twoCol(`TIME: ${timeStr}`, `SERVER: ${server}`, WIDTH));
  out.push({ rule: '=' });
  out.push({ feed: 1 });

  // --- Drinks -------------------------------------------------------------
  let totalDrinks = 0;
  drinks.forEach((it, idx) => {
    const qty = Number(it.qty ?? 1) || 1;
    totalDrinks += qty;
    const name = String(it.name || '').toUpperCase();
    const header = `[${qty}] ${name}`;
    const wrapped = wrap(header, WIDTH);
    out.push({ text: wrapped[0], bold: true });
    for (const l of wrapped.slice(1)) out.push({ text: '    ' + l, bold: true });

    if (it.options) {
      for (const p of String(it.options).split(/,|\n/)) {
        const l = modifierLine(p);
        if (l) out.push({ text: l, bold: true });
      }
    }
    if (it.note) {
      const l = noteLine(it.note);
      if (l) out.push(l);
    }

    if (idx < drinks.length - 1) out.push({ feed: 1 });
  });

  // --- Footer -------------------------------------------------------------
  out.push({ feed: 1 });
  out.push({ rule: '=' });
  out.push(twoCol(`Total Drinks: ${totalDrinks}`, `Station: ${String(stationLabel).toUpperCase()}`, WIDTH));
  out.push({ rule: '=' });

  out.push({ feed: 3 });
  out.push({ cut: true });

  return out;
}

module.exports = { build, modifierLine, noteLine, isDrink };
