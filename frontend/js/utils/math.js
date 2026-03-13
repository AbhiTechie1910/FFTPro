export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function avg(a, b) {
  return (a + b) / 2;
}

export function dist2D(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function midpoint(a, b) {
  if (!a || !b) return null;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
  };
}

export function angleDeg(a, b, c) {
  if (!a || !b || !c) return NaN;

  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };

  const dot = ab.x * cb.x + ab.y * cb.y;
  const mag = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);

  if (mag < 1e-6) return NaN;

  const cos = clamp(dot / mag, -1, 1);
  return Math.acos(cos) * (180 / Math.PI);
}

export function range(values = []) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) return 0;
  return Math.max(...clean) - Math.min(...clean);
}

export function projectPointOntoAxis(origin, target, point) {
  if (!origin || !target || !point) return NaN;

  const ax = target.x - origin.x;
  const ay = target.y - origin.y;
  const mag = Math.hypot(ax, ay);

  if (mag < 1e-6) return NaN;

  const ux = ax / mag;
  const uy = ay / mag;

  const vx = point.x - origin.x;
  const vy = point.y - origin.y;

  return vx * ux + vy * uy;
}

export function normalizeBy(referenceValue, value) {
  if (!Number.isFinite(referenceValue) || referenceValue === 0) return NaN;
  return value / referenceValue;
}

export function nowIso() {
  return new Date().toISOString();
}