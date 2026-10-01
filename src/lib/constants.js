// Pure, environment-independent constants shared by the browser app and the
// Node test suite. Nothing here touches import.meta.env or the DOM.

export const FEED_PAGE_SIZES = [50, 100, 250];
export const DEFAULT_PAGE_SIZE = 50;

// Sort modes understood by the query layer.
export const SORTS = {
  DATE_DESC: 'date_desc', // newest first (default feed)
  DATE_ASC: 'date_asc', // oldest first
  AUTHOR: 'author' // author A→Z (Hungarian), newest first within an author
};

// The two FTS5 indexes built by SQLite-converter.R.
export const FTS_TABLE = {
  sensitive: 'posts_fts', // unicode61 remove_diacritics 0 (kör != kor)
  folded: 'posts_fts_folded' // unicode61 remove_diacritics 2 (kör == kor == kór)
};

// HTTP range VFS tuning ------------------------------------------------------
// Caching/fetch granularity: 32 KiB, a multiple of the SQLite page size (2 pages
// at the 16 KiB build, 8 at 4 KiB), so a page read never straddles a block
// boundary. The actual page size comes from the manifest, not from this value.
export const BLOCK_SIZE = 32 * 1024;

// Bytes fetched eagerly when the database is opened. VACUUM INTO (section 14 of
// the converter) places the b-tree roots, archive_meta and sqlite_stat* at the
// very start of the file, so this one request makes schema parsing and the
// first metadata reads hit the cache instead of the network.
export const PREFETCH_BYTES = 256 * 1024;

// Upper bound on the in-worker block cache. The data is immutable, so evicted
// blocks can always be refetched; eviction is plain LRU.
export const MAX_CACHE_BYTES = 96 * 1024 * 1024;

// SQLite's own page cache, in KiB (negative value => KiB in PRAGMA cache_size).
export const SQLITE_CACHE_KIB = 16 * 1024;

// Best-effort multi-range hydration prefetch: before the (synchronous) hydrate,
// batch-fetch the b-tree leaf/overflow pages for the page's rows in ~tree-depth
// multipart/byteranges requests instead of one serialized read per scattered row.
// Purely an optimization — the synchronous VFS still backs every read.
// Disabled: in-browser it regressed latency. A multi-range Range header is not
// CORS-safelisted (unlike a single bytes=X-Y range), so each request adds a CORS
// preflight, and Cloudflare's multi-range assembly for cold/scattered ranges is
// slow in practice — so the prefetch kept hitting the budget below and only added
// delay. The implementation is kept (and tested) for future investigation.
export const MULTIRANGE_PREFETCH = false;

// Upper bound on time spent in the prefetch before falling back to synchronous
// reads, so a slow or stuck multi-range request can never add more than this.
export const PREFETCH_BUDGET_MS = 4000;
