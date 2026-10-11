-- Prevent two cashiers from opening two shifts for the same business_date.
--
-- Partial unique index: at most one OPEN shift (closed_at IS NULL) per
-- business_date.  Closed shifts don't count, so re-opens on a new day still
-- work, and multiple historical rows per date remain valid once closed.
--
-- The POS catches the resulting unique_violation (SQLSTATE 23505) in the
-- open-shift handler and refreshes the shift state instead of surfacing an
-- error — the second cashier simply sees the shift the first one opened.

CREATE UNIQUE INDEX IF NOT EXISTS shift_opens_business_date_open_uniq
  ON shift_opens (business_date)
  WHERE closed_at IS NULL;
