export function fit(width, height, availableWidth, availableHeight) {
  return width > 0 && height > 0 ? Math.min(availableWidth / width, availableHeight / height) : 1;
}
export function profile(input) {
  const port = Number(input.port);
  if (!input.host.trim() || /[\s/:]/.test(input.host) || !Number.isInteger(port) || port < 1 || port > 65535 || !input.username.trim()) throw Error('Enter a host, valid port and username.');
  return { name: input.name.trim() || input.host.trim(), host: input.host.trim(), port, username: input.username.trim() };
}

// Initial RDP negotiation geometry is independent of the browser viewport.
export function desktopSize() {
  return { width: 1920, height: 1080 };
}

// Guacamole's reported desktop supersedes the fallback as soon as it is known.
export function displaySize(display) {
  const width = display.getWidth(), height = display.getHeight();
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? { width, height } : desktopSize();
}
