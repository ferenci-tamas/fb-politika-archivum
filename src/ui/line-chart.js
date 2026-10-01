// A small, dependency-free SVG line chart for the Elemzés tab's monthly
// post-count histogram. Built with createElementNS and textContent only (no
// innerHTML), consistent with the rest of the app. Responsive via a fixed
// viewBox scaled to the container width in CSS.

import { clear } from './dom.js';
import { formatCount } from '../lib/format.js';

const SVGNS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs, ...children) {
  const node = document.createElementNS(SVGNS, tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      node.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c == null) continue;
    node.append(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Smallest "nice" (1/2/5 × 10^k) number ≥ v, for a readable y-axis top. */
export function niceMax(v) {
  if (!(v > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / pow;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * pow;
}

/**
 * Render a monthly line chart into `container`.
 * @param {HTMLElement} container
 * @param {{ym:string, n:number}[]} points one entry per month, chronological
 * @param {{ariaLabel?:string}} [opts]
 */
export function renderLineChart(container, points, { ariaLabel } = {}) {
  clear(container);
  if (!points || points.length === 0) return;

  const W = 920;
  const H = 340;
  const m = { top: 14, right: 16, bottom: 26, left: 52 };
  const pw = W - m.left - m.right;
  const ph = H - m.top - m.bottom;
  const n = points.length;
  const maxN = niceMax(Math.max(0, ...points.map((p) => p.n)));

  const xAt = (i) => m.left + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
  const yAt = (v) => m.top + ph - (v / maxN) * ph;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'chart-svg',
    role: 'img',
    'aria-label': ariaLabel || 'Havi találatok'
  });

  // Horizontal gridlines + y labels at 0, half, and max.
  for (const v of [0, maxN / 2, maxN]) {
    const y = yAt(v);
    svg.append(svgEl('line', { x1: m.left, y1: y, x2: W - m.right, y2: y, class: 'chart-grid' }));
    svg.append(
      svgEl('text', { x: m.left - 8, y: y + 4, class: 'chart-ylabel', 'text-anchor': 'end' }, formatCount(Math.round(v)))
    );
  }

  // One vertical gridline + year label at the first point of each calendar year.
  const seenYears = new Set();
  points.forEach((p, i) => {
    const year = p.ym.slice(0, 4);
    if (seenYears.has(year)) return;
    seenYears.add(year);
    const x = xAt(i);
    svg.append(svgEl('line', { x1: x, y1: m.top, x2: x, y2: m.top + ph, class: 'chart-grid chart-grid-v' }));
    svg.append(svgEl('text', { x, y: H - 8, class: 'chart-xlabel', 'text-anchor': 'middle' }, year));
  });

  // The series.
  const poly = points.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.n).toFixed(1)}`).join(' ');
  svg.append(svgEl('polyline', { points: poly, class: 'chart-line' }));

  container.append(svg);
}
