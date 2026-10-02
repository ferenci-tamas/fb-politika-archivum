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

// ECharts' default "save" icon, reused for our custom download button (which adds a
// title + attribution to the exported image only — see exportChartPng).
const SAVE_ICON = 'path://M4.7,22.9L29.3,45.5L54.7,23.4M4.6,43.6L4.6,58L53.8,58L53.8,43.6M29.2,45.1L29.2,0';

// Categorical palette (Okabe-Ito based), colour-blind friendly and legible on both
// the light and dark surfaces. ECharts cycles it if there are more series.
const COLORS = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#8E44AD', '#999999'];

let chartInstance = null;
let last = null; // { container, series, ariaLabel, mode } — for re-theme / export

/**
 * Convert one phrase's monthly buckets to ECharts data items. Pure (no DOM/ECharts),
 * so it stays unit-testable in Node. Each item keeps n and total so the tooltip can
 * show both regardless of mode.
 * @param {{ym:string, n:number, total:number}[]} points
 * @param {'count'|'ratio'} mode
 * @returns {Array<{value:[number, number], n:number, total:number}>}
 */
export function toSeriesData(points, mode = 'count') {
  return points.map((p) => {
    const ts = Date.UTC(Number(p.ym.slice(0, 4)), Number(p.ym.slice(5, 7)) - 1, 1);
    const total = Number(p.total) || 0;
    let y;
    if (mode === 'ratio') {
      // Suppress sparse months (gap in the line) rather than plot a noisy ratio.
      y = total >= MIN_TOTAL_FOR_RATIO ? (p.n / total) * 100 : null;
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

function buildOption(series, ariaLabel, mode) {
  const muted = cssVar('--muted', '#5b636e');
  const border = cssVar('--border', '#d4d8de');
  const surface = cssVar('--surface', '#ffffff');
  const text = cssVar('--text', '#1b1f24');
  const ratio = mode === 'ratio';
  return {
    aria: { enabled: true, label: { enabled: true, description: ariaLabel } },
    color: COLORS,
    legend: {
      show: series.length > 1, // a single curve needs no legend
      type: 'scroll',
      top: 6,
      data: series.map((s) => s.label),
      textStyle: { color: text },
      pageTextStyle: { color: muted },
      pageIconColor: muted
    },
    grid: { top: series.length > 1 ? 40 : 18, right: 20, bottom: 66, left: 56 },
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
        for (const p of arr) {
          const { n, total } = p.data;
          let val;
          if (ratio) {
            val = total < MIN_TOTAL_FOR_RATIO ? '—' : `${((n / total) * 100).toFixed(2)}%`;
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
    series: series.map((s) => ({
      type: 'line',
      name: s.label,
      data: toSeriesData(s.points, mode),
      showSymbol: false,
      connectNulls: false,
      lineStyle: { width: 2 }
    }))
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
  const subtitle = mode === 'ratio'
    ? '(arány az összes poszt számához viszonyítva)'
    : '(posztok száma havonta)';
  const titleText =
    series.length === 1
      ? `${hungarianArticle(series[0].label)} ${series[0].label} keresőkifejezés előfordulása az időben`
      : 'Keresőkifejezések előfordulása az időben';

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
    grid: { top: multi ? 40 : 18 },
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
export async function renderLineChart(container, series, { ariaLabel, mode = 'count' } = {}) {
  if (!container) return;
  disposeChart();
  if (!series || series.length === 0) {
    last = null;
    clear(container);
    return;
  }
  last = { container, series, ariaLabel, mode };

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
    chartInstance = echarts.init(host, null, { renderer: 'canvas' });
    chartInstance.setOption(buildOption(series, ariaLabel, mode), true);
  } catch {
    showMessage(container, 'A grafikon megjelenítése nem sikerült.');
  }
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
      if (last) renderLineChart(last.container, last.series, { ariaLabel: last.ariaLabel, mode: last.mode });
    });
  }
}
