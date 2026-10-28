// Monthly line chart for the Elemzés tab, rendered with ECharts (canvas renderer)
// loaded lazily via a dynamic import — ECharts only downloads when a chart is
// actually shown. Supports multiple search phrases: one line series per phrase,
// with a legend and a shared count/ratio mode. The data shaping (toSeriesData) is
// pure and unit-tested; rendering is verified in-browser.

import { clear } from './dom.js';
import { formatCount, hungarianArticle } from '../lib/format.js';

// In ratio mode, months with fewer than this many posts are suppressed (plotted as
// a gap) because their share of matches is too noisy to be meaningful.
const MIN_TOTAL_FOR_RATIO = 100;

// The "Leggyakoribb szavak" view's denominator is one author's content-word tokens
// that month, not a post count, so it is far smaller (tens, not hundreds). Reusing the
// 100-post floor there blanks most months — about 55% of Orbán Viktor's — even when a
// word's raw count is meaningful, so that view passes this lower content-token floor
// instead. Below it a single word can swing the share wildly (1 of 1 token = 100%).
export const WORD_RATIO_MIN_TOKENS = 20;

// ECharts' default "save" icon, reused for our custom download button (which adds a
// title + attribution to the exported image only — see exportChartPng).
const SAVE_ICON = 'path://M4.7,22.9L29.3,45.5L54.7,23.4M4.6,43.6L4.6,58L53.8,58L53.8,43.6M29.2,45.1L29.2,0';

// Categorical palette (Okabe-Ito based), colour-blind friendly and legible on both
// the light and dark surfaces. ECharts cycles it if there are more series.
const COLORS = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#8E44AD', '#999999'];

// A 20-colour categorical palette (d3 category20) for the stacked "Leggyakoribb
// szavak" view, where up to 20 word series share one chart. ECharts cycles it if
// there are more series.
const STACK_COLORS = [
  '#1f77b4', '#aec7e8', '#ff7f0e', '#ffbb78', '#2ca02c', '#98df8a', '#d62728', '#ff9896',
  '#9467bd', '#c5b0d5', '#8c564b', '#c49c94', '#e377c2', '#f7b6d2', '#7f7f7f', '#c7c7c7',
  '#bcbd22', '#dbdb8d', '#17becf', '#9edae5'
];

// Reserve a strip above the plot for the toolbox (download) button, pinned top-right, so
// hovering it stays above the coordinate area and never triggers the axis-pointer dashed
// line. The icon is the binding constraint, so single-series charts need the same height
// as multi-series ones (which also seat the legend in that strip).
const GRID_TOP = 40;

let chartInstance = null;
let last = null; // { container, series, ariaLabel, mode, ... } — for re-theme / export
let zoomTimer = null; // debounce for the stacked-chart zoom-recompute callback

/**
 * Convert one phrase's monthly buckets to ECharts data items. Pure (no DOM/ECharts),
 * so it stays unit-testable in Node. Each item keeps n and total so the tooltip can
 * show both regardless of mode.
 * @param {{ym:string, n:number, total:number}[]} points
 * @param {'count'|'ratio'} mode
 * @param {number} [minTotal] ratio-mode floor on `total`; months below it become a gap
 * @returns {Array<{value:[number, number], n:number, total:number}>}
 */
export function toSeriesData(points, mode = 'count', minTotal = MIN_TOTAL_FOR_RATIO) {
  return points.map((p) => {
    const ts = Date.UTC(Number(p.ym.slice(0, 4)), Number(p.ym.slice(5, 7)) - 1, 1);
    const total = Number(p.total) || 0;
    let y;
    if (mode === 'ratio') {
      // Suppress sparse months (gap in the line) rather than plot a noisy ratio.
      y = total >= minTotal ? (p.n / total) * 100 : null;
    } else {
      y = p.n;
    }
    return { value: [ts, y], n: p.n, total };
  });
}

// Pull the app's theme colors from CSS variables so the chart matches light/dark
// mode; re-read on every render so an OS color-scheme switch is reflected.
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Escape phrase text for the HTML tooltip (series names are user input).
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// The ECharts `series` array, shared by the initial render and the in-place stacked
// update (a zoom recompute) so both map points to items identically.
function seriesOption(series, mode, stack, minTotal) {
  return series.map((s) => ({
    type: 'line',
    name: s.label,
    data: toSeriesData(s.points, mode, minTotal),
    showSymbol: false,
    connectNulls: false,
    lineStyle: { width: stack ? 1 : 2 },
    ...(stack ? { stack: 'total', areaStyle: {}, emphasis: { focus: 'series' } } : {})
  }));
}

// Colours. Stacked word series may carry a stable per-word `color` (see
// assignStableColors) so re-selecting on zoom never recolours the bands that stayed;
// other charts cycle the palette by position.
function colorOption(series, stack) {
  if (!stack) return COLORS;
  return series.map((s, i) => s.color || STACK_COLORS[i % STACK_COLORS.length]);
}

// Assign a stable colour per word label into `colorMap`, reused across zoom re-selects
// so a word keeps its colour whenever it is shown. New words take the next palette slot.
export function assignStableColors(series, colorMap) {
  for (const s of series) {
    let c = colorMap.get(s.label);
    if (!c) {
      c = STACK_COLORS[colorMap.size % STACK_COLORS.length];
      colorMap.set(s.label, c);
    }
    s.color = c;
  }
  return series;
}

function buildOption(series, ariaLabel, mode, stack, minTotal = MIN_TOTAL_FOR_RATIO) {
  const muted = cssVar('--muted', '#5b636e');
  const border = cssVar('--border', '#d4d8de');
  const surface = cssVar('--surface', '#ffffff');
  const text = cssVar('--text', '#1b1f24');
  const ratio = mode === 'ratio';
  return {
    aria: { enabled: true, label: { enabled: true, description: ariaLabel } },
    color: colorOption(series, stack),
    legend: {
      show: series.length > 1, // a single curve needs no legend
      type: 'scroll',
      top: 6,
      data: series.map((s) => s.label),
      textStyle: { color: text },
      pageTextStyle: { color: muted },
      pageIconColor: muted
    },
    grid: { top: GRID_TOP, right: 20, bottom: 66, left: 56 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: surface,
      borderColor: border,
      textStyle: { color: text },
      formatter: (params) => {
        const arr = Array.isArray(params) ? params : [params];
        const anchor = arr.find((p) => p && p.value);
        if (!anchor) return '';
        const d = new Date(anchor.value[0]);
        const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        let html = `<strong>${ym}</strong>`;
        let items = arr;
        if (stack) {
          // Many stacked series: lead with the month's total (count, or stacked % in
          // ratio mode), then list only the words present this month, most frequent
          // first, to keep the tooltip short.
          const sumN = arr.reduce((s, p) => s + (p.data ? p.data.n : 0), 0);
          if (ratio) {
            const tot = (arr[0] && arr[0].data && arr[0].data.total) || 0;
            html += tot >= minTotal ? ` — ${((sumN / tot) * 100).toFixed(2)}%` : ' — —';
          } else {
            html += ` — ${formatCount(sumN)}`;
          }
          items = arr.filter((p) => p.data && p.data.n > 0).sort((a, b) => b.data.n - a.data.n);
        }
        for (const p of items) {
          const { n, total } = p.data;
          let val;
          if (ratio) {
            val = total < minTotal ? '—' : `${((n / total) * 100).toFixed(2)}%`;
          } else {
            val = formatCount(n);
          }
          html += `<br/>${p.marker}${escHtml(p.seriesName)}: <strong>${val}</strong>`;
        }
        return html;
      }
    },
    toolbox: {
      feature: {
        myDownload: { show: true, title: 'Mentés PNG-ként', icon: SAVE_ICON, onclick: () => exportChartPng() }
      },
      right: 8,
      top: 4
    },
    dataZoom: [
      { type: 'inside' },
      { type: 'slider', height: 20, bottom: 16 }
    ],
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: border } },
      axisTick: { lineStyle: { color: border } },
      axisLabel: { color: muted }
    },
    yAxis: {
      type: 'value',
      min: 0,
      minInterval: ratio ? undefined : 1,
      axisLabel: { color: muted, formatter: ratio ? '{value}%' : undefined },
      splitLine: { lineStyle: { color: border } }
    },
    series: seriesOption(series, mode, stack, minTotal)
  };
}

// Export the chart as a PNG with a title + attribution that appear ONLY in the
// downloaded image. They are merged in, the data URL is captured, then they are
// removed again — all synchronously, so the on-screen chart never shows them and
// the current zoom is preserved. The toolbar and zoom slider are excluded from the
// image (they are interactive controls, not part of the figure).
function exportChartPng() {
  if (!chartInstance || !last) return;
  const surface = cssVar('--surface', '#ffffff');
  const text = cssVar('--text', '#1b1f24');
  const muted = cssVar('--muted', '#5b636e');
  const { series, mode } = last;
  const multi = series.length > 1; // only reserve room for a legend when it is shown
  const subtitle = last.subtitle || (mode === 'ratio'
    ? '(arány az összes poszt számához viszonyítva)'
    : '(posztok száma havonta)');
  const titleText =
    last.title ||
    (series.length === 1
      ? `${hungarianArticle(series[0].label)} ${series[0].label} keresőkifejezés előfordulása az időben`
      : 'Keresőkifejezések előfordulása az időben');

  chartInstance.setOption({
    animation: false,
    grid: { top: multi ? 96 : 74 },
    legend: { top: 56 },
    title: {
      text: titleText,
      subtext: subtitle,
      left: 'center',
      top: 10,
      textStyle: { color: text, fontSize: 15, fontWeight: 600 },
      subtextStyle: { color: muted, fontSize: 12 }
    },
    graphic: [
      {
        id: 'attribution',
        type: 'text',
        right: 12,
        bottom: 10,
        z: 100,
        style: { text: 'Ferenci Tamás (www.medstat.hu)', fill: muted, fontSize: 10, textAlign: 'right' }
      }
    ]
  });

  // Clear any hover crosshair so its dashed axis-pointer line is not captured.
  chartInstance.dispatchAction({ type: 'hideTip' });
  chartInstance.dispatchAction({ type: 'updateAxisPointer', currTrigger: 'leave' });

  const url = chartInstance.getDataURL({
    type: 'png',
    pixelRatio: 2,
    backgroundColor: surface,
    excludeComponents: ['toolbox', 'dataZoom']
  });

  // Restore the on-screen chart: drop the title + attribution and the extra top room.
  chartInstance.setOption({
    animation: false,
    grid: { top: GRID_TOP },
    legend: { top: 6 },
    title: { show: false, text: '', subtext: '' },
    graphic: [{ id: 'attribution', $action: 'remove' }]
  });

  const a = document.createElement('a');
  a.href = url;
  a.download = 'havi-grafikon.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function disposeChart() {
  clearTimeout(zoomTimer);
  if (chartInstance) {
    chartInstance.dispose();
    chartInstance = null;
  }
}

function showMessage(container, message) {
  clear(container);
  const div = document.createElement('div');
  div.className = 'chart-loading';
  div.textContent = message;
  container.append(div);
}

/** Warm the lazily-loaded ECharts chunk (fetch + parse) ahead of first use — e.g.
 *  while the user reads the landing page. Fire-and-forget; a real render still
 *  handles (and surfaces) a genuine load failure. */
export function preloadChart() {
  import('./echarts-core.js').catch(() => {});
}

/**
 * Render the monthly chart into `container`. Async because ECharts is loaded on
 * demand; the caller fires it and does not await.
 * @param {{label:string, points:{ym:string,n:number,total:number}[]}[]} series
 * @param {{ariaLabel?:string, mode?:'count'|'ratio'}} [opts]
 */
export async function renderLineChart(container, series, { ariaLabel, mode = 'count', title = '', subtitle = '', stack = false, minTotalForRatio = MIN_TOTAL_FOR_RATIO, onZoomRange = null } = {}) {
  if (!container) return;
  disposeChart();
  if (!series || series.length === 0) {
    last = null;
    clear(container);
    return;
  }
  last = { container, series, ariaLabel, mode, title, subtitle, stack, minTotalForRatio, onZoomRange };

  let echarts;
  try {
    echarts = (await import('./echarts-core.js')).default;
  } catch {
    showMessage(container, 'A grafikonkönyvtár betöltése nem sikerült.');
    return;
  }

  // A newer render (new search or toggled mode) may have superseded this one.
  if (!last || last.container !== container || last.series !== series || last.mode !== mode) return;

  try {
    clear(container); // replace the loading placeholder only now that ECharts is ready
    const host = document.createElement('div');
    host.className = 'echart';
    host.setAttribute('role', 'img');
    if (ariaLabel) host.setAttribute('aria-label', ariaLabel);
    container.append(host);
    chartInstance = echarts.init(host, null, { renderer: 'canvas', locale: 'HU' });
    chartInstance.setOption(buildOption(series, ariaLabel, mode, stack, minTotalForRatio), true);
    if (onZoomRange) attachZoomListener(onZoomRange);
  } catch {
    showMessage(container, 'A grafikon megjelenítése nem sikerült.');
  }
}

function ymToTs(ym) {
  return Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1);
}

// The current zoom window as [startMs, endMs]. Prefers ECharts' value bounds; falls
// back to mapping the percent range onto the full data extent taken from the series.
function currentZoomRange() {
  const dz = (chartInstance.getOption().dataZoom || [])[0] || {};
  if (dz.startValue != null && dz.endValue != null) return [dz.startValue, dz.endValue];
  const pts = last && last.series && last.series[0] && last.series[0].points;
  if (!pts || pts.length === 0) return null;
  const lo = ymToTs(pts[0].ym);
  const hi = ymToTs(pts[pts.length - 1].ym);
  const s = dz.start == null ? 0 : dz.start;
  const e = dz.end == null ? 100 : dz.end;
  return [lo + (s / 100) * (hi - lo), lo + (e / 100) * (hi - lo)];
}

// Debounced: on a zoom gesture, hand the visible [startMs, endMs] to the callback so the
// caller can re-pick the stacked words for that window.
function attachZoomListener(cb) {
  chartInstance.on('dataZoom', () => {
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => {
      if (!chartInstance) return;
      const range = currentZoomRange();
      if (range) cb(range[0], range[1]);
    }, 180);
  });
}

/**
 * Replace the stacked chart's series in place (after a zoom recomputes which words to
 * show) without re-initialising, so the zoom window and the axis are preserved.
 */
export function updateStackedSeries(series) {
  if (!chartInstance || !last) return;
  last.series = series;
  chartInstance.setOption(
    { color: colorOption(series, true), series: seriesOption(series, last.mode, true, last.minTotalForRatio) },
    { replaceMerge: ['series'] }
  );
}

// Keep the chart responsive and in sync with the OS light/dark setting. Guarded so
// importing this module in Node (for the toSeriesData unit test) touches no DOM.
if (typeof window !== 'undefined') {
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (chartInstance) chartInstance.resize();
    }, 150);
  });
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  if (mq && mq.addEventListener) {
    mq.addEventListener('change', () => {
      if (last) renderLineChart(last.container, last.series, { ariaLabel: last.ariaLabel, mode: last.mode, title: last.title, subtitle: last.subtitle, stack: last.stack, minTotalForRatio: last.minTotalForRatio, onZoomRange: last.onZoomRange });
    });
  }
}
