import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import WebSocket from 'ws';
import { instruction as ins, takeInstruction } from '../lib/protocol.js';

test('gateway session creation without an access key, origin checks, fragmented handshake, input, ping, ticket reuse and cleanup', { timeout: 15000 }, async () => {
  let upstream; let buffered = ''; const received = [];
  const mock = net.createServer(socket => {
    upstream = socket; socket.setEncoding('utf8');
    socket.on('data', chunk => {
      buffered += chunk; let parsed;
      while ((parsed = takeInstruction(buffered))) {
        buffered = parsed.rest; received.push(parsed.values);
        if (parsed.values[0] === 'select') socket.write(ins('args', 'VERSION_1_5_0', 'hostname', 'port', 'username', 'password', 'ignore-cert'));
        if (parsed.values[0] === 'connect') {
          const frame = ins('ready', '$test') + ins('size', 0, 1920, 1080);
          socket.write(frame.slice(0, 7)); setTimeout(() => socket.write(frame.slice(7)), 10);
        }
      }
    });
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  // Reserve a free gateway port for the child process.
  const reservation = net.createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env }; delete env.GATEWAY_SECRET;
  const child = spawn(process.execPath, ['server.js'], { env: { ...env, PORT: String(port), PUBLIC_ORIGIN: origin, RDP_TARGETS: 'desktop:3389', GUACD_PORT: String(mock.address().port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let ws;
  try {
    await once(child.stdout, 'data');
    const data = { host: 'desktop', port: 3389, username: 'me', password: 'p,;🔐' };
    const post = (body, requestOrigin = origin) => fetch(origin + '/session', { method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post(data, 'https://evil.example')).status, 403);
    for (const field of ['username', 'password']) {
      for (const value of ['', null, 123]) assert.equal((await post({ ...data, [field]: value })).status, 400);
      const missing = { ...data }; delete missing[field];
      assert.equal((await post(missing)).status, 400);
    }
    assert.equal((await post({ ...data, host: 'unapproved' })).status, 400);
    const page = await fetch(origin); assert.equal(page.status, 200); assert.equal(page.headers.get('cache-control'), 'no-store');
    const html = await page.text();
    assert.doesNotMatch(html, /gatewaySecret|gateway access key/i);
    assert.match(html, /name="username" required/);
    assert.match(html, /name="password"[^>]*required/);
    const response = await post(data); assert.equal(response.status, 201);
    const { ticket } = await response.json();
    ws = new WebSocket(`ws://127.0.0.1:${port}/tunnel?ticket=${ticket}`, 'guacamole', { origin });
    const messages = []; ws.on('message', msg => messages.push(msg.toString()));
    await once(ws, 'open');
    while (messages.length < 2) await once(ws, 'message');
    assert.deepEqual(messages.slice(0, 2), [ins('', '$test'), ins('size', 0, 1920, 1080)]);
    assert.deepEqual(received.find(x => x[0] === 'connect'), ['connect', 'VERSION_1_5_0', 'desktop', '3389', 'me', 'p,;🔐', 'false']);
    const ping = once(ws, 'message'); ws.send(ins('', 'ping', 123)); assert.equal((await ping)[0].toString(), ins('', 'ping', 123));
    const input = once(upstream, 'data'); ws.send(ins('mouse', 100, 200, 1)); await input;
    assert.ok(received.some(x => x.join('|') === 'mouse|100|200|1'));
    const reused = new WebSocket(`ws://127.0.0.1:${port}/tunnel?ticket=${ticket}`, 'guacamole', { origin });
    await once(reused, 'error');
    const closed = once(ws, 'close'); upstream.destroy(); await closed;
  } finally {
    ws?.terminate(); upstream?.destroy(); child.kill(); await once(child, 'exit');
    await new Promise(resolve => mock.close(resolve));
  }
});
