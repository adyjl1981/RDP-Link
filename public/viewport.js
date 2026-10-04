

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

// Safari may scroll its visual viewport to the focused local textarea.
export function sessionViewport(window) {
  const size = usableViewport(window), visual = window.visualViewport;
  const valid = visual && size.width === visual.width && size.height === visual.height;
  return { ...size, left: valid ? visual.offsetLeft || 0 : 0,
    top: valid ? visual.offsetTop || 0 : 0,
    occlusion: valid ? Math.max(0, window.innerHeight - visual.height) : 0 };
}

// Remote caret coordinates are unavailable. Reveal the last clicked region (or
// pointer) only when geometry changes, leaving manual panning undisturbed.
export function keyboardViewport(zoom) {
  let saved = null, anchor = null, geometry = '', closing = false;
  return {
    begin(point) {
      if (saved) { closing = false; return; }
      saved = zoom.get(); anchor = point ? { ...point } : null;
      geometry = ''; closing = false;
    },
    dismiss() { closing = true; },
    layout(width, height, viewWidth, viewHeight, occlusion = 0) {
      if (!saved) return;
      if (closing && occlusion < 100) {
        zoom.restore(saved); saved = anchor = null; geometry = ''; return;
      }
      const next = [width, height, viewWidth, viewHeight].join(',');
      if (geometry === next) return;
      geometry = next;
      if (!anchor || viewWidth <= 0 || viewHeight <= 0) return;
      const state = zoom.get();
      const px = (viewWidth - width * state.zoom) / 2 + state.x + anchor.x * state.zoom;
      const py = (viewHeight - height * state.zoom) / 2 + state.y + anchor.y * state.zoom;
      const marginX = Math.min(32, viewWidth / 4), marginY = Math.min(48, viewHeight / 4);
      zoom.pan(Math.max(marginX, Math.min(viewWidth - marginX, px)) - px,
        Math.max(marginY, Math.min(viewHeight - marginY, py)) - py);
    },
    reset() { saved = anchor = null; geometry = ''; closing = false; }
  };
}
