// Tiny standalone test for lib/duitnow.ts — run with:
//   npx tsx lib/duitnow.test.mjs
// or compile+run; no test framework needed. Exits non-zero on failure.
//
// What's covered:
//   - CRC-16/CCITT-FALSE on the EMV spec's reference string.
//   - TLV length math for the payload (every tag is id+len+value with the
//     length zero-padded to 2 chars).
//   - CRC round-trip on the full payload.
//
// Known CRC fixture: EMVCo QRCPS §5 example "123456789" → CRC "29B1".

import { buildDuitNowPayload, crc16ccitt } from './duitnow.ts';

let failures = 0;
function assert(name, cond, extra) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`);
  }
}

// --- CRC fixture ----------------------------------------------------------
assert('CRC-16/CCITT-FALSE of "123456789" is 29B1', crc16ccitt('123456789') === '29B1');

// --- TLV length math on a built payload -----------------------------------
const payload = buildDuitNowPayload({
  merchantId: '1234567890',
  merchantName: 'FU HAO DIM SUM',
  merchantCity: 'KUALA LUMPUR',
  amount: 42.5,
  referenceId: 'ORD-1',
});

// Walk the top-level TLVs. Each field is id(2) + len(2) + value(len).
function walkTLV(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const id = s.slice(i, i + 2);
    const len = parseInt(s.slice(i + 2, i + 4), 10);
    if (Number.isNaN(len)) throw new Error(`bad length at ${i}: "${s.slice(i, i + 4)}"`);
    const value = s.slice(i + 4, i + 4 + len);
    if (value.length !== len) throw new Error(`short value for id ${id} at ${i}`);
    out.push({ id, len, value });
    i += 4 + len;
  }
  return out;
}

const fields = walkTLV(payload);
const ids = fields.map((f) => f.id);
assert('payload starts with 00 (format)', ids[0] === '00');
assert('payload contains 26 (DuitNow MAI)', ids.includes('26'));
assert('payload contains 53 (currency) = 458',
  fields.find((f) => f.id === '53')?.value === '458');
assert('payload contains 54 (amount) = 42.50',
  fields.find((f) => f.id === '54')?.value === '42.50');
assert('payload contains 58 (country) = MY',
  fields.find((f) => f.id === '58')?.value === 'MY');
assert('payload contains 59 (merchant name)',
  fields.find((f) => f.id === '59')?.value === 'FU HAO DIM SUM');
assert('payload contains 60 (merchant city)',
  fields.find((f) => f.id === '60')?.value === 'KUALA LUMPUR');
assert('payload ends with 63 (CRC) length 4',
  fields[fields.length - 1].id === '63' && fields[fields.length - 1].len === 4);

// --- CRC round-trip -------------------------------------------------------
const bodyWithPrefix = payload.slice(0, payload.length - 4);
const expectedCrc = crc16ccitt(bodyWithPrefix);
const actualCrc = payload.slice(-4);
assert('CRC in payload matches CRC-16/CCITT-FALSE of body', expectedCrc === actualCrc,
  `expected ${expectedCrc}, got ${actualCrc}`);

// --- Nested DuitNow MAI (tag 26) --------------------------------------------
const mai = fields.find((f) => f.id === '26');
const maiSub = walkTLV(mai.value);
assert('MAI sub-tag 00 is MY.PAYNET.DN',
  maiSub.find((f) => f.id === '00')?.value === 'MY.PAYNET.DN');
assert('MAI sub-tag 01 is merchant id',
  maiSub.find((f) => f.id === '01')?.value === '1234567890');

// --- Rejects bad inputs --------------------------------------------------
let threw = false;
try { buildDuitNowPayload({ merchantId: '', merchantName: 'x', merchantCity: 'y', amount: 1 }); }
catch { threw = true; }
assert('empty merchantId is rejected', threw);

threw = false;
try { buildDuitNowPayload({ merchantId: 'x', merchantName: 'x', merchantCity: 'x', amount: -1 }); }
catch { threw = true; }
assert('negative amount is rejected', threw);

if (failures) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log('\nAll DuitNow tests passed.');
