// End-to-end test of the real @sqlite.org/sqlite-wasm + the custom range VFS +
// the query layer, against the full production database. The VFS reads from the
// local part files (simulating HTTP range requests with fs.readSync), so this
// exercises exactly the browser code path except for the literal network call.
//
// Skips gracefully when the local database parts are not present (e.g. in CI),
// so `npm test` always passes; run it locally after building the archive.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(ROOT, 'latest.json');

function dataAvailable() {
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const ok = manifest.parts.every((p) => fs.existsSync(path.join(ROOT, manifest.base, p.name)));
    return ok ? manifest : null;
  } catch {
    return null;
  }
}

const manifest = dataAvailable();

if (!manifest) {
  test('VFS + queries e2e', { skip: 'local database parts not present (see README: reconstruct the archive)' }, () => {});
} else {
  const { default: sqlite3InitModule } = await import('@sqlite.org/sqlite-wasm');
  const { PartMap } = await import('../src/lib/parts.js');
  const { installRangeVfs } = await import('../src/lib/http-vfs.js');
  const Q = await import('../src/lib/queries.js');
  const { buildFtsMatch } = await import('../src/lib/fts-query.js');
  const { SORTS, FTS_TABLE } = await import('../src/lib/constants.js');

  const partsDir = path.join(ROOT, manifest.base);
  const partMap = new PartMap(manifest);

  const fds = new Map();
  const reader = (offset, length) => {
    const out = new Uint8Array(length);
    for (const s of partMap.slices(offset, length)) {
      if (!fds.has(s.name)) fds.set(s.name, fs.openSync(path.join(partsDir, s.name), 'r'));
      const buf = Buffer.alloc(s.length);
      let read = 0;
      while (read < s.length) {
        const n = fs.readSync(fds.get(s.name), buf, read, s.length - read, s.partStart + read);
        if (n === 0) break;
        read += n;
      }
      out.set(buf.subarray(0, read), s.bufOffset);
    }
    return out;
  };

  const sqlite3 = await sqlite3InitModule();
  const vfs = installRangeVfs(sqlite3, { vfsName: 'http-range-test', fileSize: manifest.size, read: reader });
  const db = new sqlite3.oo1.DB('/archive.sqlite', 'r', 'http-range-test');
  db.exec('PRAGMA temp_store=MEMORY');
  db.exec('PRAGMA cache_size=-16384');

  const meta = Q.readMeta(db);
  const authors = Q.readAuthors(db);
  const authorsById = new Map(authors.map((a) => [a.authorId, a]));

  const baseView = (over = {}) => {
    const v = {
      dateFrom: null, dateTo: null, authorIds: [], match: null,
      ftsTable: FTS_TABLE.folded, sort: SORTS.DATE_DESC, pageSize: 50,
      idLo: meta.min_id, idHi: meta.max_id + 1,
      ...over
    };
    const b = Q.resolveIdBounds(db, v.dateFrom, v.dateTo, meta);
    v.idLo = b.idLo;
    v.idHi = b.idHi;
    return v;
  };

  const walk = (v, pages) => {
    let cursor = null;
    let dir = 'first';
    let ids = [];
    for (let i = 0; i < pages; i++) {
      const p = Q.fetchPage(db, v, { direction: dir, cursor });
      ids = ids.concat(p.rows.map((r) => r.id));
      cursor = p.lastKey;
      dir = 'next';
      if (!p.hasNext) break;
    }
    return ids;
  };

  test('opening the database does not download it all', () => {
    // After open + reading meta/authors, only a tiny prefetch has been fetched.
    assert.ok(vfs.getStats().bytesFetched < 2 * 1024 * 1024, `fetched ${vfs.getStats().bytesFetched} bytes on open`);
  });

  test('metadata and authors match the known archive', () => {
    assert.equal(meta.post_count, 654375);
    assert.equal(meta.min_id, 1);
    assert.equal(meta.max_id, 654375);
    assert.equal(authors.length, 106);
    assert.equal(authors[0].authorname, 'Áder János');
  });

  test('default feed returns one full page, newest first', () => {
    const p = Q.fetchPage(db, baseView(), { direction: 'first', cursor: null });
    assert.equal(p.rows.length, 50);
    assert.equal(p.hasPrev, false);
    assert.equal(p.hasNext, true);
    assert.equal(p.rows[0].id, meta.max_id);
    // strictly decreasing ids (time order)
    for (let i = 1; i < p.rows.length; i++) assert.ok(p.rows[i].id < p.rows[i - 1].id);
  });

  test('keyset pagination (date) equals the OFFSET reference', () => {
    const got = walk(baseView(), 5);
    const ref = db.selectObjects('SELECT id FROM posts ORDER BY time DESC, id DESC LIMIT 250').map((r) => Number(r.id));
    assert.deepEqual(got, ref);
  });

  test('prev after next returns to the original page', () => {
    const v = baseView();
    const p1 = Q.fetchPage(db, v, { direction: 'first', cursor: null });
    const p2 = Q.fetchPage(db, v, { direction: 'next', cursor: p1.lastKey });
    const back = Q.fetchPage(db, v, { direction: 'prev', cursor: p2.firstKey });
    assert.deepEqual(back.rows.map((r) => r.id), p1.rows.map((r) => r.id));
  });

  test('oldest (last) page reaches the earliest posts', () => {
    const p = Q.fetchPage(db, baseView(), { direction: 'last', cursor: null });
    assert.equal(p.hasNext, false);
    assert.equal(p.rows.at(-1).id, meta.min_id);
    assert.equal(p.rows.at(-1).time, meta.min_time);
  });

  test('author sort keyset equals the OFFSET reference', () => {
    const got = walk(baseView({ sort: SORTS.AUTHOR }), 4);
    const ref = db
      .selectObjects('SELECT id FROM posts INDEXED BY idx_posts_author_time ORDER BY authorId, time DESC, id DESC LIMIT 200')
      .map((r) => Number(r.id));
    assert.deepEqual(got, ref);
  });

  test('author filter uses the precomputed count and returns only that author', () => {
    const author = authors[4];
    const v = baseView({ authorIds: [author.authorId] });
    assert.equal(Q.countView(db, v, meta, authorsById), author.post_count);
    const p = Q.fetchPage(db, v, { direction: 'first', cursor: null });
    assert.ok(p.rows.every((r) => r.authorId === author.authorId));
  });

  test('multi-author OR (date sort): count is the sum, keyset matches an OFFSET reference', () => {
    const ids = [authors[2].authorId, authors[4].authorId, authors[6].authorId];
    const set = new Set(ids);
    const v = baseView({ authorIds: ids });
    const expectedCount = ids.reduce((sum, id) => sum + authorsById.get(id).post_count, 0);
    assert.equal(Q.countView(db, v, meta, authorsById), expectedCount);

    const p = Q.fetchPage(db, v, { direction: 'first', cursor: null });
    assert.ok(p.rows.every((r) => set.has(r.authorId)));

    const placeholders = ids.map(() => '?').join(',');
    const ref = db
      .selectObjects(`SELECT id FROM posts WHERE authorId IN (${placeholders}) ORDER BY time DESC, id DESC LIMIT 200`, ids)
      .map((r) => Number(r.id));
    assert.deepEqual(walk(v, 4), ref);
  });

  test('multi-author OR (author sort): keyset matches an OFFSET reference', () => {
    const ids = [authors[2].authorId, authors[4].authorId, authors[6].authorId];
    const v = baseView({ authorIds: ids, sort: SORTS.AUTHOR });
    const placeholders = ids.map(() => '?').join(',');
    const ref = db
      .selectObjects(
        `SELECT id FROM posts INDEXED BY idx_posts_author_time WHERE authorId IN (${placeholders}) ORDER BY authorId, time DESC, id DESC LIMIT 200`,
        ids
      )
      .map((r) => Number(r.id));
    assert.deepEqual(walk(v, 4), ref);
  });

  test('date range count equals the rowid window width', () => {
    const from = Math.floor(Date.UTC(2020, 0, 1) / 1000);
    const to = Math.floor(Date.UTC(2021, 0, 1) / 1000);
    const v = baseView({ dateFrom: from, dateTo: to });
    assert.equal(Q.countView(db, v, meta, authorsById), v.idHi - v.idLo);
    const p = Q.fetchPage(db, v, { direction: 'first', cursor: null });
    assert.ok(p.rows.every((r) => r.time >= from && r.time < to));
  });

  test('diacritic-folded vs sensitive search differ as expected', () => {
    const folded = baseView({ match: buildFtsMatch('kormány'), ftsTable: FTS_TABLE.folded });
    const sensitive = baseView({ match: buildFtsMatch('kormány'), ftsTable: FTS_TABLE.sensitive });
    assert.equal(Q.countView(db, folded, meta, authorsById), 54608);
    assert.equal(Q.countView(db, sensitive, meta, authorsById), 52622);
  });

  test('combined search + author stays efficient (bounded fetch)', () => {
    const before = vfs.getStats().bytesFetched;
    const v = baseView({ match: buildFtsMatch('kormány'), authorIds: [authors[4].authorId, authors[2].authorId] });
    Q.countView(db, v, meta, authorsById);
    Q.fetchPage(db, v, { direction: 'first', cursor: null });
    const fetched = vfs.getStats().bytesFetched - before;
    assert.ok(fetched < 20 * 1024 * 1024, `search+author fetched ${(fetched / 1048576).toFixed(1)} MB`);
  });

  test('hydrated rows carry embedded images and links', () => {
    const row = db.selectObject(
      "SELECT id FROM posts WHERE images IS NOT NULL AND links IS NOT NULL ORDER BY id DESC LIMIT 1"
    );
    const p = Q.fetchPage(db, baseView({ pageSize: 50 }), { direction: 'first', cursor: null });
    // The newest page should include at least one post with images or links.
    assert.ok(p.rows.some((r) => r.images || r.links));
    assert.ok(Number(row.id) > 0);
  });

  test('malformed / tricky FTS input never throws', () => {
    for (const input of ['a(b)c', 'x" OR "1"="1', '***', '"', 'NEAR(x y)', 'foo:bar^2', 'alma -körte', 'inflác*']) {
      const match = buildFtsMatch(input);
      if (!match) continue;
      const v = baseView({ match });
      assert.doesNotThrow(() => Q.countView(db, v, meta, authorsById), `threw for input ${JSON.stringify(input)}`);
    }
  });

  test('total fetched to exercise every feature stays far below the DB size', () => {
    assert.ok(
      vfs.getStats().bytesFetched < 80 * 1024 * 1024,
      `total fetched ${(vfs.getStats().bytesFetched / 1048576).toFixed(1)} MB of ${(manifest.size / 1048576).toFixed(0)} MB`
    );
  });
}
