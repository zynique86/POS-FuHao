import { test } from 'node:test';
import assert from 'node:assert/strict';

import { businessDateStartISO, nextDateISO, businessDayStart } from '../datetime';

const KL = 'Asia/Kuala_Lumpur'; // fixed UTC+8, no DST

test('businessDateStartISO returns local midnight as a UTC instant', () => {
  // 2026-10-01 00:00 +08:00 == 2026-09-30 16:00 UTC
  assert.equal(businessDateStartISO('2026-10-01', KL), '2026-09-30T16:00:00.000Z');
});

test('businessDateStartISO handles a month/year rollover', () => {
  // 2027-01-01 00:00 +08:00 == 2026-12-31 16:00 UTC
  assert.equal(businessDateStartISO('2027-01-01', KL), '2026-12-31T16:00:00.000Z');
});

test('businessDateStartISO matches businessDayStart for the same calendar day', () => {
  const now = new Date('2026-10-08T15:00:00Z'); // 2026-10-08 23:00 +08:00
  const viaNow = businessDayStart(KL, now).toISOString();
  const viaDate = businessDateStartISO('2026-10-08', KL);
  assert.equal(viaDate, viaNow);
});

test('nextDateISO advances one calendar day, including month/year rollovers', () => {
  assert.equal(nextDateISO('2026-10-07'), '2026-10-08');
  assert.equal(nextDateISO('2026-10-31'), '2026-11-01');
  assert.equal(nextDateISO('2026-12-31'), '2027-01-01');
});
