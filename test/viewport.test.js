import { desktopSize, displaySize } from '../public/model.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoomState } from '../public/zoom.js';
import { viewportController, usableViewport } from '../public/viewport.js';

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
