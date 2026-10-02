import test from 'node:test';
import assert from 'node:assert/strict';
import { toSeriesData } from '../src/ui/line-chart.js';

test('toSeriesData maps ym buckets to [utcMillis, count]', () => {
  assert.deepEqual(
    toSeriesData([
      { ym: '2008-04', n: 3 },
      { ym: '2015-12', n: 120 },
      { ym: '2026-01', n: 0 }
    ]),
    [
      [Date.UTC(2008, 3, 1), 3],
      [Date.UTC(2015, 11, 1), 120],
      [Date.UTC(2026, 0, 1), 0]
    ]
  );
});

test('toSeriesData returns an empty array for empty input', () => {
  assert.deepEqual(toSeriesData([]), []);
});
