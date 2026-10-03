// Guacamole lengths count Unicode code points, not UTF-8 bytes.
export const instruction = (...parts) => parts.map(v => {
  const s = String(v); return `${[...s].length}.${s}`;
}).join(',') + ';';
export function takeInstruction(buffer) {
  const chars = [...buffer]; const values = []; let pos = 0;
  while (pos < chars.length) {
    const start = pos;
    while (/^[0-9]$/.test(chars[pos] ?? '')) pos++;
    if (pos === chars.length) return null;
    if (pos === start || chars[pos++] !== '.') throw Error('Invalid instruction');
    const length = Number(chars.slice(start, pos - 1).join(''));
    if (!Number.isSafeInteger(length) || length > 1048576) throw Error('Invalid length');
    if (pos + length >= chars.length) return null;
    values.push(chars.slice(pos, pos + length).join('')); pos += length;
    const delimiter = chars[pos++];
    if (delimiter === ';') return { values, rest: chars.slice(pos).join('') };
    if (delimiter !== ',') throw Error('Invalid delimiter');
  }
  return null;
}
