/**
 * glossary.js: hover/focus/tap reference popovers for .term spans.
 *
 * Usage in HTML:
 *   <span class="term" data-def="Short definition." data-href="https://…">word</span>
 *
 * Features:
 *   - Shows a popover on mouseenter, focus, and touchstart.
 *   - Hides on mouseleave, blur, Escape key.
 *   - Flips above the term if the popover would clip the bottom of the viewport.
 *   - Fully accessible: tabindex=0, role=button, aria-describedby linking.
 *   - Zero external dependencies; single singleton popover node.
 */

(function () {
  'use strict';

  // ── Singleton popover element ────────────────────────────────────────────────
  let popover = null;
  let currentTerm = null;
  let hideTimeout = null;

  function createPopover() {
    const el = document.createElement('div');
    el.className = 'term-popover';
    el.setAttribute('role', 'tooltip');
    el.id = 'term-popover';
    el.innerHTML =
      '<p class="term-popover-def"></p>' +
      '<a class="term-popover-link" target="_blank" rel="noopener noreferrer">Reference ↗</a>';

    // Keep the popover alive when the mouse enters it
    el.addEventListener('mouseenter', () => { clearTimeout(hideTimeout); });
    el.addEventListener('mouseleave', () => { scheduleHide(); });

    document.body.appendChild(el);
    return el;
  }

  function getPopover() {
    if (!popover) popover = createPopover();
    return popover;
  }

  // ── Show / hide ──────────────────────────────────────────────────────────────

  function showPopover(term) {
    clearTimeout(hideTimeout);
    currentTerm = term;

    const pop = getPopover();
    pop.querySelector('.term-popover-def').textContent = term.dataset.def || '';
    const link = pop.querySelector('.term-popover-link');
    const href = term.dataset.href || '';
    link.href = href;
    link.style.display = href ? '' : 'none';

    // Temporarily make it visible (off-screen) so we can measure it
    pop.classList.add('term-popover--visible');
    pop.style.left = '-9999px';
    pop.style.top  = '-9999px';

    positionPopover(term, pop);

    // Link term to popover for a11y
    term.setAttribute('aria-describedby', 'term-popover');
  }

  function positionPopover(term, pop) {
    const termRect = term.getBoundingClientRect();
    const popRect  = pop.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const gap = 8; // px gap between term and popover

    // Horizontal: align to left of term, clamp to viewport
    let left = termRect.left + scrollX;
    if (left + popRect.width > scrollX + vw - 12) {
      left = scrollX + vw - 12 - popRect.width;
    }
    if (left < scrollX + 8) left = scrollX + 8;

    // Vertical: prefer below; flip above if clipped
    const spaceBelow = vh - termRect.bottom;
    const spaceAbove = termRect.top;
    let top;
    if (spaceBelow >= popRect.height + gap || spaceBelow >= spaceAbove) {
      // Place below
      top = termRect.bottom + scrollY + gap;
      pop.classList.remove('term-popover--above');
    } else {
      // Flip above
      top = termRect.top + scrollY - popRect.height - gap;
      pop.classList.add('term-popover--above');
    }

    pop.style.left = left + 'px';
    pop.style.top  = top  + 'px';
  }

  function scheduleHide() {
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(hidePopover, 120);
  }

  function hidePopover() {
    const pop = getPopover();
    pop.classList.remove('term-popover--visible', 'term-popover--above');
    if (currentTerm) {
      currentTerm.removeAttribute('aria-describedby');
      currentTerm = null;
    }
  }

  // ── Wire up each .term span ──────────────────────────────────────────────────

  function initTerm(term) {
    // Keyboard accessibility
    if (!term.hasAttribute('tabindex')) term.setAttribute('tabindex', '0');
    term.setAttribute('role', 'button');

    term.addEventListener('mouseenter', () => showPopover(term));
    term.addEventListener('mouseleave', () => scheduleHide());
    term.addEventListener('focus',      () => showPopover(term));
    term.addEventListener('blur',       () => scheduleHide());

    // Tap on mobile: toggle
    term.addEventListener('touchstart', (e) => {
      e.preventDefault(); // prevent ghost click
      if (currentTerm === term && getPopover().classList.contains('term-popover--visible')) {
        hidePopover();
      } else {
        showPopover(term);
      }
    }, { passive: false });

    // Escape key
    term.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { hidePopover(); term.blur(); }
    });
  }

  // ── Global Escape handler (in case focus has moved elsewhere) ────────────────
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentTerm) hidePopover();
  });

  // ── Init on DOMContentLoaded ─────────────────────────────────────────────────
  function init() {
    document.querySelectorAll('.term').forEach(initTerm);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
