import { sub, len } from './vec2.js';

export function createRope({ start, end, segments, restLength }) {
  const rest = restLength ?? len(sub(end, start)) / segments;
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const pos = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
    points.push({ pos: { ...pos }, prev: { ...pos }, pinned: i === 0 || i === segments,
                  pin: (i === 0) ? { ...start } : (i === segments ? { ...end } : null) });
  }
  return { points, restLength: rest };
}

export function pinEnd(rope, which, pos) {
  const p = which === 'start' ? rope.points[0] : rope.points[rope.points.length - 1];
  p.pin = { ...pos };
}

export function step(rope, {
  dt, gravity = 9.8, groundY = -Infinity, iterations = 16, damping = 1,
  overrelax = 1.8, maxCorrection,
} = {}) {
  // NOTE: groundY defaults to -Infinity so the clamp below never fires when omitted.
  const { points, restLength } = rope;
  // Per-iteration positional correction clamp (no-snap), as a multiple of the link rest.
  const maxCorr = maxCorrection ?? restLength * 2;
  // Verlet integrate
  for (const p of points) {
    if (p.pinned) { p.pos = { ...p.pin }; p.prev = { ...p.pin }; continue; }
    const vx = (p.pos.x - p.prev.x) * damping, vy = (p.pos.y - p.prev.y) * damping;
    p.prev = { ...p.pos };
    p.pos.x += vx;
    p.pos.y += vy - gravity * dt * dt;
  }
  // Project one link, one-sided (resist stretch only) with over-relaxation (SOR): over-correcting
  // each link propagates tension along the chain far faster than plain Gauss-Seidel.
  const projectLink = (i) => {
    const a = points[i], b = points[i + 1];
    const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y;
    const d = Math.hypot(dx, dy);
    if (d <= restLength || d < 1e-9) return;         // ONE-SIDED: never push apart (rope, not rod)
    const ux = dx / d, uy = dy / d;
    const excess = (d - restLength) * overrelax;
    const aPin = a.pinned, bPin = b.pinned;
    if (aPin && bPin) return;
    if (aPin) {
      const r = Math.min(excess, maxCorr);
      b.pos.x -= ux * r; b.pos.y -= uy * r;
    } else if (bPin) {
      const r = Math.min(excess, maxCorr);
      a.pos.x += ux * r; a.pos.y += uy * r;
    } else {
      const r = Math.min(excess, maxCorr * 2) * 0.5;
      a.pos.x += ux * r; a.pos.y += uy * r;
      b.pos.x -= ux * r; b.pos.y -= uy * r;
    }
  };
  // Constraint relaxation: forward then backward sweep each iteration (symmetric convergence).
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < points.length - 1; i++) projectLink(i);
    for (let i = points.length - 2; i >= 0; i--) projectLink(i);
    for (const p of points) {
      if (p.pinned) { p.pos = { ...p.pin }; continue; }
      if (p.pos.y < groundY) p.pos.y = groundY;
    }
  }
}
