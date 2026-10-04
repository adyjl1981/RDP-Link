import { test } from 'node:test';
import assert from 'node:assert/strict';
import { originPolicy } from '../lib/origins.js';
const lan = 'http://192.168.1.50:8080', https = 'https://desktop.example.ts.net';
test('exact trusted list takes precedence over legacy origin and trims configuration whitespace', () => {
  const permits = originPolicy({ PUBLIC_ORIGINS: ` ${lan}, ${https} `, PUBLIC_ORIGIN: 'https://other.example' });
  assert.ok(permits(lan)); assert.ok(permits(https));
  for (const value of [undefined, null, ['https://other.example'], 'null', 'https://other.example', https + '/', https + '.evil.example', https + ':443', ' ' + lan, lan + '/path', https + ',' + lan]) assert.equal(permits(value), false);
});
test('legacy and localhost fallback remain available', () => {
  assert.ok(originPolicy({ PUBLIC_ORIGIN: https })(https));
  assert.ok(originPolicy({ PUBLIC_ORIGINS: '', PUBLIC_ORIGIN: lan })(lan));
  assert.ok(originPolicy({})('http://localhost:8080'));
});
test('invalid trusted configuration fails closed at startup', () => {
  for (const value of ['*', https + '/', https + ',', 'null', 'ftp://example.com', 'https://user:pass@example.com', https + '/path', 'https://*.example.com']) {
    assert.throws(() => originPolicy({ PUBLIC_ORIGINS: value }));
  }
});
