export function fit(width, height, availableWidth, availableHeight) {
  return width > 0 && height > 0 ? Math.min(availableWidth / width, availableHeight / height) : 1;
}
export function profile(input) {
  const port = Number(input.port);
  if (!input.host.trim() || /[\s/:]/.test(input.host) || !Number.isInteger(port) || port < 1 || port > 65535 || !input.username.trim()) throw Error('Enter a host, valid port and username.');
  return { name: input.name.trim() || input.host.trim(), host: input.host.trim(), port, username: input.username.trim() };
}

// CSS pixels keep controls readable on high-DPI phones. Bound resource usage.
export function desktopSize(width, height) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) return { width: 1280, height: 720 };
  const ratio = Math.min(1, 4096 / width, 4096 / height);
  return { width: Math.max(200, Math.round(width * ratio)), height: Math.max(200, Math.round(height * ratio)) };
}
