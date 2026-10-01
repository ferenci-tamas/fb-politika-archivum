import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeForSearch, filterAuthors } from '../src/ui/author-combobox.js';

const authors = [
  { authorId: 1, authorname: 'Áder János', post_count: 217 },
  { authorId: 5, authorname: 'Bányai Gábor', post_count: 4864 },
  { authorId: 106, authorname: 'Zsigó Róbert', post_count: 5000 }
];

test('normalizeForSearch strips diacritics and lowercases', () => {
  assert.equal(normalizeForSearch('Áder János'), 'ader janos');
  assert.equal(normalizeForSearch('Zsigó Róbert'), 'zsigo robert');
  assert.equal(normalizeForSearch('KŐSZEG'), 'koszeg');
});

test('filterAuthors matches case- and diacritic-insensitively (substring)', () => {
  assert.deepEqual(filterAuthors(authors, 'ader').map((a) => a.authorId), [1]);
  assert.deepEqual(filterAuthors(authors, 'ÁDER').map((a) => a.authorId), [1]);
  assert.deepEqual(filterAuthors(authors, 'robert').map((a) => a.authorId), [106]);
  assert.deepEqual(filterAuthors(authors, 'gábor').map((a) => a.authorId), [5]);
  assert.deepEqual(filterAuthors(authors, 'gabor').map((a) => a.authorId), [5]);
  assert.deepEqual(filterAuthors(authors, 'ja').map((a) => a.authorId), [1]); // "János"
});

test('empty query returns all; no match returns none', () => {
  assert.equal(filterAuthors(authors, '').length, 3);
  assert.equal(filterAuthors(authors, '   ').length, 3);
  assert.equal(filterAuthors(authors, 'xyz').length, 0);
});
