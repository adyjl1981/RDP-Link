import { desktopSize, displaySize } from '../public/model.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoomState, remotePoint } from '../public/zoom.js';
import { viewportController, usableViewport, sessionViewport, keyboardViewport } from '../public/viewport.js';

function harness() {
  let size = { width: 844, height: 310 }; let state = 1; let pending; let scales = []; let requests = [];
  const display = { getWidth: () => 1920, getHeight: () => 1080, scale: value => scales.push(value) };
  const original = { getState: () => state, getDisplay: () => display, sendSize: (...args) => requests.push(args) };
  let client = original;
  const sizing = viewportController({ getClient: () => client, isConnected: () => state === 3, measure: () => size,
    schedule: callback => { pending = callback; return callback; }, cancel: () => { pending = undefined; } });
  return { sizing, original, requests, scales, flush: () => pending?.(),
    size: value => size = value, state: value => state = value, client: value => client = value };
}

test('rotation, keyboard, reconnect and transient layouts never send remote resize', () => {
  const h = harness(); h.state(3);
  for (const size of [{ width: 390, height: 650 }, { width: 844, height: 310 }, { width: 390, height: 260 }]) {
    h.size(size); h.sizing.resize(); h.flush();
    assert.deepEqual(h.requests, []); assert.equal(h.scales.at(-1), 1);
  }
  const count = h.scales.length;
  h.size({ width: 0, height: 0 }); h.sizing.resize();
  assert.equal(h.scales.length, count);
  h.sizing.reset(); h.client(null); h.sizing.resize();
  assert.deepEqual(h.requests, []);
});

test('Safari rotation rejects stale visual dimensions', () => {
  assert.deepEqual(usableViewport({ innerWidth: 844, innerHeight: 390,
    visualViewport: { width: 390, height: 650 } }), { width: 844, height: 390 });
});

test('keyboard height reduction uses visual viewport even when its aspect flips', () => {
  assert.deepEqual(usableViewport({ innerWidth: 390, innerHeight: 650,
    visualViewport: { width: 390, height: 260 } }), { width: 390, height: 260 });
});

test('server desktop changes drive local pan bounds and Fit screen after rotation', () => {
  const zoom = zoomState();
  let desktop = [2560, 1440], viewport = { width: 390, height: 650 };
  let transform;
  const display = { getWidth: () => desktop[0], getHeight: () => desktop[1], scale() {} };
  const client = { getDisplay: () => display, sendSize() { assert.fail('remote resize'); } };
  const sizing = viewportController({ getClient: () => client, measure: () => viewport,
    render(d, _scale, w, h) { transform = zoom.layout(d.getWidth(), d.getHeight(), w, h); } });
  for (const dimensions of [[2560, 1440], [1366, 768], [1080, 1920]]) {
    desktop = dimensions; zoom.reset(); sizing.resize();
    assert.equal(transform.scale, 1);
    const pan = zoom.pan(1e6, -1e6);
    assert.equal(pan.x, Math.max(0, (desktop[0] - viewport.width) / 2));
    assert.equal(pan.y, -Math.max(0, (desktop[1] - viewport.height) / 2));
    viewport = { width: 844, height: 310 }; sizing.resize();
    zoom.fit(); sizing.fit();
    assert.equal(transform.scale, Math.min(viewport.width / desktop[0], viewport.height / desktop[1]));
    assert.equal(transform.x, 0); assert.equal(transform.y, 0);
  }
});

test('desktop negotiation size and local fallback are independent of phone geometry', () => {
  for (const size of [[390, 650], [844, 310], [0, 0], [Infinity, NaN]]) {
    assert.deepEqual(desktopSize(...size), { width: 1920, height: 1080 });
  }
  for (const [width, height] of [[0, 0], [1920, 0], [0, 1080], [Infinity, 1080], [1920, NaN]]) {
    assert.deepEqual(displaySize({ getWidth: () => width, getHeight: () => height }),
      { width: 1920, height: 1080 });
  }
});

test('reported Guacamole dimensions supersede the initial fallback for local pan bounds', () => {
  const zoom = zoomState();
  let desktop = [0, 0];
  const display = { getWidth: () => desktop[0], getHeight: () => desktop[1] };
  const client = { getDisplay: () => display, sendSize() { assert.fail('remote resize'); } };
  const sizing = viewportController({ getClient: () => client,
    measure: () => ({ width: 390, height: 650 }),
    render(d, _scale, w, h) {
      const size = displaySize(d);
      zoom.layout(size.width, size.height, w, h);
    } });
  sizing.resize();
  assert.deepEqual(zoom.pan(1e6, 1e6), { zoom: 1, x: 765, y: 215 });
  for (const dimensions of [[2560, 1440], [1366, 768]]) {
    desktop = dimensions; sizing.fit();
    assert.deepEqual(zoom.pan(1e6, 1e6), {
      zoom: 1, x: (desktop[0] - 390) / 2, y: (desktop[1] - 650) / 2
    });
  }
});


test('Safari visual offsets follow keyboard scrolling and stale rotation offsets are ignored', () => {
  assert.deepEqual(sessionViewport({ innerWidth: 390, innerHeight: 650,
    visualViewport: { width: 390, height: 260, offsetTop: 120, offsetLeft: 3 } }),
    { width: 390, height: 260, top: 120, left: 3, occlusion: 390 });
  assert.deepEqual(sessionViewport({ innerWidth: 844, innerHeight: 390,
    visualViewport: { width: 390, height: 650, offsetTop: 120 } }),
    { width: 844, height: 390, top: 0, left: 0, occlusion: 0 });
  assert.deepEqual(sessionViewport({ innerWidth: 390, innerHeight: 650 }),
    { width: 390, height: 650, top: 0, left: 0, occlusion: 0 });
});

for (const [name, normal, reduced] of [
  ['portrait', [390, 650], [390, 220]], ['landscape', [844, 390], [844, 120]]
]) test(`keyboard ${name}: reveal clicked region at zoom, preserve manual pan and restore after dismissal`, () => {
  const zoom = zoomState(), keyboard = keyboardViewport(zoom);
  const layout = (view, occlusion) => {
    zoom.layout(1920, 1080, ...view); keyboard.layout(1920, 1080, ...view, occlusion);
  };
  layout(normal, 0); zoom.pinch(2, 0, 0); zoom.pan(-300, -180);
  const saved = zoom.get(), anchor = { x: 1150, y: 700 };
  keyboard.begin(anchor); anchor.y = 0; // Snapshot the remote target, never infer a caret.
  layout(reduced, 300);
  const state = zoom.get();
  const screenY = (reduced[1] - 1080 * state.zoom) / 2 + state.y + 700 * state.zoom;
  assert.ok(screenY >= 0 && screenY <= reduced[1] - Math.min(48, reduced[1] / 4));
  zoom.pan(20, 20); const manual = zoom.get(); layout(reduced, 300);
  assert.deepEqual(zoom.get(), manual, 'ordinary renders must not undo manual panning');
  const rect = { left: (reduced[0] - 1920 * manual.zoom) / 2 + manual.x,
    top: (reduced[1] - 1080 * manual.zoom) / 2 + manual.y };
  const mapped = remotePoint({ x: rect.left + 1150 * manual.zoom, y: rect.top + 700 * manual.zoom }, rect, manual.zoom, 1920, 1080);
  assert.deepEqual(mapped, { x: 1150, y: 700 });
  keyboard.dismiss(); layout(reduced, 300);
  assert.deepEqual(zoom.get(), manual, 'wait for the keyboard closing animation');
  layout(normal, 0); assert.deepEqual(zoom.get(), saved);
});

test('rotation while typing reanchors once; missing tracking permits local pan and reset discards restoration', () => {
  const zoom = zoomState(), keyboard = keyboardViewport(zoom);
  zoom.layout(1920, 1080, 390, 650); zoom.pinch(1.5, 0, 0);
  keyboard.begin({ x: 1300, y: 800 });
  for (const [w, h] of [[390, 220], [844, 120], [390, 220]]) {
    zoom.layout(1920, 1080, w, h); keyboard.layout(1920, 1080, w, h, 300);
    const s = zoom.get();
    const y = (h - 1080 * s.zoom) / 2 + s.y + 800 * s.zoom;
    assert.ok(y >= 0 && y <= h);
  }
  keyboard.reset(); keyboard.begin(null);
  zoom.pan(0, 30); const manual = zoom.get();
  keyboard.layout(1920, 1080, 390, 220, 300); assert.deepEqual(zoom.get(), manual);
  keyboard.reset(); keyboard.dismiss(); zoom.reset();
  keyboard.layout(1920, 1080, 390, 650, 0); assert.equal(zoom.get().zoom, 1);
});
