import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeExternalUrl, imageUrl, parseImages, parseLinks } from '../src/lib/sanitize.js';

const IMAGES = 'https://cdn.example.com/images/';

test('accepts http and https URLs', () => {
  assert.equal(safeExternalUrl('https://facebook.com/x'), 'https://facebook.com/x');
  assert.equal(safeExternalUrl('http://example.org/a?b=1#c'), 'http://example.org/a?b=1#c');
});

test('rejects dangerous schemes', () => {
  for (const u of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,<script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'mailto:a@b.com'
  ]) {
    assert.equal(safeExternalUrl(u), null, `should reject: ${JSON.stringify(u)}`);
  }
});

test('rejects relative, empty and non-string input', () => {
  for (const u of ['', '   ', '/relative/path', 'example.com/no-scheme', null, undefined, 42]) {
    assert.equal(safeExternalUrl(u), null);
  }
});

test('imageUrl builds a safe URL and encodes the filename', () => {
  const u = imageUrl('671744082_967958405925619_7985198561631859901_n.jpg', IMAGES);
  assert.equal(u, IMAGES + '671744082_967958405925619_7985198561631859901_n.jpg');
});

test('imageUrl prevents path traversal via encoding', () => {
  const u = imageUrl('../../secret.key', IMAGES);
  assert.ok(u.startsWith(IMAGES));
  assert.ok(u.includes('%2F'));
  assert.ok(!u.includes('../'));
});

test('imageUrl rejects empty filenames', () => {
  assert.equal(imageUrl('', IMAGES), null);
  assert.equal(imageUrl('   ', IMAGES), null);
});

test('parseImages handles valid, empty and malformed JSON', () => {
  assert.deepEqual(parseImages('["a.jpg","b.jpg"]'), ['a.jpg', 'b.jpg']);
  assert.deepEqual(parseImages(null), []);
  assert.deepEqual(parseImages('not json'), []);
  assert.deepEqual(parseImages('{"x":1}'), []);
  assert.deepEqual(parseImages('["ok", 5, "", "two"]'), ['ok', 'two']);
});

test('parseLinks parses [url, available] pairs', () => {
  assert.deepEqual(parseLinks('[["http://a",1],["http://b",0]]'), [
    { url: 'http://a', available: true },
    { url: 'http://b', available: false }
  ]);
  assert.deepEqual(parseLinks(null), []);
  assert.deepEqual(parseLinks('garbage'), []);
  // Shape-parsing only: a [string, flag] pair is kept (the URL itself is
  // validated later at render time); a pair whose first element is not a string
  // is dropped.
  assert.deepEqual(parseLinks('[["http://a",1],["bad"],[42,1]]'), [
    { url: 'http://a', available: true },
    { url: 'bad', available: false }
  ]);
});
