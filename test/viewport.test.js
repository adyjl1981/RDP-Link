import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desktopSize } from '../public/model.js';
import { viewportController, usableViewport } from '../public/viewport.js';

test('desktop geometry is fixed across orientations and invalid viewport sizes', () => {
  for (const size of [[390, 650], [844, 310], [0, 0], [Infinity, NaN]])
    assert.deepEqual(desktopSize(...size), { width: 1920, height: 1080 });
});

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
