import { test } from 'node:test';
import assert from 'node:assert/strict';
import { be32, readVarint, interiorChild, leafOverflowHeads } from '../src/lib/btree.js';

const wbe16 = (b, o, v) => {
  b[o] = (v >> 8) & 0xff;
  b[o + 1] = v & 0xff;
};
const wbe32 = (b, o, v) => {
  b[o] = (v >>> 24) & 0xff;
  b[o + 1] = (v >>> 16) & 0xff;
  b[o + 2] = (v >>> 8) & 0xff;
  b[o + 3] = v & 0xff;
};
const wvarint = (b, o, v) => {
  if (v < 128) {
    b[o] = v;
    return 1;
  }
  b[o] = 0x80 | ((v >> 7) & 0x7f);
  b[o + 1] = v & 0x7f;
  return 2;
};

test('be32 and readVarint round-trip', () => {
  const b = new Uint8Array(8);
  wbe32(b, 0, 123456);
  assert.equal(be32(b, 0), 123456);
  const c = new Uint8Array(4);
  wvarint(c, 0, 100);
  assert.deepEqual(readVarint(c, 0), [100, 1]);
  const d = new Uint8Array(4);
  wvarint(d, 0, 200);
  assert.deepEqual(readVarint(d, 0), [200, 2]);
});

test('interiorChild routes rowids to the correct child page', () => {
  const buf = new Uint8Array(4096);
  buf[0] = 5; // interior table page
  wbe16(buf, 3, 2); // 2 cells
  wbe32(buf, 8, 12); // right-most child = 12
  wbe16(buf, 12, 100); // cell pointer 0
  wbe16(buf, 14, 110); // cell pointer 1
  wbe32(buf, 100, 10);
  wvarint(buf, 104, 100); // cell 0: child 10, key 100
  wbe32(buf, 110, 11);
  wvarint(buf, 114, 200); // cell 1: child 11, key 200
  assert.equal(interiorChild(buf, 0, 50), 10);
  assert.equal(interiorChild(buf, 0, 100), 10);
  assert.equal(interiorChild(buf, 0, 150), 11);
  assert.equal(interiorChild(buf, 0, 200), 11);
  assert.equal(interiorChild(buf, 0, 250), 12); // beyond all keys -> right-most
});

test('leafOverflowHeads returns [] when cells fit on the leaf', () => {
  const buf = new Uint8Array(4096);
  buf[0] = 13; // leaf table page
  wbe16(buf, 3, 1); // 1 cell
  wbe16(buf, 8, 300); // cell pointer (leaf header is 8 bytes)
  let o = 300;
  o += wvarint(buf, o, 10); // payload length 10 (well under the overflow threshold)
  wvarint(buf, o, 1); // rowid
  assert.deepEqual(leafOverflowHeads(buf, 0, 4096), []);
});
