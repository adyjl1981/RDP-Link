import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canConnect } from '../public/connection-policy.js';

test('HTTP connections are allowed on localhost, loopback and RFC1918 LAN addresses', () => {
  for (const hostname of ['localhost', '127.0.0.1', '192.168.1.50',
    '192.168.0.0', '192.168.255.255', '10.0.0.0', '10.255.255.255',
    '172.16.0.0', '172.31.255.255']) {
    assert.equal(canConnect(new URL(`http://${hostname}:8080`)), true, hostname);
  }
});

test('public hosts and addresses outside RFC1918 require HTTPS', () => {
  for (const hostname of ['example.com', 'desktop.local', 'localhost.example.com',
    '192.168.1.50.example.com', '8.8.8.8', '127.0.0.2', '172.15.255.255',
    '172.32.0.0', '192.167.255.255', '192.169.0.0', '169.254.1.1', '[::1]']) {
    assert.equal(canConnect(new URL(`http://${hostname}:8080`)), false, hostname);
    assert.equal(canConnect(new URL(`https://${hostname}:8080`)), true, hostname);
  }
});

test('invalid IPv4 addresses and non-HTTP protocols are rejected', () => {
  for (const hostname of ['10.256.0.1', '192.168.1.999', '172.16.0', '10.0.0.1evil']) {
    assert.equal(canConnect({ protocol: 'http:', hostname }), false, hostname);
  }
  assert.equal(canConnect({ protocol: 'file:', hostname: 'localhost' }), false);
});
