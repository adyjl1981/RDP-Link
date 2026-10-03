import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoomState, installGestures, remotePoint } from '../public/zoom.js';

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

function gestures() {
  const handlers = new Map(), taps = []; let renders = 0;
  const element = { addEventListener(type, fn, options) {
    assert.equal(options.passive, false); assert.equal(options.capture, true); handlers.set(type, fn);
  }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }) };
  const z = zoomState(); z.layout(400, 400, 400, 400);
  installGestures(element, z, () => renders++, { tap: p => taps.push(p) });
  const fire = (type, ps, changed = []) => {
    const e = { touches: ps.map(([clientX, clientY]) => ({ clientX, clientY })),
      changedTouches: changed.map(([clientX, clientY]) => ({ clientX, clientY })),
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    handlers.get(type)(e); assert.equal(e.defaultPrevented, true); assert.equal(e.stopped, true);
  };
  return { fire, z, taps, renders: () => renders };
}

test('Safari touch taps click at fit and zoom; pinch owns the sequence and zoomed drag pans', () => {
  const h = gestures();
  h.fire('touchstart', [[200, 200]]); h.fire('touchend', [], [[200, 200]]);
  assert.deepEqual(h.taps, [{ x: 200, y: 200 }]);
  h.fire('touchstart', [[150, 200]]);
  h.fire('touchstart', [[150, 200], [250, 200]]);
  h.fire('touchmove', [[100, 200], [300, 200]]);
  assert.equal(h.z.get().zoom, 2); assert.equal(h.renders(), 1);
  h.fire('touchend', [[100, 200]], [[300, 200]]);
  h.fire('touchend', [], [[100, 200]]);
  assert.equal(h.taps.length, 1);
  h.fire('touchstart', [[200, 200]]); h.fire('touchend', [], [[200, 200]]);
  assert.equal(h.taps.length, 2);
  h.fire('touchstart', [[200, 200]]); h.fire('touchmove', [[240, 220]]); h.fire('touchend', [], [[240, 220]]);
  assert.equal(h.z.get().x, 40); assert.equal(h.z.get().y, 20); assert.equal(h.taps.length, 2);
  h.fire('gesturestart', []); h.fire('gesturechange', []); h.fire('gestureend', []);
});

test('cancelled touches never click; double tap resets zoom', () => {
  const h = gestures(); h.z.pinch(2, 0, 0);
  h.fire('touchstart', [[200, 200]]); h.fire('touchcancel', []);
  h.fire('touchend', [], [[200, 200]]); assert.equal(h.taps.length, 0);
  for (let i = 0; i < 2; i++) { h.fire('touchstart', [[200, 200]]); h.fire('touchend', [], [[200, 200]]); }
  assert.equal(h.z.get().zoom, 1); assert.equal(h.taps.length, 1);
});

test('absolute pointer mapping accounts for fit, zoom, translation and bounds', () => {
  for (const scale of [0.25, 0.5, 1, 2, 4]) {
    const rect = { left: -73, top: 41 };
    assert.deepEqual(remotePoint({ x: rect.left + 123 * scale, y: rect.top + 78 * scale }, rect, scale, 800, 600), { x: 123, y: 78 });
    assert.deepEqual(remotePoint({ x: -10000, y: 10000 }, rect, scale, 800, 600), { x: 0, y: 599 });
  }
});
