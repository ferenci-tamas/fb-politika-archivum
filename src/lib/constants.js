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
// Caching/fetch granularity. A multiple of the 4096-byte SQLite page size so a
// page read never straddles a block boundary unnecessarily. 32 KiB = 8 pages.
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
