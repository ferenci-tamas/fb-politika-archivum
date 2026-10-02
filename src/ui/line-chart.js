// Monthly line chart for the Elemzés tab, rendered with ECharts (canvas renderer)
// loaded lazily via a dynamic import — ECharts only downloads when a chart is
// actually shown. Two modes: absolute monthly counts ('count') and each month's
// share of its posts ('ratio', shown as a percentage). The data shaping
// (toSeriesData) is pure and unit-tested; rendering is verified in-browser.

import { clear } from './dom.js';
import { formatCount } from '../lib/format.js';

// In ratio mode, months with fewer than this many posts are suppressed (plotted as
// a gap) because their share of matches is too noisy to be meaningful.
const MIN_TOTAL_FOR_RATIO = 100;

/**
 * Convert monthly buckets to ECharts data items. Pure (no DOM/ECharts), so it
 * stays unit-testable in Node. Each item keeps n and total so the tooltip can show
 * both regardless of mode.
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

function buildOption(points, ariaLabel, mode) {
  const accent = cssVar('--accent', '#1b5fb0');
  const muted = cssVar('--muted', '#5b636e');
  const border = cssVar('--border', '#d4d8de');
  const surface = cssVar('--surface', '#ffffff');
  const text = cssVar('--text', '#1b1f24');
  const ratio = mode === 'ratio';
  return {
    aria: { enabled: true, label: { enabled: true, description: ariaLabel } },
    grid: { top: 18, right: 20, bottom: 66, left: 56 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: surface,
      borderColor: border,
      textStyle: { color: text },
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params;
        if (!p || !p.value) return '';
        const d = new Date(p.value[0]);
        const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        const { n, total } = p.data;
        if (ratio) {
          if (total < MIN_TOTAL_FOR_RATIO) {
            return `${ym}<br/>— <small>(túl kevés poszt: ${formatCount(total)})</small>`;
          }
          const pct = (n / total) * 100;
          return `${ym}<br/><strong>${pct.toFixed(2)}%</strong> (${formatCount(n)} / ${formatCount(total)})`;
        }
        return `${ym}<br/><strong>${formatCount(n)}</strong> találat`;
      }
    },
    toolbox: {
      feature: {
        saveAsImage: {
          type: 'png',
          name: 'havi-grafikon',
          pixelRatio: 2,
          backgroundColor: surface,
          title: 'Mentés PNG-ként'
        }
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
    series: [
      {
        type: 'line',
        name: ratio ? 'Havi arány' : 'Havi találatok',
        data: toSeriesData(points, mode),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: accent, width: 2 },
        itemStyle: { color: accent }
      }
    ]
  };
}

let chartInstance = null;
let last = null; // { container, points, ariaLabel, mode } — for re-theming on scheme change

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
 * @param {{ariaLabel?:string, mode?:'count'|'ratio'}} [opts]
 */
export async function renderLineChart(container, points, { ariaLabel, mode = 'count' } = {}) {
  if (!container) return;
  disposeChart();
  if (!points || points.length === 0) {
    last = null;
    clear(container);
    return;
  }
  last = { container, points, ariaLabel, mode };

  let echarts;
  try {
    echarts = (await import('./echarts-core.js')).default;
  } catch {
    showMessage(container, 'A grafikonkönyvtár betöltése nem sikerült.');
    return;
  }

  // A newer render (new search or toggled mode) may have superseded this one.
  if (!last || last.container !== container || last.points !== points || last.mode !== mode) return;

  try {
    clear(container); // replace the loading placeholder only now that ECharts is ready
    const host = document.createElement('div');
    host.className = 'echart';
    host.setAttribute('role', 'img');
    if (ariaLabel) host.setAttribute('aria-label', ariaLabel);
    container.append(host);
    chartInstance = echarts.init(host, null, { renderer: 'canvas' });
    chartInstance.setOption(buildOption(points, ariaLabel, mode), true);
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
      if (last) renderLineChart(last.container, last.points, { ariaLabel: last.ariaLabel, mode: last.mode });
    });
  }
}
