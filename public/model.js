export function fit(width, height, availableWidth, availableHeight) {
  return width > 0 && height > 0 ? Math.min(availableWidth / width, availableHeight / height) : 1;
}
export function profile(input) {
  const port = Number(input.port);
  if (!input.host.trim() || /[\s/:]/.test(input.host) || !Number.isInteger(port) || port < 1 || port > 65535 || !input.username.trim()) throw Error('Enter a host, valid port and username.');
  return { name: input.name.trim() || input.host.trim(), host: input.host.trim(), port, username: input.username.trim() };
}
