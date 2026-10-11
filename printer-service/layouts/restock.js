// Restock Request ticket — "front counter ran out of X, kitchen please make
// more." Deliberately laid out the same way as the kitchen order voucher
// (kitchen.js) — same header strip, same bold item block, same footer rule —
// so a cook who reads kitchen tickets all day recognises a restock slip at a
// glance instead of learning a second ticket style.
//
// Entry shapes: see receipt.js.

const {
  WIDTH, DEFAULT_TZ, twoCol, wrap,
  fmtTime, ticketNumber,
} = require('./format');

function hasText(s) {
  return s != null && String(s).trim() !== '';
}

function build(data) {
  const {
    stationLabel = 'KITCHEN',
    headerLabel = '[RESTOCK REQUEST]',
    request = {},
    tz = DEFAULT_TZ,
    now = new Date(),
  } = data || {};

  const { id, name = '', nameZh, qty, note, by } = request;

  const out = [];

  // --- Header strip --------------------------------------------------------
  out.push({ rule: '=' });
  out.push({ text: twoCol(headerLabel, `TICKET #: ${ticketNumber(id)}`, WIDTH), bold: true });
  out.push({ rule: '-' });

  const timeStr = fmtTime(now, tz);
  out.push(twoCol(`TIME: ${timeStr}`, `BY: ${by || '-'}`, WIDTH));
  out.push({ rule: '=' });
  out.push({ feed: 1 });

  // --- Item ------------------------------------------------------------------
  const header = `[${qty != null ? qty : '?'}] ${String(name).toUpperCase()}`;
  const wrapped = wrap(header, WIDTH);
  out.push({ text: wrapped[0], bold: true });
  for (const l of wrapped.slice(1)) out.push({ text: '    ' + l, bold: true });

  if (hasText(nameZh)) {
    for (const l of wrap(String(nameZh), WIDTH - 4)) out.push({ text: '    ' + l });
  }
  if (hasText(note)) {
    for (const l of wrap(`NOTE: ${String(note).toUpperCase()}`, WIDTH - 4)) {
      out.push({ text: '    ' + l, bold: true });
    }
  }

  // --- Footer -------------------------------------------------------------
  out.push({ feed: 1 });
  out.push({ rule: '=' });
  out.push(twoCol('RESTOCK', `Station: ${String(stationLabel).toUpperCase()}`, WIDTH));
  out.push({ rule: '=' });

  out.push({ feed: 3 });
  out.push({ cut: true });

  return out;
}

module.exports = { build };
