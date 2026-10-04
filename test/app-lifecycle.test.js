import { installKeyboard } from '../public/keyboard.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { profile, displaySize, profileStore } from '../public/model.js';
import { canConnect } from '../public/connection-policy.js';
import { viewportController, usableViewport, sessionViewport, keyboardViewport } from '../public/viewport.js';
import { zoomState, installGestures, remotePoint } from '../public/zoom.js';

test('rotation while connecting and connected preserves the ticket, client and tunnel; explicit disconnect still works', async () => {
  const nodes = new Map(); const listeners = new Map(); const timers = new Map(); let timerID = 0; let frames = 0;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', hidden: false, clientWidth: 844, clientHeight: 310,
      reportValidity: () => true, style: {}, setAttribute() {}, handlers: new Map(), addEventListener(type, fn) { this.handlers.set(type, fn); }, replaceChildren() {}, add() {}, focus() {}, blur() {},
      classList: { remove() {}, toggle() {}, contains() { return false; } },
      querySelector: () => node('connectButton') });
    return nodes.get(id);
  };
  node('session').hidden = true;
  node('connect').elements = Object.fromEntries(['name', 'host', 'port', 'username', 'password'].map(key => [key, { value: key === 'password' ? 'secret' : '' }]));
  const values = { name: 'Desktop', host: 'desktop', port: '3389', username: 'me' };
  let stored = '';
  let currentScale = 1; let resolveFetch; let posted; let fetchCount = 0; let tunnels = 0; const clients = [];
  class Client {
    constructor() { clients.push(this); this.state = 1; this.requests = []; this.mouse = []; this.disconnects = 0; }
    getDisplay() { return { getElement: () => ({ addEventListener() {}, getBoundingClientRect: () => ({ left: -100, top: 20 }) }), getWidth: () => 1920, getHeight: () => 1080, scale(value) { currentScale = value; }, getScale: () => currentScale, showCursor() {}, moveCursor() {} }; }
    sendMouseState(state) { this.mouse.push({ ...state }); }
    sendSize(...size) { this.requests.push(size); }
    connect(query) { this.query = query; this.state = 3; this.onstatechange(3); }
    disconnect() { this.disconnects++; this.state = 5; this.onstatechange(5); }
  }
  class Mouse { onEach() {} }
  Mouse.State = class {};
  const context = vm.createContext({ installKeyboard, profile, displaySize, profileStore, canConnect, viewportController, usableViewport, sessionViewport, keyboardViewport, zoomState, installGestures, remotePoint,
    Guacamole: { Client, Mouse, WebSocketTunnel: class { constructor() { tunnels++; } } },
    document: { addEventListener: (name, fn) => listeners.set('document:' + name, fn), getElementById: node, activeElement: { blur() {} }, documentElement: { style: { setProperty() {} } } },
    window: { innerHeight: 390, visualViewport: { height: 390, addEventListener: (name, fn) => listeners.set('visual:' + name, fn) }, addEventListener: (name, fn) => listeners.set(name, fn) },
    location: { protocol: 'http:', hostname: '192.168.1.50', host: '192.168.1.50:8080' },
    localStorage: { getItem: () => null, setItem(_key, value) { stored = value; } }, Option: class {},
    FormData: class { [Symbol.iterator]() { return Object.entries(values)[Symbol.iterator](); } },
    ResizeObserver: class { constructor(fn) { listeners.set('observer', fn); } observe() {} },
    AbortSignal, navigator: {},
    setTimeout: fn => { timers.set(++timerID, fn); return timerID; }, clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => { frames++; timers.set(++timerID, fn); return timerID; }, cancelAnimationFrame: id => timers.delete(id),
    fetch: (_url, options) => { fetchCount++; posted = JSON.parse(options.body); return new Promise(resolve => resolveFetch = resolve); }
  });
  // Inject deterministic scheduling into the production viewport controller.
  context.viewportController = options => viewportController({ ...options, schedule: context.setTimeout, cancel: context.clearTimeout });
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  vm.runInContext(source, context);
  const flush = () => { const work = [...timers.values()]; timers.clear(); work.forEach(fn => fn()); };
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<button id="connectButton" type="button">Connect<\/button>/);
  assert.doesNotMatch(html.match(/<form id="connect">[\s\S]*?<\/form>/)[0], /type="submit"|\baction=|\bhref=|\bdownload=/);
  const click = new Event('click', { cancelable: true });
  const pending = node('connectButton').onclick(click);
  assert.equal(click.defaultPrevented, true);
  const submit = new Event('submit', { cancelable: true });
  await node('connect').onsubmit(submit);
  assert.equal(submit.defaultPrevented, true);
  assert.equal(fetchCount, 1);
  assert.equal(Object.hasOwn(posted, 'width'), false); assert.equal(Object.hasOwn(posted, 'height'), false);
  node('viewport').clientWidth = 390; node('viewport').clientHeight = 650;
  listeners.get('resize')(); listeners.get('observer')(); flush();
  assert.equal(fetchCount, 1); assert.equal(node('session').hidden, false);
  resolveFetch({ ok: true, json: async () => ({ ticket: 'single-ticket' }) }); await pending; flush();
  assert.equal(clients.length, 1); assert.equal(tunnels, 1);
  assert.equal(clients[0].query, 'ticket=single-ticket');
  assert.deepEqual(clients[0].requests, []);
  assert.equal(currentScale, 1);
  node('viewport').clientWidth = 844; node('viewport').clientHeight = 310;
  listeners.get('orientationchange')(); listeners.get('observer')(); flush();
  listeners.get('pagehide')({ persisted: true }); listeners.get('pageshow')(); flush();
  assert.equal(clients.length, 1); assert.equal(tunnels, 1); assert.equal(clients[0].disconnects, 0);
  assert.deepEqual(clients[0].requests, []);
  assert.equal(currentScale, 1);
  const point = { clientX: -100 + 123 * currentScale, clientY: 20 + 78 * currentScale };
  const touchEvent = touches => ({ touches, changedTouches: [point], preventDefault() {}, stopImmediatePropagation() {} });
  node('viewport').handlers.get('touchstart')(touchEvent([point]));
  node('viewport').handlers.get('touchend')(touchEvent([]));
  assert.equal(clients[0].mouse.length, 2);
  for (const state of clients[0].mouse) {
    assert.ok(Math.abs(state.x - 960) < 1e-10);
    assert.ok(Math.abs(state.y - 540) < 1e-10);
  }
  assert.equal(clients[0].mouse[0].left, true);
  assert.equal(clients[0].mouse[1].left, false);
  node('viewport').handlers.get('touchstart')(touchEvent([point]));
  node('viewport').handlers.get('touchmove')(touchEvent([{ clientX: point.clientX + 1, clientY: point.clientY + 1 }]));
  assert.equal(clients[0].mouse.at(-1).x, 961);
  assert.equal(clients[0].mouse.at(-1).y, 541);
  node('viewport').handlers.get('touchcancel')(touchEvent([]));
  // Exercise the actual app callbacks: taps use the tracked remote cursor,
  // including after movement, exact-edge panning, and pinch zoom.
  node('viewport').getBoundingClientRect = () => ({ left: 0, top: 0, width: 844, height: 310 });
  const fire = (type, points, changed = []) => node('viewport').handlers.get(type)({
    touches: points.map(([clientX, clientY]) => ({ clientX, clientY })),
    changedTouches: changed.map(([clientX, clientY]) => ({ clientX, clientY })),
    preventDefault() {}, stopImmediatePropagation() {}
  });
  const mouse = clients[0].mouse;
  const assertClick = (before, x, y) => {
    assert.equal(mouse.length, before + 2);
    assert.deepEqual(mouse.slice(-2).map(s => [s.x, s.y, s.left]), [[x, y, true], [x, y, false]]);
  };
  let before = mouse.length;
  fire('touchstart', [[20, 20]]); fire('touchmove', [[22, 21]]); fire('touchend', [], [[22, 21]]);
  assertClick(before + 1, 963, 542); // Minor wobble still clicks after its pointer update.
  before = mouse.length;
  fire('touchstart', [[20, 20]]); fire('touchend', [], [[20, 20]]);
  assertClick(before, 963, 542); // Consecutive taps each click, without resetting zoom.
  before = mouse.length;
  fire('touchstart', [[20, 20]]); fire('touchmove', [[50, 20]]); fire('touchend', [], [[50, 20]]);
  assert.equal(mouse.length, before + 1);
  assert.equal(mouse.at(-1).left, undefined);
  before = mouse.length;
  fire('touchstart', [[20, 20]]); fire('touchmove', [[520, 20]]); fire('touchend', [], [[520, 20]]);
  assert.equal(mouse.length, before + 1);
  assert.equal(mouse.at(-1).x, 1493);
  assert.equal(node('display').style.transform, 'translate(-111px, 0px)');
  before = mouse.length;
  fire('touchstart', [[100, 100]]);
  fire('touchstart', [[100, 100], [200, 100]]);
  const previousFrames = frames;
  fire('touchmove', [[60, 100], [240, 100]]);
  fire('touchmove', [[50, 100], [250, 100]]);
  assert.equal(frames, previousFrames + 1, 'pinch renders coalesce within one animation frame');
  assert.equal(currentScale, 1); flush();
  fire('touchend', [[50, 100]], [[250, 100]]);
  fire('touchmove', [[60, 100]]); fire('touchend', [], [[60, 100]]);
  assert.equal(mouse.length, before);
  assert.equal(currentScale, 2);
  fire('touchstart', [[5, 5]]); fire('touchend', [], [[5, 5]]);
  assertClick(before, 1493, 542);
  assert.equal(currentScale, 2);
  before = mouse.length;
  fire('touchstart', [[100, 100]]); flush(); fire('touchend', [], [[100, 100]]);
  assert.deepEqual(mouse.slice(before).map(s => [s.x, s.y, s.right]), [[1493, 542, true], [1493, 542, false]]);
  before = mouse.length;
  fire('touchstart', [[100, 100], [200, 100]]);
  fire('touchmove', [[100, 124], [200, 124]]); fire('touchmove', [[100, 148], [200, 148]]);
  fire('touchend', [[100, 148]], [[200, 148]]); fire('touchend', [], [[100, 148]]);
  assert.deepEqual(mouse.slice(before).map(s => [s.x, s.y, s.down]), [[1493, 542, true], [1493, 542, false], [1493, 542, true], [1493, 542, false]]);
  assert.equal(currentScale, 2);
  before = mouse.length;
  fire('touchstart', [[100, 100], [200, 100]]); fire('touchmove', [[100, 76], [200, 76]]); fire('touchend', [], [[100, 76]]);
  assert.deepEqual(mouse.slice(before).map(s => s.up), [true, false]);
  assert.equal(node('sessionNotice').hidden, true);
  // Real keyboard callbacks share the same client and render the latest state,
  // including a queued pinch frame and Safari offset changes during dismissal.
  const beforeKeyboard = node('display').style.transform;
  windowForKeyboard();
  function windowForKeyboard() {
    const win = vm.runInContext('window', context);
    win.innerWidth = 390; win.innerHeight = 650;
    win.visualViewport.width = 390; win.visualViewport.height = 650;
    node('viewport').clientWidth = 390; node('viewport').clientHeight = 650;
    listeners.get('resize')();
    const saved = node('display').style.transform;
    node('keyboard').value = 'old preview';
    node('sessionControls').hidden = false;
    node('keyboard').handlers.get('focus')();
    assert.equal(node('keyboard').value, '');
    assert.equal(node('sessionControls').hidden, true);
    win.visualViewport.height = 260; win.visualViewport.offsetTop = 100;
    node('viewport').clientHeight = 178;
    listeners.get('visual:resize')(); listeners.get('observer')(); flush();
    assert.notEqual(node('display').style.transform, saved);
    let prevented = false;
    node('panUp').handlers.get('pointerdown')({ preventDefault() { prevented = true; } });
    flush(); assert.equal(prevented, true);
    node('keyboard').handlers.get('blur')();
    win.visualViewport.height = 650; win.visualViewport.offsetTop = 0;
    node('viewport').clientHeight = 650;
    listeners.get('visual:resize')(); listeners.get('visual:scroll')(); flush();
    assert.equal(node('display').style.transform, saved);
    assert.equal(currentScale, 2);
    assert.equal(clients.length, 1); assert.equal(tunnels, 1);
    assert.equal(clients[0].disconnects, 0); assert.deepEqual(clients[0].requests, []);
    win.innerWidth = 844; win.innerHeight = 390;
    win.visualViewport.width = 844; win.visualViewport.height = 390;
    node('viewport').clientWidth = 844; node('viewport').clientHeight = 310;
    listeners.get('resize')();
  }
  assert.equal(node('display').style.transform, beforeKeyboard);
  node('controlsButton').onclick(); node('fitButton').onclick(); flush();
  assert.equal(clients.length, 1); assert.equal(tunnels, 1); assert.equal(clients[0].disconnects, 0);
  assert.deepEqual(clients[0].requests, []);
  node('disconnect').onclick(); flush();
  assert.equal(clients[0].disconnects, 1); assert.equal(node('session').hidden, true);
  assert.equal(node('home').hidden, false); assert.equal(node('connectButton').disabled, false);
  assert.equal(JSON.parse(stored)[0].zoom, 310 / 1080);
  node('profiles').value = '0'; node('profiles').onchange();
  assert.equal(node('connect').elements.host.value, 'desktop');
  assert.equal(node('connect').elements.port.value, 3389);
  assert.equal(node('connect').elements.password.value, '');
  values.name = 'Edited'; values.host = 'new-desktop'; node('saveProfile').onclick();
  assert.equal(JSON.parse(stored).length, 1); assert.equal(JSON.parse(stored)[0].name, 'Edited');
  node('profiles').value = ''; node('profiles').onchange();
  assert.equal(node('connect').elements.host.value, '');
  values.name = 'Second'; values.host = 'home'; node('saveProfile').onclick();
  assert.equal(JSON.parse(stored).length, 2);
  node('forget').onclick(); assert.equal(JSON.parse(stored).length, 1);
  assert.doesNotMatch(stored, /secret|password/);

  node('profiles').value = '0'; node('profiles').onchange();
  const reconnect = node('connectButton').onclick(new Event('click', { cancelable: true }));
  resolveFetch({ ok: true, json: async () => ({ ticket: 'second-ticket' }) }); await reconnect; flush();
  assert.equal(clients.length, 2); assert.equal(tunnels, 2);
  assert.equal(currentScale, 310 / 1080); assert.deepEqual(clients[1].requests, []);
  node('disconnect').onclick();

});
