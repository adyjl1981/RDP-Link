import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { profile, desktopSize } from '../public/model.js';
import { canConnect } from '../public/connection-policy.js';
import { viewportController } from '../public/viewport.js';
import { zoomState, installGestures } from '../public/zoom.js';

test('rotation while connecting and connected preserves the ticket, client and tunnel; explicit disconnect still works', async () => {
  const nodes = new Map(); const listeners = new Map(); const timers = new Map(); let timerID = 0;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', hidden: false, clientWidth: 844, clientHeight: 310,
      style: {}, setAttribute() {}, addEventListener() {}, replaceChildren() {}, add() {}, focus() {}, blur() {},
      classList: { remove() {}, toggle() {}, contains() { return false; } },
      querySelector: () => node('submit') });
    return nodes.get(id);
  };
  node('session').hidden = true;
  node('connect').elements = { password: { value: 'secret' } };
  const values = { name: 'Desktop', host: 'desktop', port: '3389', username: 'me' };
  let resolveFetch; let posted; let fetchCount = 0; let tunnels = 0; const clients = [];
  class Client {
    constructor() { clients.push(this); this.state = 1; this.requests = []; this.disconnects = 0; }
    getDisplay() { return { getElement: () => ({ addEventListener() {} }), getWidth: () => 844, getHeight: () => 310, scale() {} }; }
    getState() { return this.state; }
    sendSize(...size) { this.requests.push(size); }
    connect(query) { this.query = query; this.state = 3; this.onstatechange(3); }
    disconnect() { this.disconnects++; this.state = 5; this.onstatechange(5); }
  }
  class Mouse { onEach() {} }
  Mouse.Touchpad = Mouse;
  const context = vm.createContext({ profile, desktopSize, canConnect, viewportController, zoomState, installGestures,
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
  const pending = node('connect').onsubmit({ preventDefault() {} });
  assert.equal(posted.width, 844); assert.equal(posted.height, 310);
  node('viewport').clientWidth = 390; node('viewport').clientHeight = 650;
  listeners.get('resize')(); listeners.get('observer')(); flush();
  assert.equal(fetchCount, 1); assert.equal(node('session').hidden, false);
  resolveFetch({ ok: true, json: async () => ({ ticket: 'single-ticket' }) }); await pending; flush();
  assert.equal(clients.length, 1); assert.equal(tunnels, 1);
  assert.equal(clients[0].query, 'ticket=single-ticket');
  assert.deepEqual(clients[0].requests, [[390, 650]]);
  node('viewport').clientWidth = 844; node('viewport').clientHeight = 310;
  listeners.get('visual:resize')(); listeners.get('observer')(); flush();
  listeners.get('pagehide')({ persisted: true }); listeners.get('pageshow')(); flush();
  assert.equal(clients.length, 1); assert.equal(tunnels, 1); assert.equal(clients[0].disconnects, 0);
  assert.deepEqual(clients[0].requests, [[390, 650], [844, 310]]);
  node('controlsButton').onclick(); node('fitButton').onclick(); flush();
  assert.equal(clients.length, 1); assert.equal(tunnels, 1); assert.equal(clients[0].disconnects, 0);
  node('disconnect').onclick(); flush();
  assert.equal(clients[0].disconnects, 1); assert.equal(node('session').hidden, true);
  assert.equal(node('home').hidden, false); assert.equal(node('submit').disabled, false);
});
