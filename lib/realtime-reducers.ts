// Reducers that apply Supabase Realtime postgres_changes payloads to local
// row lists, so pages don't have to refetch every table on every event.
//
// Each reducer returns { ok: true, rows } on success, or { ok: false, reason }
// when the payload can't be interpreted — for example an UPDATE whose new
// row has no id, or a DELETE missing old.id. Callers fall back to a full
// refetch in that case.
//
// Rows are keyed by numeric `id`, which every table we subscribe to has.

export type EventType = 'INSERT' | 'UPDATE' | 'DELETE';

export type RealtimePayload<T> = {
  eventType: EventType;
  new: T | Record<string, never>;
  old: Partial<T> | Record<string, never>;
};

export type WithId = { id: number };

export type Ok<T> = { ok: true; rows: T[] };
export type Err = { ok: false; reason: string };
export type Result<T> = Ok<T> | Err;

// Generic reducer: apply one Realtime event to a list of rows keyed by id.
// `belongs(row)` decides whether the row should remain in the resulting list
// (e.g. "is this order still unpaid?"); an UPDATE that flips the predicate
// removes the row from the list.
export function applyRowEvent<T extends WithId>(
  rows: T[],
  payload: RealtimePayload<T>,
  belongs: (row: T) => boolean = () => true,
): Result<T> {
  if (payload.eventType === 'DELETE') {
    const id = (payload.old as Partial<T>).id;
    if (id == null) return { ok: false, reason: 'DELETE missing old.id' };
    const next = rows.filter((r) => r.id !== id);
    return { ok: true, rows: next };
  }

  const row = payload.new as T;
  if (!row || row.id == null) {
    return { ok: false, reason: `${payload.eventType} missing new.id` };
  }

  const idx = rows.findIndex((r) => r.id === row.id);
  const want = belongs(row);

  if (idx === -1) {
    if (!want) return { ok: true, rows };
    return { ok: true, rows: [...rows, row] };
  }
  if (!want) {
    return { ok: true, rows: rows.filter((_, i) => i !== idx) };
  }
  const next = rows.slice();
  next[idx] = row;
  return { ok: true, rows: next };
}

// Apply an orders payload to two buckets at once — e.g. unpaid vs paid-today
// on the cashier screen — so a row flipping buckets (an unpaid order being
// paid) is removed from one list and inserted into the other in a single
// step. If either sub-reduction fails, the whole operation fails so the
// caller refetches once.
export type Buckets<T> = Record<string, T[]>;

export function applyRowEventBuckets<T extends WithId>(
  state: Buckets<T>,
  payload: RealtimePayload<T>,
  predicates: Record<keyof typeof state, (row: T) => boolean>,
): { ok: true; state: Buckets<T> } | Err {
  const next: Buckets<T> = {};
  for (const key of Object.keys(state)) {
    const res = applyRowEvent(state[key], payload, predicates[key]);
    if (!res.ok) return res;
    next[key] = res.rows;
  }
  return { ok: true, state: next };
}
