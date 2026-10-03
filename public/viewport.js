import { desktopSize, fit } from './model.js';

// Read both axes together: iOS may briefly retain the previous visual viewport
// during rotation. Use the layout viewport until the visual viewport catches up.
export function usableViewport(window) {
  const visual = window.visualViewport;
  const width = window.innerWidth, height = window.innerHeight;
  const valid = visual?.width > 0 && visual?.height > 0;
  const stale = valid && width > 0 && height > 0 && Math.abs(visual.width - width) > 1
    && (visual.width > visual.height) !== (width > height);
  return valid && !stale
    ? { width: visual.width, height: visual.height }
    : { width, height };
}

// Resize only the current client: never construct a tunnel or end a session here.
export function viewportController({ getClient, isConnected = () => true, measure, schedule = setTimeout, cancel = clearTimeout, render }) {
  let timer; let lastClient; let lastSize = '';
  function fitDisplay() {
    const client = getClient(); const { width, height } = measure();
    if (!client || width <= 0 || height <= 0) return;
    const display = client.getDisplay();
    const scale = fit(display.getWidth(), display.getHeight(), width, height);
    if (render) render(display, scale, width, height);
    else display.scale(scale);
  }
  function update() {
    timer = undefined;
    const client = getClient(); const measured = measure();
    if (!client || !isConnected(client) || measured.width <= 0 || measured.height <= 0) return;
    const { width, height } = desktopSize(measured.width, measured.height);
    const size = `${width}x${height}`;
    if (client !== lastClient || size !== lastSize) {
      client.sendSize(width, height); lastClient = client; lastSize = size;
    }
    fitDisplay();
  }
  return {
    fit: fitDisplay,
    resize() { fitDisplay(); cancel(timer); timer = schedule(update, 250); },
    reset() { cancel(timer); timer = undefined; lastClient = null; lastSize = ''; }
  };
}
