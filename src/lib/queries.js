// Centralized, read-only data access for the archive. Every SQL statement lives
// here (nothing is scattered through the UI), and every statement uses bound
// parameters (?) — no user input is ever concatenated into SQL. The query plans
// were validated with EXPLAIN QUERY PLAN against the full 654k-row database; the
// comments note which index each path relies on and why no TEMP B-TREE sort is
// needed.
//
// The caller (the Web Worker) passes an oo1 DB handle. All functions are pure
// with respect to that handle: they prepare, bind, run and finalize statements
// via db.selectObjects()/selectValue().

import { SORTS, FTS_TABLE } from './constants.js';

const HYDRATE_COLUMNS = 'id, postId, authorId, url, time, text, images, links';

/** Read archive_meta into a plain object with numeric values. */
export function readMeta(db) {
  const rows = db.selectObjects('SELECT key, value FROM archive_meta');
  const meta = {};
  for (const r of rows) meta[r.key] = Number(r.value);
  return meta;
}

/** Read the (small) authors table, already in Hungarian alphabetical order. */
export function readAuthors(db) {
  return db.selectObjects(
    'SELECT authorId, authorname, post_count, first_time, last_time FROM authors ORDER BY authorId'
  );
}

// --- date <-> rowid bounds --------------------------------------------------
// ids are 1..N in (time, postId) order, so a time becomes a rowid bound with a
// single covering-index seek. Used for O(1) counts and for the FTS rowid window.

function firstIdWithTimeGte(db, t, meta) {
  const id = db.selectValue(
    'SELECT rowid FROM posts WHERE time >= ? ORDER BY time, rowid LIMIT 1',
    [t]
  );
  return id == null ? meta.max_id + 1 : Number(id);
}

export function resolveIdBounds(db, dateFrom, dateTo, meta) {
  const idLo = dateFrom == null ? meta.min_id : firstIdWithTimeGte(db, dateFrom, meta);
  const idHi = dateTo == null ? meta.max_id + 1 : firstIdWithTimeGte(db, dateTo, meta);
  return { idLo, idHi: Math.max(idHi, idLo) };
}

// --- shared predicate pieces ------------------------------------------------

function ftsTableName(view) {
  const name = view.ftsTable;
  // Defense in depth: the FTS table name is never user input, but constrain it
  // to the known-good set so it can never become an injection vector.
  if (name !== FTS_TABLE.sensitive && name !== FTS_TABLE.folded) {
    throw new Error(`Unknown FTS table: ${name}`);
  }
  return name;
}

// Force the right index on posts-driven queries. Without this, the planner can
// decide to drive from the full-text subquery and probe posts by rowid once per
// match — tens of thousands of scattered page reads for a common term combined
// with an author. The hint makes the author equality (or the time range) drive
// the scan and turns the match subquery into a bloom filter.
function postsIndexHint(view) {
  return view.authorIds && view.authorIds.length
    ? 'INDEXED BY idx_posts_author_time'
    : 'INDEXED BY idx_posts_time';
}

/** base filter on posts: date (as time bounds), author, and full-text match. */
function basePostsPredicate(view, { includeAuthor = true } = {}) {
  const parts = [];
  const binds = [];
  if (view.dateFrom != null) {
    parts.push('time >= ?');
    binds.push(view.dateFrom);
  }
  if (view.dateTo != null) {
    parts.push('time < ?');
    binds.push(view.dateTo);
  }
  if (includeAuthor && view.authorIds && view.authorIds.length) {
    // OR over the selected authors.
    parts.push(`authorId IN (${view.authorIds.map(() => '?').join(', ')})`);
    binds.push(...view.authorIds);
  }
  if (view.match != null) {
    parts.push(`id IN (SELECT rowid FROM ${ftsTableName(view)} WHERE ${ftsTableName(view)} MATCH ?)`);
    binds.push(view.match);
  }
  return { parts, binds };
}

// --- counts (cheap in every combination) ------------------------------------

export function countView(db, view, meta, authorsById) {
  if (view.idLo >= view.idHi) return 0;
  const authorIds = view.authorIds || [];

  if (view.match != null) {
    if (authorIds.length === 0) {
      // FTS doclist count with a rowid (date) window — ~1ms even for common terms.
      return Number(
        db.selectValue(
          `SELECT count(*) FROM ${ftsTableName(view)} WHERE ${ftsTableName(view)} MATCH ? AND rowid >= ? AND rowid < ?`,
          [view.match, view.idLo, view.idHi]
        )
      );
    }
    const { parts, binds } = basePostsPredicate(view);
    return Number(
      db.selectValue(`SELECT count(*) FROM posts ${postsIndexHint(view)} WHERE ${parts.join(' AND ')}`, binds)
    );
  }

  if (authorIds.length > 0) {
    const fullRange = view.dateFrom == null && view.dateTo == null;
    if (fullRange && authorsById) {
      // OR over authors: the total is the sum of their precomputed post counts.
      return authorIds.reduce((sum, id) => sum + ((authorsById.get(id) || {}).post_count || 0), 0);
    }
    const { parts, binds } = basePostsPredicate(view);
    return Number(
      db.selectValue(`SELECT count(*) FROM posts ${postsIndexHint(view)} WHERE ${parts.join(' AND ')}`, binds)
    );
  }

  // No author, no search: ids are contiguous in time order, so the count is just
  // the width of the rowid window — no query needed.
  return view.idHi - view.idLo;
}

// --- page scans (return ordered key lists, never full rows) ------------------

function scanDateFtsDirect(db, view, descending, boundary, limit) {
  const fts = ftsTableName(view);
  const parts = [`${fts} MATCH ?`, 'rowid >= ?', 'rowid < ?'];
  const binds = [view.match, view.idLo, view.idHi];
  if (boundary) {
    parts.push(descending ? 'rowid < ?' : 'rowid > ?');
    binds.push(boundary.id);
  }
  binds.push(limit);
  const sql =
    `SELECT rowid AS id FROM ${fts} WHERE ${parts.join(' AND ')} ` +
    `ORDER BY rowid ${descending ? 'DESC' : 'ASC'} LIMIT ?`;
  return db.selectObjects(sql, binds).map((r) => ({ id: Number(r.id) }));
}

function scanDatePosts(db, view, descending, boundary, limit) {
  const { parts, binds } = basePostsPredicate(view);
  if (boundary) {
    if (descending) {
      parts.push('(time < ? OR (time = ? AND id < ?))');
    } else {
      parts.push('(time > ? OR (time = ? AND id > ?))');
    }
    binds.push(boundary.time, boundary.time, boundary.id);
  }
  binds.push(limit);
  const dir = descending ? 'DESC' : 'ASC';
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  const sql = `SELECT id, time FROM posts ${postsIndexHint(view)} ${where} ORDER BY time ${dir}, id ${dir} LIMIT ?`;
  return db.selectObjects(sql, binds).map((r) => ({ time: Number(r.time), id: Number(r.id) }));
}

function scanAuthor(db, view, scanDir, boundary, limit) {
  const backward = scanDir === 'backward';
  const out = [];

  const runPhase = (extraParts, extraBinds, orderBy, phaseLimit, includeAuthor) => {
    const { parts, binds } = basePostsPredicate(view, { includeAuthor });
    parts.push(...extraParts);
    binds.push(...extraBinds);
    binds.push(phaseLimit);
    const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
    // The INDEXED BY hint forces the covering index so the (authorId, time, id)
    // order is produced by the index itself — no TEMP B-TREE — even when a
    // full-text match subquery is also present (it becomes a bloom filter).
    const sql = `SELECT id, authorId, time FROM posts INDEXED BY idx_posts_author_time ${where} ORDER BY ${orderBy} LIMIT ?`;
    return db
      .selectObjects(sql, binds)
      .map((r) => ({ authorId: Number(r.authorId), time: Number(r.time), id: Number(r.id) }));
  };

  if (!boundary) {
    // The base author-set restriction (authorId IN …) keeps it to the selected
    // authors; the covering index already yields (authorId, time) order.
    const orderBy = backward ? 'authorId DESC, time ASC, id ASC' : 'authorId, time DESC, id DESC';
    return runPhase([], [], orderBy, limit, true);
  }

  const a = boundary.authorId;
  const t = boundary.time;
  const r = boundary.id;

  if (!backward) {
    // Rest of the current author (older) — authorId = a alone — then the
    // following selected authors (set restriction via the base IN).
    const p1 = runPhase(['authorId = ?', '(time < ? OR (time = ? AND id < ?))'], [a, t, t, r], 'time DESC, id DESC', limit, false);
    out.push(...p1);
    if (out.length < limit) {
      const p2 = runPhase(['authorId > ?'], [a], 'authorId, time DESC, id DESC', limit - out.length, true);
      out.push(...p2);
    }
  } else {
    // Rest of the current author (newer), then previous selected authors.
    const p1 = runPhase(['authorId = ?', '(time > ? OR (time = ? AND id > ?))'], [a, t, t, r], 'time ASC, id ASC', limit, false);
    out.push(...p1);
    if (out.length < limit) {
      const p2 = runPhase(['authorId < ?'], [a], 'authorId DESC, time ASC, id ASC', limit - out.length, true);
      out.push(...p2);
    }
  }
  return out;
}

function runScan(db, view, scanDir, boundary, limit) {
  if (view.sort === SORTS.AUTHOR) {
    return scanAuthor(db, view, scanDir, boundary, limit);
  }
  const descending = (view.sort === SORTS.DATE_DESC) === (scanDir === 'forward');
  if (view.match != null && !(view.authorIds && view.authorIds.length)) {
    return scanDateFtsDirect(db, view, descending, boundary, limit);
  }
  return scanDatePosts(db, view, descending, boundary, limit);
}

// --- hydration --------------------------------------------------------------
// One query fetches whole rows for the page's ids, including the embedded
// images/links JSON, so a 1:N page needs no join and no extra page fetches.

export function hydrateIds(db, ids) {
  if (ids.length === 0) return [];
  const rows = db.selectObjects(
    `SELECT ${HYDRATE_COLUMNS} FROM posts WHERE id IN (SELECT value FROM json_each(?))`,
    [JSON.stringify(ids)]
  );
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

// --- public page API --------------------------------------------------------

/**
 * Fetch one page.
 * @param {object} view resolved view (filters, sort, pageSize, idLo/idHi, ftsTable, match)
 * @param {{direction:'first'|'next'|'prev'|'last', cursor:(object|null)}} nav
 * @returns {{rows:object[], firstKey:object|null, lastKey:object|null, hasPrev:boolean, hasNext:boolean}}
 */
export function scanPage(db, view, nav) {
  const empty = { ids: [], firstKey: null, lastKey: null, hasPrev: false, hasNext: false };
  if (view.idLo >= view.idHi) return empty;

  const direction = nav.direction;
  const scanDir = direction === 'prev' || direction === 'last' ? 'backward' : 'forward';
  const boundary = direction === 'next' || direction === 'prev' ? nav.cursor : null;
  const limit = view.pageSize + 1;

  let keys = runScan(db, view, scanDir, boundary, limit);
  const extra = keys.length > view.pageSize;
  if (extra) keys = keys.slice(0, view.pageSize);
  if (scanDir === 'backward') keys.reverse(); // restore canonical display order

  let hasPrev;
  let hasNext;
  switch (direction) {
    case 'first':
      hasPrev = false;
      hasNext = extra;
      break;
    case 'next':
      hasPrev = true;
      hasNext = extra;
      break;
    case 'prev':
      hasNext = true;
      hasPrev = extra;
      break;
    case 'last':
      hasNext = false;
      hasPrev = extra;
      break;
    default:
      hasPrev = false;
      hasNext = false;
  }

  return {
    ids: keys.map((k) => k.id),
    firstKey: keys.length ? keys[0] : null,
    lastKey: keys.length ? keys[keys.length - 1] : null,
    hasPrev,
    hasNext
  };
}

// scanPage (index-only, returns ids + pagination) then hydrateIds (fetch rows).
// The worker runs the optional multi-range prefetch between the two.
export function fetchPage(db, view, nav) {
  const page = scanPage(db, view, nav);
  return {
    rows: hydrateIds(db, page.ids),
    firstKey: page.firstKey,
    lastKey: page.lastKey,
    hasPrev: page.hasPrev,
    hasNext: page.hasNext
  };
}
