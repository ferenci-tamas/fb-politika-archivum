import test from 'node:test';
import assert from 'node:assert/strict';
import { niceMax } from '../src/ui/line-chart.js';

test('niceMax rounds up to 1/2/5 × 10^k', () => {
  assert.equal(niceMax(1), 1);
  assert.equal(niceMax(2), 2);
  assert.equal(niceMax(3), 5);
  assert.equal(niceMax(5), 5);
  assert.equal(niceMax(6), 10);
  assert.equal(niceMax(50), 50);
  assert.equal(niceMax(51), 100);
  assert.equal(niceMax(150), 200);
  assert.equal(niceMax(1000), 1000);
  assert.equal(niceMax(1001), 2000);
});

test('niceMax handles zero and negatives defensively', () => {
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(-5), 1);
});
