// Plain HTTP is supported only for local development and RFC1918 LAN hosts.
export function canConnect({ protocol, hostname }) {
  if (protocol === 'https:') return true;
  if (protocol !== 'http:') return false;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return false;
  const octets = hostname.split('.').map(Number);
  if (octets.some(value => value > 255)) return false;
  const [first, second] = octets;
  return first === 10 || (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
}
