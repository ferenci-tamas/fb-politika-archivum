import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatHuDateTime,
  formatHuDate,
  dateInputToUnixStart,
  dateInputToUnixEndExclusive,
  unixToDateInput,
  formatCount,
  hungarianArticle
} from '../src/lib/format.js';

test('formatHuDateTime formats Budapest local as "YYYY. MM. DD. HH:MM"', () => {
  assert.equal(formatHuDateTime(0), '1970. 01. 01. 01:00'); // 1970-01-01 00:00 UTC + 1h (CET)
  // 2020-01-02 03:04 UTC -> 04:04 Budapest (CET, +1)
  assert.equal(formatHuDateTime(Date.UTC(2020, 0, 2, 3, 4, 0) / 1000), '2020. 01. 02. 04:04');
  // 2020-07-01 00:30 UTC -> 02:30 Budapest (CEST, +2) — DST-aware
  assert.equal(formatHuDateTime(Date.UTC(2020, 6, 1, 0, 30, 0) / 1000), '2020. 07. 01. 02:30');
});

test('formatHuDate formats date only (Budapest local)', () => {
  // 2026-04-18 21:53 UTC -> 23:53 Budapest, still the same day
  assert.equal(formatHuDate(Date.UTC(2026, 3, 18, 21, 53) / 1000), '2026. 04. 18.');
});

test('date inputs convert to Budapest-midnight boundaries', () => {
  // 2020-01-01 00:00 Budapest (CET) == 2019-12-31 23:00 UTC
  assert.equal(dateInputToUnixStart('2020-01-01'), 1577833200);
  // exclusive upper bound is the next Budapest midnight
  assert.equal(dateInputToUnixEndExclusive('2020-12-31'), 1609455600);
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

test('hungarianArticle chooses Az before vowels and A before consonants', () => {
  assert.equal(hungarianArticle('infláció'), 'Az');
  assert.equal(hungarianArticle('kormány'), 'A');
  assert.equal(hungarianArticle('Orbán'), 'Az'); // case-insensitive
  assert.equal(hungarianArticle('őrség'), 'Az'); // ő is a vowel
  assert.equal(hungarianArticle('ügyek'), 'Az'); // ü is a vowel
});

test('hungarianArticle uses the first actual letter, skipping operators/quotes', () => {
  assert.equal(hungarianArticle('"orbán viktor"'), 'Az');
  assert.equal(hungarianArticle('-brüsszel'), 'A');
  assert.equal(hungarianArticle('  ukrajna'), 'Az');
  assert.equal(hungarianArticle('123 alma'), 'Az');
});

test('hungarianArticle falls back to A when there is no letter', () => {
  assert.equal(hungarianArticle('123'), 'A');
  assert.equal(hungarianArticle(''), 'A');
});
