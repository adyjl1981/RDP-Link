import { desktopSize, fit } from './model.js';

// Resize only the current client: never construct a tunnel or end a session here.
export function viewportController({ getClient, measure, schedule = setTimeout, cancel = clearTimeout }) {
  let timer; let lastClient; let lastSize = '';
  function fitDisplay() {
    const client = getClient(); const { width, height } = measure();
    if (!client || width <= 0 || height <= 0) return;
    const display = client.getDisplay();
    display.scale(fit(display.getWidth(), display.getHeight(), width, height));
  }
  function update() {
    timer = undefined;
    const client = getClient(); const measured = measure();
    if (!client || client.getState() !== 3 || measured.width <= 0 || measured.height <= 0) return;
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
