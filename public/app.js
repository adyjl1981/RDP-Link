import Guacamole from '/guacamole.js';
import { desktopSize, profile } from './model.js';
import { canConnect } from './connection-policy.js';
import { viewportController } from './viewport.js';
const $ = id => document.getElementById(id);
const form = $('connect'); const status = message => $('status').textContent = message;
let profiles = []; let client = null; let generation = 0; let busy = false;
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
const sizing = viewportController({ getClient: () => client, measure });
const scale = sizing.fit;
function resizeViewport() {
  // Safari's visual viewport also tracks the software keyboard and browser bars.
  document.documentElement.style.setProperty('--session-height', `${window.visualViewport?.height ?? window.innerHeight}px`);
  sizing.resize();
}
new ResizeObserver(() => sizing.resize()).observe($('viewport'));
window.addEventListener('resize', resizeViewport);
window.visualViewport?.addEventListener('resize', resizeViewport);
window.addEventListener('pageshow', resizeViewport);
resizeViewport();
function end(message) {
  generation++; busy = false; sizing.reset();
  const old = client; client = null; old?.disconnect();
  $('display').replaceChildren(); $('session').hidden = true; $('home').hidden = false;
  $('keyboard').classList.remove('visible'); $('keyboard').value = ''; $('keyboard').blur();
  form.querySelector('[type=submit]').disabled = false; status(message);
}
form.onsubmit = async event => {
  event.preventDefault(); if (busy) return;
  if (!canConnect(location)) return status('Open RDP-Link over HTTPS to connect securely.');
  const id = ++generation; busy = true; form.querySelector('[type=submit]').disabled = true;
  try {
    const p = profile(Object.fromEntries(new FormData(form)));
    const credentials = { ...p, password: form.elements.password.value };
    form.elements.password.value = '';
    document.activeElement?.blur();
    $('home').hidden = true; $('session').hidden = false;
    $('desktopName').textContent = p.name; resizeViewport();
    Object.assign(credentials, desktopSize(measure().width, measure().height));
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
    const sendMouse = e => { if (client === current) { display.showCursor(true); current.sendMouseState(e.state, true); } };
    new Guacamole.Mouse(display.getElement()).onEach(['mousedown', 'mousemove', 'mouseup'], sendMouse);
    new Guacamole.Mouse.Touchpad(display.getElement()).onEach(['mousedown', 'mousemove', 'mouseup'], sendMouse);
    current.onerror = error => { if (client === current) end(error.message || 'Connection failed. Enter credentials to reconnect.'); };
    current.onstatechange = state => {
      if (client !== current) return;
      if (state === 3) { status('Connected'); resizeViewport(); }
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
};
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
