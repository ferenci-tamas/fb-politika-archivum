import test from 'node:test';
import assert from 'node:assert/strict';
import { toSeriesData } from '../src/ui/line-chart.js';

test('toSeriesData (count mode) maps buckets to {value:[ts,n], n, total}', () => {
  assert.deepEqual(
    toSeriesData([{ ym: '2008-04', n: 3, total: 10 }], 'count'),
    [{ value: [Date.UTC(2008, 3, 1), 3], n: 3, total: 10 }]
  );
});

test('toSeriesData (ratio mode) plots n/total as a percentage for large months', () => {
  assert.deepEqual(
    toSeriesData([{ ym: '2015-12', n: 3, total: 120 }], 'ratio'),
    [{ value: [Date.UTC(2015, 11, 1), 2.5], n: 3, total: 120 }]
  );
});

test('toSeriesData (ratio mode) suppresses months with < 100 posts as a gap (null)', () => {
  assert.deepEqual(
    toSeriesData(
      [
        { ym: '2008-04', n: 5, total: 50 },
        { ym: '2008-05', n: 0, total: 0 },
        { ym: '2008-06', n: 40, total: 100 }
      ],
      'ratio'
    ),
    [
      { value: [Date.UTC(2008, 3, 1), null], n: 5, total: 50 },
      { value: [Date.UTC(2008, 4, 1), null], n: 0, total: 0 },
      { value: [Date.UTC(2008, 5, 1), 40], n: 40, total: 100 }
    ]
  );
});

test('toSeriesData (count mode) always shows the count, even for small months', () => {
  assert.deepEqual(
    toSeriesData([{ ym: '2008-04', n: 5, total: 50 }]),
    [{ value: [Date.UTC(2008, 3, 1), 5], n: 5, total: 50 }]
  );
});

test('toSeriesData returns an empty array for empty input', () => {
  assert.deepEqual(toSeriesData([]), []);
});
