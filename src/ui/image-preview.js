// Hover/focus thumbnail preview for the numbered image links in the results
// table. Each image number is an <a class="num-link"> whose href is already the
// full, sanitized image URL (see render.js / imageUrl), so this is a pure
// front-end enhancement — no worker, DB, or manifest involvement.
//
//   - Pointer-only (gated on `(hover: hover)`); on touch the links keep their
//     normal tap-to-open behavior.
//   - A short delay before loading avoids a burst of full-size downloads while
//     skimming across "1 2 3". The image is preloaded into a detached Image and
//     swapped in only once decoded, so the box never flashes an empty or broken
//     frame, and a stale (superseded) load can never win.
//   - Keyboard parity: the same preview appears on focus and hides on blur.
//
// The database images are full-size (there is no thumbnail derivative), so the
// browser caches each one after the first hover; with the immutable cache header
// on /images/*, repeat hovers and the "open in new tab" are then instant.

import { el } from './dom.js';

const HOVER_DELAY_MS = 160;
const CURSOR_GAP = 14; // gap between the pointer (or link) and the preview box
const EDGE_MARGIN = 8; // keep the box at least this far from the viewport edges
const LINK_SELECTOR = '.col-images .num-link';

/**
 * Clamp the preview box to the viewport, flipping to the other side of the
 * anchor point when it would overflow the right or bottom edge. Pure, so the
 * only non-trivial geometry is unit-tested without a DOM.
 *
 * @param {{x:number,y:number,w:number,h:number,vw:number,vh:number,gap?:number,margin?:number}} p
 * @returns {{left:number, top:number}}
 */
export function computePreviewPosition({ x, y, w, h, vw, vh, gap = CURSOR_GAP, margin = EDGE_MARGIN }) {
  let left = x + gap;
  let top = y + gap;
  if (left + w > vw - margin) left = x - gap - w; // flip to the left of the anchor
  if (left < margin) left = margin;
  if (top + h > vh - margin) top = y - gap - h; // flip above the anchor
  if (top < margin) top = margin;
  return { left: Math.round(left), top: Math.round(top) };
}

export function initImagePreview(container) {
  if (!container || typeof document === 'undefined') return;
  // Pointer-only enhancement; skip entirely on touch so taps just open the image.
  if (typeof window.matchMedia === 'function' && !window.matchMedia('(hover: hover)').matches) return;

  let box = null;
  let img = null;
  let timer = null;
  let activeLink = null;
  let pendingLink = null;
  let mode = 'cursor'; // 'cursor' (hover) anchors to the pointer, 'focus' to the link box
  let reqId = 0;
  const cursor = { x: 0, y: 0 };

  function ensureBox() {
    if (box) return;
    img = el('img', { alt: '', decoding: 'async' });
    box = el('div', { class: 'img-preview', 'aria-hidden': 'true' }, img);
    document.body.append(box);
  }

  function previewLink(target) {
    const node = target && target.closest ? target.closest(LINK_SELECTOR) : null;
    if (!node || !container.contains(node)) return null;
    // Unsafe URLs render as a <span> (no image); only real anchors get a preview.
    return node.tagName === 'A' && node.href ? node : null;
  }

  function anchorPoint() {
    if (mode === 'focus' && activeLink) {
      const r = activeLink.getBoundingClientRect();
      return { x: r.right, y: r.bottom };
    }
    return cursor;
  }

  function place() {
    const { x, y } = anchorPoint();
    const { left, top } = computePreviewPosition({
      x,
      y,
      w: box.offsetWidth,
      h: box.offsetHeight,
      vw: window.innerWidth,
      vh: window.innerHeight
    });
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  }

  function load(link) {
    ensureBox();
    const myReq = ++reqId;
    activeLink = link;
    pendingLink = null;
    // Preload detached so the visible box is only revealed once bytes are ready.
    const pre = new Image();
    pre.onload = () => {
      if (myReq !== reqId) return; // a newer hover/blur superseded this one
      img.src = link.href; // now served from cache -> no flash
      place(); // measurable while visibility:hidden still reserves layout
      box.classList.add('is-visible');
    };
    pre.onerror = () => {
      if (myReq === reqId) hide();
    };
    pre.src = link.href;
  }

  function schedule(link, nextMode) {
    cancel();
    pendingLink = link;
    mode = nextMode;
    timer = setTimeout(() => load(link), HOVER_DELAY_MS);
  }

  function cancel() {
    clearTimeout(timer);
    timer = null;
  }

  function hide() {
    cancel();
    reqId += 1; // invalidate any in-flight preload
    activeLink = null;
    pendingLink = null;
    if (box) box.classList.remove('is-visible');
  }

  container.addEventListener('mouseover', (e) => {
    const link = previewLink(e.target);
    if (!link || link === activeLink || link === pendingLink) return;
    schedule(link, 'cursor');
  });
  container.addEventListener('mouseout', (e) => {
    const link = previewLink(e.target);
    if (!link) return;
    // Ignore moves that stay inside the same link.
    if (e.relatedTarget && link.contains(e.relatedTarget)) return;
    hide();
  });
  container.addEventListener('mousemove', (e) => {
    cursor.x = e.clientX;
    cursor.y = e.clientY;
    if (mode === 'cursor' && box && box.classList.contains('is-visible')) place();
  });
  container.addEventListener('focusin', (e) => {
    const link = previewLink(e.target);
    if (!link || link === activeLink || link === pendingLink) return;
    schedule(link, 'focus');
  });
  container.addEventListener('focusout', (e) => {
    if (previewLink(e.target)) hide();
  });

  // A fixed-position box would detach from its link on scroll/resize; just hide.
  window.addEventListener('scroll', hide, { passive: true, capture: true });
  window.addEventListener('resize', hide, { passive: true });
}
