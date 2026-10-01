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
import { renderRows, renderMessageRow } from './ui/render.js';

const worker = new Worker(new URL('./worker/db-worker.js', import.meta.url), { type: 'module' });

const $ = (id) => document.getElementById(id);
const els = {
  appLoading: $('app-loading'),
  appLoadingText: $('app-loading-text'),
  appLoadingError: $('app-loading-error'),
  reload: $('app-reload'),
  search: $('search'),
  searchClear: $('search-clear'),
  accent: $('accent'),
  author: $('author'),
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
  body: $('results-body'),
  navFirst: $('nav-first'),
  navPrev: $('nav-prev'),
  navNext: $('nav-next'),
  navLast: $('nav-last'),
  pageInfo: $('page-info'),
  fetchStat: $('fetch-stat')
};

const state = {
  // filters / view
  search: '',
  accentSensitive: false,
  authorId: null,
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

// --- worker messaging -------------------------------------------------------

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
    default:
      break;
  }
};

worker.onerror = (e) => {
  showInitError(`A háttérfolyamat hibát jelzett: ${e.message || 'ismeretlen hiba'}`);
};

function buildViewParams() {
  return {
    search: state.search,
    accentSensitive: state.accentSensitive,
    authorId: state.authorId,
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
    sort: state.sort,
    pageSize: state.pageSize
  };
}

function send(direction) {
  let cursor = null;
  if (direction === 'next') cursor = state.lastKey;
  else if (direction === 'prev') cursor = state.firstKey;

  state.reqId += 1;
  state.pendingDirection = direction;
  setLoading(true);
  worker.postMessage({
    type: 'query',
    reqId: state.reqId,
    view: buildViewParams(),
    nav: { direction, cursor },
    wantCount: direction === 'first'
  });
}

// --- state transitions ------------------------------------------------------

function onReady(msg) {
  state.ready = true;
  populateAuthors(msg.authors);
  setupDateBounds(msg.meta);
  els.appLoading.hidden = true;
  setControlsDisabled(false);
  send('first');
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

function setLoading(isLoading) {
  state.loading = isLoading;
  els.tableWrap.setAttribute('aria-busy', String(isLoading));
  els.loadingStatus.textContent = isLoading ? 'Betöltés…' : '';
  if (isLoading) {
    for (const b of [els.navFirst, els.navPrev, els.navNext, els.navLast]) b.disabled = true;
  } else {
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

function populateAuthors(authors) {
  // Clear the placeholder option from index.html so "Minden szerző" is not doubled.
  els.author.replaceChildren();
  const frag = document.createDocumentFragment();
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'Minden szerző';
  frag.append(all);
  for (const a of authors) {
    const opt = document.createElement('option');
    opt.value = String(a.authorId);
    opt.textContent = `${a.authorname} (${formatCount(a.post_count)})`;
    frag.append(opt);
  }
  els.author.append(frag);
}

function setupDateBounds(meta) {
  const min = unixToDateInput(meta.min_time);
  const max = unixToDateInput(meta.max_time);
  els.dateFrom.min = min;
  els.dateFrom.max = max;
  els.dateTo.min = min;
  els.dateTo.max = max;
}

function setControlsDisabled(disabled) {
  for (const key of ['search', 'accent', 'author', 'dateFrom', 'dateTo', 'sort', 'pageSize', 'filtersClear', 'searchClear']) {
    els[key].disabled = disabled;
  }
}

// --- reading controls into state --------------------------------------------

function readFiltersAndReload() {
  state.authorId = els.author.value ? Number(els.author.value) : null;
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
els.author.addEventListener('change', readFiltersAndReload);
els.dateFrom.addEventListener('change', readFiltersAndReload);
els.dateTo.addEventListener('change', readFiltersAndReload);
els.sort.addEventListener('change', readFiltersAndReload);
els.pageSize.addEventListener('change', readFiltersAndReload);

els.filtersClear.addEventListener('click', () => {
  els.search.value = '';
  els.searchClear.hidden = true;
  els.accent.checked = false;
  els.author.value = '';
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

setControlsDisabled(true);
