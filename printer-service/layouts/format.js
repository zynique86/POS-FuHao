// Shared formatting helpers for the three ticket layouts (receipt, kitchen,
// bar).  The single source of truth for the printable column width lives
// here as WIDTH — change it in one place and every layout follows.
//
// Why 42?  Most 80mm ESC/POS printers at Font A render 48 columns, but a
// slightly off-centre paper feed or a non-standard printer eats a few columns
// at each edge.  42 gives a 3-column safety margin on each side so every
// mockup renders without wrapping on any 80mm hardware we've seen.
//
// Honors the same RECEIPT_WIDTH env var index.js/drivers use, so a narrower
// printer configured there doesn't get layouts hardcoded to 42 anyway.
const WIDTH = Number(process.env.RECEIPT_WIDTH) || 42;

// A full-width horizontal rule of `char` (defaults to '-').
function line(char = '-', w = WIDTH) {
  const c = String(char || '-').charAt(0) || '-';
  return c.repeat(w);
}

// Centre a single-line string inside `w` columns.  Strings longer than `w`
// are returned verbatim — call wrap() first if you need multi-line centring.
function centre(text, w = WIDTH) {
  const t = String(text ?? '');
  if (t.length >= w) return t;
  const pad = Math.floor((w - t.length) / 2);
  return ' '.repeat(pad) + t;
}

// Left + right columns on one row, padded with spaces so the right value sits
// flush against the right margin.  When they can't both fit on one row the
// right value wins the right edge and the left value is truncated with "…".
function twoCol(left, right, w = WIDTH) {
  const l = String(left ?? '');
  const r = String(right ?? '');
  if (l.length + 1 + r.length <= w) {
    return l + ' '.repeat(w - l.length - r.length) + r;
  }
  const roomForLeft = Math.max(0, w - r.length - 2);
  const trimmed = roomForLeft > 0 ? l.slice(0, roomForLeft - 1) + '…' : '';
  return trimmed + ' '.repeat(Math.max(1, w - trimmed.length - r.length)) + r;
}

// Word-wrap plain text at `w` columns.  Returns an array of lines, each of
// length <= w.  Long words that themselves exceed `w` are hard-split so no
// single produced line ever overflows.
function wrap(text, w = WIDTH) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const out = [];
  let line = '';
  for (const word of t.split(' ')) {
    if (word.length > w) {
      if (line) { out.push(line); line = ''; }
      for (let i = 0; i < word.length; i += w) out.push(word.slice(i, i + w));
      continue;
    }
    const candidate = line ? line + ' ' + word : word;
    if (candidate.length > w) {
      out.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) out.push(line);
  return out;
}

// RM is the shop's currency — same formatter the existing receipt uses so a
// mixed cash/change screen reads consistently.  Signed values keep their sign.
function money(value, { currency = 'RM', withSymbol = true } = {}) {
  const n = Number(value) || 0;
  const body = (n < 0 ? '-' : '') + Math.abs(n).toFixed(2);
  return withSymbol ? `${currency} ${body}` : body;
}

// Just the number, e.g. "18.50" — used in the item-price column where the
// section header already labels the unit (PRICE (RM)).
function amount(value) {
  return money(value, { withSymbol: false });
}

// Date / time rendered against the shop's business timezone, so a cashier in
// another TZ (travel, SSR) still sees today's date.
const DEFAULT_TZ = 'Asia/Kuala_Lumpur';
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function partsIn(tz, date) {
  const d = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || DEFAULT_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    y: get('year'),
    m: get('month'),
    d: get('day'),
    hh: get('hour') === '24' ? '00' : get('hour'),  // some Intl impls use 24
    mm: get('minute'),
  };
}

function fmtDate(date, tz = DEFAULT_TZ) {
  const { y, m, d } = partsIn(tz, date);
  return `${d}/${MONTHS[Number(m) - 1] || m}/${y}`;
}

function fmtTime(date, tz = DEFAULT_TZ) {
  const { hh, mm } = partsIn(tz, date);
  return `${hh}:${mm}`;
}

// YYYYMMDD-NNNN receipt number — the business-day prefix lets the receipt
// read as an invoice while the order id stays monotonic across days.
function receiptNumber(orderId, date, tz = DEFAULT_TZ) {
  const { y, m, d } = partsIn(tz, date);
  const n = String(orderId == null ? 0 : orderId).padStart(4, '0');
  return `${y}${m}${d}-${n}`;
}

// Zero-pad for the kitchen/bar `TICKET #: #NNNN` headers.
function ticketNumber(orderId) {
  return `#${String(orderId == null ? 0 : orderId).padStart(4, '0')}`;
}

// Returns the string body of an entry (whatever its shape) so the width
// assertion and the console preview can treat them uniformly.
function entryText(entry) {
  if (entry == null) return '';
  if (typeof entry === 'string') return entry;
  if (entry.rule) return line(entry.rule);
  if (entry.feed != null) return '';
  if (entry.cut) return '';
  return String(entry.text ?? '');
}

// Fail-loud guard the tests use to prove every line fits the paper.  Returns
// the entries so it chains in a test one-liner.
function assertWidth(entries, w = WIDTH) {
  const arr = Array.isArray(entries) ? entries : [entries];
  for (const e of arr) {
    const text = entryText(e);
    if (text.length > w) {
      throw new Error(
        `layout line exceeds ${w} cols (len=${text.length}): ${JSON.stringify(text)}`
      );
    }
  }
  return arr;
}

module.exports = {
  WIDTH,
  DEFAULT_TZ,
  line,
  centre,
  twoCol,
  wrap,
  money,
  amount,
  fmtDate,
  fmtTime,
  receiptNumber,
  ticketNumber,
  entryText,
  assertWidth,
};
