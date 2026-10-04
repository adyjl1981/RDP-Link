import Guacamole from '/guacamole.js';
import { installKeyboard } from './keyboard.js';
import { profile, displaySize, profileStore } from './model.js';
import { canConnect } from './connection-policy.js';
import { viewportController, sessionViewport, keyboardViewport } from './viewport.js';
import { zoomState, installGestures, remotePoint } from './zoom.js';
const $ = id => document.getElementById(id);
const form = $('connect'); const status = message => { $('status').textContent = message; $('sessionStatus').textContent = message; $('sessionNotice').textContent = message; $('sessionNotice').hidden = connected; };
let connected = false; let client = null; let generation = 0; let busy = false;
const store = profileStore({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) });
let selected = -1, activeProfile = -1;
function list() {
  $('profiles').replaceChildren(new Option('New connection', ''));
  store.list().forEach((p, i) => $('profiles').add(new Option(p.name, String(i))));
  $('profiles').value = selected < 0 ? '' : String(selected);
  $('forget').disabled = selected < 0;
}
list();
$('profiles').onchange = () => {
  selected = $('profiles').value === '' ? -1 : Number($('profiles').value);
  const p = store.list()[selected] ?? { name: '', host: '', port: 3389, username: '' };
  for (const key of ['name', 'host', 'port', 'username']) form.elements[key].value = p[key];
  form.elements.password.value = ''; list();
  status(selected < 0 ? 'New connection' : `${p.name} selected. Enter your password to connect.`);
};
function saveProfile() {
  try {
    const input = Object.fromEntries(new FormData(form));
    selected = store.save({ ...input, zoom: store.list()[selected]?.zoom }, selected);
    list(); status('Profile saved on this device.');
  } catch (error) { status(error.message || 'Profile could not be saved on this device.'); }
}
$('saveProfile').onclick = saveProfile;
$('forget').onclick = () => {
  if (selected < 0) return;
  try { store.remove(selected); selected = -1; $('profiles').value = ''; $('profiles').onchange(); status('Profile deleted.'); }
  catch { status('Profile could not be deleted on this device.'); }
};
const measure = () => ({ width: $('viewport').clientWidth, height: $('viewport').clientHeight });
const zoom = zoomState();
let remoteCursor = null, inputAnchor = null;
const keyboardView = keyboardViewport(zoom);
const sizing = viewportController({ getClient: () => client, isConnected: () => connected, measure, render(display, _scale, width, height) {
  const desktop = displaySize(display);
  zoom.layout(desktop.width, desktop.height, width, height);
  keyboardView.layout(desktop.width, desktop.height, width, height, sessionViewport(window).occlusion);
  const transform = { ...zoom.get(), scale: zoom.get().zoom };
  display.scale(transform.scale);
  $('display').style.transform = `translate(${transform.x}px, ${transform.y}px)`;
} });
let zoomFrame = null;
const renderZoom = () => {
  if (typeof requestAnimationFrame !== 'function') return sizing.fit();
  if (zoomFrame === null) zoomFrame = requestAnimationFrame(() => { zoomFrame = null; sizing.fit(); });
};
const gestures = installGestures($('viewport'), zoom, renderZoom, {
  schedule: setTimeout, cancel: clearTimeout,
  move: (dx, dy) => {
    if (!client || !connected) return;
    const display = client.getDisplay();
    sizing.fit();
    remoteCursor = zoom.followCursor(remoteCursor ?? {
      x: displaySize(display).width / 2, y: displaySize(display).height / 2
    }, dx, dy);
    sizing.fit();
    const state = new Guacamole.Mouse.State();
    Object.assign(state, remoteCursor);
    display.showCursor(true);
    client.sendMouseState(state);
    // Guacamole rounds protocol coordinates; retain subpixel local placement
    // so zoom does not pull the visible cursor away from the viewport edge.
    display.moveCursor(remoteCursor.x, remoteCursor.y);
  },
  rightClick: () => click('right'),
  scrollStart: () => { wheelY = 0; },
  scroll: (dx, dy) => wheel(dx, dy),
  tap: () => click('left')
});
function click(button) {
  if (!client || !connected) return;
  const display = client.getDisplay();
  remoteCursor ??= { x: displaySize(display).width / 2, y: displaySize(display).height / 2 };
  const state = new Guacamole.Mouse.State();
  Object.assign(state, remoteCursor);
  display.showCursor(true);
  inputAnchor = { ...remoteCursor };
  state[button] = true; client.sendMouseState(state);
  state[button] = false; client.sendMouseState(state);
}
let wheelY = 0;
function wheel(_dx, dy) {
  if (!client || !connected) return;
  wheelY += dy;
  const display = client.getDisplay();
  remoteCursor ??= { x: displaySize(display).width / 2, y: displaySize(display).height / 2 };
  while (Math.abs(wheelY) >= 24) {
    const state = new Guacamole.Mouse.State(); Object.assign(state, remoteCursor);
    const button = wheelY < 0 ? 'up' : 'down';
    state[button] = true; client.sendMouseState(state);
    state[button] = false; client.sendMouseState(state);
    wheelY -= Math.sign(wheelY) * 24;
  }
}
$('fitButton').onclick = () => { zoom.fit(); sizing.fit(); };
$('controlsButton').onclick = () => {
  if ($('keyboard').classList.contains('visible')) return;
  const expanded = $('sessionControls').hidden;
  $('sessionControls').hidden = !expanded;
  $('controlsButton').setAttribute('aria-expanded', String(expanded));
};
const scale = sizing.fit;
function resizeViewport() {
  // Safari's visual viewport also tracks the software keyboard and browser bars.
  const viewport = sessionViewport(window);
  document.documentElement.style.setProperty('--session-left', `${viewport.left}px`);
  document.documentElement.style.setProperty('--session-top', `${viewport.top}px`);
  document.documentElement.style.setProperty('--session-width', `${viewport.width}px`);
  document.documentElement.style.setProperty('--session-height', `${viewport.height}px`);
  sizing.resize();
}
new ResizeObserver(() => sizing.resize()).observe($('viewport'));
window.addEventListener('resize', resizeViewport);
window.visualViewport?.addEventListener('resize', resizeViewport);
window.visualViewport?.addEventListener('scroll', resizeViewport);
window.addEventListener('pageshow', resizeViewport);
// iOS can report the old visual viewport during the first orientation event.
const orientationResize = () => { resizeViewport(); setTimeout(resizeViewport, 350); setTimeout(resizeViewport, 750); };
window.addEventListener('orientationchange', orientationResize);
window.screen?.orientation?.addEventListener('change', orientationResize);
resizeViewport();
function end(message) {
  if (zoomFrame !== null) { cancelAnimationFrame(zoomFrame); zoomFrame = null; }
  gestures.reset(); wheelY = 0;
  if (activeProfile >= 0) {
    const p = store.list()[activeProfile];
    if (p) try { store.save({ ...p, zoom: zoom.get().zoom }, activeProfile); } catch { /* Session cleanup must always finish. */ }
  }
  activeProfile = -1;
  generation++; busy = false; connected = false; sizing.reset(); keyboardView.reset(); zoom.reset(); remoteCursor = inputAnchor = null;
  $('sessionControls').hidden = true; $('controlsButton').setAttribute('aria-expanded', 'false');
  const old = client; client = null; old?.disconnect();
  $('display').replaceChildren(); $('session').hidden = true; $('home').hidden = false;
  $('keyboard').classList.remove('visible'); keyboardInput.clear(); $('keyboard').blur();
  $('connectButton').disabled = false; status(message);
}
async function connect(event) {
  event.preventDefault(); if (busy) return;
  if (!form.reportValidity()) return;
  if (!canConnect(location)) return status('Open RDP-Link over HTTPS to connect securely.');
  const id = ++generation; busy = true; $('connectButton').disabled = true;
  try {
    const p = profile(Object.fromEntries(new FormData(form)));
    const credentials = { ...p, password: form.elements.password.value };
    form.elements.password.value = '';
    document.activeElement?.blur();
    $('home').hidden = true; $('session').hidden = false;
    $('desktopName').textContent = p.name; resizeViewport();
    status('Connecting…');
    const response = await fetch('/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials), signal: AbortSignal.timeout(15000) });
    credentials.password = '';
    if (!response.ok) throw Error(await response.text());
    const { ticket } = await response.json(); if (id !== generation) return;
    const saved = store.list();
    const index = selected >= 0 ? selected : saved.findIndex(x => x.host === p.host && x.port === p.port && x.username === p.username);
    try { selected = store.save({ ...p, zoom: saved[index]?.zoom }, index); activeProfile = selected; list(); }
    catch { status('Connecting… Profile could not be saved on this device.'); }
    zoom.reset();
    const preference = store.list()[activeProfile]?.zoom;
    if (preference) {
      const desktop = displaySize({ getWidth: () => 0, getHeight: () => 0 }); const view = measure();
      zoom.layout(desktop.width, desktop.height, view.width, view.height); zoom.pinch(preference, 0, 0);
    }
    const tunnel = new Guacamole.WebSocketTunnel(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/tunnel`);
    const current = client = new Guacamole.Client(tunnel); const display = current.getDisplay();
    $('display').replaceChildren(display.getElement()); $('desktopName').textContent = p.name;
    $('home').hidden = true; $('session').hidden = false;
    display.onresize = scale;
    let pointer = null;
    display.getElement().addEventListener('mousemove', e => { pointer = e; }, true);
    display.getElement().addEventListener('mousedown', e => { pointer = e; }, true);
    display.getElement().addEventListener('mouseup', e => { pointer = e; }, true);
    const sendMouse = e => { if (client === current) { display.showCursor(true); if (pointer) {
      const rect = display.getElement().getBoundingClientRect();
      const state = new Guacamole.Mouse.State(e.state);
      Object.assign(state, e.state, remotePoint({ x: pointer.clientX, y: pointer.clientY }, rect, display.getScale(), displaySize(display).width, displaySize(display).height));
      remoteCursor = { x: state.x, y: state.y };
      if (state.left || state.right) inputAnchor = { ...remoteCursor };
      current.sendMouseState(state); pointer = null;
    } else {
      remoteCursor = { x: e.state.x / display.getScale(), y: e.state.y / display.getScale() };
      if (e.state.left || e.state.right) inputAnchor = { ...remoteCursor };
      current.sendMouseState(e.state, true);
    } } };
    new Guacamole.Mouse(display.getElement()).onEach(['mousedown', 'mousemove', 'mouseup'], sendMouse);
    current.onerror = error => { if (client === current) end(error.message || 'Connection failed. Enter credentials to reconnect.'); };
    current.onstatechange = state => {
      if (client !== current) return;
      connected = state === 3;
      if (connected) { status('Connected'); resizeViewport(); }
      if (state === 5) end('Disconnected. Enter credentials to reconnect.');
    };
    current.onclipboard = (stream, mimetype) => {
      if (mimetype !== 'text/plain') { stream.sendAck('Text only', 0x100); return; }
      let text = ''; const reader = new Guacamole.StringReader(stream);
      reader.ontext = value => {
        if (text.length + value.length > 65536) { stream.sendAck('Clipboard too large', 0x100); return; }
        text += value; stream.sendAck('OK', 0);
      };
      reader.onend = () => { if (client === current) $('clipboardText').value = text; };
    };
    current.connect(`ticket=${encodeURIComponent(ticket)}`);
  } catch (error) { if (id === generation) end(error.message || 'Unable to connect'); }
}
// Connect has no native submission action, even if a module fails to load.
$('connectButton').onclick = connect;
form.onsubmit = connect;
$('disconnect').onclick = () => end('Disconnected. Enter credentials to reconnect.');
// A cached page may resume with its existing client; do not discard it on suspend.
window.addEventListener('pagehide', event => { keyboardInput.clear(); if (!event.persisted) end('Disconnected'); });
window.addEventListener('offline', () => end('Network lost. Enter credentials to reconnect.'));
const key = value => { if (!client) return; client.sendKeyEvent(1, value); client.sendKeyEvent(0, value); };
$('keyboardButton').onclick = () => { $('keyboard').classList.toggle('visible'); if ($('keyboard').classList.contains('visible')) $('keyboard').focus(); else $('keyboard').blur(); resizeViewport(); };
// iOS software keyboards emit input/composition rather than reliable keydown events.
function type(text) {
  for (const char of text) {
    const cp = char.codePointAt(0);
    key(char === '\n' ? 0xff0d : cp <= 255 ? cp : 0x01000000 | cp);
  }
}
const keyboardInput = installKeyboard($('keyboard'), { key, type });
document.addEventListener('visibilitychange', () => { if (document.hidden) keyboardInput.clear(); });
$('clearKeyboard').addEventListener('pointerdown', event => { event.preventDefault(); keyboardInput.clear(); });
let hiddenInput = false;
$('privacyKeyboard').addEventListener('pointerdown', event => {
  event.preventDefault(); hiddenInput = !hiddenInput; keyboardInput.setHidden(hiddenInput);
  $('privacyKeyboard').setAttribute('aria-pressed', String(hiddenInput));
  $('privacyKeyboard').textContent = hiddenInput ? 'Hidden' : 'Hide';
});
$('keyboard').addEventListener('focus', () => {
  keyboardView.begin(inputAnchor ?? remoteCursor); keyboardInput.clear();
  $('sessionControls').hidden = true; $('controlsButton').setAttribute('aria-expanded', 'false'); resizeViewport();
});
$('keyboard').addEventListener('blur', () => {
  $('keyboard').classList.remove('visible'); keyboardInput.clear(); keyboardView.dismiss(); resizeViewport();
});
// These local controls retain textarea focus and never send remote mouse input.
for (const [id, dx, dy] of [['panUp', 0, 80], ['panDown', 0, -80], ['panLeft', 80, 0], ['panRight', -80, 0]]) {
  $(id).addEventListener('pointerdown', event => {
    event.preventDefault(); zoom.pan(dx, dy); renderZoom();
  });
}
$('keyboardDone').addEventListener('pointerdown', event => {
  event.preventDefault(); $('keyboard').classList.remove('visible'); $('keyboard').blur(); resizeViewport();
});
$('clipboardButton').onclick = () => $('clipboard').showModal();
$('sendClipboard').onclick = () => {
  if (!client) return status('Connect before sending clipboard text.');
  const writer = new Guacamole.StringWriter(client.createClipboardStream('text/plain'));
  writer.sendText($('clipboardText').value); writer.sendEnd(); status('Clipboard sent');
};
$('copyClipboard').onclick = async () => {
  try { await navigator.clipboard.writeText($('clipboardText').value); status('Copied to iPhone'); }
  catch { status('Select the clipboard text and copy it manually.'); }
};
