import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeTopWords } from '../src/lib/top-words.js';

test('empty input yields empty series and months', () => {
  const r = shapeTopWords([], 20);
  assert.deepEqual(r.series, []);
  assert.deepEqual(r.months, []);
});

test('one series per word, 0-filled across the union of months (sorted)', () => {
  const rows = [
    { ym: '2020-02', word: 'alma', n: 2 },
    { ym: '2020-01', word: 'alma', n: 5 },
    { ym: '2020-01', word: 'körte', n: 3 }
  ];
  const { series, months } = shapeTopWords(rows, 20);
  assert.deepEqual(months, ['2020-01', '2020-02']);
  const alma = series.find((s) => s.label === 'alma');
  const korte = series.find((s) => s.label === 'körte');
  assert.deepEqual(alma.points.map((p) => p.n), [5, 2]);
  assert.deepEqual(korte.points.map((p) => p.n), [3, 0]); // absent in 2020-02 -> 0
  assert.deepEqual(alma.points.map((p) => p.ym), ['2020-01', '2020-02']);
});

test('series ordered by total descending; totals are summed across months', () => {
  const rows = [
    { ym: '2020-01', word: 'low', n: 1 },
    { ym: '2020-02', word: 'low', n: 1 },
    { ym: '2020-01', word: 'high', n: 10 },
    { ym: '2020-01', word: 'mid', n: 5 }
  ];
  const { series } = shapeTopWords(rows, 20);
  assert.deepEqual(series.map((s) => s.label), ['high', 'mid', 'low']);
  assert.equal(series.find((s) => s.label === 'low').total, 2);
});

test('ties in total are broken by word ascending (stable order)', () => {
  const rows = [
    { ym: '2020-01', word: 'banán', n: 2 },
    { ym: '2020-01', word: 'alma', n: 2 }
  ];
  assert.deepEqual(shapeTopWords(rows, 20).series.map((s) => s.label), ['alma', 'banán']);
});

test('limit keeps only the top-N words by total', () => {
  const rows = [
    { ym: '2020-01', word: 'a', n: 5 },
    { ym: '2020-01', word: 'b', n: 4 },
    { ym: '2020-01', word: 'c', n: 3 }
  ];
  assert.deepEqual(shapeTopWords(rows, 2).series.map((s) => s.label), ['a', 'b']);
});

test('point.total is the per-month stacked total over the kept words only', () => {
  const rows = [
    { ym: '2020-01', word: 'a', n: 5 },
    { ym: '2020-01', word: 'b', n: 4 },
    { ym: '2020-01', word: 'c', n: 3 } // excluded by limit 2, so not in the stack total
  ];
  const { series } = shapeTopWords(rows, 2);
  assert.equal(series[0].points[0].total, 9);
});
