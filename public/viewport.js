

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

// Local viewport updates never resize or replace the remote session.
export function viewportController({ getClient, measure, render }) {
  function update() {
    const client = getClient(); const { width, height } = measure();
    if (!client || width <= 0 || height <= 0) return;
    const display = client.getDisplay();
    if (render) render(display, 1, width, height);
    else display.scale(1);
  }
  return { fit: update, resize: update, reset() {} };
}
