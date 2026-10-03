// Display-only zoom; all dimensions and offsets are CSS pixels.
export function zoomState() {
  let zoom = 1, x = 0, y = 0;
  let width = 0, height = 0, viewWidth = 0, viewHeight = 0;
  function clamp() {
    x = Math.max(-Math.max(0, (width * zoom - viewWidth) / 2), Math.min(Math.max(0, (width * zoom - viewWidth) / 2), x));
    y = Math.max(-Math.max(0, (height * zoom - viewHeight) / 2), Math.min(Math.max(0, (height * zoom - viewHeight) / 2), y));
    return { zoom, x, y };
  }
  return {
    layout(w, h, vw, vh) { width = w; height = h; viewWidth = vw; viewHeight = vh; return clamp(); },
    pinch(factor, anchorX, anchorY, dx = 0, dy = 0) {
      const next = Math.max(1, Math.min(4, zoom * factor));
      const ratio = next / zoom;
      x = anchorX - (anchorX - x) * ratio + dx;
      y = anchorY - (anchorY - y) * ratio + dy;
      zoom = next; return clamp();
    },
    pan(dx, dy) { x += dx; y += dy; return clamp(); },
    reset() { zoom = 1; x = y = 0; return clamp(); },
    get() { return { zoom, x, y }; }
  };
}

export function installGestures(element, state, render, { touch = () => {}, claim = () => {} } = {}) {
  let previous = null, owned = false, lastTap = 0, start = null;
  const points = touches => Array.from(touches, t => ({ x: t.clientX, y: t.clientY }));
  const center = ps => ({ x: ps.reduce((v, p) => v + p.x, 0) / ps.length, y: ps.reduce((v, p) => v + p.y, 0) / ps.length });
  const distance = ps => Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
  const consume = e => { e.preventDefault(); e.stopImmediatePropagation(); };
  element.addEventListener('touchstart', e => {
    previous = points(e.touches);
    if (previous.length === 1) start = { ...previous[0], time: Date.now() };
    else start = null;
    const nextOwned = owned || previous.length > 1 || state.get().zoom > 1;
    if (nextOwned && !owned) claim();
    owned = nextOwned;
    if (owned) consume(e); else touch(e);
  }, { capture: true, passive: false });
  element.addEventListener('touchmove', e => {
    const ps = points(e.touches);
    if (owned) {
      consume(e);
      if (previous && ps.length === previous.length) {
        const a = center(previous), b = center(ps);
        if (ps.length === 2) {
          const rect = element.getBoundingClientRect();
          state.pinch(distance(ps) / Math.max(1, distance(previous)), a.x - rect.left - rect.width / 2, a.y - rect.top - rect.height / 2, b.x - a.x, b.y - a.y);
        } else if (ps.length === 1) state.pan(b.x - a.x, b.y - a.y);
        render();
      }
    }
    if (!owned) touch(e);
    previous = ps;
  }, { capture: true, passive: false });
  element.addEventListener('touchend', e => {
    if (owned) consume(e);
    const t = e.changedTouches[0];
    if (!e.touches.length && start && t && Date.now() - start.time < 250 && Math.hypot(t.clientX - start.x, t.clientY - start.y) < 12) {
      const now = Date.now();
      if (now - lastTap < 300) { consume(e); claim(); state.reset(); render(); lastTap = 0; }
      else lastTap = now;
    }
    if (!owned && !e.defaultPrevented) touch(e);
    previous = points(e.touches);
    if (!e.touches.length) { owned = false; start = null; }
  }, { capture: true, passive: false });
  element.addEventListener('touchcancel', e => { claim(); if (owned) consume(e); previous = null; owned = false; start = null; }, { capture: true, passive: false });
}
