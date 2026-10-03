import Guacamole from '/guacamole.js';
import { profile } from './model.js';
import { canConnect } from './connection-policy.js';
import { viewportController, usableViewport } from './viewport.js';
import { zoomState, installGestures, remotePoint } from './zoom.js';
const $ = id => document.getElementById(id);
const form = $('connect'); const status = message => $('status').textContent = message;
let profiles = []; let connected = false; let client = null; let generation = 0; let busy = false;
try { profiles = JSON.parse(localStorage.getItem('rdp-profiles') || '[]').map(profile); } catch { profiles = []; }
function list() {
  $('profiles').replaceChildren(new Option('New connection', ''));
  profiles.forEach((p, i) => $('profiles').add(new Option(p.name, String(i))));
}
list();
$('profiles').onchange = () => {
  const p = profiles[$('profiles').value];
  if (p) Object.entries(p).forEach(([key, value]) => form.elements[key].value = value);
  form.elements.password.value = '';
};
$('forget').onclick = () => {
  if ($('profiles').value === '') return;
  profiles.splice(Number($('profiles').value), 1); persist(); list();
};
function persist() { try { localStorage.setItem('rdp-profiles', JSON.stringify(profiles)); } catch { status('Profile could not be saved on this device.'); } }
const measure = () => ({ width: $('viewport').clientWidth, height: $('viewport').clientHeight });
const zoom = zoomState();
let remoteCursor = null;
const sizing = viewportController({ getClient: () => client, isConnected: () => connected, measure, render(display, _scale, width, height) {
  const transform = zoom.layout(display.getWidth(), display.getHeight(), width, height);
  display.scale(transform.scale);
  $('display').style.transform = `translate(${transform.x}px, ${transform.y}px)`;
} });
installGestures($('viewport'), zoom, () => sizing.fit(), {
  move: (dx, dy) => {
    if (!client || !connected) return;
    const display = client.getDisplay();
    sizing.fit();
    remoteCursor = zoom.followCursor(remoteCursor ?? {
      x: display.getWidth() / 2, y: display.getHeight() / 2
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
  tap: () => {
    if (!client || !connected) return;
    const display = client.getDisplay();
    remoteCursor ??= { x: display.getWidth() / 2, y: display.getHeight() / 2 };
    const state = new Guacamole.Mouse.State();
    Object.assign(state, remoteCursor);
    display.showCursor(true);
    state.left = true; client.sendMouseState(state);
    state.left = false; client.sendMouseState(state);
  }
});
$('fitButton').onclick = () => { zoom.fit(); sizing.fit(); };
$('controlsButton').onclick = () => {
  const expanded = $('sessionControls').hidden;
  $('sessionControls').hidden = !expanded;
  $('controlsButton').setAttribute('aria-expanded', String(expanded));
};
const scale = sizing.fit;
function resizeViewport() {
  // Safari's visual viewport also tracks the software keyboard and browser bars.
  const viewport = usableViewport(window);
  document.documentElement.style.setProperty('--session-width', `${viewport.width}px`);
  document.documentElement.style.setProperty('--session-height', `${viewport.height}px`);
  sizing.resize();
}
new ResizeObserver(() => sizing.resize()).observe($('viewport'));
window.addEventListener('resize', resizeViewport);
window.visualViewport?.addEventListener('resize', resizeViewport);
window.addEventListener('pageshow', resizeViewport);
// iOS can report the old visual viewport during the first orientation event.
const orientationResize = () => { resizeViewport(); setTimeout(resizeViewport, 350); setTimeout(resizeViewport, 750); };
window.addEventListener('orientationchange', orientationResize);
window.screen?.orientation?.addEventListener('change', orientationResize);
resizeViewport();
function end(message) {
  generation++; busy = false; connected = false; sizing.reset(); zoom.reset(); remoteCursor = null;
  $('sessionControls').hidden = true; $('controlsButton').setAttribute('aria-expanded', 'false');
  const old = client; client = null; old?.disconnect();
  $('display').replaceChildren(); $('session').hidden = true; $('home').hidden = false;
  $('keyboard').classList.remove('visible'); $('keyboard').value = ''; $('keyboard').blur();
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
    const index = profiles.findIndex(x => x.host === p.host && x.port === p.port && x.username === p.username);
    if (index < 0) profiles.push(p); else profiles[index] = p;
    persist(); list();
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
      Object.assign(state, e.state, remotePoint({ x: pointer.clientX, y: pointer.clientY }, rect, display.getScale(), display.getWidth(), display.getHeight()));
      remoteCursor = { x: state.x, y: state.y };
      current.sendMouseState(state); pointer = null;
    } else {
      remoteCursor = { x: e.state.x / display.getScale(), y: e.state.y / display.getScale() };
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
window.addEventListener('pagehide', event => { if (!event.persisted) end('Disconnected'); });
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
const sentinel = '\u200b';
const resetKeyboard = () => { $('keyboard').value = sentinel; };
$('keyboard').addEventListener('focus', resetKeyboard);
let composing = false;
$('keyboard').addEventListener('compositionstart', () => composing = true);
$('keyboard').addEventListener('compositionend', event => { composing = false; type(event.data); resetKeyboard(); });
$('keyboard').addEventListener('input', event => {
  if (composing || event.isComposing) return;
  if (event.inputType.startsWith('delete')) key(0xff08);
  else type((event.data ?? $('keyboard').value).replaceAll(sentinel, ''));
  resetKeyboard();
});
$('keyboard').addEventListener('keydown', event => {
  const keys = { Backspace: 0xff08, Enter: 0xff0d, Tab: 0xff09, Escape: 0xff1b, ArrowLeft: 0xff51, ArrowUp: 0xff52, ArrowRight: 0xff53, ArrowDown: 0xff54 };
  if (keys[event.key]) { event.preventDefault(); key(keys[event.key]); }
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
