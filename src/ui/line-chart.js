// Monthly post-count line chart for the Elemzés tab, rendered with ECharts (SVG
// renderer) loaded lazily via a dynamic import — ECharts only downloads when a
// chart is actually shown. The data shaping (toSeriesData) is pure and
// unit-tested; the rendering needs the DOM + ECharts and is verified in-browser.

import { clear } from './dom.js';
import { formatCount } from '../lib/format.js';

/**
 * Convert monthly buckets to ECharts time-series points: [utcMillis, count].
 * Pure (no DOM, no ECharts), so it stays unit-testable in Node.
 * @param {{ym:string, n:number}[]} points
 * @returns {Array<[number, number]>}
 */
export function toSeriesData(points) {
  return points.map((p) => {
    const year = Number(p.ym.slice(0, 4));
    const month = Number(p.ym.slice(5, 7));
    return [Date.UTC(year, month - 1, 1), p.n];
  });
}

// Pull the app's theme colors from CSS variables so the chart matches light/dark
// mode; re-read on every render so an OS color-scheme switch is reflected.
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function buildOption(points, ariaLabel) {
  const accent = cssVar('--accent', '#1b5fb0');
  const muted = cssVar('--muted', '#5b636e');
  const border = cssVar('--border', '#d4d8de');
  const surface = cssVar('--surface', '#ffffff');
  const text = cssVar('--text', '#1b1f24');
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
        const d = new Date(p.value[0]);
        const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        return `${ym}<br/><strong>${formatCount(p.value[1])}</strong> találat`;
      }
    },
    toolbox: { feature: { saveAsImage: { title: 'Mentés képként' } }, right: 8, top: 4 },
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
      minInterval: 1,
      axisLabel: { color: muted },
      splitLine: { lineStyle: { color: border } }
    },
    series: [
      {
        type: 'line',
        name: 'Havi találatok',
        data: toSeriesData(points),
        showSymbol: false,
        lineStyle: { color: accent, width: 2 },
        itemStyle: { color: accent }
      }
    ]
  };
}

let chartInstance = null;
let last = null; // { container, points, ariaLabel } — for re-theming on scheme change

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

/**
 * Render the monthly chart into `container`. Async because ECharts is loaded on
 * demand; the caller fires it and does not await.
 */
export async function renderLineChart(container, points, { ariaLabel } = {}) {
  if (!container) return;
  disposeChart();
  if (!points || points.length === 0) {
    last = null;
    clear(container);
    return;
  }
  last = { container, points, ariaLabel };

  let echarts;
  try {
    echarts = (await import('./echarts-core.js')).default;
  } catch {
    showMessage(container, 'A grafikonkönyvtár betöltése nem sikerült.');
    return;
  }

  // A newer render may have superseded this one while ECharts was loading.
  if (!last || last.container !== container || last.points !== points) return;

  try {
    clear(container); // replace the loading placeholder only now that ECharts is ready
    const host = document.createElement('div');
    host.className = 'echart';
    host.setAttribute('role', 'img');
    if (ariaLabel) host.setAttribute('aria-label', ariaLabel);
    container.append(host);
    chartInstance = echarts.init(host, null, { renderer: 'svg' });
    chartInstance.setOption(buildOption(points, ariaLabel), true);
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
      if (last) renderLineChart(last.container, last.points, { ariaLabel: last.ariaLabel });
    });
  }
}
