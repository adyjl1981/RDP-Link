import { fit } from './model.js';

// Display-only zoom; all dimensions and offsets are CSS pixels.
export function zoomState() {
  let zoom = 1, x = 0, y = 0;
  let width = 0, height = 0, viewWidth = 0, viewHeight = 0, baseline = 1;
  function clamp() {
    x = Math.max(-Math.max(0, (width * baseline * zoom - viewWidth) / 2), Math.min(Math.max(0, (width * baseline * zoom - viewWidth) / 2), x));
    y = Math.max(-Math.max(0, (height * baseline * zoom - viewHeight) / 2), Math.min(Math.max(0, (height * baseline * zoom - viewHeight) / 2), y));
    return { zoom, x, y };
  }
  return {
    layout(w, h, vw, vh) {
      width = w; height = h; viewWidth = vw; viewHeight = vh;
      baseline = fit(w, h, vw, vh);
      const transform = clamp();
      return { ...transform, scale: baseline * zoom };
    },
    pinch(factor, anchorX, anchorY, dx = 0, dy = 0) {
      const next = Math.max(1, Math.min(4, zoom * factor));
      const ratio = next / zoom;
      x = anchorX - (anchorX - x) * ratio + dx;
      y = anchorY - (anchorY - y) * ratio + dy;
      zoom = next; return clamp();
    },
    pan(dx, dy) { if (zoom > 1) { x += dx; y += dy; } return clamp(); },
    reset() { zoom = 1; x = y = 0; return clamp(); },
    get() { return { zoom, x, y }; }
  };
}

export function remotePoint(point, rect, scale, width, height) {
  return { x: Math.max(0, Math.min(width - 1, (point.x - rect.left) / scale)),
    y: Math.max(0, Math.min(height - 1, (point.y - rect.top) / scale)) };
}

// Own touch input at the viewport, including letterboxed areas. Cancel native
// gestures from the first touch so Safari cannot take over a later pinch.
export function installGestures(element, state, render, { tap = () => {} } = {}) {
  let previous = [], start = null, pinching = false, moved = false, lastTap = 0;
  const points = touches => Array.from(touches, t => ({ x: t.clientX, y: t.clientY }));
  const center = ps => ({ x: ps.reduce((v, p) => v + p.x, 0) / ps.length, y: ps.reduce((v, p) => v + p.y, 0) / ps.length });
  const distance = ps => Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
  const consume = e => { e.preventDefault(); e.stopImmediatePropagation(); };
  const options = { capture: true, passive: false };
  element.addEventListener('touchstart', e => {
    consume(e);
    previous = points(e.touches);
    if (previous.length === 1 && !pinching) {
      start = { ...previous[0], time: Date.now() }; moved = false;
    } else { pinching = true; start = null; lastTap = 0; }
  }, options);
  element.addEventListener('touchmove', e => {
    consume(e);
    const ps = points(e.touches);
    if (start && ps[0] && Math.hypot(ps[0].x - start.x, ps[0].y - start.y) > 12) moved = true;
    if (ps.length && ps.length === previous.length) {
      const a = center(previous), b = center(ps);
      if (ps.length === 2) {
        const rect = element.getBoundingClientRect();
        state.pinch(distance(ps) / Math.max(1, distance(previous)), a.x - rect.left - rect.width / 2, a.y - rect.top - rect.height / 2, b.x - a.x, b.y - a.y);
        render();
      } else if (ps.length === 1 && state.get().zoom > 1 && (moved || pinching)) {
        state.pan(b.x - a.x, b.y - a.y); render();
      }
    }
    previous = ps;
  }, options);
  element.addEventListener('touchend', e => {
    consume(e);
    const t = e.changedTouches[0];
    if (!e.touches.length) {
      if (start && t && !pinching && !moved && Date.now() - start.time < 300
          && Math.hypot(t.clientX - start.x, t.clientY - start.y) < 12) {
        const now = Date.now();
        if (lastTap && now - lastTap < 300 && state.get().zoom > 1) { state.reset(); render(); lastTap = 0; }
        else { tap({ x: t.clientX, y: t.clientY }); lastTap = now; }
      }
      start = null; pinching = false; moved = false;
    }
    previous = points(e.touches);
  }, options);
  element.addEventListener('touchcancel', e => {
    consume(e); previous = []; start = null; pinching = false; moved = false; lastTap = 0;
  }, options);
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) element.addEventListener(type, consume, options);
}
