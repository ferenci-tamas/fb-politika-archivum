import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeTopWords } from '../src/lib/top-words.js';

test('empty input yields empty series and months', () => {
  const r = shapeTopWords([], null, 20);
  assert.deepEqual(r.series, []);
  assert.deepEqual(r.months, []);
});

test('one series per word, 0-filled across the union of months (sorted)', () => {
  const rows = [
    { ym: '2020-02', word: 'alma', n: 2 },
    { ym: '2020-01', word: 'alma', n: 5 },
    { ym: '2020-01', word: 'körte', n: 3 }
  ];
  const { series, months } = shapeTopWords(rows, null, 20);
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
  const { series } = shapeTopWords(rows, null, 20);
  assert.deepEqual(series.map((s) => s.label), ['high', 'mid', 'low']);
  assert.equal(series.find((s) => s.label === 'low').total, 2);
});

test('ties in total are broken by word ascending (stable order)', () => {
  const rows = [
    { ym: '2020-01', word: 'banán', n: 2 },
    { ym: '2020-01', word: 'alma', n: 2 }
  ];
  assert.deepEqual(shapeTopWords(rows, null, 20).series.map((s) => s.label), ['alma', 'banán']);
});

test('limit keeps only the top-N words by total', () => {
  const rows = [
    { ym: '2020-01', word: 'a', n: 5 },
    { ym: '2020-01', word: 'b', n: 4 },
    { ym: '2020-01', word: 'c', n: 3 }
  ];
  assert.deepEqual(shapeTopWords(rows, null, 2).series.map((s) => s.label), ['a', 'b']);
});

test('without totals, point.total falls back to the per-month stack sum', () => {
  const rows = [
    { ym: '2020-01', word: 'a', n: 5 },
    { ym: '2020-01', word: 'b', n: 4 },
    { ym: '2020-01', word: 'c', n: 3 } // excluded by limit 2, so not in the stack total
  ];
  const { series } = shapeTopWords(rows, null, 2);
  assert.equal(series[0].points[0].total, 9);
});

test('totalsByYm sets each point.total (the ratio denominator)', () => {
  const rows = [
    { ym: '2020-01', word: 'a', n: 5 },
    { ym: '2020-01', word: 'b', n: 4 },
    { ym: '2020-02', word: 'a', n: 2 }
  ];
  const totals = new Map([['2020-01', 100], ['2020-02', 50]]);
  const a = shapeTopWords(rows, totals, 10).series.find((s) => s.label === 'a');
  assert.deepEqual(a.points.map((p) => p.total), [100, 50]); // cell token totals, not stack sums
});

test('a missing/zero monthly total falls back to that month stack sum', () => {
  const rows = [
    { ym: '2020-01', word: 'a', n: 5 },
    { ym: '2020-02', word: 'a', n: 2 }
  ];
  const totals = new Map([['2020-01', 100]]); // 2020-02 missing
  const a = shapeTopWords(rows, totals, 10).series.find((s) => s.label === 'a');
  assert.equal(a.points[0].total, 100);
  assert.equal(a.points[1].total, 2); // fallback: only 'a' present, stack sum = 2
});

test('with totals, selection ranks by summed monthly share, not raw count', () => {
  const rows = [
    { ym: '2020-01', word: 'rare', n: 5 }, // small month -> high share
    { ym: '2020-02', word: 'common', n: 8 } // big month -> lower share
  ];
  const totals = new Map([['2020-01', 10], ['2020-02', 100]]); // shares .5 vs .08
  const labels = shapeTopWords(rows, totals, 1).series.map((s) => s.label);
  assert.deepEqual(labels, ['rare']); // share .5 > .08, though count 5 < 8
});

test('selectMonths restricts the ranking to a window but keeps the full month axis', () => {
  const rows = [
    { ym: '2020-01', word: 'early', n: 9 },
    { ym: '2020-02', word: 'late', n: 9 },
    { ym: '2020-01', word: 'late', n: 1 }
  ];
  // Over all months 'late' (10) outranks 'early' (9); restricted to 2020-01, 'early' wins.
  const r = shapeTopWords(rows, null, 1, ['2020-01']);
  assert.deepEqual(r.series.map((s) => s.label), ['early']);
  assert.deepEqual(r.months, ['2020-01', '2020-02']); // full axis retained
  assert.deepEqual(r.series[0].points.map((p) => p.ym), ['2020-01', '2020-02']);
});
