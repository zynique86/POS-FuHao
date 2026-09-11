// Pricing math for the dim sum POS.
// Kept pure (no DB, no React) so the same function is used on the POS
// terminal, in the cashier modal, and by the printer service.

import type { ShopSettings } from './types';

export type PriceBreakdown = {
  subtotal: number;        // sum of qty * price for each line
  service_charge: number;  // subtotal * service_charge_pct / 100
  tax: number;             // (subtotal + service_charge) * sst_pct / 100
  rounding: number;        // amount added/subtracted to hit nearest 5 sen
  discount: number;        // flat RM amount subtracted at the end
  total: number;           // subtotal + service_charge + tax + rounding - discount
};

// Round a ringgit amount to the nearest 5 sen (Malaysia dropped 1c/2c coins).
// e.g. 12.37 → 12.35, 12.38 → 12.40.
export function roundToNearest5Sen(amount: number): number {
  return Math.round(amount * 20) / 20;
}

// Given the line-item subtotal and the current shop settings, compute
// the full price breakdown. All figures are returned with 2 decimal
// precision (as plain numbers, not strings — format at the edge).
export function computeBreakdown(
  subtotal: number,
  settings: Pick<ShopSettings, 'sst_pct' | 'service_charge_pct' | 'round_to_5_sen'>,
  discount: number = 0
): PriceBreakdown {
  const sub = round2(subtotal);
  const svc = round2(sub * (Number(settings.service_charge_pct) || 0) / 100);
  const tax = round2((sub + svc) * (Number(settings.sst_pct) || 0) / 100);
  const discountAmount = Math.max(0, round2(Number(discount) || 0));
  const gross = round2(sub + svc + tax - discountAmount);
  const total = settings.round_to_5_sen ? roundToNearest5Sen(gross) : gross;
  const rounding = round2(total - gross);
  return {
    subtotal: sub,
    service_charge: svc,
    tax,
    rounding,
    discount: discountAmount,
    total,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Convenience: sum an array of line items into a subtotal.
export function sumLines(
  lines: { qty: number; price: number }[]
): number {
  return lines.reduce((s, l) => s + l.qty * l.price, 0);
}
