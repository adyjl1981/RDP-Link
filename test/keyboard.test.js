import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installKeyboard } from '../public/keyboard.js';
function setup() {
  const handlers = {}, sent = [], keys = [];
  const field = { value: '', selectionEnd: 0, classList: { toggle() {} }, setAttribute() {}, addEventListener(name, fn) { handlers[name] = fn; } };
  const control = installKeyboard(field, { key: k => { keys.push(k); sent.push(k); }, type: text => sent.push(...Array.from(text)) });
  const fire = (name, event = {}) => handlers[name]({ preventDefault() {}, ...event });
  const edit = (text, inputType = 'insertText', data = null, selection = text.length) => {
    fire('beforeinput', { inputType, data }); field.value = text; field.selectionEnd = selection;
    fire('input', { inputType, data });
  };
  return { field, control, sent, keys, fire, edit };
}
test('typing, spaces, punctuation, paste and null data send each character once', () => {
  const s = setup();
  s.edit('H'); s.edit('Hi'); s.edit('Hi '); s.edit('Hi !'); s.edit('Hi ! café 😀', 'insertFromPaste');
  assert.deepEqual(s.sent, Array.from('Hi ! café 😀'));
  s.fire('input', { inputType: 'insertText' });
  assert.deepEqual(s.sent, Array.from('Hi ! café 😀'));
  assert.equal(s.field.value, 'Hi ! café 😀');
});
test('backspace and autocorrection reconcile changed text, including selection replacements', () => {
  const s = setup(); s.edit('teh'); s.sent.length = 0;
  s.edit('the', 'insertReplacementText');
  assert.deepEqual(s.sent, [0xff08, 0xff08, 'h', 'e']);
  s.sent.length = 0; s.edit('th', 'deleteContentBackward'); assert.deepEqual(s.sent, [0xff08]);
  s.edit('th world'); s.sent.length = 0; s.edit('a world', 'insertReplacementText', 'a', 1);
  assert.deepEqual(s.sent, [...Array(6).fill(0xff51), 0xff08, 0xff08, 'a']);
});
test('composition remains visible locally, sends only the commit and ignores trailing input', () => {
  const s = setup(); s.fire('compositionstart'); s.field.value = 'に'; s.fire('input', { isComposing: true });
  s.field.value = '日本'; s.field.selectionEnd = 2; s.fire('input', { isComposing: true });
  s.fire('keydown', { key: 'Enter', isComposing: true }); assert.deepEqual(s.sent, []);
  s.fire('compositionend', { data: '日本' }); s.fire('input', { inputType: 'insertFromComposition', data: '日本' });
  assert.deepEqual(s.sent, ['日', '本']); assert.equal(s.field.value, '日本');
});
test('hidden input discards committed secrets and suppresses composition echo', () => {
  const s = setup(); s.edit('old'); s.control.setHidden(true); assert.equal(s.field.value, '');
  s.sent.length = 0; s.edit('secret', 'insertFromPaste'); assert.equal(s.field.value, '');
  s.edit('x'); assert.deepEqual(s.sent, Array.from('secretx'));
  s.fire('compositionstart'); s.field.value = '密'; s.field.selectionEnd = 1;
  s.fire('compositionend', { data: '密' }); assert.equal(s.field.value, '');
  s.field.value = '密'; s.fire('input', { inputType: 'insertFromComposition', data: '密' });
  assert.deepEqual(s.sent, Array.from('secretx密')); assert.equal(s.field.value, '');
  s.edit('密'); assert.deepEqual(s.sent, Array.from('secretx密密'));
  s.control.setHidden(false); assert.equal(s.field.value, '');
});
test('native keydown does not duplicate input; empty deletion and local reset work', () => {
  const s = setup(); s.edit('a'); s.fire('keydown', { key: 'Backspace' });
  s.edit('', 'deleteContentBackward'); assert.deepEqual(s.sent, ['a', 0xff08]);
  let prevented = false;
  s.fire('beforeinput', { inputType: 'deleteContentBackward', preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(s.sent.at(-1), 0xff08);
  s.edit('long'); s.sent.length = 0; s.control.clear(); assert.equal(s.field.value, ''); assert.deepEqual(s.sent, []);
  s.edit('fresh'); assert.deepEqual(s.sent, Array.from('fresh'));
});
