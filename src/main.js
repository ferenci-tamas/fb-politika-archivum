// Main UI thread controller. Holds no data beyond the current page; every query
// goes to the Web Worker, which is the only place SQLite runs. Stale worker
// responses (superseded by a newer request) are dropped by reqId.

import './styles.css';
import {
  IMAGES_BASE_URL,
  FEED_PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  SORTS
} from './config.js';
import { formatCount, dateInputToUnixStart, dateInputToUnixEndExclusive, unixToDateInput } from './lib/format.js';
import { renderRows, renderMessageRow, refreshExpandControls } from './ui/render.js';
import { createAuthorCombobox } from './ui/author-combobox.js';
import { initImagePreview } from './ui/image-preview.js';
import { renderLineChart } from './ui/line-chart.js';
import { encodeViewToHash, decodeHashToView } from './lib/url-state.js';
import { marked } from 'marked';
import landingMarkdown from '../landing.md?raw';

let worker = null;
let dbInitStarted = false;
let activeTab = 'nyitolap';
let firstQueryDone = false;

const $ = (id) => document.getElementById(id);
const els = {
  appLoading: $('app-loading'),
  appLoadingText: $('app-loading-text'),
  appLoadingError: $('app-loading-error'),
  reload: $('app-reload'),
  tabs: $('tabs'),
  tabNyitolap: $('tab-nyitolap'),
  tabAdatbazis: $('tab-adatbazis'),
  tabElemzes: $('tab-elemzes'),
  panelNyitolap: $('panel-nyitolap'),
  panelAdatbazis: $('panel-adatbazis'),
  panelElemzes: $('panel-elemzes'),
  landing: $('landing'),
  analysisSearch: $('analysis-search'),
  analysisSearchClear: $('analysis-search-clear'),
  analysisAccent: $('analysis-accent'),
  analysisStatus: $('analysis-status'),
  analysisChart: $('analysis-chart'),
  search: $('search'),
  searchClear: $('search-clear'),
  accent: $('accent'),
  authorCombobox: $('author-combobox'),
  authorInput: $('author-input'),
  authorListbox: $('author-listbox'),
  authorChips: $('author-chips'),
  authorClear: $('author-clear'),
  dateFrom: $('date-from'),
  dateTo: $('date-to'),
  sort: $('sort'),
  pageSize: $('page-size'),
  filtersClear: $('filters-clear'),
  resultCount: $('result-count'),
  loadingStatus: $('loading-status'),
  errorBanner: $('error-banner'),
  errorMessage: $('error-message'),
  errorRetry: $('error-retry'),
  tableWrap: $('table-wrap'),
  resultsLoading: $('results-loading'),
  body: $('results-body'),
  navFirst: $('nav-first'),
  navPrev: $('nav-prev'),
  navNext: $('nav-next'),
  navLast: $('nav-last'),
  pageInfo: $('page-info'),
  fetchStat: $('fetch-stat')
};

const TABS = ['nyitolap', 'adatbazis', 'elemzes'];
const tabEls = {
  nyitolap: { tab: els.tabNyitolap, panel: els.panelNyitolap },
  adatbazis: { tab: els.tabAdatbazis, panel: els.panelAdatbazis },
  elemzes: { tab: els.tabElemzes, panel: els.panelElemzes }
};

const state = {
  // filters / view
  search: '',
  accentSensitive: false,
  authorIds: [],
  dateFrom: null,
  dateTo: null,
  sort: SORTS.DATE_DESC,
  pageSize: DEFAULT_PAGE_SIZE,
  // pagination bookkeeping
  firstKey: null,
  lastKey: null,
  hasPrev: false,
  hasNext: false,
  count: null,
  offset: 0,
  rowCount: 0,
  // request tracking
  reqId: 0,
  pendingDirection: null,
  loading: false,
  sessionBytes: 0,
  ready: false
};

let authorPicker = null;
let authorIdToName = new Map();
let authorNameToId = new Map();
const SORT_VALUES = Object.values(SORTS);

// --- database worker (created lazily when the Adatbázis tab is first opened) -

function initDatabase() {
  if (dbInitStarted) return;
  dbInitStarted = true;
  showAppLoading();
  worker = new Worker(new URL('./worker/db-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'ready':
        onReady(msg);
        break;
      case 'init-error':
        onInitError(msg);
        break;
      case 'result':
        if (msg.reqId === state.reqId) onResult(msg);
        break;
      case 'error':
        if (msg.reqId === state.reqId) onQueryError(msg);
        break;
      case 'monthly-result':
        if (msg.reqId === analysisReqId) onMonthlyResult(msg);
        break;
      case 'monthly-error':
        if (msg.reqId === analysisReqId) onMonthlyError(msg);
        break;
      default:
        break;
    }
  };
  worker.onerror = (e) => {
    showInitError(`A háttérfolyamat hibát jelzett: ${e.message || 'ismeretlen hiba'}`);
  };
}

function buildViewParams() {
  return {
    search: state.search,
    accentSensitive: state.accentSensitive,
    authorIds: state.authorIds,
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
    sort: state.sort,
    pageSize: state.pageSize
  };
}

function send(direction) {
  if (!worker) return;
  let cursor = null;
  if (direction === 'next') cursor = state.lastKey;
  else if (direction === 'prev') cursor = state.firstKey;

  state.reqId += 1;
  state.pendingDirection = direction;
  // Reflect the query (not the pagination position) in the URL on filter changes.
  if (direction === 'first') updateHash();
  setLoading(true);
  worker.postMessage({
    type: 'query',
    reqId: state.reqId,
    view: buildViewParams(),
    nav: { direction, cursor },
    wantCount: direction === 'first'
  });
}

// Runs the initial feed query the first time the Adatbázis tab is shown with the
// database ready — deferred so a background preload doesn't query or announce
// while the user is still on the landing page.
function runFirstQueryIfNeeded() {
  if (state.ready && !firstQueryDone && activeTab === 'adatbazis') {
    firstQueryDone = true;
    send('first');
  }
}

// --- state transitions ------------------------------------------------------

function onReady(msg) {
  state.ready = true;
  authorIdToName = new Map(msg.authors.map((a) => [a.authorId, a.authorname]));
  authorNameToId = new Map(msg.authors.map((a) => [a.authorname, a.authorId]));
  authorPicker = createAuthorCombobox({
    container: els.authorCombobox,
    input: els.authorInput,
    listbox: els.authorListbox,
    chips: els.authorChips,
    clearButton: els.authorClear,
    authors: msg.authors,
    formatCount,
    onChange: (authorIds) => {
      state.authorIds = authorIds;
      send('first');
    }
  });
  setupDateBounds(msg.meta);
  hideAppLoading();
  setControlsDisabled(false);
  applyHashFiltersToState(); // restore filters/search from a shared or bookmarked URL
  runFirstQueryIfNeeded(); // only queries if the Adatbázis tab is already showing
  if (activeTab === 'elemzes') prepareAnalysis(); // warm + run if the user is already here
}

function onResult(msg) {
  setLoading(false);
  hideError();

  state.firstKey = msg.pagination.firstKey;
  state.lastKey = msg.pagination.lastKey;
  state.hasPrev = msg.pagination.hasPrev;
  state.hasNext = msg.pagination.hasNext;
  if (typeof msg.count === 'number') state.count = msg.count;

  const prevOffset = state.offset;
  const prevRowCount = state.rowCount;
  const rowCount = msg.rows.length;
  switch (state.pendingDirection) {
    case 'first':
      state.offset = 0;
      break;
    case 'next':
      state.offset = prevOffset + prevRowCount;
      break;
    case 'prev':
      state.offset = Math.max(0, prevOffset - rowCount);
      break;
    case 'last':
      state.offset = Math.max(0, (state.count || rowCount) - rowCount);
      break;
    default:
      break;
  }
  state.rowCount = rowCount;

  if (rowCount === 0) {
    renderMessageRow(els.body, 'Nincs a feltételeknek megfelelő poszt.');
  } else {
    renderRows(els.body, msg.rows, { imagesBaseUrl: IMAGES_BASE_URL });
  }

  state.sessionBytes += msg.fetchedBytes || 0;
  updateResultCount();
  updatePager();
  updateFetchStat();
}

function onQueryError(msg) {
  setLoading(false);
  showError(formatErrorMessage(msg));
}

function onInitError(msg) {
  showInitError(formatErrorMessage(msg));
}

// --- rendering of status / controls -----------------------------------------

function updateResultCount() {
  if (state.count == null) {
    els.resultCount.textContent = '';
    return;
  }
  if (state.count === 0) {
    els.resultCount.textContent = '0 találat';
    return;
  }
  els.resultCount.textContent = `${formatCount(state.count)} találat`;
}

function updatePager() {
  els.navFirst.disabled = !state.hasPrev;
  els.navPrev.disabled = !state.hasPrev;
  els.navNext.disabled = !state.hasNext;
  els.navLast.disabled = !state.hasNext;
  applyNavLabels();

  if (state.rowCount === 0) {
    els.pageInfo.textContent = '';
    return;
  }
  const from = state.offset + 1;
  const to = state.offset + state.rowCount;
  const total = state.count != null ? ` / ${formatCount(state.count)}` : '';
  els.pageInfo.textContent = `${formatCount(from)}–${formatCount(to)}${total}`;
}

function applyNavLabels() {
  const labels = {
    [SORTS.DATE_DESC]: { first: 'Legújabb', prev: 'Újabb', next: 'Régebbi', last: 'Legrégebbi' },
    [SORTS.DATE_ASC]: { first: 'Legrégebbi', prev: 'Régebbi', next: 'Újabb', last: 'Legújabb' },
    [SORTS.AUTHOR]: { first: 'Eleje', prev: 'Előző', next: 'Következő', last: 'Vége' }
  }[state.sort];
  els.navFirst.querySelector('.nav-text').textContent = labels.first;
  els.navPrev.querySelector('.nav-text').textContent = labels.prev;
  els.navNext.querySelector('.nav-text').textContent = labels.next;
  els.navLast.querySelector('.nav-text').textContent = labels.last;
}

function updateFetchStat() {
  const mb = state.sessionBytes / (1024 * 1024);
  const text =
    mb >= 1
      ? `${mb.toFixed(1)} MB`
      : `${Math.round(state.sessionBytes / 1024)} KB`;
  els.fetchStat.textContent = `Az adatbázisból letöltve ebben a munkamenetben: ${text}`;
}

// Delay the visible loading cues so instant (cached) queries don't flash them;
// if a query finishes first, the timer is cancelled and nothing is shown.
const SPINNER_DELAY_MS = 150;
let spinnerTimer = null;

function setLoading(isLoading) {
  state.loading = isLoading;
  els.tableWrap.setAttribute('aria-busy', String(isLoading));

  clearTimeout(spinnerTimer);
  if (isLoading) {
    for (const b of [els.navFirst, els.navPrev, els.navNext, els.navLast]) b.disabled = true;
    spinnerTimer = setTimeout(() => {
      els.resultsLoading.hidden = false;
      els.loadingStatus.textContent = 'Betöltés…';
    }, SPINNER_DELAY_MS);
  } else {
    els.resultsLoading.hidden = true;
    els.loadingStatus.textContent = '';
    updatePager();
  }
}

function showError(message) {
  els.errorMessage.textContent = message;
  els.errorBanner.hidden = false;
}

function hideError() {
  els.errorBanner.hidden = true;
}

function showInitError(message) {
  els.appLoadingText.hidden = true;
  els.appLoadingError.textContent = message;
  els.appLoadingError.hidden = false;
  els.reload.hidden = false;
  els.appLoading.hidden = false;
}

function showAppLoading() {
  els.appLoading.hidden = false;
}

function hideAppLoading() {
  els.appLoading.hidden = true;
}

function formatErrorMessage(msg) {
  if (msg.kind === 'range-not-supported') {
    return 'A kiszolgáló nem támogatja a HTTP-tartománykéréseket (206 helyett 200 választ adott). Az archívum így nem tölthető be.';
  }
  if (msg.kind === 'network') {
    return `Hálózati hiba az adatbázis elérésekor. ${msg.message || ''}`.trim();
  }
  return msg.message || 'Ismeretlen hiba történt.';
}

// --- control population -----------------------------------------------------

function setupDateBounds(meta) {
  const min = unixToDateInput(meta.min_time);
  const max = unixToDateInput(meta.max_time);
  els.dateFrom.min = min;
  els.dateFrom.max = max;
  els.dateTo.min = min;
  els.dateTo.max = max;
}

function setControlsDisabled(disabled) {
  for (const key of ['search', 'accent', 'authorInput', 'dateFrom', 'dateTo', 'sort', 'pageSize', 'filtersClear', 'searchClear']) {
    els[key].disabled = disabled;
  }
}

// --- deep link (URL hash) <-> state -----------------------------------------
// Only the query is encoded (search, accent, authors by name, date range, sort,
// page size) — never the pagination position; a shared link reopens on page 1.
// replaceState avoids flooding history and does not fire hashchange (no loop).

function updateHash() {
  let body = '';
  if (activeTab === 'adatbazis') {
    const query = encodeViewToHash(
      {
        search: state.search,
        accentSensitive: state.accentSensitive,
        authorNames: state.authorIds.map((id) => authorIdToName.get(id)).filter(Boolean),
        dateFrom: els.dateFrom.value,
        dateTo: els.dateTo.value,
        sort: state.sort,
        pageSize: state.pageSize
      },
      { defaultSort: SORTS.DATE_DESC, defaultPageSize: DEFAULT_PAGE_SIZE }
    );
    body = query ? `tab=adatbazis&${query}` : 'tab=adatbazis';
  } else if (activeTab === 'elemzes') {
    body = 'tab=elemzes';
  }
  history.replaceState(null, '', body ? `#${body}` : location.pathname + location.search);
}

function applyHashFiltersToState() {
  const v = decodeHashToView(location.hash, {
    validSorts: SORT_VALUES,
    pageSizes: FEED_PAGE_SIZES,
    defaultSort: SORTS.DATE_DESC,
    defaultPageSize: DEFAULT_PAGE_SIZE
  });
  els.search.value = v.search;
  state.search = v.search;
  els.searchClear.hidden = v.search.trim() === '';
  els.accent.checked = v.accentSensitive;
  state.accentSensitive = v.accentSensitive;
  els.sort.value = v.sort;
  state.sort = v.sort;
  els.pageSize.value = String(v.pageSize);
  state.pageSize = v.pageSize;
  els.dateFrom.value = v.dateFrom;
  state.dateFrom = v.dateFrom ? dateInputToUnixStart(v.dateFrom) : null;
  els.dateTo.value = v.dateTo;
  state.dateTo = v.dateTo ? dateInputToUnixEndExclusive(v.dateTo) : null;
  state.authorIds = [...new Set(v.authorNames.map((n) => authorNameToId.get(n)).filter((id) => Number.isFinite(id)))];
  if (authorPicker) authorPicker.setSelected(state.authorIds);
}

// --- reading controls into state --------------------------------------------

function readFiltersAndReload() {
  state.dateFrom = els.dateFrom.value ? dateInputToUnixStart(els.dateFrom.value) : null;
  state.dateTo = els.dateTo.value ? dateInputToUnixEndExclusive(els.dateTo.value) : null;
  state.accentSensitive = els.accent.checked;
  state.sort = els.sort.value;
  state.pageSize = FEED_PAGE_SIZES.includes(Number(els.pageSize.value)) ? Number(els.pageSize.value) : DEFAULT_PAGE_SIZE;
  send('first');
}

function applySearch(value) {
  state.search = value;
  els.searchClear.hidden = value.trim() === '';
  send('first');
}

// --- event wiring -----------------------------------------------------------

let searchTimer = null;
els.search.addEventListener('input', () => {
  const value = els.search.value;
  els.searchClear.hidden = value.trim() === '';
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => applySearch(value), 250);
});
els.search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(searchTimer);
    applySearch(els.search.value);
  }
});
els.searchClear.addEventListener('click', () => {
  els.search.value = '';
  els.searchClear.hidden = true;
  applySearch('');
  els.search.focus();
});

els.accent.addEventListener('change', readFiltersAndReload);
els.dateFrom.addEventListener('change', readFiltersAndReload);
els.dateTo.addEventListener('change', readFiltersAndReload);
els.sort.addEventListener('change', readFiltersAndReload);
els.pageSize.addEventListener('change', readFiltersAndReload);

els.filtersClear.addEventListener('click', () => {
  els.search.value = '';
  els.searchClear.hidden = true;
  els.accent.checked = false;
  if (authorPicker) authorPicker.reset();
  state.authorIds = [];
  els.dateFrom.value = '';
  els.dateTo.value = '';
  els.sort.value = SORTS.DATE_DESC;
  els.pageSize.value = String(DEFAULT_PAGE_SIZE);
  state.search = '';
  readFiltersAndReload();
});

els.navFirst.addEventListener('click', () => send('first'));
els.navPrev.addEventListener('click', () => send('prev'));
els.navNext.addEventListener('click', () => send('next'));
els.navLast.addEventListener('click', () => send('last'));

els.errorRetry.addEventListener('click', () => {
  hideError();
  send(state.pendingDirection || 'first');
});

els.reload.addEventListener('click', () => window.location.reload());

// --- analysis (Elemzés tab) -------------------------------------------------
// Shares the worker/DB with Adatbázis. A search posts a 'monthly' request; the
// worker returns per-month counts, drawn as a line chart. analysisReqId drops
// stale responses, exactly like the feed's reqId.
let analysisReqId = 0;
let analysisPrepared = false;
let analysisTimer = null;

// Shown the Elemzés tab (and re-invoked from onReady if the DB was still loading):
// warm the month boundaries, then run whatever the user has already typed.
function prepareAnalysis() {
  if (!state.ready) return;
  if (!analysisPrepared) {
    analysisPrepared = true;
    worker.postMessage({ type: 'prepare-monthly' });
  }
  if (els.analysisSearch.value.trim() !== '') runAnalysis();
}

function runAnalysis() {
  const term = els.analysisSearch.value;
  els.analysisSearchClear.hidden = term.trim() === '';
  if (term.trim() === '') {
    analysisReqId += 1; // invalidate any in-flight response
    els.analysisStatus.textContent = '';
    els.analysisChart.replaceChildren();
    return;
  }
  if (!state.ready) {
    els.analysisStatus.textContent = 'Az adatbázis betöltése folyamatban…';
    return; // prepareAnalysis() re-runs this once the DB is ready
  }
  analysisReqId += 1;
  els.analysisStatus.textContent = 'Számítás…';
  const loading = document.createElement('div');
  loading.className = 'chart-loading';
  loading.textContent = 'Grafikon számítása…';
  els.analysisChart.replaceChildren(loading);
  worker.postMessage({
    type: 'monthly',
    reqId: analysisReqId,
    search: term,
    accentSensitive: els.analysisAccent.checked
  });
}

function onMonthlyResult(msg) {
  if (msg.matchEmpty) {
    els.analysisStatus.textContent = 'Adj meg egy keresőkifejezést.';
    els.analysisChart.replaceChildren();
    return;
  }
  if (msg.total === 0) {
    els.analysisStatus.textContent = 'Nincs a keresésnek megfelelő poszt.';
    els.analysisChart.replaceChildren();
    return;
  }
  const term = els.analysisSearch.value.trim();
  els.analysisStatus.textContent = `${formatCount(msg.total)} találat havi eloszlása`;
  renderLineChart(els.analysisChart, msg.points, {
    ariaLabel: `„${term}”: havi találatszám, összesen ${formatCount(msg.total)} poszt`
  });
}

function onMonthlyError(msg) {
  els.analysisStatus.textContent = formatErrorMessage(msg);
  els.analysisChart.replaceChildren();
}

els.analysisSearch.addEventListener('input', () => {
  els.analysisSearchClear.hidden = els.analysisSearch.value.trim() === '';
  clearTimeout(analysisTimer);
  analysisTimer = setTimeout(runAnalysis, 300);
});
els.analysisSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(analysisTimer);
    runAnalysis();
  }
});
els.analysisSearchClear.addEventListener('click', () => {
  els.analysisSearch.value = '';
  els.analysisSearchClear.hidden = true;
  runAnalysis();
  els.analysisSearch.focus();
});
els.analysisAccent.addEventListener('change', runAnalysis);

// Expand / collapse long post text (event delegation on the table body).
els.body.addEventListener('click', (e) => {
  const btn = e.target.closest('.expand-toggle');
  if (!btn) return;
  const target = document.getElementById(btn.getAttribute('aria-controls'));
  if (!target) return;
  const wasExpanded = btn.getAttribute('aria-expanded') === 'true';
  const nowExpanded = !wasExpanded;
  btn.setAttribute('aria-expanded', String(nowExpanded));
  target.classList.toggle('clamped', !nowExpanded);
  btn.textContent = nowExpanded ? 'Kevesebb' : 'Megnyitás';
});

// Re-evaluate expand controls when a width change (window resize / orientation)
// could alter which posts are clipped.
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => refreshExpandControls(els.body), 150);
});

// --- tabs -------------------------------------------------------------------

function setActiveTab(tab, { updateUrl = true } = {}) {
  if (!TABS.includes(tab)) tab = 'nyitolap';
  activeTab = tab;
  for (const t of TABS) {
    const selected = t === tab;
    tabEls[t].tab.setAttribute('aria-selected', String(selected));
    tabEls[t].tab.tabIndex = selected ? 0 : -1;
    tabEls[t].panel.hidden = !selected;
  }
  if (tab === 'adatbazis') {
    initDatabase(); // start the worker on first open (idempotent)
    runFirstQueryIfNeeded(); // if the DB was preloaded, run the deferred first query now
  } else if (tab === 'elemzes') {
    initDatabase(); // the monthly histogram also runs in the worker
    prepareAnalysis(); // warm the month boundaries, then run any typed search
  }
  if (updateUrl) updateHash();
}

// tab= in the hash wins; otherwise any encoded query implies the Adatbázis tab.
function tabFromHash() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const tab = params.get('tab');
  if (tab === 'elemzes') return 'elemzes';
  if (tab === 'adatbazis') return 'adatbazis';
  const query = encodeViewToHash(
    decodeHashToView(location.hash, {
      validSorts: SORT_VALUES,
      pageSizes: FEED_PAGE_SIZES,
      defaultSort: SORTS.DATE_DESC,
      defaultPageSize: DEFAULT_PAGE_SIZE
    }),
    { defaultSort: SORTS.DATE_DESC, defaultPageSize: DEFAULT_PAGE_SIZE }
  );
  return query ? 'adatbazis' : 'nyitolap';
}

for (const t of TABS) {
  tabEls[t].tab.addEventListener('click', () => setActiveTab(t));
}
els.tabs.addEventListener('keydown', (e) => {
  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const i = TABS.indexOf(activeTab);
  let next;
  if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = TABS.length - 1;
  else if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
  else next = (i - 1 + TABS.length) % TABS.length;
  setActiveTab(TABS[next]);
  tabEls[TABS[next]].tab.focus();
});

// Deep-link: reflect tab + filters from the URL (shared link, manual edit, Back/Forward).
window.addEventListener('hashchange', () => {
  const tab = tabFromHash();
  if (tab === 'adatbazis' && state.ready) {
    // Apply the new hash's filters before switching so we don't fire a stale query.
    applyHashFiltersToState();
    firstQueryDone = true;
  }
  setActiveTab(tab, { updateUrl: false });
  if (tab === 'adatbazis' && state.ready) send('first');
});

// Render the landing page from landing.md (trusted, author-authored Markdown).
// marked has no smartypants option, so convert the author's `--` to an em dash
// ourselves. The lookarounds match exactly two hyphens, leaving `---` untouched.
els.landing.innerHTML = marked.parse(landingMarkdown.replace(/(?<!-)--(?!-)/g, '—'));

// Hover/focus thumbnail preview over the numbered image links in the results.
initImagePreview(els.body);

setControlsDisabled(true);
setActiveTab(tabFromHash(), { updateUrl: false });

// Preload the database in the background while the user reads the landing page,
// so opening Adatbázis is instant. The first query is deferred until that tab is
// actually shown (runFirstQueryIfNeeded), so nothing renders or announces early.
if (activeTab !== 'adatbazis') {
  const preloadDatabase = () => initDatabase();
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(preloadDatabase, { timeout: 2000 });
  } else {
    setTimeout(preloadDatabase, 1200);
  }
}
