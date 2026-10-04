import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoomState, installGestures } from '../public/zoom.js';
function harness() {
  const handlers = new Map(), timers = new Map(), calls = []; let id = 0;
  const z = zoomState(); z.layout(1920, 1080, 390, 650);
  const control = installGestures({ addEventListener: (type, fn) => handlers.set(type, fn),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 650 }) }, z, () => calls.push(['render']), {
    tap: () => calls.push(['left']), rightClick: () => calls.push(['right']),
    move: (x, y) => calls.push(['move', x, y]), scroll: (x, y) => calls.push(['scroll', x, y]),
    schedule: fn => { timers.set(++id, fn); return id; }, cancel: id => timers.delete(id)
  });
  const fire = (type, points, changed = []) => handlers.get(type)({ touches: points.map(([clientX, clientY]) => ({ clientX, clientY })),
    changedTouches: changed.map(([clientX, clientY]) => ({ clientX, clientY })), preventDefault() {}, stopImmediatePropagation() {} });
  const hold = () => { const work = [...timers.values()]; timers.clear(); work.forEach(fn => fn()); };
  return { z, fire, calls, hold, control };
}
test('long press right-clicks once and cannot also move or left-click after firing', () => {
  const h = harness(); h.fire('touchstart', [[100, 100]]); h.hold(); h.hold();
  h.fire('touchmove', [[150, 100]]); h.fire('touchend', [], [[150, 100]]);
  assert.deepEqual(h.calls, [['right']]);
  h.fire('touchstart', [[100, 100]]); h.fire('touchend', [], [[100, 100]]); h.hold();
  assert.deepEqual(h.calls, [['right'], ['left']]);
});
test('movement, cancellation, native gesture and session reset cancel long press', () => {
  for (const cancel of [h => h.fire('touchmove', [[120, 100]]), h => h.fire('touchcancel', []),
    h => h.fire('gesturestart', []), h => h.control.reset()]) {
    const h = harness(); h.fire('touchstart', [[100, 100]]); cancel(h); h.hold();
    h.fire('touchend', [], [[120, 100]]); assert.ok(!h.calls.some(c => ['left', 'right'].includes(c[0])));
  }
});
test('two-finger translation scrolls without zoom, cursor movement or clicks, including remaining finger', () => {
  const h = harness(); h.fire('touchstart', [[100, 100], [200, 100]]);
  h.fire('touchmove', [[100, 105], [200, 105]]); assert.deepEqual(h.calls, []);
  h.fire('touchmove', [[100, 125], [200, 125]]); h.hold();
  h.fire('touchmove', [[80, 145], [220, 145]]); // Scroll mode stays locked even if distance changes.
  h.fire('touchend', [[80, 145]], [[220, 145]]); h.fire('touchmove', [[80, 170]]); h.fire('touchend', [], [[80, 170]]);
  assert.deepEqual(h.calls, [['scroll', 0, 25], ['scroll', 0, 20]]); assert.equal(h.z.get().zoom, 1);
});
test('pinch locks out scroll and clicks; Safari gesture events do not interrupt owned touches', () => {
  const h = harness(); h.fire('touchstart', [[100, 100], [200, 100]]);
  h.fire('gesturestart', []); h.fire('touchmove', [[50, 100], [250, 100]]);
  h.fire('gesturechange', []); h.fire('touchmove', [[50, 150], [250, 150]]);
  assert.equal(h.z.get().zoom, 2); h.hold();
  h.fire('touchend', [[50, 150]], [[250, 150]]); h.fire('touchend', [], [[50, 150]]);
  assert.deepEqual(h.calls, [['render'], ['render']]);
});
test('zoom-out depends only on initial gesture geometry despite intermediate clamping', () => {
  const run = distances => {
    const h = harness(); h.z.pinch(2, 0, 0); h.z.pan(1700, 0);
    h.fire('touchstart', [[50, 200], [250, 200]]);
    for (const d of distances) h.fire('touchmove', [[150 - d / 2, 200], [150 + d / 2, 200]]);
    return h.z.get();
  };
  assert.deepEqual(run([190, 170, 140, 120, 100]), run([100]));
  assert.deepEqual(run([100, 120, 140, 160, 180, 200]), run([400, 200]));
});
test('pinch preserves the remote point under its moving center away from bounds', () => {
  const h = harness(); h.fire('touchstart', [[100, 200], [200, 200]]);
  h.fire('touchmove', [[75, 210], [275, 210]]);
  const t = h.z.get();
  const x = (150 - 195) + 960, y = (200 - 325) + 540;
  assert.equal(195 + t.x + (x - 960) * t.zoom, 175);
  assert.equal(325 + t.y + (y - 540) * t.zoom, 210);
});
test('two-finger tap and three-finger sequences cannot click or leave a pending hold', () => {
  const h = harness(); h.fire('touchstart', [[100, 100], [200, 100]]); h.hold(); h.fire('touchend', [], [[100, 100]]);
  h.fire('touchstart', [[100, 100], [200, 100], [300, 100]]); h.fire('touchmove', [[90, 100], [210, 100], [300, 100]]);
  h.fire('touchend', [], [[100, 100]]); assert.deepEqual(h.calls, []);
});

test('Safari gestureend after the last touch leaves the next tap usable', () => {
  const h = harness(); h.fire('touchstart', [[100, 100], [200, 100]]);
  h.fire('gesturestart', []); h.fire('touchmove', [[50, 100], [250, 100]]);
  h.fire('touchend', [], [[50, 100]]); h.fire('gestureend', []);
  h.fire('touchstart', [[100, 100]]); h.fire('touchend', [], [[100, 100]]);
  assert.deepEqual(h.calls.at(-1), ['left']);
});
