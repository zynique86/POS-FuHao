// Business-day helpers that respect the shop's timezone.
//
// `new Date().setHours(0,0,0,0)` resolves "today" against the VIEWER's
// timezone, which drifts the Paid-today list for a cashier opening the
// browser from another TZ (travel, server-side rendering).  These helpers
// anchor the business day to the shop's own timezone instead.

export const BUSINESS_TZ_DEFAULT = 'Asia/Kuala_Lumpur';

// Today's calendar date (YYYY-MM-DD) in the shop's business timezone — for
// defaulting a date picker (expenses, shift open) to the right business day
// even when the device's own clock/timezone is set to somewhere else.
export function businessTodayISO(tz: string = BUSINESS_TZ_DEFAULT, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
}

// Returns the UTC Date at the start of "today" in the given IANA timezone.
// e.g. tz = 'Asia/Kuala_Lumpur' at 2026-10-08T15:00+08:00  →  2026-10-08T00:00+08:00 UTC.
export function businessDayStart(tz: string = BUSINESS_TZ_DEFAULT, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  // en-CA gives YYYY-MM-DD / HH:mm:ss cleanly.
  const y = get('year');
  const m = get('month');
  const d = get('day');
  const hh = Number(get('hour'));
  const mm = Number(get('minute'));
  const ss = Number(get('second'));

  // The UTC instant corresponding to local midnight in `tz` is
  // `now` minus however far "today in tz" has already run.
  const elapsedMs = ((hh * 60 + mm) * 60 + ss) * 1000;
  const localMidnightUtc = new Date(now.getTime() - elapsedMs);

  // Guard against the ~1ms drift from the formatter dropping fractional seconds.
  localMidnightUtc.setUTCMilliseconds(0);
  // Tag the YMD so callers can log / assert if they want it.
  void `${y}-${m}-${d}`;
  return localMidnightUtc;
}

export function businessDayStartISO(tz: string = BUSINESS_TZ_DEFAULT, now: Date = new Date()): string {
  return businessDayStart(tz, now).toISOString();
}

// Convert a calendar date (YYYY-MM-DD, as picked by an owner in a <input
// type="date"> for a report) to the UTC instant of that date's local
// midnight in `tz`. Reports that filter by a date *range* (monthly P&L,
// rankings) need this instead of raw `${date}T00:00:00Z` — a plain UTC
// boundary is 8 hours off from Kuala Lumpur local time and can misattribute
// orders placed in the first ~8 hours of a business day/month.
export function businessDateStartISO(dateISO: string, tz: string = BUSINESS_TZ_DEFAULT): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  // Noon UTC lands on the same calendar day in `tz` for any real-world
  // timezone offset (-12..+14), so it's a safe reference instant: handing
  // it to businessDayStart() gives that day's local midnight.
  const noonUTC = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return businessDayStart(tz, noonUTC).toISOString();
}

// The calendar date (YYYY-MM-DD) after `dateISO` — the exclusive upper
// bound for a single-day report query, e.g.
// `.gte(businessDateStartISO(date)).lt(businessDateStartISO(nextDateISO(date)))`.
export function nextDateISO(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
