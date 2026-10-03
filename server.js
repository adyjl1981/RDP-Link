import http from 'node:http';
import net from 'node:net';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { instruction as ins, takeInstruction } from './lib/protocol.js';
import { desktopSize } from './public/model.js';
const origin = process.env.PUBLIC_ORIGIN || 'http://localhost:8080';
const targets = new Set((process.env.RDP_TARGETS || 'host.docker.internal:3389').split(','));
const tickets = new Map(); let sessions = 0;
const files = new Map([
  ['/', ['public/index.html', 'text/html']], ['/app.js', ['public/app.js', 'text/javascript']],
  ['/viewport.js', ['public/viewport.js', 'text/javascript']],
  ['/zoom.js', ['public/zoom.js', 'text/javascript']],
  ['/model.js', ['public/model.js', 'text/javascript']], ['/style.css', ['public/style.css', 'text/css']],
  ['/connection-policy.js', ['public/connection-policy.js', 'text/javascript']],
  ['/guacamole.js', ['node_modules/guacamole-common-js/dist/esm/guacamole-common.js', 'text/javascript']]
]);
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'");
  try {
    if (req.method === 'POST' && req.url === '/session') {
      if (req.headers.origin !== origin) { res.writeHead(403).end(); return; }
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 8192) { res.writeHead(413).end(); return; } }
      const data = JSON.parse(body);
      if (tickets.size + sessions >= 4) { res.writeHead(429).end('Gateway is busy'); return; }
      if (!targets.has(`${data.host}:${data.port}`) || !Number.isInteger(data.port) || typeof data.username !== 'string' || !data.username || typeof data.password !== 'string' || !data.password) {
        res.writeHead(400).end('Check credentials and the allowed desktop address'); return;
      }
      const ticket = randomBytes(32).toString('hex');
      tickets.set(ticket, { host: data.host, port: data.port, username: data.username, password: data.password });
      setTimeout(() => tickets.delete(ticket), 10000).unref();
      res.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ticket })); return;
    }
    const file = files.get(req.url);
    if (req.method !== 'GET' || !file) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file[1]); res.end(await readFile(new URL(file[0], import.meta.url)));
  } catch { res.writeHead(400).end('Unable to process request'); }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, handleProtocols: protocols => protocols.has('guacamole') ? 'guacamole' : false });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, origin); const ticket = url.searchParams.get('ticket');
  const config = tickets.get(ticket); tickets.delete(ticket);
  if (url.pathname !== '/tunnel' || req.headers.origin !== origin || !config || sessions >= 4 || !req.headers['sec-websocket-protocol']?.split(/,\s*/).includes('guacamole')) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => bridge(ws, config));
});
function bridge(ws, config) {
  sessions++;
  const tcp = net.createConnection({ host: process.env.GUACD_HOST || '127.0.0.1', port: Number(process.env.GUACD_PORT || 4822) });
  tcp.setEncoding('utf8'); let buffer = ''; let phase = 'args'; let finished = false;
  const timer = setTimeout(() => stop('Connection timed out'), 20000);
  const stop = reason => { if (finished) return; finished = true; clearTimeout(timer); sessions--; tcp.destroy(); ws.close(1000, reason); config.password = ''; };
  tcp.on('connect', () => tcp.write(ins('select', 'rdp')));
  tcp.on('data', chunk => {
    try {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) return stop('Invalid gateway response');
      let parsed;
      while ((parsed = takeInstruction(buffer))) {
        buffer = parsed.rest; const [op, ...args] = parsed.values;
        if (phase === 'stream') {
          if (ws.bufferedAmount > 8 * 1024 * 1024) return stop('Connection too slow');
          ws.send(ins(op, ...args));
        } else if (phase === 'args' && op === 'args') {
          const { width, height } = desktopSize();
          const params = { width, height, hostname: config.host, port: config.port, username: config.username, password: config.password,
            security: 'any', 'ignore-cert': process.env.RDP_IGNORE_CERT === 'true' ? 'true' : 'false',
            'resize-method': 'none', 'disable-audio': 'true', 'enable-drive': 'false' };
          // Negotiate a desktop-sized connection; subsequent client sizes are blocked.
          tcp.write(ins('size', width, height, 96) + ins('audio') + ins('video') + ins('image', 'image/png', 'image/jpeg') + ins('connect', ...args.map(k => k.startsWith('VERSION_') ? 'VERSION_1_5_0' : params[k] ?? '')));
          config.password = ''; phase = 'ready';
        } else if (phase === 'ready' && op === 'ready') {
          clearTimeout(timer); phase = 'stream'; ws.send(ins('', args[0]));
          continue;
        } else if (op === 'error') { stop('RDP connection failed. Check Ubuntu settings, credentials and certificate.'); }
        else { stop('Unexpected gateway response'); }
      }
    } catch { stop('Invalid gateway response'); }
  });
  ws.on('message', (data, binary) => {
    if (phase !== 'stream' || binary) return stop('Invalid client message');
    if (tcp.writableLength > 1024 * 1024) return stop('Connection too slow');
    try {
      let input = data.toString(); let parsed;
      while ((parsed = takeInstruction(input))) {
        input = parsed.rest;
        if (parsed.values[0] === '') ws.send(ins(...parsed.values));
        // Never forward client viewport dimensions to the shared desktop.
        else if (parsed.values[0] !== 'size') tcp.write(ins(...parsed.values));
      }
      if (input) stop('Invalid client message');
    } catch { stop('Invalid client message'); }
  });
  ws.on('close', () => stop('Disconnected')); ws.on('error', () => stop('Connection lost'));
  tcp.on('error', () => stop('RDP gateway unavailable')); tcp.on('close', () => stop('Desktop disconnected'));
}
server.listen(Number(process.env.PORT || 8080), process.env.BIND_HOST || '127.0.0.1', () => console.log('RDP-Link gateway ready'));
