// sdf.js: §Stroke: quadratic-Bézier SDF stroke demo.
//
// Three URL-addressable poses for headless verification:
//   default:  WebGL path forced (fails LOUD with throw if shader compile/link fails)
//   cpu:      Canvas-2D per-pixel path forced (uses src/bezier-sdf.js sdBezier)
//   heatmap:  WebGL distance-field colour ramp (multiple distinct colour bands)
//
// Anti-v1-blank-SDF checks baked in:
//   1. Module-relative shader URL: new URL('../bezier-sdf.glsl', import.meta.url)
//      so it resolves under /index.html AND /verify/harness.html.
//   2. Compile/link errors throw immediately (never silent blank).
//   3. default and cpu use IDENTICAL fixed control points; stroked regions coincide.
//   4. A visible badge shows which path (WebGL / Canvas 2D) is active.
//   5. `default` pose FAILS (throws) rather than silently falling back to CPU.
//      The harness will show a red ERROR screenshot, not a false green blank.
//
// Demo contract: mount(root, {pose}) -> { ready: Promise<void>, destroy(): void }
// Canvas dimensions in the verify harness: 760×480.

import { sdBezier } from '../bezier-sdf.js';

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  bg:    '#0d1117',
  bg2:   '#161b22',
  rope:  '#996EFF',
  ropeR: 0.6, ropeG: 0.43, ropeB: 1.0,    // linear (no gamma)
  fg:    '#e6edf3',
  fg2:   '#8b949e',
  ok:    '#3fb950',
  warn:  '#f85149',
  gold:  '#f0b040',
};

// ── Fixed control points (pixel space, used by BOTH WebGL and CPU poses) ──────
// These are FIXED (not draggable in the default/cpu/heatmap poses) so the
// verify harness can assert a pixel-count floor without user interaction.
//
// The canvas is 760×480. Control points in CSS/Canvas2D pixel coords (Y-down).
// For WebGL (gl_FragCoord, Y-up from bottom-left) we flip Y: glY = H - cssY.
function fixedCtrlPts(W, H) {
  return [
    { cssX: W * 0.20, cssY: H * 0.65 },   // P0: bottom-left
    { cssX: W * 0.50, cssY: H * 0.20 },   // P1: top-centre (control)
    { cssX: W * 0.80, cssY: H * 0.65 },   // P2: bottom-right
  ];
}

// ── WebGL helpers ─────────────────────────────────────────────────────────────

function createShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`[sdf.js] Shader compile failed:\n${log}`);
  }
  return s;
}

function createProgram(gl, vertSrc, fragSrc) {
  const vs = createShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.deleteProgram(prog);
    throw new Error(`[sdf.js] Shader link failed:\n${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

// Full-screen quad vertex shader (used by all WebGL poses).
const VERT_SRC = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

function buildFullscreenQuad(gl, prog) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER,
    new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a_pos');
  return { buf, loc };
}

function drawFullscreenQuad(gl, prog, { buf, loc }, uniforms) {
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  for (const [name, val] of Object.entries(uniforms)) {
    const u = gl.getUniformLocation(prog, name);
    if (u === null) continue;
    if (typeof val === 'number')       gl.uniform1f(u, val);
    else if (val.length === 2)         gl.uniform2f(u, val[0], val[1]);
    else if (val.length === 3)         gl.uniform3f(u, val[0], val[1], val[2]);
  }
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// ── Heatmap fragment shader (inlined, no fetch needed) ────────────────────────
const HEATMAP_FRAG = `
precision highp float;
uniform vec2 p0, p1, p2;
uniform float half_px;
float dot2(vec2 v){ return dot(v,v); }
float sdSegment(vec2 p, vec2 a, vec2 b){
  vec2 pa=p-a, ba=b-a;
  float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0);
  return length(pa-ba*h);
}
float sdBez(vec2 pos, vec2 A, vec2 B, vec2 C){
  vec2 a=B-A, b=A-2.0*B+C, d=A-pos;
  float bb=dot(b,b); if(bb<1e-6) return sdSegment(pos,A,C);
  float kk=1.0/bb, kx=kk*dot(a,b), ky=kk*(2.0*dot(a,a)+dot(d,b))/3.0, kz=kk*dot(d,a);
  float p=ky-kx*kx, p3=p*p*p, q=kx*(2.0*kx*kx-3.0*ky)+kz, h=q*q+4.0*p3; float res;
  if(h>=0.0){ h=sqrt(h); vec2 x=(vec2(h,-h)-q)/2.0;
    vec2 uv=sign(x)*pow(abs(x),vec2(1.0/3.0)); float t=clamp(uv.x+uv.y-kx,0.0,1.0);
    vec2 qp=(1.0-t)*(1.0-t)*A+2.0*(1.0-t)*t*B+t*t*C; res=length(pos-qp);
  } else { float z=sqrt(-p), v=acos(clamp(q/(p*z*2.0),-1.0,1.0))/3.0;
    float m=cos(v), n=sin(v)*1.732050808;
    vec3 t=clamp(vec3(m+m,-n-m,n-m)*z-kx,0.0,1.0);
    vec2 q0=(1.0-t.x)*(1.0-t.x)*A+2.0*(1.0-t.x)*t.x*B+t.x*t.x*C;
    vec2 q1=(1.0-t.y)*(1.0-t.y)*A+2.0*(1.0-t.y)*t.y*B+t.y*t.y*C;
    vec2 q2=(1.0-t.z)*(1.0-t.z)*A+2.0*(1.0-t.z)*t.z*B+t.z*t.z*C;
    res=min(length(pos-q0), min(length(pos-q1), length(pos-q2)));
  } return res;
}
void main(){
  vec2 bq=p0-2.0*p1+p2; float d;
  if(dot(bq,bq) < 1e-6*max(dot2(p2-p0),1.0)) d=sdSegment(gl_FragCoord.xy,p0,p2);
  else d=sdBez(gl_FragCoord.xy,p0,p1,p2);
  // Distance ramp with multiple distinct colour bands:
  //   inside stroke  → lavender (#996EFF)
  //   stroke edge    → white marker
  //   near outside   → blue fade
  //   mid outside    → gold
  //   far outside    → dark purple (background)
  float range = half_px * 4.0;
  float norm  = clamp(d / range, 0.0, 1.0);
  vec3 inside   = vec3(0.60, 0.43, 1.00);   // lavender
  vec3 nearOut  = vec3(0.10, 0.60, 1.00);   // blue
  vec3 midOut   = vec3(1.00, 0.80, 0.10);   // gold
  vec3 farOut   = vec3(0.08, 0.04, 0.18);   // dark purple
  vec3 col;
  if (d < half_px) {
    col = inside;
  } else {
    float t = clamp((d - half_px) / (range - half_px), 0.0, 1.0);
    float t1 = clamp(t * 2.0, 0.0, 1.0);
    float t2 = clamp(t * 2.0 - 1.0, 0.0, 1.0);
    col = mix(mix(nearOut, midOut, t1), farOut, t2);
  }
  // Stroke boundary marker (thin white ring)
  if (abs(d - half_px) < 1.5) col = vec3(1.0);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ── CPU / Canvas-2D path ──────────────────────────────────────────────────────
function renderCpu(canvas, pts, halfPx) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const img  = ctx.createImageData(W, H);
  const data = img.data;

  // Control points in JS {x,y} (CSS coords, Y-down, matching Canvas origin).
  // sdBezier takes {x,y} objects in the same coord system as p, consistent.
  const A = { x: pts[0].cssX, y: pts[0].cssY };
  const B = { x: pts[1].cssX, y: pts[1].cssY };
  const Cv = { x: pts[2].cssX, y: pts[2].cssY };

  const rI = Math.round(C.ropeR * 255);
  const gI = Math.round(C.ropeG * 255);
  const bI = Math.round(C.ropeB * 255);

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const d = sdBezier({ x: px + 0.5, y: py + 0.5 }, A, B, Cv);
      if (d > halfPx) continue;
      const aa = 1 - Math.max(0, Math.min(1, (d - (halfPx - 1.0)) / 1.0));
      const i  = (py * W + px) * 4;
      data[i]   = rI;
      data[i+1] = gI;
      data[i+2] = bI;
      data[i+3] = Math.round(aa * 255);
    }
  }

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.putImageData(img, 0, 0);
}

// ── Draw control-point handles on a 2D context (overlay for WebGL, or main for CPU) ──
function drawHandles(ctx, pts, H) {
  for (let i = 0; i < pts.length; i++) {
    const { cssX, cssY } = pts[i];
    ctx.beginPath();
    ctx.arc(cssX, cssY, 8, 0, Math.PI * 2);
    ctx.fillStyle = i === 1 ? C.gold : C.fg;
    ctx.fill();
    ctx.strokeStyle = C.bg;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = C.bg;
    ctx.font = 'bold 10px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`P${i}`, cssX, cssY);
  }
}

// ── Badge overlay (mode label + info) ────────────────────────────────────────
function drawBadge(ctx, label, ok) {
  ctx.save();
  const txt = label;
  ctx.font = 'bold 12px ui-monospace, Menlo, Consolas, monospace';
  const tw = ctx.measureText(txt).width;
  const bx = 10, by = 10, bw = tw + 18, bh = 24, br = 6;
  ctx.fillStyle = C.bg2;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, br);
  ctx.fill();
  ctx.fillStyle = ok ? C.ok : C.warn;
  ctx.fillText(txt, bx + 9, by + bh / 2 + 1);
  ctx.restore();
}

// ── Mount ─────────────────────────────────────────────────────────────────────
export function mount(root, { pose = 'default', mode = 'full' } = {}) {
  // Compact mode: just the smooth SDF stroke + tiny caption, no handles, no badge.
  // cpu/heatmap poses always use full rendering even in compact (they only appear in modal).
  if (mode === 'compact' && pose !== 'cpu' && pose !== 'heatmap') {
    const cssW = root.clientWidth  || 290;
    const cssH = root.clientHeight || 300;
    const dpr  = Math.min(window.devicePixelRatio || 1, 2);
    const PW   = Math.round(cssW * dpr);
    const PH   = Math.round(cssH * dpr);

    const canvas = root.appendChild(document.createElement('canvas'));
    canvas.width  = PW;
    canvas.height = PH;
    canvas.style.width   = `${cssW}px`;
    canvas.style.height  = `${cssH}px`;
    canvas.style.display = 'block';

    const pts = fixedCtrlPts(cssW, cssH);
    const halfPxCss  = 14;
    const halfPxPhys = halfPxCss * dpr;

    let compactDestroyed = false;
    let compactGl = null, compactProg = null, compactQuad = null;

    const ready = (async () => {
      const shaderUrl = new URL('../bezier-sdf.glsl', import.meta.url);
      const resp = await fetch(shaderUrl);
      if (compactDestroyed) return;
      if (!resp.ok) throw new Error(`[sdf.js] fetch ${shaderUrl} failed: ${resp.status}`);
      const fragSrc = await resp.text();
      if (compactDestroyed) return;

      // premultipliedAlpha:false so the SDF's straight-alpha edge composites as a true
      // rope→background blend (not a bright fringe), i.e. it actually anti-aliases.
      const gl = canvas.getContext('webgl', { premultipliedAlpha: false });
      if (!gl) throw new Error('[sdf.js] compact: WebGL not available');
      compactGl = gl;

      const prog = createProgram(gl, VERT_SRC, fragSrc);
      compactProg = prog;
      const quad = buildFullscreenQuad(gl, prog);
      compactQuad = quad;

      if (compactDestroyed) return;

      gl.viewport(0, 0, PW, PH);
      const p0gl = [pts[0].cssX * dpr, PH - pts[0].cssY * dpr];
      const p1gl = [pts[1].cssX * dpr, PH - pts[1].cssY * dpr];
      const p2gl = [pts[2].cssX * dpr, PH - pts[2].cssY * dpr];
      drawFullscreenQuad(gl, prog, quad, {
        p0: p0gl, p1: p1gl, p2: p2gl,
        half_px: halfPxPhys,
        aa_px: dpr * 1.5,
        rope_color: [C.ropeR, C.ropeG, C.ropeB],
      });

      // Overlay: just the single caption, no handle labels, no badge
      const overlayCanvas = document.createElement('canvas');
      overlayCanvas.width  = PW;
      overlayCanvas.height = PH;
      overlayCanvas.style.width  = `${cssW}px`;
      overlayCanvas.style.height = `${cssH}px`;
      Object.assign(overlayCanvas.style, {
        position: 'absolute', top: '0', left: '0', pointerEvents: 'none',
      });
      canvas.style.position = 'relative';
      canvas.parentElement.style.position = 'relative';
      canvas.parentElement.appendChild(overlayCanvas);

      const octx = overlayCanvas.getContext('2d');
      octx.scale(dpr, dpr);
      octx.font = '10px ui-monospace, Menlo, Consolas, monospace';
      octx.fillStyle = C.fg2;
      octx.textAlign = 'center';
      octx.textBaseline = 'bottom';
      octx.fillText('SDF stroke', cssW / 2, cssH - 8);

      // Store refs for destroy
      canvas._compactOverlay = overlayCanvas;
    })();

    return {
      ready,
      destroy() {
        compactDestroyed = true;
        if (compactGl) {
          if (compactQuad) compactGl.deleteBuffer(compactQuad.buf);
          if (compactProg) compactGl.deleteProgram(compactProg);
          compactGl.getExtension('WEBGL_lose_context')?.loseContext();
        }
        canvas.remove();
        if (canvas._compactOverlay) canvas._compactOverlay.remove();
      },
    };
  }

  // CSS (logical) dimensions: what the element occupies on screen.
  const W = root.clientWidth  || 760;
  const H = root.clientHeight || 480;

  // Device pixel ratio: cap at 2 to avoid outsized GPU cost on 3× screens.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  // Physical backing-store dimensions.
  const PW = Math.round(W * dpr);
  const PH = Math.round(H * dpr);

  // ── Canvas ────────────────────────────────────────────────────────────────
  const canvas = root.appendChild(document.createElement('canvas'));
  // Backing store at physical resolution for crisp rendering at devicePixelRatio.
  canvas.width  = PW;
  canvas.height = PH;
  // CSS size stays at the logical element size so no CSS upscaling.
  canvas.style.width  = `${W}px`;
  canvas.style.height = `${H}px`;
  canvas.style.display = 'block';

  // Control points in CSS pixel space (logical, Y-down).
  const pts = fixedCtrlPts(W, H);

  // Stroke half-width in CSS pixels; scale by dpr for the physical pixel space
  // the shader evaluates in.
  const halfPxCss = 16;
  const halfPxPhys = halfPxCss * dpr;

  // The AA edge in the GLSL smoothstep covers 1 physical pixel (~1/dpr CSS px):
  // that is 0.5 CSS px at dpr=2, which is imperceptibly thin and perfectly smooth.

  let overlayCanvas = null;  // 2D overlay for handle dots over WebGL
  let fullDestroyed = false;
  let fullGl = null, fullProg = null, fullQuad = null;

  // ── Async init (shader fetch for WebGL poses) ─────────────────────────────
  const ready = (async () => {
    if (pose === 'cpu') {
      // ── CPU / Canvas-2D pose ─────────────────────────────────────────────
      // CPU path works in physical pixels. Scale control points and halfPx by dpr
      // so renderCpu (which uses canvas.width/height as its coordinate space) renders
      // into the full physical backing store with correct proportions.
      const physPts = pts.map(p => ({ cssX: p.cssX * dpr, cssY: p.cssY * dpr }));
      renderCpu(canvas, physPts, halfPxPhys);
      // Draw handles and badge in CSS logical coordinates (scale the 2D context).
      const ctx2 = canvas.getContext('2d');
      ctx2.scale(dpr, dpr);
      drawHandles(ctx2, pts, H);
      drawBadge(ctx2, 'Canvas 2D (CPU)', true);

    } else if (pose === 'heatmap') {
      // ── Heatmap pose: inlined GLSL, no fetch ─────────────────────────────
      if (fullDestroyed) return;
      const gl = canvas.getContext('webgl', { premultipliedAlpha: false });
      if (!gl) throw new Error('[sdf.js] heatmap pose: WebGL not available');
      fullGl = gl;
      const prog = createProgram(gl, VERT_SRC, HEATMAP_FRAG);
      fullProg = prog;
      const quad = buildFullscreenQuad(gl, prog);
      fullQuad = quad;
      if (fullDestroyed) return;
      // Viewport at full physical resolution.
      gl.viewport(0, 0, PW, PH);
      // Control points in WebGL physical-pixel space (Y-up from bottom-left).
      const p0gl = [pts[0].cssX * dpr, PH - pts[0].cssY * dpr];
      const p1gl = [pts[1].cssX * dpr, PH - pts[1].cssY * dpr];
      const p2gl = [pts[2].cssX * dpr, PH - pts[2].cssY * dpr];
      drawFullscreenQuad(gl, prog, quad, {
        p0: p0gl, p1: p1gl, p2: p2gl, half_px: halfPxPhys,
      });
      // Overlay: handle dots and badge in logical CSS pixels.
      overlayCanvas = document.createElement('canvas');
      overlayCanvas.width  = PW;
      overlayCanvas.height = PH;
      overlayCanvas.style.width  = `${W}px`;
      overlayCanvas.style.height = `${H}px`;
      Object.assign(overlayCanvas.style, {
        position: 'absolute', top: '0', left: '0', pointerEvents: 'none',
      });
      canvas.style.position = 'relative';
      canvas.parentElement.style.position = 'relative';
      canvas.parentElement.appendChild(overlayCanvas);
      const octx = overlayCanvas.getContext('2d');
      octx.scale(dpr, dpr);
      drawHandles(octx, pts, H);
      drawBadge(octx, 'WebGL · heatmap', true);

    } else {
      // ── Default (WebGL stroke) pose ───────────────────────────────────────
      // CRITICAL: use module-relative URL so this works under BOTH:
      //   /index.html (server root)  → resolves to /src/bezier-sdf.glsl
      //   /verify/harness.html       → resolves to /src/bezier-sdf.glsl
      const shaderUrl = new URL('../bezier-sdf.glsl', import.meta.url);
      const resp = await fetch(shaderUrl);
      if (fullDestroyed) return;
      if (!resp.ok) {
        throw new Error(`[sdf.js] fetch ${shaderUrl} failed: ${resp.status} ${resp.statusText}`);
      }
      const fragSrc = await resp.text();
      if (fullDestroyed) return;

      const gl = canvas.getContext('webgl', { premultipliedAlpha: false });
      if (!gl) throw new Error('[sdf.js] default pose: WebGL not available');
      fullGl = gl;

      // LOUD: createProgram throws on compile/link failure, never a silent blank.
      const prog = createProgram(gl, VERT_SRC, fragSrc);
      fullProg = prog;
      const quad = buildFullscreenQuad(gl, prog);
      fullQuad = quad;

      if (fullDestroyed) return;

      // Viewport at full physical resolution.
      gl.viewport(0, 0, PW, PH);
      // Control points in WebGL physical-pixel space (Y-up from bottom-left).
      const p0gl = [pts[0].cssX * dpr, PH - pts[0].cssY * dpr];
      const p1gl = [pts[1].cssX * dpr, PH - pts[1].cssY * dpr];
      const p2gl = [pts[2].cssX * dpr, PH - pts[2].cssY * dpr];
      const ropeColor = [C.ropeR, C.ropeG, C.ropeB];
      drawFullscreenQuad(gl, prog, quad, {
        p0: p0gl, p1: p1gl, p2: p2gl,
        half_px: halfPxPhys,
        aa_px: dpr * 1.5,
        rope_color: ropeColor,
      });

      // Overlay: handle dots + badge on a 2D canvas positioned over WebGL canvas.
      overlayCanvas = document.createElement('canvas');
      overlayCanvas.width  = PW;
      overlayCanvas.height = PH;
      overlayCanvas.style.width  = `${W}px`;
      overlayCanvas.style.height = `${H}px`;
      Object.assign(overlayCanvas.style, {
        position: 'absolute', top: '0', left: '0', pointerEvents: 'none',
      });
      canvas.style.position = 'relative';
      canvas.parentElement.style.position = 'relative';
      canvas.parentElement.appendChild(overlayCanvas);
      const octx = overlayCanvas.getContext('2d');
      octx.scale(dpr, dpr);
      drawHandles(octx, pts, H);
      drawBadge(octx, 'WebGL', true);
    }
  })();

  return {
    ready,
    destroy() {
      fullDestroyed = true;
      if (fullGl) {
        if (fullQuad) fullGl.deleteBuffer(fullQuad.buf);
        if (fullProg) fullGl.deleteProgram(fullProg);
        fullGl.getExtension('WEBGL_lose_context')?.loseContext();
      }
      canvas.remove();
      if (overlayCanvas) overlayCanvas.remove();
    },
  };
}
