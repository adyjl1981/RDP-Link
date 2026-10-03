import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { profile, desktopSize } from '../public/model.js';
import { canConnect } from '../public/connection-policy.js';
import { viewportController, usableViewport } from '../public/viewport.js';
import { zoomState, installGestures, remotePoint } from '../public/zoom.js';

test('rotation while connecting and connected preserves the ticket, client and tunnel; explicit disconnect still works', async () => {
  const nodes = new Map(); const listeners = new Map(); const timers = new Map(); let timerID = 0;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', hidden: false, clientWidth: 844, clientHeight: 310,
      reportValidity: () => true, style: {}, setAttribute() {}, handlers: new Map(), addEventListener(type, fn) { this.handlers.set(type, fn); }, replaceChildren() {}, add() {}, focus() {}, blur() {},
      classList: { remove() {}, toggle() {}, contains() { return false; } },
      querySelector: () => node('connectButton') });
    return nodes.get(id);
  };
  node('session').hidden = true;
  node('connect').elements = { password: { value: 'secret' } };
  const values = { name: 'Desktop', host: 'desktop', port: '3389', username: 'me' };
  let currentScale = 1; let resolveFetch; let posted; let fetchCount = 0; let tunnels = 0; const clients = [];
  class Client {
    constructor() { clients.push(this); this.state = 1; this.requests = []; this.mouse = []; this.disconnects = 0; }
    getDisplay() { return { getElement: () => ({ addEventListener() {}, getBoundingClientRect: () => ({ left: -100, top: 20 }) }), getWidth: () => 1920, getHeight: () => 1080, scale(value) { currentScale = value; }, getScale: () => currentScale, showCursor() {} }; }
    sendMouseState(state) { this.mouse.push({ ...state }); }
    sendSize(...size) { this.requests.push(size); }
    connect(query) { this.query = query; this.state = 3; this.onstatechange(3); }
    disconnect() { this.disconnects++; this.state = 5; this.onstatechange(5); }
  }
  class Mouse { onEach() {} }
  Mouse.State = class {};
  const context = vm.createContext({ profile, desktopSize, canConnect, viewportController, usableViewport, zoomState, installGestures, remotePoint,
    Guacamole: { Client, Mouse, WebSocketTunnel: class { constructor() { tunnels++; } } },
    document: { getElementById: node, activeElement: { blur() {} }, documentElement: { style: { setProperty() {} } } },
    window: { innerHeight: 390, visualViewport: { height: 390, addEventListener: (name, fn) => listeners.set('visual:' + name, fn) }, addEventListener: (name, fn) => listeners.set(name, fn) },
    location: { protocol: 'http:', hostname: '192.168.1.50', host: '192.168.1.50:8080' },
    localStorage: { getItem: () => null, setItem() {} }, Option: class {},
    FormData: class { [Symbol.iterator]() { return Object.entries(values)[Symbol.iterator](); } },
    ResizeObserver: class { constructor(fn) { listeners.set('observer', fn); } observe() {} },
    AbortSignal, navigator: {},
    setTimeout: fn => { timers.set(++timerID, fn); return timerID; }, clearTimeout: id => timers.delete(id),
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
  assert.equal(posted.width, 844); assert.equal(posted.height, 310);
  node('viewport').clientWidth = 390; node('viewport').clientHeight = 650;
  listeners.get('resize')(); listeners.get('observer')(); flush();
  assert.equal(fetchCount, 1); assert.equal(node('session').hidden, false);
  resolveFetch({ ok: true, json: async () => ({ ticket: 'single-ticket' }) }); await pending; flush();
  assert.equal(clients.length, 1); assert.equal(tunnels, 1);
  assert.equal(clients[0].query, 'ticket=single-ticket');
  assert.deepEqual(clients[0].requests, [[390, 650]]);
  assert.equal(currentScale, 390 / 1920);
  node('viewport').clientWidth = 844; node('viewport').clientHeight = 310;
  listeners.get('orientationchange')(); listeners.get('observer')(); flush();
  listeners.get('pagehide')({ persisted: true }); listeners.get('pageshow')(); flush();
  assert.equal(clients.length, 1); assert.equal(tunnels, 1); assert.equal(clients[0].disconnects, 0);
  assert.deepEqual(clients[0].requests, [[390, 650], [844, 310]]);
  assert.equal(currentScale, 310 / 1080);
  const point = { clientX: -100 + 123 * currentScale, clientY: 20 + 78 * currentScale };
  const touchEvent = touches => ({ touches, changedTouches: [point], preventDefault() {}, stopImmediatePropagation() {} });
  node('viewport').handlers.get('touchstart')(touchEvent([point]));
  node('viewport').handlers.get('touchend')(touchEvent([]));
  assert.equal(clients[0].mouse.length, 2);
  for (const state of clients[0].mouse) {
    assert.ok(Math.abs(state.x - 123) < 1e-10);
    assert.ok(Math.abs(state.y - 78) < 1e-10);
  }
  assert.equal(clients[0].mouse[0].left, true);
  assert.equal(clients[0].mouse[1].left, false);
  node('controlsButton').onclick(); node('fitButton').onclick(); flush();
  assert.equal(clients.length, 1); assert.equal(tunnels, 1); assert.equal(clients[0].disconnects, 0);
  node('disconnect').onclick(); flush();
  assert.equal(clients[0].disconnects, 1); assert.equal(node('session').hidden, true);
  assert.equal(node('home').hidden, false); assert.equal(node('connectButton').disabled, false);
});
