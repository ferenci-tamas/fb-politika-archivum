import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PartMap } from '../src/lib/parts.js';

const manifest = {
  pageSize: 4096,
  size: 1000,
  parts: [
    { name: 'a', offset: 0, size: 600 },
    { name: 'b', offset: 600, size: 400 }
  ]
};

test('single-part slice', () => {
  const pm = new PartMap(manifest);
  assert.deepEqual(pm.slices(0, 100), [{ name: 'a', partStart: 0, length: 100, bufOffset: 0 }]);
});

test('slice spanning the part boundary splits into two', () => {
  const pm = new PartMap(manifest);
  assert.deepEqual(pm.slices(550, 100), [
    { name: 'a', partStart: 550, length: 50, bufOffset: 0 },
    { name: 'b', partStart: 0, length: 50, bufOffset: 50 }
  ]);
});

test('read starting exactly at a boundary', () => {
  const pm = new PartMap(manifest);
  assert.deepEqual(pm.slices(600, 50), [{ name: 'b', partStart: 0, length: 50, bufOffset: 0 }]);
});

test('final byte of the file', () => {
  const pm = new PartMap(manifest);
  assert.deepEqual(pm.slices(999, 1), [{ name: 'b', partStart: 399, length: 1, bufOffset: 0 }]);
});

test('zero-length read returns no slices', () => {
  const pm = new PartMap(manifest);
  assert.deepEqual(pm.slices(10, 0), []);
});

test('reading past EOF throws', () => {
  const pm = new PartMap(manifest);
  assert.throws(() => pm.slices(999, 2), RangeError);
});

test('negative offset throws', () => {
  const pm = new PartMap(manifest);
  assert.throws(() => pm.slices(-1, 10), RangeError);
});

test('rejects a manifest with a gap between parts', () => {
  assert.throws(
    () =>
      new PartMap({
        pageSize: 4096,
        size: 1000,
        parts: [
          { name: 'a', offset: 0, size: 500 },
          { name: 'b', offset: 600, size: 400 }
        ]
      })
  );
});

test('rejects a manifest whose parts do not cover the file', () => {
  assert.throws(
    () => new PartMap({ pageSize: 4096, size: 1001, parts: [{ name: 'a', offset: 0, size: 1000 }] })
  );
});
