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
      baseline = 1;
      const transform = clamp();
      return { ...transform, scale: baseline * zoom };
    },
    pinch(factor, anchorX, anchorY, dx = 0, dy = 0, origin = { zoom, x, y }) {
      const next = Math.max(Math.min(1, fit(width, height, viewWidth, viewHeight)), Math.min(4, origin.zoom * factor));
      const ratio = next / origin.zoom;
      x = anchorX - (anchorX - origin.x) * ratio + dx;
      y = anchorY - (anchorY - origin.y) * ratio + dy;
      zoom = next; return clamp();
    },
    pan(dx, dy) { x += dx; y += dy; return clamp(); },
    // Input deltas are CSS pixels; cursor coordinates remain remote pixels.
    // Only the portion of a move beyond the actual viewport edge pans.
    followCursor(cursor, dx, dy) {
      const scale = baseline * zoom;
      const next = {
        x: Math.max(0, Math.min(width - 1, cursor.x + dx / scale)),
        y: Math.max(0, Math.min(height - 1, cursor.y + dy / scale))
      };
      const screenX = (viewWidth - width * scale) / 2 + x + next.x * scale;
      const screenY = (viewHeight - height * scale) / 2 + y + next.y * scale;
      if (dx < 0 && screenX < 0) x -= screenX;
      if (dx > 0 && screenX > viewWidth) x -= screenX - viewWidth;
      if (dy < 0 && screenY < 0) y -= screenY;
      if (dy > 0 && screenY > viewHeight) y -= screenY - viewHeight;
      clamp();
      return next;
    },
    fit() { zoom = fit(width, height, viewWidth, viewHeight); x = y = 0; return clamp(); },
    reset() { zoom = 1; x = y = 0; return clamp(); },
    restore(state) { ({ zoom, x, y } = state); return clamp(); },
    get() { return { zoom, x, y }; }
  };
}

export function remotePoint(point, rect, scale, width, height) {
  return { x: Math.max(0, Math.min(width - 1, (point.x - rect.left) / scale)),
    y: Math.max(0, Math.min(height - 1, (point.y - rect.top) / scale)) };
}

// Own touch input at the viewport, including letterboxed areas. Cancel native
// gestures from the first touch so Safari cannot take over a later pinch.
export function installGestures(element, state, render, {
  tap = () => {}, move, rightClick = () => {}, scroll, scrollStart = () => {},
  schedule = setTimeout, cancel = clearTimeout
} = {}) {
  let previous = [], start = null, mode = 'idle', travel = 0, timer = null, pair = null, lastTap = 0;
  const points = touches => Array.from(touches, t => ({ x: t.clientX, y: t.clientY }));
  const center = ps => ({ x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 });
  const distance = ps => Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
  const stopTimer = () => { if (timer !== null) cancel(timer); timer = null; };
  const consume = e => { e.preventDefault(); e.stopImmediatePropagation(); };
  const options = { capture: true, passive: false };
  element.addEventListener('touchstart', e => {
    consume(e); stopTimer(); previous = points(e.touches);
    if (previous.length === 1 && mode === 'idle') {
      start = { ...previous[0], time: Date.now() }; mode = 'pointer'; travel = 0;
      timer = schedule(() => {
        timer = null;
        if (mode === 'pointer' && travel < 12) { mode = 'held'; start = null; rightClick(); }
      }, 500);
    } else {
      start = null; lastTap = 0;
      mode = previous.length === 2 ? 'pending' : 'blocked';
      if (previous.length === 2) pair = { center: center(previous), distance: Math.max(1, distance(previous)), origin: state.get() };
    }
  }, options);
  element.addEventListener('touchmove', e => {
    consume(e); const ps = points(e.touches);
    if (ps.length === 2 && previous.length === 2 && pair && mode !== 'blocked') {
      stopTimer(); const b = center(ps), d = distance(ps);
      if (mode === 'pending') {
        if (Math.abs(d - pair.distance) >= 6) mode = 'pinch';
        else if (Math.hypot(b.x - pair.center.x, b.y - pair.center.y) >= 8) {
          mode = scroll ? 'scroll' : 'pinch'; if (scroll) scrollStart();
        }
      }
      if (mode === 'pinch') {
        const rect = element.getBoundingClientRect();
        state.pinch(d / pair.distance, pair.center.x - rect.left - rect.width / 2,
          pair.center.y - rect.top - rect.height / 2, b.x - pair.center.x, b.y - pair.center.y, pair.origin);
        render();
      } else if (mode === 'scroll') {
        const a = center(previous);
        const from = pair.delivered ? a : pair.center;
        scroll(b.x - from.x, b.y - from.y); pair.delivered = true;
      }
    } else if (ps.length === 1 && previous.length === 1 && mode === 'pointer') {
      const dx = ps[0].x - previous[0].x, dy = ps[0].y - previous[0].y;
      travel += Math.hypot(dx, dy); if (travel >= 12) stopTimer();
      if (move) move(dx, dy); else if (travel >= 12) { state.pan(dx, dy); render(); }
    }
    previous = ps;
  }, options);
  element.addEventListener('touchend', e => {
    consume(e); stopTimer(); const t = e.changedTouches[0];
    if (!e.touches.length) {
      if (start && t && previous.length === 1) travel += Math.hypot(t.clientX - previous[0].x, t.clientY - previous[0].y);
      if (mode === 'pointer' && start && t && travel < 12 && Date.now() - start.time < 300) {
        const now = Date.now();
        if (!move && lastTap && now - lastTap < 300) { state.reset(); render(); lastTap = 0; }
        else { tap({ x: t.clientX, y: t.clientY }); lastTap = now; }
      }
      start = pair = null; mode = 'idle';
    } else { start = null; mode = 'blocked'; }
    previous = points(e.touches);
  }, options);
  const reset = () => { stopTimer(); previous = []; start = pair = null; mode = 'idle'; lastTap = 0; };
  element.addEventListener('touchcancel', e => { consume(e); reset(); }, options);
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) element.addEventListener(type, e => {
    consume(e); stopTimer(); start = null; lastTap = 0;
    // Safari also emits gesture events for touches we already own.
    if (previous.length < 2) mode = type === 'gestureend' && !previous.length ? 'idle' : 'blocked';
  }, options);
  return { reset };
}
