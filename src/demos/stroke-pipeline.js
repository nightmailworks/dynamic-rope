// stroke-pipeline.js: §Stroke module split, in isolation. A rope wraps a trunk (top-down):
// it is DECOMPOSED into the arc that hugs the wrap and the free legs between, each arc is
// TESSELLATED to exact quadratic Béziers, each free leg is FITTED to a smooth Bézier that joins the
// arc tangentially. Drag the slack handle; the free leg flexes (in-plane slack, geometry, not
// gravity) yet stays anchored to, and tangent with, the arc at the contact points.

import { decompose } from '../primitive-decompose.js';
import { tessellateArc } from '../arc-tessellate.js';
import { fitFreeSpan } from '../free-span-fit.js';

const C = {
  bg: '#0d1117', fg: '#e6edf3', fg2: '#8b949e',
  rope: '#996EFF', sim: '#4fd0e0', gold: '#f0c040',
  tree: '#3a6b4a', treeBdr: '#5aab7a',
};

function q(a, b, c, t) {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * b.x + t * t * c.x, y: u * u * a.y + 2 * u * t * b.y + t * t * c.y };
}

// The contact where a tangent from P meets the trunk on its UPPER side (rope rides over the top).
function upperTangent(P, center, R) {
  const d = Math.hypot(center.x - P.x, center.y - P.y);
  const psi = Math.atan2(P.y - center.y, P.x - center.x), al = Math.acos(Math.min(1, R / d));
  const c = [psi + al, psi - al].map(a => ({ a, x: center.x + R * Math.cos(a), y: center.y + R * Math.sin(a) }));
  return c[0].y < c[1].y ? c[0] : c[1];
}

function buildScene(W, H, slack) {
  const center = { x: W * 0.5, y: H * 0.5 }, radius = Math.min(W, H) * 0.2;
  // spool/hand sit close enough that the over-the-top contact arc is substantial (~100°), not a graze.
  const spool = { x: center.x - 2.3 * radius, y: center.y + 1.25 * radius };
  const hand  = { x: center.x + 2.3 * radius, y: center.y + 1.25 * radius };
  const T1 = upperTangent(spool, center, radius), T2 = upperTangent(hand, center, radius);

  // A free leg P→T. With slack=0 it's the straight tangent line (so it meets the arc tangentially);
  // slack bows it by a perpendicular belly on the side AWAY from the trunk (it never cuts in).
  const leg = (P, T) => {
    const mid = { x: (P.x + T.x) / 2, y: (P.y + T.y) / 2 };
    let nx = -(T.y - P.y), ny = T.x - P.x; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    if (Math.hypot(mid.x + nx - center.x, mid.y + ny - center.y) < Math.hypot(mid.x - center.x, mid.y - center.y)) { nx = -nx; ny = -ny; }
    const ctrl = { x: mid.x + nx * slack, y: mid.y + ny * slack };
    const pts = []; for (let i = 0; i <= 10; i++) pts.push(q(P, ctrl, T, i / 10));
    return { pts, ctrl, mid };
  };
  const L = leg(spool, T1), R = leg(hand, T2);

  let dA = T2.a - T1.a; while (dA <= -Math.PI) dA += 2 * Math.PI; while (dA > Math.PI) dA -= 2 * Math.PI;
  const arc = []; for (let i = 1; i < 18; i++) { const a = T1.a + dA * i / 18; arc.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) }); }

  const points = [...L.pts, ...arc, ...R.pts.slice().reverse()];   // spool → T1 → arc → T2 → hand
  return { points, wrap: { center, radius, entryAngle: T1.a, span: dA }, circle: { center, radius }, handle: L.ctrl, tautMid: L.mid };
}

function drawPoly(ctx, points, color, width, dash) {
  if (points.length < 2) return;
  ctx.save(); ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = ctx.lineCap = 'round';
  if (dash) ctx.setLineDash(dash); ctx.stroke(); ctx.restore();
}

function drawBeziers(ctx, beziers, color, width) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = ctx.lineCap = 'round';
  for (const [p0, p1, p2] of beziers) { ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y); ctx.stroke(); }
  ctx.restore();
}

function label(ctx, text, x, y, color = C.fg2, size = 10, align = 'center') {
  ctx.save(); ctx.font = `${size}px ui-monospace,Menlo,Consolas,monospace`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y); ctx.restore();
}

export function mount(root, { mode = 'full' } = {}) {
  const compact = mode === 'compact';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = root.clientWidth || 760;
  const H = root.clientHeight || 300;
  const canvas = root.appendChild(document.createElement('canvas'));
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  canvas.style.cssText = `width:${W}px;height:${H}px;display:block`;

  let slack = Math.min(W, H) * 0.16;     // a visible belly in each free leg by default
  let dragging = false, destroyed = false, raf = null;

  // arc tangent (direction of travel) at the entry (a0) or exit (a1) contact.
  const arcTan = (arc, entry) => { const a = entry ? arc.a0 : arc.a1, s = Math.sign(arc.a1 - arc.a0) || 1; return { x: -Math.sin(a) * s, y: Math.cos(a) * s }; };

  function render() {
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);

    const scene = buildScene(W, H, slack);
    const prims = decompose(scene.points, [scene.wrap]);
    const circles = [{ center: scene.circle.center, radius: scene.circle.radius }];
    const arcBeziers = [], freeBeziers = [];
    for (let i = 0; i < prims.length; i++) {
      const prim = prims[i];
      if (prim.kind === 'arc') { arcBeziers.push(...tessellateArc(prim.arc, { maxSegRad: Math.PI / 6 })); continue; }
      // join each free leg to the arc it abuts: prepend/append the arc's contact point and align the
      // boundary Bézier's control along the arc tangent at that contact, so the join is G1-continuous.
      const prev = prims[i - 1], next = prims[i + 1];
      const startJoin = prev && prev.kind === 'arc' ? { point: prev.arc.exit, tangent: arcTan(prev.arc, false) } : null;
      const endJoin   = next && next.kind === 'arc' ? { point: next.arc.entry, tangent: arcTan(next.arc, true) } : null;
      const seg = [];
      if (startJoin) seg.push(startJoin.point);
      for (let k = prim.start; k <= prim.end; k++) seg.push(scene.points[k]);
      if (endJoin) seg.push(endJoin.point);
      if (seg.length >= 2) freeBeziers.push(...fitFreeSpan(seg, { circles, startJoin, endJoin }));
    }

    // trunk (top-down)
    ctx.beginPath(); ctx.arc(scene.circle.center.x, scene.circle.center.y, scene.circle.radius, 0, Math.PI * 2);
    ctx.fillStyle = C.tree; ctx.fill(); ctx.strokeStyle = C.treeBdr; ctx.lineWidth = 2; ctx.stroke();

    drawPoly(ctx, scene.points, C.fg2 + '66', 1.2, [3, 5]);     // raw decomposed polyline (faint)
    drawBeziers(ctx, freeBeziers, C.sim, compact ? 3 : 3.5);    // free-span-fit
    drawBeziers(ctx, arcBeziers, C.rope, compact ? 4 : 5);      // arc-tessellate

    if (!compact) {
      for (const p of scene.points) { ctx.beginPath(); ctx.arc(p.x, p.y, 2.1, 0, Math.PI * 2); ctx.fillStyle = C.fg + 'cc'; ctx.fill(); }
      const h = scene.handle;
      ctx.beginPath(); ctx.arc(h.x, h.y, 11, 0, Math.PI * 2); ctx.strokeStyle = C.gold + 'aa'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
      label(ctx, 'decompose', W * 0.5, 20, C.fg2, 11);
      label(ctx, 'arc-tessellate', scene.circle.center.x, scene.circle.center.y - scene.circle.radius - 16, C.rope, 10);
      label(ctx, 'free-span-fit', W * 0.5, H - 16, C.sim, 10);
      label(ctx, 'drag slack', h.x, h.y + 22, C.gold, 9);
    }
  }

  function schedule() { if (raf !== null || destroyed) return; raf = requestAnimationFrame(() => { raf = null; render(); }); }
  function pos(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; }

  function onDown(e) {
    if (compact) return;
    const p = pos(e), h = buildScene(W, H, slack).handle;
    if (Math.hypot(p.x - h.x, p.y - h.y) > 18) return;
    e.preventDefault(); dragging = true; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing';
  }
  function onMove(e) {
    if (compact) return;
    const p = pos(e), h = buildScene(W, H, slack).handle;
    if (!dragging) { canvas.style.cursor = Math.hypot(p.x - h.x, p.y - h.y) <= 18 ? 'grab' : 'default'; return; }
    e.preventDefault();
    const taut = buildScene(W, H, 0).tautMid;               // slack = how far the belly is pulled off the taut leg
    slack = Math.max(0, Math.min(Math.min(W, H) * 0.3, Math.hypot(p.x - taut.x, p.y - taut.y)));
    schedule();
  }
  function onUp() { dragging = false; canvas.style.cursor = 'default'; }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  render();

  return {
    ready: Promise.resolve(),
    destroy() {
      destroyed = true; if (raf !== null) cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.remove();
    },
  };
}
