// Small DOM helpers. The golden rule: untrusted data is only ever written with
// textContent (never innerHTML), and anchors are only created for URLs that pass
// scheme validation. There is deliberately no "html" escape hatch.

import { safeExternalUrl } from '../lib/sanitize.js';

/**
 * Create an element. `props` understands: class, text (textContent), dataset,
 * and any other key is set via setAttribute. Children may be nodes or strings
 * (strings become text nodes). Never interprets HTML.
 */
export function el(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else node.setAttribute(key, value === true ? '' : value);
    }
  }
  appendChildren(node, children);
  return node;
}

export function appendChildren(node, children) {
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Build an external link that opens in a new tab, or a plain, clearly-marked
 * span if the URL is not a safe http/https URL. Always uses rel="noopener
 * noreferrer".
 */
export function externalAnchor(rawUrl, text, { ariaLabel, className } = {}) {
  const safe = safeExternalUrl(rawUrl);
  if (!safe) {
    return el(
      'span',
      { class: ['link-invalid', className].filter(Boolean).join(' ') || null, title: 'Érvénytelen vagy nem biztonságos URL' },
      text
    );
  }
  const a = el('a', {
    class: className || null,
    target: '_blank',
    rel: 'noopener noreferrer',
    'aria-label': ariaLabel || null
  }, text);
  a.href = safe;
  return a;
}
