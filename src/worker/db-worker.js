// The database Web Worker. ALL SQLite work happens here — initialization, VFS
// installation, the synchronous network-backed reads, and SQL execution — so the
// UI thread is never blocked. The worker exposes a tiny message protocol:
//
//   main -> worker : { type:'query', reqId, view, nav, wantCount }
//   worker -> main : { type:'ready', meta, authors }
//                    { type:'init-error', message, kind }
//                    { type:'result', reqId, rows, pagination, count?, fetchedBytes }
//                    { type:'error', reqId, message, kind? }

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

import {
  MANIFEST_URL,
  DATABASE_BASE_URL,
  FTS_TABLE,
  SORTS,
  FEED_PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  SQLITE_CACHE_KIB
} from '../config.js';
import { PartMap } from '../lib/parts.js';
import { installRangeVfs } from '../lib/http-vfs.js';
import { buildFtsMatch } from '../lib/fts-query.js';
import { parseImages, parseLinks } from '../lib/sanitize.js';
import * as Q from '../lib/queries.js';
import { bucketByMonth, monthTotals } from '../lib/monthly.js';
import { prefetchHydrationPages } from '../lib/btree.js';
import { makeMultiRangeFetcher } from './multirange.js';
import { BLOCK_SIZE, MULTIRANGE_PREFETCH, PREFETCH_BUDGET_MS } from '../lib/constants.js';

let db = null;
let vfs = null;
let meta = null;
let authors = null;
let authorsById = null;
let ready = false;
// Set once the database is open; used by the multi-range hydration prefetch.
let rootPage = 0;
let usableSize = 0;
let pageSize = 0;
let fileSize = 0;
let fetchBlocks = null;
let mrBytesTotal = 0;
// Per-session cache of each month's smallest id, for the Elemzés histogram.
let monthBounds = null;
// Boundaries shipped in the manifest (MANIFEST_FORMAT >= 2), when present — lets us
// skip the one-time time-index scan entirely.
let manifestMonthBounds = null;

const VALID_SORTS = new Set([SORTS.DATE_DESC, SORTS.DATE_ASC, SORTS.AUTHOR]);

function clampPageSize(n) {
  return FEED_PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
}

function resolveView(raw) {
  const match = raw.search ? buildFtsMatch(raw.search) : '';
  const view = {
    dateFrom: Number.isFinite(raw.dateFrom) ? raw.dateFrom : null,
    dateTo: Number.isFinite(raw.dateTo) ? raw.dateTo : null,
    authorIds: Array.isArray(raw.authorIds)
      ? [...new Set(raw.authorIds.filter((n) => Number.isFinite(n)))]
      : [],
    match: match === '' ? null : match,
    ftsTable: raw.accentSensitive ? FTS_TABLE.sensitive : FTS_TABLE.folded,
    sort: VALID_SORTS.has(raw.sort) ? raw.sort : SORTS.DATE_DESC,
    pageSize: clampPageSize(raw.pageSize)
  };
  const bounds = Q.resolveIdBounds(db, view.dateFrom, view.dateTo, meta);
  view.idLo = bounds.idLo;
  view.idHi = bounds.idHi;
  return view;
}

function toDisplayRow(r) {
  return {
    id: r.id,
    postId: r.postId,
    authorId: r.authorId,
    authorname: (authorsById.get(r.authorId) || {}).authorname || '',
    url: r.url,
    time: r.time,
    text: r.text,
    images: parseImages(r.images),
    links: parseLinks(r.links)
  };
}

async function init() {
  try {
    const resp = await fetch(MANIFEST_URL);
    if (!resp.ok) throw new Error(`Nem sikerült letölteni az adatbázis-leírót (HTTP ${resp.status}).`);
    const manifest = await resp.json();
    if (manifest.schemaVersion !== 2) {
      throw new Error(`Nem támogatott adatbázis-sémaverzió: ${manifest.schemaVersion}.`);
    }
    if (Array.isArray(manifest.monthBounds)) {
      manifestMonthBounds = manifest.monthBounds.map((m) => ({ ym: m.ym, lo: Number(m.lo) }));
    }

    const partMap = new PartMap(manifest);
    const partsBaseUrl = new URL(manifest.base, DATABASE_BASE_URL).href;
    const { makeXhrReader } = await import('./transport-xhr.js');
    const reader = makeXhrReader(partMap, partsBaseUrl);

    const sqlite3 = await sqlite3InitModule();
    vfs = installRangeVfs(sqlite3, {
      vfsName: 'http-range',
      fileSize: manifest.size,
      read: reader
    });

    db = new sqlite3.oo1.DB('/archive.sqlite', 'r', 'http-range');
    db.exec('PRAGMA temp_store=MEMORY');
    db.exec(`PRAGMA cache_size=-${SQLITE_CACHE_KIB}`);

    // Wiring for the best-effort multi-range hydration prefetch.
    pageSize = manifest.pageSize;
    fileSize = manifest.size;
    rootPage = Number(db.selectValue("SELECT rootpage FROM sqlite_schema WHERE name='posts'"));
    const header = new Uint8Array(100);
    vfs.cache.readInto(header, 0, 100);
    usableSize = pageSize - header[20]; // reserved bytes per page (byte 20 of the file header)
    fetchBlocks = makeMultiRangeFetcher({
      partMap,
      partsBaseUrl,
      fileSize,
      blockSize: BLOCK_SIZE,
      store: (bi, bytes) => {
        mrBytesTotal += bytes.byteLength;
        vfs.cache.store(bi, bytes);
      }
    });

    meta = Q.readMeta(db);
    authors = Q.readAuthors(db);
    authorsById = new Map(authors.map((a) => [a.authorId, a]));
    ready = true;

    self.postMessage({ type: 'ready', meta, authors });
  } catch (err) {
    self.postMessage({
      type: 'init-error',
      kind: err && err.kind,
      message: (err && err.message) || String(err)
    });
  }
}

self.onmessage = (event) => {
  const msg = event.data;
  if (!msg) return;
  if (msg.type === 'query') return void handleQuery(msg);
  if (msg.type === 'monthly') return void handleMonthly(msg);
  if (msg.type === 'prepare-monthly') return void handlePrepareMonthly();
};

async function handleQuery(msg) {
  if (!ready) {
    self.postMessage({ type: 'error', reqId: msg.reqId, message: 'Az adatbázis még nem áll készen.' });
    return;
  }

  try {
    vfs.clearLastError();
    const beforeBytes = vfs.getStats().bytesFetched;
    const beforeMr = mrBytesTotal;
    const view = resolveView(msg.view);
    const page = Q.scanPage(db, view, msg.nav);

    // Best-effort: batch-fetch the hydrate pages in ~tree-depth multi-range
    // requests so the synchronous hydrate below is (mostly) cache hits. Any
    // failure falls back to the normal per-page synchronous reads.
    if (MULTIRANGE_PREFETCH && fetchBlocks && page.ids.length > 0) {
      try {
        // Race a budget so a slow multi-range request can never add more than
        // PREFETCH_BUDGET_MS before we fall back to synchronous reads.
        await Promise.race([
          prefetchHydrationPages({
            cache: vfs.cache,
            fetchBlocks,
            rootPage,
            rowids: page.ids,
            pageSize,
            usableSize,
            fileSize,
            blockSize: BLOCK_SIZE
          }),
          new Promise((resolve) => setTimeout(resolve, PREFETCH_BUDGET_MS))
        ]);
      } catch {
        // ignore — the synchronous VFS still backs every read
      }
    }

    const rows = Q.hydrateIds(db, page.ids);
    const payload = {
      type: 'result',
      reqId: msg.reqId,
      rows: rows.map(toDisplayRow),
      pagination: {
        hasPrev: page.hasPrev,
        hasNext: page.hasNext,
        firstKey: page.firstKey,
        lastKey: page.lastKey
      },
      fetchedBytes: vfs.getStats().bytesFetched - beforeBytes + (mrBytesTotal - beforeMr)
    };
    if (msg.wantCount) payload.count = Q.countView(db, view, meta, authorsById);
    self.postMessage(payload);
  } catch (err) {
    const vfsErr = vfs && vfs.getLastError();
    self.postMessage({
      type: 'error',
      reqId: msg.reqId,
      kind: (vfsErr && vfsErr.kind) || (err && err.kind),
      message: (vfsErr && vfsErr.message) || (err && err.message) || String(err)
    });
  }
}

// Month boundaries come from the manifest when present (MANIFEST_FORMAT >= 2);
// otherwise fall back to a one-time covering-index scan of the time index. Cached
// for the session either way.
function ensureMonthBounds() {
  if (!monthBounds) monthBounds = manifestMonthBounds || Q.monthBoundaries(db);
  return monthBounds;
}

// Warm the month boundaries when the Elemzés tab is opened, so the first search
// doesn't pay for the (fallback) scan.
function handlePrepareMonthly() {
  if (!ready || monthBounds) return;
  try {
    ensureMonthBounds();
  } catch {
    // Non-fatal: the next monthly request retries and surfaces any real error.
  }
}

// Monthly post-count histogram for a search: bucket the matching FTS rowids into
// months via the cached boundaries (see src/lib/monthly.js). Only the FTS index
// (and, once per session, the time index) is read — never the posts rows.
function handleMonthly(msg) {
  if (!ready) {
    self.postMessage({ type: 'monthly-error', reqId: msg.reqId, message: 'Az adatbázis még nem áll készen.' });
    return;
  }
  try {
    vfs.clearLastError();
    const beforeBytes = vfs.getStats().bytesFetched;
    ensureMonthBounds();
    // Per-month totals come free from the boundaries (ids are contiguous in time
    // order), so the ratio view needs no extra query — see src/lib/monthly.js.
    const totals = monthTotals(monthBounds, meta.max_id);
    const ftsTable = msg.accentSensitive ? FTS_TABLE.sensitive : FTS_TABLE.folded;
    const searches = Array.isArray(msg.searches) ? msg.searches : [];

    // One series per phrase. Boundaries + totals are computed once above; each
    // phrase is then just a compact FTS doclist scan plus in-memory bucketing.
    const series = searches.map(({ id, phrase }) => {
      const match = phrase ? buildFtsMatch(phrase) : '';
      if (match === '') {
        return { id, phrase, matchEmpty: true, matchCount: 0, points: [] };
      }
      const ids = Q.matchRowidsAsc(db, ftsTable, match);
      const points = bucketByMonth(ids, monthBounds).map((p, i) => ({ ym: p.ym, n: p.n, total: totals[i] }));
      return { id, phrase, matchEmpty: false, matchCount: ids.length, points };
    });

    self.postMessage({
      type: 'monthly-result',
      reqId: msg.reqId,
      series,
      fetchedBytes: vfs.getStats().bytesFetched - beforeBytes
    });
  } catch (err) {
    const vfsErr = vfs && vfs.getLastError();
    self.postMessage({
      type: 'monthly-error',
      reqId: msg.reqId,
      kind: (vfsErr && vfsErr.kind) || (err && err.kind),
      message: (vfsErr && vfsErr.message) || (err && err.message) || String(err)
    });
  }
}

init();
