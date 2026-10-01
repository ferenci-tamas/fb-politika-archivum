import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFtsMatch } from '../src/lib/fts-query.js';

test('empty / whitespace / non-string input yields empty', () => {
  assert.equal(buildFtsMatch(''), '');
  assert.equal(buildFtsMatch('    '), '');
  assert.equal(buildFtsMatch(null), '');
  assert.equal(buildFtsMatch(42), '');
});

test('single term is quoted (preserving diacritics)', () => {
  assert.equal(buildFtsMatch('kormány'), '"kormány"');
});

test('multiple terms are AND-ed by default', () => {
  assert.equal(buildFtsMatch('alma körte'), '"alma" AND "körte"');
});

test('quoted phrase is preserved as a phrase', () => {
  assert.equal(buildFtsMatch('"orbán viktor"'), '"orbán viktor"');
});

test('explicit OR operator', () => {
  assert.equal(buildFtsMatch('alma OR körte'), '"alma" OR "körte"');
  assert.equal(buildFtsMatch('alma VAGY körte'), '"alma" OR "körte"');
});

test('trailing asterisk enables prefix search', () => {
  assert.equal(buildFtsMatch('inflác*'), '"inflác"*');
});

test('leading minus excludes a term', () => {
  assert.equal(buildFtsMatch('alma -körte'), '("alma") NOT ("körte")');
});

test('FTS special characters cannot break out of the quoted token', () => {
  // All of these must produce a syntactically safe string (quotes doubled),
  // never raw operators. We assert the result has balanced double quotes.
  for (const input of ['a(b)c', 'x" OR "1"="1', 'foo:bar^2', '***', '"', 'a"b', 'NEAR(x y)']) {
    const out = buildFtsMatch(input);
    const quoteCount = (out.match(/"/g) || []).length;
    assert.equal(quoteCount % 2, 0, `unbalanced quotes for input ${JSON.stringify(input)}: ${out}`);
  }
});

test('only-operator / only-punctuation input yields empty (no dangling operator)', () => {
  assert.equal(buildFtsMatch('***'), '');
  assert.equal(buildFtsMatch('"'), '');
  assert.equal(buildFtsMatch('-'), '');
  assert.equal(buildFtsMatch('OR'), '');
});

test('unbalanced opening quote is tolerated', () => {
  assert.equal(buildFtsMatch('"hello'), '"hello"');
});
