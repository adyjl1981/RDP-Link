import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileStore } from '../public/model.js';
const desktop = { name: 'Office', host: 'desktop', port: 3389, username: 'me' };
function storage(value = null) {
  return { value, getItem() { return this.value; }, setItem(_key, next) { this.value = next; } };
}
test('profiles add multiple connections, edit the selected entry, delete and reload without credentials', () => {
  const device = storage(), store = profileStore(device);
  assert.equal(store.save({ ...desktop, password: 'secret', zoom: 1.5 }), 0);
  assert.equal(store.save({ ...desktop, name: 'Home', host: 'home' }), 1);
  store.save({ ...desktop, name: 'Renamed', host: 'changed', zoom: 2, password: 'other' }, 0);
  assert.deepEqual(profileStore(device).list(), [{ ...desktop, name: 'Renamed', host: 'changed', zoom: 2 }, { ...desktop, name: 'Home', host: 'home' }]);
  assert.doesNotMatch(device.value, /password|secret|other/);
  const copy = store.list(); copy[0].name = 'mutated'; assert.equal(store.list()[0].name, 'Renamed');
  store.remove(0); assert.equal(profileStore(device).list()[0].name, 'Home');
  store.remove(0); assert.deepEqual(profileStore(device).list(), []);
});
test('legacy profiles migrate independently and remove unexpected credential fields', () => {
  const device = storage(JSON.stringify([{ ...desktop, password: 'secret', token: 'token', zoom: 99 }, { ...desktop, port: 0 }, { ...desktop, name: 'Valid', zoom: 0.5 }]));
  assert.deepEqual(profileStore(device).list(), [desktop, { ...desktop, name: 'Valid', zoom: 0.5 }]);
  assert.doesNotMatch(device.value, /secret|password|token/);
  for (const value of ['broken', '{}', 'null']) assert.deepEqual(profileStore(storage(value)).list(), []);
});
test('invalid profiles and blocked storage never mutate existing entries', () => {
  const device = storage(), store = profileStore(device); store.save(desktop);
  assert.throws(() => store.save({ ...desktop, port: 65536 }, 0));
  device.setItem = () => { throw Error('Storage blocked'); };
  assert.throws(() => store.save({ ...desktop, name: 'Changed' }, 0), /Storage blocked/);
  assert.throws(() => store.remove(0), /Storage blocked/);
  assert.deepEqual(store.list(), [desktop]);
});
