import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatHuDateTime,
  formatHuDate,
  dateInputToUnixStart,
  dateInputToUnixEndExclusive,
  unixToDateInput,
  formatCount
} from '../src/lib/format.js';

test('formatHuDateTime formats UTC as "YYYY. MM. DD. HH:MM"', () => {
  assert.equal(formatHuDateTime(0), '1970. 01. 01. 00:00');
  // 2020-01-02 03:04:00 UTC
  assert.equal(formatHuDateTime(Date.UTC(2020, 0, 2, 3, 4, 0) / 1000), '2020. 01. 02. 03:04');
});

test('formatHuDate formats date only', () => {
  assert.equal(formatHuDate(Date.UTC(2026, 3, 18, 21, 53) / 1000), '2026. 04. 18.');
});

test('date inputs convert to UTC boundaries', () => {
  assert.equal(dateInputToUnixStart('2020-01-01'), 1577836800);
  // exclusive upper bound is the next UTC midnight
  assert.equal(dateInputToUnixEndExclusive('2020-12-31'), 1609459200);
});

test('invalid date inputs return null', () => {
  for (const v of ['', 'not-a-date', '2020-13-40', '2020/01/01', null]) {
    assert.equal(dateInputToUnixStart(v), null);
    assert.equal(dateInputToUnixEndExclusive(v), null);
  }
});

test('unixToDateInput round-trips with dateInputToUnixStart', () => {
  assert.equal(unixToDateInput(1577836800), '2020-01-01');
  const s = '2015-06-07';
  assert.equal(unixToDateInput(dateInputToUnixStart(s)), s);
});

test('formatCount groups thousands with a non-breaking space', () => {
  assert.equal(formatCount(654375), '654\u00A0375');
  assert.equal(formatCount(42), '42');
  assert.equal(formatCount(1000000), '1\u00A0000\u00A0000');
});
