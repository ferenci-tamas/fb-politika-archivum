import test from 'node:test';
import assert from 'node:assert/strict';
import { bucketByMonth } from '../src/lib/monthly.js';

const bounds = [
  { ym: '2008-04', lo: 1 },
  { ym: '2008-05', lo: 11 },
  { ym: '2008-06', lo: 21 }
];

test('buckets ascending ids into month ranges, 0-filled', () => {
  assert.deepEqual(bucketByMonth([1, 5, 10, 11, 25], bounds), [
    { ym: '2008-04', n: 3 },
    { ym: '2008-05', n: 1 },
    { ym: '2008-06', n: 1 }
  ]);
});

test('empty ids yields all zeros across every month', () => {
  assert.deepEqual(bucketByMonth([], bounds), [
    { ym: '2008-04', n: 0 },
    { ym: '2008-05', n: 0 },
    { ym: '2008-06', n: 0 }
  ]);
});

test('ids at or beyond the last boundary fall into the last month', () => {
  assert.deepEqual(
    bucketByMonth([21, 100, 9999], bounds).map((p) => p.n),
    [0, 0, 3]
  );
});

test('a month with no matches between two with matches stays zero', () => {
  assert.deepEqual(
    bucketByMonth([1, 2, 25], bounds).map((p) => p.n),
    [2, 0, 1]
  );
});

test('empty boundaries yields an empty result', () => {
  assert.deepEqual(bucketByMonth([1, 2, 3], []), []);
});
