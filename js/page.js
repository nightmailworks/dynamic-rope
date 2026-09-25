/**
 * page.js: scrollable sectioned page with lazy-mount demo registry + expand modal.
 *
 * API:
 *   registerSection(name, mountFn)
 *     name:    section id suffix, e.g. 's-solve' or 'solve' (both accepted)
 *     mountFn: (root, {pose, mode}) -> { ready: Promise, destroy() }
 *               mode is 'compact' (inline, label-light preview) or 'full' (modal).
 *
 * Behaviour:
 *   - An IntersectionObserver fires mountFn the first time each .demo-root enters
 *     view, in COMPACT mode. Mounts happen at most once per section.
 *   - Each figure gets an "expand" button that opens a modal and mounts a SECOND
 *     instance of the same demo in FULL mode (interactive). Closing destroys it.
 *   - #s-NAME deep-links scroll to the matching section on load.
 *   - The fixed progress rail shows the currently-visible section as active.
 *
 * Opt out of the expand button on a figure with data-no-expand on the .demo-root.
 */

// ── Registry ──────────────────────────────────────────────────────────────────

/** @type {Map<string, (root:Element, opts:object) => {ready:Promise, destroy:()=>void}>} */
const _registry = new Map();

export function registerSection(name, mountFn) {
  const key = name.startsWith('s-') ? name : `s-${name}`;
  _registry.set(key, mountFn);
}

// ── Expand modal ──────────────────────────────────────────────────────────────

let _modal = null; // { close } when a modal is open

function sectionTitle(section) {
  const h = section.querySelector('h2, h3');
  return h ? h.textContent.trim() : 'Interactive demo';
}

// Sections whose FULL demo is hands-on (you grab a handle, player, tree, bulge, or slack,
// and it re-solves live). Drives both the modal "drag to interact" hint and the inline
// thumbnail "drag" badge, so the interactive figures are visually distinct from the ones
// that only animate or are static. (s-winding-3 is the static chord-false-positive pose, so
// it is deliberately NOT here even though winding.js is draggable in its other poses.)
const DRAGGABLE_SECTIONS = new Set([
  's-synopsis', 's-winding', 's-winding-2', 's-solve', 's-simulate-2', 's-simulate-3',
  's-stroke-pipeline', 's-synthesis',
]);

function openModal(section, pose, mountFn, returnFocusEl) {
  if (_modal) return;

  const title = sectionTitle(section);
  const overlay = document.createElement('div');
  overlay.className = 'demo-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `${title} (interactive demo)`);

  const panel = document.createElement('div');
  panel.className = 'demo-modal-panel';

  const bar = document.createElement('div');
  bar.className = 'demo-modal-bar';
  const titleEl = document.createElement('span');
  titleEl.className = 'demo-modal-title';
  titleEl.textContent = title;
  const hint = document.createElement('span');
  hint.className = 'demo-modal-hint';
  const isDraggable = DRAGGABLE_SECTIONS.has(section.id);
  hint.textContent = isDraggable ? 'drag to interact · Esc to close' : 'Esc to close';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'demo-modal-close';
  closeBtn.setAttribute('aria-label', 'Close demo');
  closeBtn.innerHTML = '<span aria-hidden="true">✕</span>';
  bar.append(titleEl, hint, closeBtn);

  const modalRoot = document.createElement('div');
  modalRoot.className = 'demo-root demo-modal-root';
  if (pose) modalRoot.dataset.pose = pose;

  panel.append(bar, modalRoot);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');

  // Mount a fresh FULL instance (do NOT move the inline canvas, second instance).
  let handle = null;
  try {
    handle = mountFn(modalRoot, { pose, mode: 'full' });
  } catch (e) {
    modalRoot.innerHTML = `<pre class="demo-error">demo failed: ${(e && e.message) || e}</pre>`;
  }
  // Handle async failures (e.g. shader fetch error after modal opens)
  if (handle && handle.ready && typeof handle.ready.catch === 'function') {
    handle.ready.catch(e => {
      if (_modal && _modal.close === close) {
        modalRoot.innerHTML = `<pre class="demo-error">demo failed: ${(e && e.message) || e}</pre>`;
      }
    });
  }

  function close() {
    if (handle && typeof handle.destroy === 'function') {
      try { handle.destroy(); } catch (_) { /* ignore */ }
    }
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    document.body.classList.remove('modal-open');
    _modal = null;
    if (returnFocusEl && typeof returnFocusEl.focus === 'function') returnFocusEl.focus();
  }

  function focusables() {
    return [...panel.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.disabled && el.offsetParent !== null);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') {
      const f = focusables();
      if (f.length === 0) return;
      const first = f[0], last = f[f.length - 1];
      if (!panel.contains(document.activeElement)) {
        e.preventDefault(); first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  }

  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);

  _modal = { close };
  closeBtn.focus();
}

// ── Initialise when the DOM is ready ─────────────────────────────────────────

function init() {
  // Deep-link: #s-NAME → scroll on load
  const hash = location.hash;
  if (hash) {
    const scrollToHash = () => {
      const target = document.getElementById(hash.slice(1));
      if (target) target.scrollIntoView({ block: 'start' });
    };
    requestAnimationFrame(scrollToHash);
    window.addEventListener('load', () => requestAnimationFrame(scrollToHash), { once: true });
  }

  // Deep-link: ?expand=s-NAME[&pose=…] opens that demo's modal on load (shareable).
  const params = new URLSearchParams(location.search);
  const expandId = params.get('expand');
  if (expandId) {
    requestAnimationFrame(() => {
      const section = document.getElementById(expandId);
      const mountFn = _registry.get(expandId);
      if (section && mountFn) {
        const pose = params.get('pose') ?? section.querySelector('.demo-root')?.dataset.pose ?? 'default';
        openModal(section, pose, mountFn, null);
      }
    });
  }

  // Progress rail: click → smooth scroll (prevent default href jump)
  const railItems = document.querySelectorAll('#progress-rail .rail-item');
  railItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const section = document.getElementById(item.dataset.section);
      if (section) section.scrollIntoView({ behavior: 'smooth' });
    });
  });

  const mounted = new Map();   // sectionId → mounted once
  const visible = new Set();

  function updateRailActive() {
    let activeId = null;
    railItems.forEach(item => {
      if (activeId === null && visible.has(item.dataset.section)) activeId = item.dataset.section;
    });
    railItems.forEach(item => item.classList.toggle('active', item.dataset.section === activeId));
  }

  function ensureMounted(section) {
    const id = section.id;
    if (mounted.get(id)) return;
    mounted.set(id, true);
    const mountFn = _registry.get(id);
    if (mountFn) section.querySelectorAll('.demo-root').forEach(r => mountFigure(section, r, mountFn));
  }

  function mountFigure(section, demoRoot, mountFn) {
    if (demoRoot._demoHandle) return;
    const pose = demoRoot.dataset.pose ?? 'default';

    // Mount the demo first (do NOT move the element, avoids disrupting layout/mount).
    demoRoot._demoHandle = mountFn(demoRoot, { pose, mode: 'compact' });

    // Mark interactive (draggable) figures so they read as hands-on, not just static previews.
    if (DRAGGABLE_SECTIONS.has(section.id)) {
      const tag = document.createElement('span');
      tag.className = 'demo-tag';
      tag.title = 'Interactive: expand to play with it';
      tag.textContent = 'interactive';
      demoRoot.appendChild(tag);
    }

    // The WHOLE thumbnail is the expand button: a transparent cover over the figure opens the
    // modal on a click anywhere, with the ⤢ glyph pinned in the corner as a visual cue. (It also
    // means the thumbnail isn't draggable; you drag in the expanded view.)
    if (!('noExpand' in demoRoot.dataset)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'demo-expand';
      btn.setAttribute('aria-label', `Open large interactive demo: ${sectionTitle(section)}`);
      btn.title = 'Expand';
      btn.innerHTML = '<span class="demo-expand-icon" aria-hidden="true">⤢</span>';
      btn.addEventListener('click', () => openModal(section, pose, mountFn, btn));
      demoRoot.appendChild(btn);  // full-area cover inside the (position:relative) demo-root
    }
  }

  const sectionObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const section = entry.target;
      const id = section.id;
      if (entry.isIntersecting) visible.add(id); else visible.delete(id);
      updateRailActive();

      if (entry.isIntersecting && !mounted.get(id)) {
        ensureMounted(section);
      }
    });
  }, { threshold: [0, 0.1, 0.5] });

  document.querySelectorAll('section.sec').forEach(sec => sectionObserver.observe(sec));

  // Chromium's headless screenshot path can capture before IntersectionObserver
  // delivers its first entries. Eagerly mount sections already in the initial
  // viewport so above-the-fold figures never appear as empty frames.
  requestAnimationFrame(() => {
    document.querySelectorAll('section.sec').forEach(section => {
      const r = section.getBoundingClientRect();
      if (r.bottom >= 0 && r.top <= window.innerHeight) {
        visible.add(section.id);
        ensureMounted(section);
      }
    });
    updateRailActive();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
