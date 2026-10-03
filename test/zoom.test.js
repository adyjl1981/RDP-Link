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
  assert.deepEqual(z.layout(300, 150, 300, 600), { zoom: 2, x: 150, y: 0, scale: 2 });
  assert.deepEqual(z.pinch(0.01, 0, 0), { zoom: 1, x: 0, y: 0 });
});

function gestures(move) {
  const handlers = new Map(), taps = []; let renders = 0;
  const element = { addEventListener(type, fn, options) {
    assert.equal(options.passive, false); assert.equal(options.capture, true); handlers.set(type, fn);
  }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }) };
  const z = zoomState(); z.layout(400, 400, 400, 400);
  installGestures(element, z, () => renders++, { tap: p => taps.push(p), move });
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


test('default viewport is native scale; pan works before zoom and fit is explicit', () => {
  const z = zoomState();
  assert.equal(z.layout(1920, 1080, 390, 650).scale, 1);
  assert.deepEqual(z.pan(100, -100), { zoom: 1, x: 100, y: -100 });
  assert.equal(z.layout(1920, 1080, 844, 310).scale, 1);
  z.fit();
  assert.equal(z.layout(1920, 1080, 844, 310).scale, 310 / 1080);
  z.reset(); assert.equal(z.layout(1920, 1080, 844, 310).scale, 1);
});

test('one-finger pan at native scale never clicks; small tap jitter does', () => {
  const h = gestures(); h.z.layout(1920, 1080, 400, 400);
  h.fire('touchstart', [[200, 200]]); h.fire('touchmove', [[240, 220]]);
  h.fire('touchend', [], [[240, 220]]);
  assert.deepEqual(h.z.get(), { zoom: 1, x: 40, y: 20 });
  assert.equal(h.taps.length, 0);
  h.fire('touchstart', [[200, 200]]); h.fire('touchmove', [[202, 201]]);
  h.fire('touchend', [], [[202, 201]]); assert.equal(h.taps.length, 1);
});

test('pointer mapping combines centered desktop, pan and zoom after rotation', () => {
  const z = zoomState(); z.layout(1920, 1080, 390, 650);
  z.pan(100, -50); z.pinch(2, 0, 0);
  const t = z.layout(1920, 1080, 844, 310);
  const rect = { left: (844 - 1920 * t.scale) / 2 + t.x,
    top: (310 - 1080 * t.scale) / 2 + t.y };
  assert.deepEqual(remotePoint({ x: rect.left + 900 * t.scale, y: rect.top + 450 * t.scale },
    rect, t.scale, 1920, 1080), { x: 900, y: 450 });
});

test('cursor follow starts at the exact edge, pins the cursor, and stops on reversal at every zoom', () => {
  for (const scale of [0.5, 1, 2, 4]) {
    for (const [axis, direction, extent] of [['x', -1, 390], ['x', 1, 390], ['y', -1, 310], ['y', 1, 310]]) {
      const z = zoomState(); z.layout(1920, 1080, 390, 310); z.pinch(scale, 0, 0);
      let cursor = { x: 960, y: 540 };
      const move = amount => {
        cursor = z.followCursor(cursor, axis === 'x' ? amount : 0, axis === 'y' ? amount : 0);
      };
      const screen = () => extent / 2 + z.get()[axis] + (cursor[axis] - (axis === 'x' ? 960 : 540)) * scale;
      move(direction * (extent / 2 - 0.25));
      assert.equal(z.get()[axis], 0, 'no early edge margin');
      move(direction * 0.25);
      assert.equal(z.get()[axis], 0, 'arrival at edge alone does not pan');
      move(direction * 20);
      assert.equal(z.get()[axis], -direction * 20);
      assert.equal(screen(), direction < 0 ? 0 : extent);
      move(direction * 10);
      assert.equal(z.get()[axis], -direction * 30);
      assert.equal(screen(), direction < 0 ? 0 : extent);
      move(-direction * 1);
      assert.equal(z.get()[axis], -direction * 30, 'reversal stops panning immediately');
      assert.equal(screen(), direction < 0 ? 1 : extent - 1);
    }
  }
});

test('edge crossing pans only the overflow and preserves remote coordinates at desktop bounds', () => {
  const z = zoomState(); z.layout(1920, 1080, 390, 310);
  let cursor = z.followCursor({ x: 960, y: 540 }, 200, -160);
  assert.deepEqual(cursor, { x: 1160, y: 380 });
  assert.deepEqual(z.get(), { zoom: 1, x: -5, y: 5 });
  cursor = z.followCursor(cursor, 10000, -10000);
  assert.deepEqual(cursor, { x: 1919, y: 0 });
  assert.deepEqual(z.get(), { zoom: 1, x: -764, y: 385 });
  assert.deepEqual(z.followCursor(cursor, 10, -10), cursor);
  assert.deepEqual(z.get(), { zoom: 1, x: -764, y: 385 });
});

test('a fitted desktop never pans while the cursor moves to its bounds', () => {
  const z = zoomState(); z.layout(1920, 1080, 390, 650); z.fit();
  const before = z.get();
  assert.deepEqual(z.followCursor({ x: 960, y: 540 }, -10000, 10000), { x: 0, y: 1079 });
  assert.deepEqual(z.get(), before);
});

test('cursor gestures deliver small movements without a dead zone and ignore a remaining pinch finger', () => {
  const handlers = new Map(), moves = [];
  const element = { addEventListener: (name, fn) => handlers.set(name, fn),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 650 }) };
  const z = zoomState(); z.layout(1920, 1080, 390, 650);
  installGestures(element, z, () => {}, { move: (dx, dy) => moves.push([dx, dy]) });
  const fire = (type, points) => handlers.get(type)({ touches: points.map(([clientX, clientY]) => ({ clientX, clientY })), changedTouches: [],
    preventDefault() {}, stopImmediatePropagation() {} });
  fire('touchstart', [[100, 100]]); fire('touchmove', [[101, 99]]);
  assert.deepEqual(moves, [[1, -1]]);
  fire('touchstart', [[101, 99], [201, 99]]);
  fire('touchend', [[101, 99]]); fire('touchmove', [[120, 99]]);
  assert.deepEqual(moves, [[1, -1]]);
  assert.equal(z.get().x, 0);
});


test('trackpad taps use cumulative travel, suppress release-only movement and reject long touches', t => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const moves = [], h = gestures((dx, dy) => moves.push([dx, dy]));
  h.fire('touchstart', [[100, 100]]);
  // Repeated small reversals exceed the threshold despite ending at the start.
  for (let i = 0; i < 4; i++) h.fire('touchmove', [[i % 2 ? 100 : 104, 100]]);
  h.fire('touchend', [], [[100, 100]]);
  assert.equal(h.taps.length, 0); assert.equal(moves.length, 4);
  h.fire('touchstart', [[100, 100]]); h.fire('touchend', [], [[120, 100]]);
  assert.equal(h.taps.length, 0);
  h.fire('touchstart', [[100, 100]]); now += 301;
  h.fire('touchend', [], [[100, 100]]); assert.equal(h.taps.length, 0);
  h.fire('touchstart', [[100, 100]]);
  h.fire('gesturestart', []); h.fire('touchend', [], [[100, 100]]);
  assert.equal(h.taps.length, 0);
});
