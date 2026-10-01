// Renders the current page of posts into the table body. Only the rows for the
// current view are ever created (at most pageSize = 50/100/250), so the DOM never
// holds more than a few hundred rows regardless of the 650k-row archive.

import { el, externalAnchor, clear } from './dom.js';
import { formatHuDateTime } from '../lib/format.js';
import { imageUrl } from '../lib/sanitize.js';

const TABLE_COLUMNS = 6;

export function renderRows(tbody, rows, { imagesBaseUrl }) {
  clear(tbody);
  const frag = document.createDocumentFragment();
  for (const row of rows) frag.append(buildRow(row, imagesBaseUrl));
  tbody.append(frag);
  // Decide the expand control from real layout: only text that is actually
  // clipped at the 4-line clamp gets a "Megnyitás" button, so expanding never
  // leaves the text unchanged. All heights are read first, then mutated, to
  // avoid layout thrashing.
  addExpandControls(tbody);
}

function addExpandControls(tbody) {
  const divs = Array.from(tbody.querySelectorAll('.post-text.clamped'));
  const overflowing = divs.map((div) => div.scrollHeight > div.clientHeight + 1);
  divs.forEach((div, i) => {
    if (overflowing[i]) {
      div.after(
        el('button', {
          type: 'button',
          class: 'expand-toggle',
          'aria-expanded': 'false',
          'aria-controls': div.id
        }, 'Megnyitás')
      );
    } else {
      div.classList.remove('clamped');
    }
  });
}

export function renderMessageRow(tbody, message) {
  clear(tbody);
  tbody.append(el('tr', { class: 'message-row' }, el('td', { colspan: String(TABLE_COLUMNS), text: message })));
}

function buildRow(row, imagesBaseUrl) {
  return el(
    'tr',
    null,
    el('td', { class: 'col-author' }, el('span', { class: 'author-name', text: row.authorname })),
    el('td', { class: 'col-date' }, buildDate(row.time)),
    buildTextCell(row),
    el('td', { class: 'col-post' }, externalAnchor(row.url, 'Megnyitás', {
      ariaLabel: 'A Facebook-poszt megnyitása új lapon',
      className: 'post-link'
    })),
    buildLinksCell(row.links),
    buildImagesCell(row.images, imagesBaseUrl)
  );
}

function buildDate(time) {
  if (!Number.isFinite(time)) return el('span', { text: '' });
  const iso = new Date(time * 1000).toISOString();
  return el('time', { datetime: iso, text: formatHuDateTime(time) });
}

function buildTextCell(row) {
  const td = el('td', { class: 'col-text' });
  // Always clamp initially; renderRows() measures real overflow after insertion
  // and only then keeps the clamp and adds the expand control.
  const div = el('div', { class: 'post-text clamped', id: `text-${row.id}`, text: row.text || '' });
  td.append(div);
  return td;
}

function buildLinksCell(links) {
  const td = el('td', { class: 'col-links' });
  if (!links || links.length === 0) return td;
  links.forEach((link, index) => {
    const n = index + 1;
    const ok = !!link.available;
    td.append(
      el(
        'span',
        { class: 'link-item' },
        externalAnchor(link.url, String(n), {
          ariaLabel: `${n}. hivatkozás megnyitása új lapon`,
          className: 'num-link'
        }),
        // Availability is conveyed by glyph (✓/✕) + title + aria-label, not color alone.
        el('span', {
          class: `dot ${ok ? 'dot-ok' : 'dot-bad'}`,
          role: 'img',
          'aria-label': ok ? 'elérhető' : 'nem elérhető',
          title: ok ? 'A hivatkozás elérhető' : 'A hivatkozás nem elérhető'
        }, ok ? '✓' : '✕')
      )
    );
  });
  return td;
}

function buildImagesCell(images, imagesBaseUrl) {
  const td = el('td', { class: 'col-images' });
  if (!images || images.length === 0) return td;
  images.forEach((filename, index) => {
    const n = index + 1;
    td.append(
      externalAnchor(imageUrl(filename, imagesBaseUrl), String(n), {
        ariaLabel: `${n}. kép megnyitása új lapon`,
        className: 'num-link'
      })
    );
  });
  return td;
}
