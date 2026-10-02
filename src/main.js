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
import { renderLineChart, preloadChart } from './ui/line-chart.js';
import { el } from './ui/dom.js';
import { encodeViewToHash, decodeHashToView, encodeAnalysisToHash, decodeHashToAnalysis } from './lib/url-state.js';
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
  analysisPhrases: $('analysis-phrases'),
  analysisAdd: $('analysis-add'),
  analysisAccent: $('analysis-accent'),
  analysisRatio: $('analysis-ratio'),
  analysisStatus: $('analysis-status'),
  analysisChart: $('analysis-chart'),
  elemzesMenu: $('elemzes-menu'),
  elemzesActivity: $('elemzes-activity'),
  elemzesNarratives: $('elemzes-narratives'),
  elemzesLinks: $('elemzes-links'),
  linksStatus: $('links-status'),
  linksChart: $('links-chart'),
  activityStatus: $('activity-status'),
  activityChart: $('activity-chart'),
  activityAuthorCombobox: $('activity-author-combobox'),
  activityAuthorInput: $('activity-author-input'),
  activityAuthorListbox: $('activity-author-listbox'),
  activityAuthorChips: $('activity-author-chips'),
  activityAuthorClear: $('activity-author-clear'),
  activityRatio: $('activity-ratio'),
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
      case 'activity-result':
        if (msg.reqId === activityReqId) onActivityResult(msg);
        break;
      case 'activity-error':
        if (msg.reqId === activityReqId) onActivityError(msg);
        break;
      case 'link-availability-result':
        if (msg.reqId === linkReqId) onLinkResult(msg);
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
  activityAuthorPicker = createAuthorCombobox({
    container: els.activityAuthorCombobox,
    input: els.activityAuthorInput,
    listbox: els.activityAuthorListbox,
    chips: els.activityAuthorChips,
    clearButton: els.activityAuthorClear,
    authors: msg.authors,
    formatCount,
    idPrefix: 'activity-author-opt-',
    onChange: (authorIds) => {
      activityAuthorIds = authorIds;
      syncActivityRatioControl(); // untick + disable at once when the selection empties
      lastActivity = null; // selection changed — refetch
      runActivity();
    }
  });
  setupDateBounds(msg.meta);
  hideAppLoading();
  setControlsDisabled(false);
  applyHashFiltersToState(); // restore filters/search from a shared or bookmarked URL
  restoreActivityAuthorsFromHash(); // restore the Elemzés activity author selection, if any
  runFirstQueryIfNeeded(); // only queries if the Adatbázis tab is already showing
  if (activeTab === 'elemzes') showElemzesView(elemzesView); // run the current sub-view
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
    const query = encodeAnalysisToHash({
      view: elemzesView,
      phrases: [...els.analysisPhrases.querySelectorAll('.analysis-phrase')].map((i) => i.value),
      accentSensitive: els.analysisAccent.checked,
      ratio: elemzesView === 'activity' ? els.activityRatio.checked : els.analysisRatio.checked,
      authorNames: activityAuthorIds.map((id) => authorIdToName.get(id)).filter(Boolean)
    });
    body = query ? `tab=elemzes&${query}` : 'tab=elemzes';
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
// Shares the worker/DB with Adatbázis. One or more phrase inputs each become a
// line series; a search posts a single 'monthly' request for all phrases and the
// worker returns per-phrase monthly counts. analysisReqId drops stale replies.
let analysisReqId = 0;
let analysisPrepared = false;
let analysisTimer = null;
let nextPhraseId = 0;
// At most this many phrases/series — matches the chart colour palette (line-chart.js).
const MAX_PHRASES = 8;
let lastMonthly = null; // most recent { series }; re-rendered on ratio toggle, no re-query
// Elemzés sub-view (dropdown): 'activity' (all posts), 'narratives' (phrase search),
// or 'links' (link-availability over time).
let elemzesView = 'narratives';
let activityReqId = 0;
let activityAuthorIds = [];
let activityAuthorPicker = null;
let lastActivity = null; // cached { key, series } for the current author selection
let linkReqId = 0;
let lastLink = null; // cached { series } for the link-availability view (static per session)

function addPhraseRow(value = '') {
  if (els.analysisPhrases.querySelectorAll('.analysis-phrase-row').length >= MAX_PHRASES) return null;
  const id = ++nextPhraseId;
  const input = el('input', {
    type: 'search',
    class: 'analysis-phrase',
    placeholder: 'Keresés a posztokban… (pl. kormány, „védett ár”, infláció*)',
    enterkeyhint: 'search',
    spellcheck: 'false',
    'aria-label': 'Keresőkifejezés'
  });
  if (value) input.value = value;
  const clearBtn = el(
    'button',
    { type: 'button', class: 'search-clear analysis-phrase-clear', 'aria-label': 'Keresőkifejezés törlése' },
    '×'
  );
  clearBtn.hidden = value.trim() === '';
  const removeBtn = el(
    'button',
    { type: 'button', class: 'analysis-phrase-remove', 'aria-label': 'Keresőkifejezés eltávolítása', title: 'Keresőkifejezés eltávolítása' },
    '−'
  );
  const row = el(
    'div',
    { class: 'analysis-phrase-row', dataset: { id: String(id) } },
    el('div', { class: 'search-field' }, input, clearBtn),
    removeBtn
  );
  els.analysisPhrases.append(row);
  updateRemoveButtons();
  return input;
}

// Hide the remove control when a single row is left (there must always be one), and
// disable the "add" button once the phrase cap is reached.
function updateRemoveButtons() {
  const rows = els.analysisPhrases.querySelectorAll('.analysis-phrase-row');
  for (const r of rows) r.querySelector('.analysis-phrase-remove').hidden = rows.length <= 1;
  els.analysisAdd.disabled = rows.length >= MAX_PHRASES;
}

// Non-empty, de-duplicated phrases with their row id.
function collectPhrases() {
  const seen = new Set();
  const out = [];
  for (const input of els.analysisPhrases.querySelectorAll('.analysis-phrase')) {
    const phrase = input.value.trim();
    if (phrase === '' || seen.has(phrase)) continue;
    seen.add(phrase);
    out.push({ id: input.closest('.analysis-phrase-row').dataset.id, phrase });
  }
  return out;
}

// Shown the Elemzés tab (and re-invoked from onReady if the DB was still loading):
// warm the month boundaries, then run whatever the user has already typed.
function prepareAnalysis() {
  if (!state.ready) return;
  if (!analysisPrepared) {
    analysisPrepared = true;
    worker.postMessage({ type: 'prepare-monthly' });
  }
  if (collectPhrases().length > 0) runAnalysis();
}

function runAnalysis() {
  updateHash(); // keep the shareable URL in sync with the phrases + toggles
  const searches = collectPhrases();
  if (searches.length === 0) {
    analysisReqId += 1; // invalidate any in-flight response
    lastMonthly = null;
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
  // Spinner (decorative; the status text above announces for screen readers).
  const loading = el('div', { class: 'chart-loading', 'aria-hidden': 'true' }, el('div', { class: 'spinner' }));
  els.analysisChart.replaceChildren(loading);
  worker.postMessage({
    type: 'monthly',
    reqId: analysisReqId,
    searches,
    accentSensitive: els.analysisAccent.checked
  });
}

function onMonthlyResult(msg) {
  const series = (msg.series || []).filter((s) => !s.matchEmpty);
  if (series.length === 0) {
    els.analysisStatus.textContent = 'Adj meg legalább egy keresőkifejezést.';
    lastMonthly = null;
    els.analysisChart.replaceChildren();
    return;
  }
  lastMonthly = { series };
  const totalMatches = series.reduce((sum, s) => sum + s.matchCount, 0);
  els.analysisStatus.textContent =
    series.length === 1
      ? `${formatCount(series[0].matchCount)} találat havi eloszlása`
      : `${series.length} keresőkifejezés összehasonlítása — összesen ${formatCount(totalMatches)} találat`;
  drawAnalysisChart();
}

// Draw (or redraw) the cached result in the mode the checkbox selects. Toggling the
// checkbox re-renders instantly from the same data — no new worker query.
function drawAnalysisChart() {
  if (!lastMonthly) return;
  const ratio = els.analysisRatio.checked;
  const series = lastMonthly.series.map((s) => ({ label: s.phrase, points: s.points }));
  const phrases = series.map((s) => s.label).join(', ');
  renderLineChart(els.analysisChart, series, {
    mode: ratio ? 'ratio' : 'count',
    ariaLabel: `Havi ${ratio ? 'találatarány' : 'találatszám'} keresőkifejezésenként: ${phrases}`
  });
}

function onMonthlyError(msg) {
  els.analysisStatus.textContent = formatErrorMessage(msg);
  els.analysisChart.replaceChildren();
}

// Phrase rows: debounced input, per-row clear/remove, Enter to run immediately.
els.analysisPhrases.addEventListener('input', (e) => {
  const input = e.target.closest('.analysis-phrase');
  if (!input) return;
  const clearBtn = input.parentElement.querySelector('.analysis-phrase-clear');
  if (clearBtn) clearBtn.hidden = input.value.trim() === '';
  clearTimeout(analysisTimer);
  analysisTimer = setTimeout(runAnalysis, 300);
});
els.analysisPhrases.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.closest('.analysis-phrase')) {
    e.preventDefault();
    clearTimeout(analysisTimer);
    runAnalysis();
  }
});
els.analysisPhrases.addEventListener('click', (e) => {
  const clearBtn = e.target.closest('.analysis-phrase-clear');
  if (clearBtn) {
    const input = clearBtn.parentElement.querySelector('.analysis-phrase');
    input.value = '';
    clearBtn.hidden = true;
    input.focus();
    runAnalysis();
    return;
  }
  const removeBtn = e.target.closest('.analysis-phrase-remove');
  if (removeBtn) {
    removeBtn.closest('.analysis-phrase-row').remove();
    updateRemoveButtons();
    runAnalysis();
  }
});
els.analysisAdd.addEventListener('click', () => {
  const input = addPhraseRow();
  if (input) input.focus();
});
els.analysisAccent.addEventListener('change', runAnalysis);
els.analysisRatio.addEventListener('change', () => {
  drawAnalysisChart();
  updateHash();
});
// Activity ratio toggle: re-render from the cached series (points already carry each
// month's total), so no re-query, and keep the shareable URL in sync. Disabled until
// an author is selected.
els.activityRatio.disabled = true;
els.activityRatio.addEventListener('change', () => {
  drawActivityChart();
  updateHash();
});

// --- Elemzés sub-views: activity chart + the view dropdown ------------------
function setElemzesMenuOpen(open) {
  els.elemzesMenu.hidden = !open;
  els.tabElemzes.setAttribute('aria-expanded', String(open));
}

// Show one sub-view ('activity' | 'narratives' | 'links') and run it. Called from
// setActiveTab.
function showElemzesView(view) {
  elemzesView = view === 'activity' ? 'activity' : view === 'links' ? 'links' : 'narratives';
  els.elemzesActivity.hidden = elemzesView !== 'activity';
  els.elemzesNarratives.hidden = elemzesView !== 'narratives';
  els.elemzesLinks.hidden = elemzesView !== 'links';
  for (const item of els.elemzesMenu.querySelectorAll('.tab-menu-item')) {
    item.setAttribute('aria-current', String(item.dataset.view === elemzesView));
  }
  if (elemzesView === 'activity') prepareActivity();
  else if (elemzesView === 'links') prepareLinks();
  else prepareAnalysis();
}

// Stable cache key for the current author selection.
function activityKey() {
  return activityAuthorIds.slice().sort((a, b) => a - b).join(',');
}

function prepareActivity() {
  if (!state.ready) {
    els.activityStatus.textContent = 'Az adatbázis betöltése folyamatban…';
    return; // onReady re-invokes showElemzesView once the DB is ready
  }
  if (lastActivity && lastActivity.key === activityKey()) {
    drawActivityChart(); // same selection — re-render the cached result
    return;
  }
  runActivity();
}

function runActivity() {
  updateHash(); // keep the shareable URL in sync with the author selection
  activityReqId += 1;
  els.activityStatus.textContent = 'Számítás…';
  const loading = el('div', { class: 'chart-loading', 'aria-hidden': 'true' }, el('div', { class: 'spinner' }));
  els.activityChart.replaceChildren(loading);
  worker.postMessage({ type: 'activity', reqId: activityReqId, authorIds: activityAuthorIds });
}

function onActivityResult(msg) {
  lastActivity = { key: activityKey(), series: msg.series };
  drawActivityChart();
}

// The ratio (an author's posts / all posts that month) only means something for a
// subset of authors; with none selected the single series *is* the total, so the view
// is always count mode. Reflect that in the control: disable it AND show it unticked,
// never greyed-but-ticked. Returns whether any author is selected.
function syncActivityRatioControl() {
  const hasAuthors = activityAuthorIds.length > 0;
  els.activityRatio.disabled = !hasAuthors;
  if (!hasAuthors) els.activityRatio.checked = false;
  return hasAuthors;
}

function drawActivityChart() {
  if (!lastActivity) return;
  const hasAuthors = syncActivityRatioControl();
  const ratio = hasAuthors && els.activityRatio.checked;
  const series = lastActivity.series.map((s) => ({ label: s.label, points: s.points }));
  const total = lastActivity.series.reduce((sum, s) => sum + s.total, 0);
  els.activityStatus.textContent = hasAuthors
    ? `${series.length} szerző — összesen ${formatCount(total)} poszt`
    : `${formatCount(total)} poszt havi eloszlása`;
  renderLineChart(els.activityChart, series, {
    mode: ratio ? 'ratio' : 'count',
    title: 'Posztolási aktivitás időben',
    ariaLabel: hasAuthors
      ? `Havi ${ratio ? 'posztarány' : 'posztszám'} szerzőnként: ${series.map((s) => s.label).join(', ')}`
      : 'A havonta közzétett összes poszt száma, 2008 és 2026 között'
  });
}

function onActivityError(msg) {
  els.activityStatus.textContent = formatErrorMessage(msg);
  els.activityChart.replaceChildren();
}

// --- Elemzés: link-availability (link-rot) sub-view -------------------------
// A single static line: the monthly share of unavailable links, read from the
// manifest (MANIFEST_FORMAT >= 3). No per-session input, so the result is cached once.
function prepareLinks() {
  if (!state.ready) {
    els.linksStatus.textContent = 'Az adatbázis betöltése folyamatban…';
    return; // onReady re-invokes showElemzesView once the DB is ready
  }
  if (lastLink) {
    drawLinkChart(); // already fetched this session — just re-render
    return;
  }
  runLinks();
}

function runLinks() {
  linkReqId += 1;
  els.linksStatus.textContent = 'Számítás…';
  const loading = el('div', { class: 'chart-loading', 'aria-hidden': 'true' }, el('div', { class: 'spinner' }));
  els.linksChart.replaceChildren(loading);
  worker.postMessage({ type: 'link-availability', reqId: linkReqId });
}

function onLinkResult(msg) {
  lastLink = { series: msg.series };
  drawLinkChart();
}

function drawLinkChart() {
  if (!lastLink) return;
  if (!lastLink.series) {
    // The manifest predates the link counts (MANIFEST_FORMAT < 3): no scan fallback.
    els.linksStatus.textContent = 'Ehhez a nézethez frissített adatbázis szükséges — a linkstatisztika még nincs a leíróban.';
    els.linksChart.replaceChildren();
    return;
  }
  const points = lastLink.series[0].points;
  const totalLinks = points.reduce((sum, p) => sum + p.total, 0);
  const totalUnavail = points.reduce((sum, p) => sum + p.n, 0);
  const pct = totalLinks > 0 ? (100 * totalUnavail) / totalLinks : 0;
  els.linksStatus.textContent = `${formatCount(totalLinks)} link — ${pct.toFixed(1)}% elérhetetlen`;
  renderLineChart(els.linksChart, lastLink.series, {
    mode: 'ratio',
    title: 'Link-avulási statisztika',
    subtitle: '(az elérhetetlen linkek aránya havonta)',
    ariaLabel: 'A posztokban megosztott linkek havi elérhetetlenségi aránya'
  });
}

// The Elemzés tab button opens a menu to choose the sub-view (rather than switching
// directly); picking an item activates the tab with that view.
els.tabElemzes.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = els.tabElemzes.getAttribute('aria-expanded') === 'true';
  setElemzesMenuOpen(!open);
  if (!open) els.elemzesMenu.querySelector('.tab-menu-item')?.focus();
});
els.tabElemzes.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    setElemzesMenuOpen(true);
    els.elemzesMenu.querySelector('.tab-menu-item')?.focus();
  }
});
els.elemzesMenu.addEventListener('click', (e) => {
  const item = e.target.closest('.tab-menu-item');
  if (!item) return;
  setElemzesMenuOpen(false);
  elemzesView = item.dataset.view === 'activity' ? 'activity' : item.dataset.view === 'links' ? 'links' : 'narratives';
  setActiveTab('elemzes'); // shows the sub-view + updates the hash
  els.tabElemzes.focus();
});
els.elemzesMenu.addEventListener('keydown', (e) => {
  const items = [...els.elemzesMenu.querySelectorAll('.tab-menu-item')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') {
    e.stopPropagation();
    setElemzesMenuOpen(false);
    els.tabElemzes.focus();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    e.stopPropagation();
    items[(i + 1) % items.length]?.focus();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    e.stopPropagation();
    items[(i - 1 + items.length) % items.length]?.focus();
  }
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.tab-dropdown')) setElemzesMenuOpen(false);
});

// Restore phrases + toggles from the hash when it is an Elemzés deep link; otherwise
// start with a single empty row. Seeds the rows at load and on Back/Forward.
function applyHashAnalysisToState() {
  els.analysisPhrases.replaceChildren();
  const onElemzes = new URLSearchParams(location.hash.replace(/^#/, '')).get('tab') === 'elemzes';
  const a = onElemzes
    ? decodeHashToAnalysis(location.hash)
    : { view: 'narratives', phrases: [], accentSensitive: false, ratio: true };
  elemzesView = a.view === 'activity' ? 'activity' : a.view === 'links' ? 'links' : 'narratives';
  els.analysisAccent.checked = a.accentSensitive;
  // Route the decoded ratio to its sub-view; the other sub-view keeps its default.
  if (a.view === 'activity') {
    els.activityRatio.checked = a.ratio;
    els.analysisRatio.checked = true; // narratives ratio defaults on
  } else {
    els.analysisRatio.checked = a.ratio;
    els.activityRatio.checked = false; // activity ratio defaults off
  }
  const phrases = a.phrases.slice(0, MAX_PHRASES);
  if (phrases.length === 0) addPhraseRow();
  else for (const phrase of phrases) addPhraseRow(phrase);
  updateRemoveButtons();
}

// Restore the activity sub-view's author selection from an Elemzés deep link.
// Authors travel by NAME (stable across rebuilds), so this needs the author maps
// and the picker: it runs from onReady and on hashchange, never at module load.
// setSelected does not fire the picker's onChange, so the follow-on prepareActivity
// (via setActiveTab) is what refetches when the selection actually changed.
function restoreActivityAuthorsFromHash() {
  const onElemzes = new URLSearchParams(location.hash.replace(/^#/, '')).get('tab') === 'elemzes';
  const names = onElemzes ? decodeHashToAnalysis(location.hash).authorNames : [];
  activityAuthorIds = [...new Set(names.map((n) => authorNameToId.get(n)).filter((id) => Number.isFinite(id)))];
  if (activityAuthorPicker) activityAuthorPicker.setSelected(activityAuthorIds);
}

applyHashAnalysisToState(); // seed the phrase rows (restoring an Elemzés deep link)

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
  setElemzesMenuOpen(false); // any tab activation closes the Elemzés dropdown
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
    showElemzesView(elemzesView); // show + run the selected sub-view
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
  if (t === 'elemzes') continue; // the Elemzés tab opens a dropdown (wired above)
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
  if (tab === 'elemzes') {
    applyHashAnalysisToState();
    restoreActivityAuthorsFromHash();
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

// Warm the lazily-loaded pieces during idle so the next tab opens instantly. The
// ECharts chunk is always preloaded (most visitors reach Elemzés eventually); the
// database worker is warmed too unless we're already on Adatbázis, where
// setActiveTab has just started it for the feed. The DB's first query stays
// deferred (runFirstQueryIfNeeded), so nothing renders or announces early.
const preload = () => {
  if (activeTab !== 'adatbazis') initDatabase();
  preloadChart();
};
if (typeof requestIdleCallback === 'function') {
  requestIdleCallback(preload, { timeout: 2000 });
} else {
  setTimeout(preload, 1200);
}
