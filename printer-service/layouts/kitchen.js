// Kitchen Order Ticket (back of house).  Drives any food prep station —
// GRILL, STEAM, FRY, DIM SUM — distinguished by `stationLabel`.  Bar is a
// separate layout (bar.js) because bartenders filter by drink category.
//
// Entry shapes: see receipt.js.  Modifier lines use three visually distinct
// prefixes so a line cook can scan the ticket at a glance:
//
//   *** TEMP: MEDIUM RARE ***     — temperature / doneness
//   + EXTRA CHEDDAR CHEESE        — add-on
//   *** MOD: NO RICE -> SUB … *** — swap or any other modification
//
// On the real printer the driver wraps these with BOLD_ON / BOLD_OFF; here we
// emit the plain-text form so the fallback and the tests stay byte-exact.

const {
  WIDTH, DEFAULT_TZ, twoCol, wrap,
  fmtTime, ticketNumber,
} = require('./format');

const TEMP_RE = /^(temp|doneness|cook)\s*[:\-]\s*(.+)$/i;
const SWAP_RE = /->|=>|\bswap\b|\bsub(?:stitute)?\b|\bno\b.+\binstead\b/i;
const ADDON_RE = /^(\+|add|extra)\s*[:\-]?\s*(.+)$/i;

// Classify a modifier string so the kitchen gets the right visual treatment.
// Returns a prefixed line already indented to the mockup's 6-space gutter.
// 4-space gutter (not 5): on 42-col paper, "    *** MOD: NO RICE -> SUB SIDE
// SALAD ***" fits exactly; a 5-space gutter spills to 43 on the mockup's
// longest modifier.  All three bullet styles use the same gutter so items
// line up vertically.
const GUTTER = '    ';

function modifierLine(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  let m;
  if ((m = TEMP_RE.exec(text))) {
    return `${GUTTER}*** TEMP: ${m[2].toUpperCase()} ***`;
  }
  if ((m = ADDON_RE.exec(text))) {
    // Drop any trailing upcharge "(+1.50)" — the kitchen doesn't need money.
    const body = m[2].replace(/\s*\(\+?[^)]+\)\s*$/, '').trim();
    return `${GUTTER}+ ${body.toUpperCase()}`;
  }
  if (SWAP_RE.test(text)) {
    const body = text.replace(/\s*\(\+?[^)]+\)\s*$/, '').trim();
    return `${GUTTER}*** MOD: ${body.toUpperCase()} ***`;
  }
  // Fallback: still highlight it so the cook doesn't miss it.
  return `${GUTTER}*** MOD: ${text.toUpperCase()} ***`;
}

// Pull modifier strings out of options (comma-separated) and note.
function modifiersOf(item) {
  const out = [];
  if (item && item.options) {
    for (const p of String(item.options).split(/,|\n/)) {
      const line = modifierLine(p);
      if (line) out.push(line);
    }
  }
  if (item && item.note) {
    const line = modifierLine(item.note);
    if (line) out.push(line);
  }
  return out;
}

function build(data) {
  const {
    station = 'KITCHEN',
    stationLabel = 'GRILL',
    order = {},
    items = [],
    tz = DEFAULT_TZ,
    now = new Date(),
    headerLabel = '[KITCHEN TICKET]',
  } = data || {};

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

  // --- Items --------------------------------------------------------------
  let total = 0;
  items.forEach((it, idx) => {
    const qty = Number(it.qty ?? 1) || 1;
    total += qty;
    const name = String(it.name || '').toUpperCase();
    // "[1] CLASSIC WAGYU BURGER" — hard-wrap long names at WIDTH so a
    // 40-char dish still fits a single column.
    const header = `[${qty}] ${name}`;
    const wrapped = wrap(header, WIDTH);
    out.push({ text: wrapped[0], bold: true });
    for (const l of wrapped.slice(1)) out.push({ text: '    ' + l, bold: true });

    for (const l of modifiersOf(it)) out.push({ text: l, bold: true });
    // Blank line between items for scanability — mirrors the mockup.
    if (idx < items.length - 1) out.push({ feed: 1 });
  });

  // --- Footer -------------------------------------------------------------
  out.push({ feed: 1 });
  out.push({ rule: '=' });
  out.push(twoCol(`Total Items: ${total}`, `Station: ${String(stationLabel).toUpperCase()}`, WIDTH));
  out.push({ rule: '=' });

  out.push({ feed: 3 });
  out.push({ cut: true });

  return out;
}

module.exports = { build, modifierLine };
