// Local edit history only: RDP does not report the remote field or caret.
export function installKeyboard(field, { key, type, hidden = false }) {
  let previous = '', caret = 0, composing = false, privateMode = hidden;
  let compositionEcho = false;
  const clear = () => { previous = ''; caret = 0; field.value = ''; composing = false; compositionEcho = false; };
  const move = target => {
    while (caret > target) { key(0xff51); caret--; }
    while (caret < target) { key(0xff53); caret++; }
  };
  const commit = () => {
    const next = field.value;
    if (next === previous) return;
    const old = Array.from(previous), value = Array.from(next);
    let start = 0, end = 0;
    while (start < old.length && start < value.length && old[start] === value[start]) start++;
    while (end < old.length - start && end < value.length - start && old.at(-end - 1) === value.at(-end - 1)) end++;
    move(old.length - end);
    for (let i = start; i < old.length - end; i++) { key(0xff08); caret--; }
    const inserted = value.slice(start, value.length - end).join('');
    type(inserted); caret += Array.from(inserted).length;
    const selection = Array.from(next.slice(0, field.selectionEnd ?? next.length)).length;
    move(selection);
    previous = next;
    if (privateMode) { previous = ''; caret = 0; field.value = ''; }
  };
  field.addEventListener('beforeinput', event => {
    if (!event.isComposing && !['insertFromComposition', 'insertCompositionText'].includes(event.inputType)) compositionEcho = false;
    if (!composing && !field.value && event.inputType === 'deleteContentBackward') {
      event.preventDefault(); key(0xff08);
    }
  });
  field.addEventListener('compositionstart', () => { composing = true; compositionEcho = false; });
  field.addEventListener('compositionend', () => {
    composing = false;
    commit();
    // Safari may follow compositionend with another input for the same commit.
    compositionEcho = privateMode;
  });
  field.addEventListener('input', event => {
    if (composing || event.isComposing) return;
    if (compositionEcho) {
      compositionEcho = false; field.value = ''; return;
    }
    compositionEcho = false; commit();
  });
  field.addEventListener('keydown', event => {
    if (composing || event.isComposing || event.keyCode === 229) return;
    const keys = { Tab: 0xff09, Escape: 0xff1b, ArrowUp: 0xff52, ArrowDown: 0xff54 };
    if (keys[event.key]) { event.preventDefault(); key(keys[event.key]); clear(); }
    // Backspace, Enter and horizontal editing use native input exactly once.
  });
  return { clear, setHidden(value) {
    clear(); privateMode = value;
    field.classList.toggle('private', value);
    field.setAttribute('aria-label', value ? 'Hidden remote input' : 'Local typing preview');
  } };
}
