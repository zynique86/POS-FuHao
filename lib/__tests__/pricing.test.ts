import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeBreakdown, roundToNearest5Sen, sumLines } from '../pricing';
import type { ShopSettings } from '../types';

type Settings = Pick<ShopSettings, 'sst_pct' | 'service_charge_pct' | 'round_to_5_sen'>;

const base: Settings = { sst_pct: 6, service_charge_pct: 10, round_to_5_sen: true };

test('sumLines totals qty * price for each line', () => {
  assert.equal(sumLines([{ qty: 2, price: 5 }, { qty: 3, price: 1.5 }]), 14.5);
  assert.equal(sumLines([]), 0);
});

test('roundToNearest5Sen rounds to the nearest 5 sen (half-up at the boundary)', () => {
  assert.equal(roundToNearest5Sen(12.37), 12.35);
  assert.equal(roundToNearest5Sen(12.38), 12.4);
  assert.equal(roundToNearest5Sen(12.025), 12.05); // 240.5 → half-up
  assert.equal(roundToNearest5Sen(0), 0);
  assert.equal(roundToNearest5Sen(12.4), 12.4);
});

test('computeBreakdown applies service charge, then SST on (subtotal + service)', () => {
  const b = computeBreakdown(100, base);
  assert.equal(b.subtotal, 100);
  assert.equal(b.service_charge, 10);          // 100 * 10%
  assert.equal(b.tax, 6.6);                    // (100 + 10) * 6%
  assert.equal(b.discount, 0);
  assert.equal(b.rounding, 0);                 // 116.6 is already 5-sen aligned
  assert.equal(b.total, 116.6);
});

test('computeBreakdown clamps a negative discount to 0', () => {
  const b = computeBreakdown(50, base, -10);
  assert.equal(b.discount, 0);
  // Mirror of the 100 subtotal case, scaled: svc 5, tax 3.30, gross 58.30 → 58.30
  assert.equal(b.service_charge, 5);
  assert.equal(b.tax, 3.3);
  assert.equal(b.total, 58.3);
});

test('computeBreakdown subtracts the discount after service and tax', () => {
  const b = computeBreakdown(100, base, 20);
  // gross before discount = 116.6; after discount = 96.6
  assert.equal(b.discount, 20);
  assert.equal(b.total, 96.6);
});

test('computeBreakdown rounds the final total to 5 sen when enabled', () => {
  // Pick a subtotal that produces a non-5-sen gross so rounding is non-zero.
  // 10.11 * 1.1 * 1.06 = 11.788 → 11.79 after round2, then round-to-5-sen → 11.80
  const b = computeBreakdown(10.11, base);
  assert.equal(b.total, 11.8);
  assert.equal(b.rounding, Math.round((11.8 - 11.79) * 100) / 100);
});

test('computeBreakdown leaves the gross alone when 5-sen rounding is off', () => {
  const b = computeBreakdown(10.11, { ...base, round_to_5_sen: false });
  assert.equal(b.total, 11.79);
  assert.equal(b.rounding, 0);
});

test('computeBreakdown handles a zero subtotal cleanly', () => {
  const b = computeBreakdown(0, base);
  assert.equal(b.subtotal, 0);
  assert.equal(b.service_charge, 0);
  assert.equal(b.tax, 0);
  assert.equal(b.rounding, 0);
  assert.equal(b.total, 0);
});

test('computeBreakdown coerces non-numeric settings to 0 safely', () => {
  const b = computeBreakdown(100, {
    sst_pct: NaN as unknown as number,
    service_charge_pct: NaN as unknown as number,
    round_to_5_sen: false,
  });
  assert.equal(b.service_charge, 0);
  assert.equal(b.tax, 0);
  assert.equal(b.total, 100);
});
