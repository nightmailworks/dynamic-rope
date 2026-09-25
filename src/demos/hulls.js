// hulls.js: §Solve illustration: the same wrap works on non-circular obstacles.
//
// Static (no drag). Two poses showing that circles are just the clean case:
//   hull:     the rope wraps a convex polygon, bending at SUPPORT VERTICES and
//              running along the hull edges between them (the analytic tangent
//              point on a circle becomes a vertex on a polygon).
//   boundary: a boundary loop: the rope routed INSIDE an enclosing region, hugging
//              an inward corner, the same wrap seen from the other side.
//
// Geometry is hand-authored for a clean illustration (this is a teaching figure,
// not a solver); the reusable solver in this repo is circle-only by design.
//
// Demo contract: mount(root, {pose, mode}) -> { ready, destroy }

const C = {
  bg: '#0d1117', fg: '#e6edf3', fg2: '#8b949e',
  rope: '#996EFF', tree: '#3a6b4a', treeBdr: '#5aab7a',
  vtx: '#f0c040', wall: '#39414f', wallBdr: '#5aab7a', gold: '#f0c040',
};

function setup(root) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = root.clientWidth || 380;
  const cssH = root.clientHeight || 300;
  const canvas = root.appendChild(document.createElement('canvas'));
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, cssW, cssH);
  return { canvas, ctx, cssW, cssH };
}

function dot(ctx, x, y, r, fill) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
}
function text(ctx, t, x, y, color, size = 11, align = 'center') {
  ctx.save();
  ctx.font = `${size}px ui-monospace,Menlo,Consolas,monospace`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(t, x, y); ctx.restore();
}
function poly(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); }

// ── Pose: convex hull wrap ────────────────────────────────────────────────────
function drawHull(ctx, W, H, compact) {
  const cx = W / 2, cy = H * 0.52, R = Math.min(W, H) * 0.26;
  // Convex hexagon (CCW), pointy-ish top so the rope drapes over two top vertices.
  const verts = [];
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + i * (Math.PI * 2 / 6);   // start at top
    verts.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  }
  // Fill hull
  poly(ctx, verts); ctx.closePath();
  ctx.fillStyle = C.tree; ctx.fill();
  ctx.strokeStyle = C.treeBdr; ctx.lineWidth = 2; ctx.stroke();

  // Endpoints below the hull, left & right.
  const spool = { x: W * 0.08, y: cy + R * 0.55 };
  const player = { x: W * 0.92, y: cy + R * 0.55 };

  // Support vertices: the two top vertices the rope grazes (indices 5 = upper-left, 1 = upper-right
  // for a top-first hexagon), plus the apex (0) between them; the rope runs along those edges.
  const chain = [verts[5], verts[0], verts[1]];   // upper-left → apex → upper-right

  // Rope: spool → chain → player
  const ropePts = [spool, ...chain, player];
  poly(ctx, ropePts);
  ctx.strokeStyle = C.rope; ctx.lineWidth = compact ? 3 : 3.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.stroke();

  // Highlight the support vertices
  for (const v of chain) {
    dot(ctx, v.x, v.y, compact ? 4 : 5, C.vtx);
  }
  // Endpoint dots
  dot(ctx, spool.x, spool.y, 5, C.fg2);
  dot(ctx, player.x, player.y, 5, C.gold);

  if (!compact) {
    text(ctx, 'spool', spool.x, spool.y + 16, C.fg2, 10);
    text(ctx, 'player', player.x, player.y + 16, C.gold, 10);
    text(ctx, 'support vertices', cx, verts[0].y - 14, C.vtx, 10);
    text(ctx, 'convex hull: the rope bends at vertices, not a tangent arc', cx, H - 14, C.fg2, 10);
  } else {
    text(ctx, 'convex hull', cx, H - 12, C.fg2, 10);
  }
}

// ── Pose: boundary loop ───────────────────────────────────────────────────────
function drawBoundary(ctx, W, H, compact) {
  // An enclosing region: SOLID outside, OPEN space inside. A solid block hangs from
  // the top wall INTO the room. The straight spool→player line is blocked by the
  // block, so the rope must detour UNDER it, hugging the block's two bottom corners;
  // the same wrap as a convex hull, just from the inside (solid on the far side).
  const m = Math.min(W, H) * 0.10;
  const left = m, right = W - m, top = H * 0.14, bot = H * 0.86;
  const cx = W * 0.5, bw = W * 0.10, blockBot = H * 0.52;

  // Open-region polygon (CCW-ish): the room rectangle with the hanging block carved out.
  const region = [
    { x: left, y: top },
    { x: cx - bw, y: top }, { x: cx - bw, y: blockBot },   // down the block's left side
    { x: cx + bw, y: blockBot }, { x: cx + bw, y: top },   // across its bottom, up its right side
    { x: right, y: top }, { x: right, y: bot }, { x: left, y: bot },
  ];
  ctx.save();
  ctx.fillStyle = C.wall;
  ctx.fillRect(0, 0, W, H);                 // everything solid…
  poly(ctx, region); ctx.closePath();
  ctx.fillStyle = C.bg; ctx.fill();         // …then carve the open room (incl. under the block)
  ctx.strokeStyle = C.wallBdr; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();

  // Rope: spool & player at mid-height (within the block's vertical span, so the
  // straight line is blocked). It detours under the block, hugging both bottom corners.
  const spool  = { x: left + W * 0.05, y: H * 0.40 };
  const player = { x: right - W * 0.05, y: H * 0.40 };
  const cL = { x: cx - bw, y: blockBot };
  const cR = { x: cx + bw, y: blockBot };
  poly(ctx, [spool, cL, cR, player]);
  ctx.strokeStyle = C.rope; ctx.lineWidth = compact ? 3 : 3.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.stroke();
  dot(ctx, cL.x, cL.y, compact ? 4 : 5, C.vtx);
  dot(ctx, cR.x, cR.y, compact ? 4 : 5, C.vtx);
  dot(ctx, spool.x, spool.y, 5, C.fg2);
  dot(ctx, player.x, player.y, 5, C.gold);

  if (!compact) {
    text(ctx, 'solid', cx, top + (blockBot - top) / 2, C.fg2, 9);
    text(ctx, 'open space', cx, bot - 12, C.fg2, 9);
    text(ctx, 'inside corners', cx, blockBot + 16, C.vtx, 10);
    text(ctx, 'boundary loop: the rope detours around solid, hugging the inside corners', cx, H - 14, C.fg2, 9.5);
  } else {
    text(ctx, 'boundary loop', cx, H - 12, C.fg2, 10);
  }
}

/**
 * @param {Element} root
 * @param {{ pose?: 'hull'|'boundary', mode?: 'full'|'compact' }} opts
 * @returns {{ ready: Promise<void>, destroy(): void }}
 */
export function mount(root, { pose = 'hull', mode = 'full' } = {}) {
  const { ctx, cssW, cssH } = setup(root);
  const compact = mode === 'compact';
  if (pose === 'boundary') drawBoundary(ctx, cssW, cssH, compact);
  else drawHull(ctx, cssW, cssH, compact);
  return { ready: Promise.resolve(), destroy() { root.querySelector('canvas')?.remove(); } };
}
