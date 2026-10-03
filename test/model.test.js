import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fit, profile } from '../public/model.js';
import { instruction, takeInstruction } from '../lib/protocol.js';
test('desktop fits portrait, landscape and keyboard-reduced view without distortion', () => {
  assert.equal(fit(1920, 1080, 390, 600), 390 / 1920);
  assert.equal(fit(1920, 1080, 844, 300), 300 / 1080);
  assert.equal(fit(0, 0, 390, 600), 1);
});
test('profiles discard credentials and reject invalid addresses and ports', () => {
  const p = profile({ name: '', host: 'desktop', port: '3389', username: 'me', password: 'secret' });
  assert.deepEqual(p, { name: 'desktop', host: 'desktop', port: 3389, username: 'me' });
  for (const port of [0, 65536, 12.5]) assert.throws(() => profile({ ...p, port }));
  assert.throws(() => profile({ ...p, host: 'https://desktop' }));
});
test('protocol handles fragmented instructions, delimiters in credentials and Unicode', () => {
  const encoded = instruction('connect', 'päss,;🔐', '');
  for (let i = 0; i < encoded.length; i++) assert.equal(takeInstruction(encoded.slice(0, i)), null);
  assert.deepEqual(takeInstruction(encoded + instruction('sync', 42)), { values: ['connect', 'päss,;🔐', ''], rest: instruction('sync', 42) });
  assert.throws(() => takeInstruction('x.bad;'));
});
