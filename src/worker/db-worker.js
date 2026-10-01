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

let db = null;
let vfs = null;
let meta = null;
let authors = null;
let authorsById = null;
let ready = false;

const VALID_SORTS = new Set([SORTS.DATE_DESC, SORTS.DATE_ASC, SORTS.AUTHOR]);

function clampPageSize(n) {
  return FEED_PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
}

function resolveView(raw) {
  const match = raw.search ? buildFtsMatch(raw.search) : '';
  const view = {
    dateFrom: Number.isFinite(raw.dateFrom) ? raw.dateFrom : null,
    dateTo: Number.isFinite(raw.dateTo) ? raw.dateTo : null,
    authorId: Number.isFinite(raw.authorId) ? raw.authorId : null,
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
  if (!msg || msg.type !== 'query') return;

  if (!ready) {
    self.postMessage({ type: 'error', reqId: msg.reqId, message: 'Az adatbázis még nem áll készen.' });
    return;
  }

  try {
    vfs.clearLastError();
    const before = vfs.getStats().bytesFetched;
    const view = resolveView(msg.view);
    const page = Q.fetchPage(db, view, msg.nav);
    const payload = {
      type: 'result',
      reqId: msg.reqId,
      rows: page.rows.map(toDisplayRow),
      pagination: {
        hasPrev: page.hasPrev,
        hasNext: page.hasNext,
        firstKey: page.firstKey,
        lastKey: page.lastKey
      },
      fetchedBytes: vfs.getStats().bytesFetched - before
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
};

init();
