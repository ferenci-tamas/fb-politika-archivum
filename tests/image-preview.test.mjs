import test from 'node:test';
import assert from 'node:assert/strict';
import { computePreviewPosition } from '../src/ui/image-preview.js';

const BOX = { w: 200, h: 150, vw: 1000, vh: 800, gap: 14, margin: 8 };

test('places the box below-right of the anchor when it fits', () => {
  const pos = computePreviewPosition({ x: 100, y: 100, ...BOX });
  assert.deepEqual(pos, { left: 114, top: 114 });
});

test('flips to the left of the anchor near the right edge', () => {
  // 950 + 14 + 200 = 1164 > 1000 - 8 -> flip: 950 - 14 - 200 = 736
  const pos = computePreviewPosition({ x: 950, y: 100, ...BOX });
  assert.equal(pos.left, 736);
  assert.equal(pos.top, 114);
});

test('flips above the anchor near the bottom edge', () => {
  // 780 + 14 + 150 = 944 > 800 - 8 -> flip: 780 - 14 - 150 = 616
  const pos = computePreviewPosition({ x: 100, y: 780, ...BOX });
  assert.equal(pos.top, 616);
  assert.equal(pos.left, 114);
});

test('clamps to the top-left margin when even the flip would overflow', () => {
  // Box larger than the viewport on both axes: flip goes negative, clamp to margin.
  const pos = computePreviewPosition({ x: 5, y: 5, w: 400, h: 400, vw: 420, vh: 420, gap: 14, margin: 8 });
  assert.deepEqual(pos, { left: 8, top: 8 });
});
