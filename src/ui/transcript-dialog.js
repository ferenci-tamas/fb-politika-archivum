// Modal dialog for the transcript of a post's video (schema_version >= 4). The
// results only know whether a post has a transcript (posts.video); the text is
// fetched by the caller when the dialog opens, written with textContent (never as
// HTML), and offered as a UTF-8 .txt download built in the browser.

import { el, externalAnchor } from './dom.js';
import { formatHuDateTime, unixToDateInput } from '../lib/format.js';

// Downloads read the object URL asynchronously, so it is revoked only later.
const REVOKE_DELAY_MS = 60_000;

function slug(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * File name for a downloaded transcript, e.g.
 * "leirat_orban-viktor_2020-05-01_123456789.txt": ASCII only (accents dropped), so
 * it is safe on every file system. The date is the post's Hungarian local date.
 * @param {{authorname?:string, time?:number, postId?:string}} row
 */
export function transcriptFilename({ authorname, time, postId } = {}) {
  const parts = ['leirat', slug(authorname), Number.isFinite(time) ? unixToDateInput(time) : '', slug(postId)];
  return `${parts.filter(Boolean).join('_')}.txt`;
}

function downloadText(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = el('a', { href: url, download: filename, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * Wire the static <dialog> markup (index.html). Returns the controller:
 *   open(row, trigger)    show the dialog for a result row, in its loading state
 *   showText(id, text)    fill in the transcript of post `id` (ignored if stale)
 *   showError(id, msg)    show an error instead (ignored if stale)
 *   close()
 * Focus returns to `trigger` (the "Leirat" button) when the dialog closes.
 */
export function createTranscriptDialog({ dialog, meta, body, download }) {
  let current = null; // { row, text } while open
  let trigger = null;
  let pointerDownOnBackdrop = false;

  function setStatus(message, { error = false } = {}) {
    body.classList.add('is-status');
    body.classList.toggle('is-error', error);
    body.textContent = message;
  }

  function open(row, triggerEl) {
    current = { row, text: null };
    trigger = triggerEl || null;
    const metaParts = [row.authorname, formatHuDateTime(row.time)].filter(Boolean).join(' · ');
    meta.replaceChildren(
      metaParts,
      metaParts ? ' · ' : '',
      externalAnchor(row.url, 'Poszt megnyitása', {
        ariaLabel: 'A Facebook-poszt (és a videó) megnyitása új lapon',
        className: 'post-link'
      })
    );
    download.disabled = true;
    body.setAttribute('aria-busy', 'true');
    setStatus('Betöltés…');
    if (!dialog.open) dialog.showModal();
    body.scrollTop = 0;
  }

  function isCurrent(id) {
    return current != null && current.row.id === id;
  }

  function showText(id, text) {
    if (!isCurrent(id)) return;
    current.text = text;
    body.classList.remove('is-status', 'is-error');
    body.removeAttribute('aria-busy');
    body.textContent = text;
    body.scrollTop = 0;
    download.disabled = false;
  }

  function showError(id, message) {
    if (!isCurrent(id)) return;
    body.removeAttribute('aria-busy');
    setStatus(message, { error: true });
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  dialog.addEventListener('close', () => {
    current = null;
    body.textContent = '';
    download.disabled = true;
    const t = trigger;
    trigger = null;
    if (t && t.isConnected) t.focus();
  });

  // Close on a click on the backdrop (the dialog element itself; its content
  // fills it), but not when a text selection that started inside ends outside.
  dialog.addEventListener('pointerdown', (e) => {
    pointerDownOnBackdrop = e.target === dialog;
  });
  dialog.addEventListener('click', (e) => {
    if (e.target.closest('[data-dialog-close]') || (e.target === dialog && pointerDownOnBackdrop)) close();
  });

  download.addEventListener('click', () => {
    if (current && current.text != null) downloadText(current.text, transcriptFilename(current.row));
  });

  return { open, showText, showError, close };
}
