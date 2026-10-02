import test from 'node:test';
import assert from 'node:assert/strict';
import { toSeriesData } from '../src/ui/line-chart.js';

test('toSeriesData (count mode) maps buckets to {value:[ts,n], n, total}', () => {
  assert.deepEqual(
    toSeriesData([{ ym: '2008-04', n: 3, total: 10 }], 'count'),
    [{ value: [Date.UTC(2008, 3, 1), 3], n: 3, total: 10 }]
  );
});

test('toSeriesData (ratio mode) plots n/total as a percentage', () => {
  assert.deepEqual(
    toSeriesData([{ ym: '2015-12', n: 3, total: 12 }], 'ratio'),
    [{ value: [Date.UTC(2015, 11, 1), 25], n: 3, total: 12 }]
  );
});

test('toSeriesData defaults to count and guards a zero total in ratio mode', () => {
  assert.deepEqual(toSeriesData([{ ym: '2020-01', n: 5, total: 0 }], 'ratio'), [
    { value: [Date.UTC(2020, 0, 1), 0], n: 5, total: 0 }
  ]);
  assert.deepEqual(toSeriesData([{ ym: '2020-01', n: 5, total: 20 }]), [
    { value: [Date.UTC(2020, 0, 1), 5], n: 5, total: 20 }
  ]);
});

test('toSeriesData returns an empty array for empty input', () => {
  assert.deepEqual(toSeriesData([]), []);
});
