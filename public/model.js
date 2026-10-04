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

// Whitelist every persisted field, including when migrating older device data.
export function savedProfile(input) {
  const p = profile(input);
  if (Number.isFinite(input.zoom) && input.zoom > 0 && input.zoom <= 4) p.zoom = input.zoom;
  return p;
}
export function profileStore(storage) {
  let entries = [];
  try {
    const data = JSON.parse(storage.getItem('rdp-profiles') || '[]');
    if (Array.isArray(data)) for (const item of data) {
      try { entries.push(savedProfile(item)); } catch { /* Keep other valid profiles. */ }
    }
    storage.setItem('rdp-profiles', JSON.stringify(entries));
  } catch { /* A device can disable storage. Saving will report the error. */ }
  const persist = next => { storage.setItem('rdp-profiles', JSON.stringify(next)); entries = next; };
  return {
    list: () => entries.map(p => ({ ...p })),
    save(input, index = -1) {
      const p = savedProfile(input), next = entries.slice();
      if (index >= 0 && index < next.length) next[index] = p;
      else { index = next.length; next.push(p); }
      persist(next); return index;
    },
    remove(index) { if (index < 0 || index >= entries.length) return; persist(entries.filter((_, i) => i !== index)); }
  };
}
