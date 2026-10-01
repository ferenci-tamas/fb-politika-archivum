import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMultipart } from '../src/worker/multirange.js';

const T = (s) => new TextEncoder().encode(s);
function concat(...arrs) {
  const len = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

test('parseMultipart extracts each part by Content-Range start and bytes', () => {
  const b = 'BOUNDARY123';
  const body = concat(
    T(`--${b}\r\nContent-Type: application/octet-stream\r\nContent-Range: bytes 0-3/1000\r\n\r\n`),
    new Uint8Array([1, 2, 3, 4]),
    T(`\r\n--${b}\r\nContent-Range: bytes 500-502/1000\r\n\r\n`),
    new Uint8Array([9, 8, 7]),
    T(`\r\n--${b}--\r\n`)
  );
  const parts = parseMultipart(body, b);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].start, 0);
  assert.deepEqual([...parts[0].bytes], [1, 2, 3, 4]);
  assert.equal(parts[1].start, 500);
  assert.deepEqual([...parts[1].bytes], [9, 8, 7]);
});

test('parseMultipart handles a single part', () => {
  const b = 'X';
  const body = concat(T(`--${b}\r\nContent-Range: bytes 42-44/100\r\n\r\n`), new Uint8Array([5, 5, 5]), T(`\r\n--${b}--`));
  const parts = parseMultipart(body, b);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].start, 42);
  assert.deepEqual([...parts[0].bytes], [5, 5, 5]);
});

test('parseMultipart handles binary payloads containing CRLF', () => {
  const b = 'Z';
  const payload = new Uint8Array([13, 10, 0, 255, 13, 10]);
  const body = concat(T(`--${b}\r\nContent-Range: bytes 7-12/99\r\n\r\n`), payload, T(`\r\n--${b}--`));
  const parts = parseMultipart(body, b);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].start, 7);
  assert.deepEqual([...parts[0].bytes], [13, 10, 0, 255, 13, 10]);
});
