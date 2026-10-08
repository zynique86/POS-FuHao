// Unit tests for pure helpers exposed by the printer service.
// No Supabase, no printer — we pass in a fake printer that records calls.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const service = require('../index');
const { say, hasRealName, stationForCategory } = service;

function fakePrinter() {
  const calls = [];
  return {
    calls,
    println: (s) => calls.push(['println', s]),
    newLine: () => calls.push(['newLine']),
    raw: (b) => calls.push(['raw', b]),
    bold: () => {},
    tableCustom: () => {},
    cut: () => {},
  };
}

// ---------------------------------------------------------------------------
// hasRealName — guards the "optional Chinese name / shop name" lines so they
// are only printed when there is something readable to print.
// ---------------------------------------------------------------------------

test('hasRealName accepts a plain string with letters or digits', () => {
  assert.equal(hasRealName('Har Gow'), true);
  assert.equal(hasRealName('點心'), true);
  assert.equal(hasRealName('Table 7'), true);
});

test('hasRealName rejects empty / nullish / whitespace-only values', () => {
  assert.equal(hasRealName(null), false);
  assert.equal(hasRealName(undefined), false);
  assert.equal(hasRealName(''), false);
  assert.equal(hasRealName('   '), false);
  assert.equal(hasRealName('\t\n'), false);
});

test('hasRealName rejects known placeholder tokens', () => {
  for (const p of ['0', '-', 'N/A', 'na', 'NA', 'null', 'undefined', 'Null', 'UNDEFINED']) {
    assert.equal(hasRealName(p), false, `placeholder: ${p}`);
  }
});

test('hasRealName rejects all-punctuation strings', () => {
  assert.equal(hasRealName('---'), false);
  assert.equal(hasRealName('...'), false);
  assert.equal(hasRealName('——'), false);
});

test('hasRealName accepts a non-string that stringifies to something real', () => {
  assert.equal(hasRealName(5), true);
  assert.equal(hasRealName(0), false); // "0" is a placeholder
});

// ---------------------------------------------------------------------------
// say — prints a line; by default strips Chinese so budget printers that
// cannot render GB18030 still produce readable English.
// ---------------------------------------------------------------------------
// All these cases run with PRINT_CHINESE unset (the default), which is what
// production uses.

test('say prints a plain English line verbatim', () => {
  const p = fakePrinter();
  say(p, 'Table 7');
  assert.deepEqual(p.calls, [['println', 'Table 7']]);
});

test('say emits a blank newLine for empty / nullish input', () => {
  const p = fakePrinter();
  say(p, '');
  say(p, null);
  say(p, undefined);
  assert.deepEqual(p.calls, [['newLine'], ['newLine'], ['newLine']]);
});

test('say strips Chinese and keeps the English alongside it', () => {
  const p = fakePrinter();
  say(p, 'No chilli 不辣');
  // The CJK is removed and the trailing space is trimmed.
  assert.deepEqual(p.calls, [['println', 'No chilli']]);
});

test('say drops the line entirely when nothing readable remains after stripping', () => {
  const p = fakePrinter();
  say(p, '點心');
  // Pure Chinese line → nothing to print, no newLine either (it is a drop,
  // not a blank line).
  assert.deepEqual(p.calls, []);
});

test('say tidies punctuation left behind by a stripped Chinese tail', () => {
  const p = fakePrinter();
  say(p, 'ALL DONE / 完成');
  // The "/ 完成" tail collapses: trailing separators and spaces are removed.
  assert.deepEqual(p.calls, [['println', 'ALL DONE']]);
});

// ---------------------------------------------------------------------------
// stationForCategory — mirror of lib/types.ts, must stay in sync.
// ---------------------------------------------------------------------------

test('printer-service stationForCategory routes the same way as lib/types.ts', () => {
  assert.equal(stationForCategory('noodles'), 'kitchen');
  assert.equal(stationForCategory('rice'), 'kitchen');
  assert.equal(stationForCategory('drinks'), 'bar');
  assert.equal(stationForCategory('dim sum'), 'cashier');
  assert.equal(stationForCategory('UNKNOWN'), 'cashier');
  assert.equal(stationForCategory(null), 'cashier');
});
