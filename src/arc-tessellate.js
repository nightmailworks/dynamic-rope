import { add, scale, fromAngle } from './vec2.js';

export function tessellateArc({ center, radius, a0, a1 }, { maxSegRad = Math.PI/6 } = {}) {
  const total = a1 - a0;
  const n = Math.max(1, Math.ceil(Math.abs(total) / maxSegRad));
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = a0 + total * i / n, e = a0 + total * (i + 1) / n;
    const half = (e - s) / 2, mid = (s + e) / 2;
    const q0 = add(center, scale(fromAngle(s), radius));
    const q2 = add(center, scale(fromAngle(e), radius));
    const q1 = add(center, scale(fromAngle(mid), radius / Math.cos(half)));
    out.push([q0, q1, q2]);
  }
  return out;
}
