import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoomState } from '../public/zoom.js';

test('pinch anchors the desktop, pans within bounds, and resets proportionally', () => {
  const z = zoomState(); z.layout(800, 400, 800, 400);
  assert.deepEqual(z.pinch(2, 100, 50), { zoom: 2, x: -100, y: -50 });
  assert.deepEqual(z.pan(10000, -10000), { zoom: 2, x: 400, y: -200 });
  assert.equal(z.pinch(100, 0, 0).zoom, 4);
  assert.deepEqual(z.reset(), { zoom: 1, x: 0, y: 0 });
});

test('rotation and letterboxing clamp pan without losing zoom', () => {
  const z = zoomState(); z.layout(800, 400, 800, 400); z.pinch(2, 0, 0); z.pan(300, 200);
  assert.deepEqual(z.layout(300, 150, 300, 600), { zoom: 2, x: 150, y: 0 });
  assert.deepEqual(z.pinch(0.01, 0, 0), { zoom: 1, x: 0, y: 0 });
});
