// DuitNow QR payload builder — produces an EMVCo-compatible QR string that
// the DuitNow network (PayNet) accepts for merchant-presented, amount-fixed
// transactions. The customer scans this with their bank app and sees the
// amount pre-filled, so the only cashier error we can still make is a wrong
// amount typed in the POS, not a wrong amount typed by the customer.
//
// References:
//   - MyDuitNow Merchant-Presented QR specification (PayNet)
//   - EMVCo QR Code Specification for Payment Systems (EMV QRCPS)
//
// The payload is a flat sequence of TLV triples:
//   ID (2 chars) + LENGTH (2 chars, zero-padded) + VALUE
// Finished off by a CRC-16/CCITT-FALSE over the whole string including the
// "6304" prefix of the CRC field itself (i.e. compute, then append the hex).

export type DuitNowPayload = {
  merchantId: string;      // DuitNow merchant/registration ID issued by the bank
  merchantName: string;    // Up to 25 chars, printed on the payer's confirm screen
  merchantCity: string;    // Up to 15 chars, e.g. "KUALA LUMPUR"
  amount: number;          // Transaction amount in MYR, e.g. 42.50
  currency?: string;       // ISO 4217 numeric; defaults to '458' (MYR)
  countryCode?: string;    // ISO 3166-1 alpha-2; defaults to 'MY'
  referenceId?: string;    // Optional billing/reference ID (max 25 chars)
};

// EMV TLV tag IDs we use.
const TAG = {
  PAYLOAD_FORMAT: '00',          // "01"
  POI_METHOD: '01',              // "11" static / "12" dynamic
  MERCHANT_ACCOUNT_DUITNOW: '26',
  MERCHANT_CATEGORY: '52',       // 4-digit MCC; "0000" if unknown
  CURRENCY: '53',                // ISO 4217 numeric
  AMOUNT: '54',
  COUNTRY: '58',
  MERCHANT_NAME: '59',
  MERCHANT_CITY: '60',
  ADDITIONAL_DATA: '62',         // nested TLVs (ref id, etc.)
  CRC: '63',
};

// Nested sub-tag IDs under tag 26 (DuitNow merchant account info).
const DUITNOW_SUB = {
  GUID: '00',                    // "MY.PAYNET.DN"
  MERCHANT_ID: '01',
};

// Nested sub-tag ID under tag 62 (additional data).
const ADDITIONAL_SUB = {
  REFERENCE_ID: '01',
};

/** Format one TLV field. */
function tlv(id: string, value: string): string {
  const len = value.length.toString().padStart(2, '0');
  return `${id}${len}${value}`;
}

/**
 * CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, no final xor.
 * This is the CRC variant the EMV QRCPS spec mandates.
 */
export function crc16ccitt(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Format amount per EMV: no currency symbol, dot as decimal, 2dp. */
function formatAmount(amount: number): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) throw new Error('DuitNow amount must be a non-negative number');
  // EMV allows up to 13 chars incl. decimal; two decimals is standard for MYR.
  return n.toFixed(2);
}

function clean(s: string, max: number): string {
  // EMV QR is a strict ASCII payload. Strip anything outside printable ASCII
  // and clip to the field's length so the TLV stays valid.
  const ascii = String(s).replace(/[^\x20-\x7E]/g, '').trim();
  return ascii.slice(0, max);
}

/**
 * Build a DuitNow EMV QR payload string. Pass the result to any QR encoder;
 * the resulting QR shows the amount pre-filled when scanned.
 */
export function buildDuitNowPayload(input: DuitNowPayload): string {
  const merchantId = String(input.merchantId || '').trim();
  const merchantName = clean(input.merchantName || '', 25);
  const merchantCity = clean(input.merchantCity || '', 15);
  if (!merchantId) throw new Error('DuitNow merchantId is required');
  if (!merchantName) throw new Error('DuitNow merchantName is required');
  if (!merchantCity) throw new Error('DuitNow merchantCity is required');

  const currency = input.currency || '458';
  const countryCode = (input.countryCode || 'MY').toUpperCase();

  // DuitNow merchant account info is a nested TLV under tag 26:
  //   00 "MY.PAYNET.DN"
  //   01 <merchantId>
  const duitnowAccount =
    tlv(DUITNOW_SUB.GUID, 'MY.PAYNET.DN') +
    tlv(DUITNOW_SUB.MERCHANT_ID, merchantId);

  // Additional data (ref id) is optional.
  const refId = input.referenceId ? clean(input.referenceId, 25) : '';
  const additional = refId ? tlv(ADDITIONAL_SUB.REFERENCE_ID, refId) : '';

  const fields = [
    tlv(TAG.PAYLOAD_FORMAT, '01'),
    tlv(TAG.POI_METHOD, '12'),                       // 12 = dynamic (amount included)
    tlv(TAG.MERCHANT_ACCOUNT_DUITNOW, duitnowAccount),
    tlv(TAG.MERCHANT_CATEGORY, '0000'),              // MCC unknown
    tlv(TAG.CURRENCY, currency),
    tlv(TAG.AMOUNT, formatAmount(input.amount)),
    tlv(TAG.COUNTRY, countryCode),
    tlv(TAG.MERCHANT_NAME, merchantName),
    tlv(TAG.MERCHANT_CITY, merchantCity),
    ...(additional ? [tlv(TAG.ADDITIONAL_DATA, additional)] : []),
  ];

  // CRC is computed over everything up to and including the "6304" prefix of
  // the CRC field itself — that's the EMV QRCPS rule.
  const partial = fields.join('') + TAG.CRC + '04';
  const crc = crc16ccitt(partial);
  return partial + crc;
}
