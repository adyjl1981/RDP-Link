import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desktopSize } from '../public/model.js';
import { viewportController } from '../public/viewport.js';

test('desktop requests readable CSS pixel sizes in both orientations and bounds invalid/huge input', () => {
  assert.deepEqual(desktopSize(390, 650), { width: 390, height: 650 });
  assert.deepEqual(desktopSize(844, 310), { width: 844, height: 310 });
  for (const dimensions of [[0, 0], [NaN, 600], [Infinity, 600], ['844', 310], [undefined, undefined]]) {
    assert.deepEqual(desktopSize(...dimensions), { width: 1280, height: 720 });
  }
  assert.deepEqual(desktopSize(8192, 4096), { width: 4096, height: 2048 });
  assert.deepEqual(desktopSize(390, 100), { width: 390, height: 200 });
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

test('landscape startup, rotation and keyboard changes resize the same connected client without duplicate requests', () => {
  const h = harness(); h.sizing.resize(); h.flush(); assert.deepEqual(h.requests, []);
  h.state(3); h.sizing.resize(); h.flush(); assert.deepEqual(h.requests, [[844, 310]]);
  h.size({ width: 390, height: 650 }); h.sizing.resize();
  h.size({ width: 390, height: 630 }); h.sizing.resize(); h.flush();
  assert.deepEqual(h.requests, [[844, 310], [390, 630]]);
  h.sizing.resize(); h.flush(); assert.equal(h.requests.length, 2);
  h.size({ width: 390, height: 300 }); h.sizing.resize(); h.flush();
  assert.deepEqual(h.requests.at(-1), [390, 300]);
  assert.equal(h.scales.at(-1), 390 / 1920);
  // Zero-sized transient rotation layouts cannot resize or collapse the display.
  const scaleCount = h.scales.length;
  h.size({ width: 0, height: 0 }); h.sizing.resize(); h.flush();
  assert.equal(h.requests.length, 3); assert.equal(h.scales.length, scaleCount);
});

test('disconnect cancels pending resize; reconnect sends size even if the viewport is unchanged', () => {
  const h = harness(); h.state(3); h.sizing.resize(); h.flush();
  h.size({ width: 390, height: 630 }); h.sizing.resize(); h.sizing.reset(); h.client(null); h.flush();
  assert.equal(h.requests.length, 1);
  h.client(h.original); h.sizing.resize(); h.flush();
  assert.deepEqual(h.requests.at(-1), [390, 630]);
  h.sizing.reset(); h.sizing.resize(); h.flush(); assert.equal(h.requests.length, 3);
});
