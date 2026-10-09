import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyRowEvent,
  applyRowEventBuckets,
  type RealtimePayload,
} from '../realtime-reducers';

type Row = { id: number; name: string; done?: boolean };

const empty: Partial<Row> = {};

function payload(
  eventType: 'INSERT' | 'UPDATE' | 'DELETE',
  newRow: Partial<Row>,
  oldRow: Partial<Row> = empty,
): RealtimePayload<Row> {
  return {
    eventType,
    new: newRow as Row,
    old: oldRow as Partial<Row>,
  };
}

test('INSERT appends a new row when it is not yet present', () => {
  const rows: Row[] = [{ id: 1, name: 'a' }];
  const res = applyRowEvent(rows, payload('INSERT', { id: 2, name: 'b' }));
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.rows, [
    { id: 1, name: 'a' },
    { id: 2, name: 'b' },
  ]);
});

test('INSERT for an id that already exists replaces the row (dedup)', () => {
  const rows: Row[] = [{ id: 1, name: 'a' }];
  const res = applyRowEvent(rows, payload('INSERT', { id: 1, name: 'a2' }));
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.rows, [{ id: 1, name: 'a2' }]);
});

test('UPDATE replaces the row by id', () => {
  const rows: Row[] = [
    { id: 1, name: 'a' },
    { id: 2, name: 'b' },
  ];
  const res = applyRowEvent(rows, payload('UPDATE', { id: 2, name: 'B' }));
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.rows, [
    { id: 1, name: 'a' },
    { id: 2, name: 'B' },
  ]);
});

test('UPDATE for an id not yet seen appends it (handles partial-filter inserts)', () => {
  const rows: Row[] = [{ id: 1, name: 'a' }];
  const res = applyRowEvent(rows, payload('UPDATE', { id: 3, name: 'c' }));
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.rows.length, 2);
  assert.deepEqual(res.rows[1], { id: 3, name: 'c' });
});

test('DELETE removes the row with matching old.id', () => {
  const rows: Row[] = [
    { id: 1, name: 'a' },
    { id: 2, name: 'b' },
  ];
  const res = applyRowEvent(rows, payload('DELETE', {}, { id: 1 }));
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.rows, [{ id: 2, name: 'b' }]);
});

test('DELETE without old.id returns ok=false so the caller refetches', () => {
  const rows: Row[] = [{ id: 1, name: 'a' }];
  const res = applyRowEvent(rows, payload('DELETE', {}, {}));
  assert.equal(res.ok, false);
});

test('INSERT without new.id returns ok=false so the caller refetches', () => {
  const rows: Row[] = [];
  const res = applyRowEvent(rows, payload('INSERT', {}));
  assert.equal(res.ok, false);
});

test('belongs() predicate drops a row that no longer fits the bucket', () => {
  const rows: Row[] = [
    { id: 1, name: 'a', done: false },
    { id: 2, name: 'b', done: false },
  ];
  const res = applyRowEvent(
    rows,
    payload('UPDATE', { id: 1, name: 'a', done: true }),
    (r) => r.done !== true,
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.rows, [{ id: 2, name: 'b', done: false }]);
});

test('belongs() predicate skips a brand-new row that does not fit the bucket', () => {
  const rows: Row[] = [{ id: 1, name: 'a', done: false }];
  const res = applyRowEvent(
    rows,
    payload('INSERT', { id: 2, name: 'b', done: true }),
    (r) => r.done !== true,
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.rows, [{ id: 1, name: 'a', done: false }]);
});

test('applyRowEventBuckets flips a row between two buckets atomically', () => {
  const state = {
    open: [{ id: 1, name: 'a', done: false }] as Row[],
    done: [] as Row[],
  };
  const res = applyRowEventBuckets(state, payload('UPDATE', { id: 1, name: 'a', done: true }), {
    open: (r) => r.done !== true,
    done: (r) => r.done === true,
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.state.open, []);
  assert.deepEqual(res.state.done, [{ id: 1, name: 'a', done: true }]);
});

test('applyRowEventBuckets fails the whole update if any sub-reduction fails', () => {
  const state = { open: [] as Row[], done: [] as Row[] };
  const res = applyRowEventBuckets(state, payload('DELETE', {}, {}), {
    open: () => true,
    done: () => true,
  });
  assert.equal(res.ok, false);
});

test('empty-list DELETE is a no-op success', () => {
  const res = applyRowEvent([] as Row[], payload('DELETE', {}, { id: 42 }));
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.rows, []);
});

test('reducer returns a new array (no in-place mutation)', () => {
  const rows: Row[] = [{ id: 1, name: 'a' }];
  const res = applyRowEvent(rows, payload('UPDATE', { id: 1, name: 'A' }));
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.notEqual(res.rows, rows);
  assert.deepEqual(rows, [{ id: 1, name: 'a' }]);
});
