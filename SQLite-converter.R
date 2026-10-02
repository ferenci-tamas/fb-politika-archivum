library(data.table)
library(DBI)
library(RSQLite)

###############################################################################
# 0. CONFIGURATION
###############################################################################

OUTPUT_FILE <- "archive.sqlite"

# Work files live next to OUTPUT_FILE and are removed at the end. An existing
# OUTPUT_FILE is only replaced once the new build has passed all checks.
STAGE_FILE <- paste0(OUTPUT_FILE, ".stage")
BUILD_FILE <- paste0(OUTPUT_FILE, ".build")
FTS_SCRATCH_FILE <- paste0(OUTPUT_FILE, ".fts-scratch")
COMPACT_FILE <- paste0(OUTPUT_FILE, ".compact")

# SQLite page size in bytes: a power of two from 512 to 65536 (SQLite silently
# ignores other values). A page is the smallest unit a client fetches over HTTP,
# so smaller pages waste less transfer per lookup, while larger ones need fewer
# requests for scans. The parts manifest (section 15) reads it back from the file
# header and the browser takes it from the manifest, so changing this needs no
# frontend change. 16384 makes the file ~5% smaller than 4096 while keeping the
# b-tree shallow (benchmarked: a minor but free win for this read-only archive).
PAGE_SIZE <- 16384L

# Full-text indexes over posts.text (external content: the text is stored only
# once). posts_fts keeps diacritics (kör != kor), posts_fts_folded removes them
# (kör == kor == kór) for searching without accents. Both fold case, also for
# non-ASCII letters (Ő == ő). The folded index roughly doubles the size of the
# full-text index; set BUILD_FOLDED_FTS to FALSE to skip it.
FTS_TOKENIZERS <- c(
  posts_fts = "unicode61 remove_diacritics 0",
  posts_fts_folded = "unicode61 remove_diacritics 2"
)
BUILD_FOLDED_FTS <- TRUE
if (!BUILD_FOLDED_FTS) FTS_TOKENIZERS <- FTS_TOKENIZERS["posts_fts"]
fts_definition <- function(tokenize) {
  sprintf("text, content='posts', content_rowid='id', tokenize='%s'", tokenize)
}

# The FTS5 structures must stay in on-disk format version 4.
FTS5_REQUIRED_VERSION <- 4L

# archive_meta 'schema_version'. 1: posts, links, images and authors, with
# clustered child rowids. 2: as 1, but the rowids of posts, links and images are
# an explicit column (id INTEGER PRIMARY KEY), and every post also carries its
# images and links as JSON (posts.images, posts.links), so one query hydrates a
# page.
SCHEMA_VERSION <- 2L

# "format" of the parts manifest (manifest.json and latest.json, section 15).
# It describes how the archive is split, not what is in it, so it is versioned
# independently of SCHEMA_VERSION. 2: builtAt, schemaVersion (archive_meta
# 'schema_version', so a client can reject an archive it cannot read before
# fetching any of it), file, and size and md5 of the whole archive, pageSize,
# partSize, monthBounds (an array of {ym, lo}: the smallest id in each year-month;
# ids are assigned in (time, postId) order, so these partition the archive by month
# exactly, letting the website bucket search hits per month without scanning the
# time index), and parts, an array of {name, offset, size, md5} for consecutive
# page-aligned byte ranges (each of partSize bytes except the last) that
# concatenate to the archive; latest.json adds base, the build folder relative
# to latest.json. A client treats monthBounds as optional (older format: scan).
MANIFEST_FORMAT <- 2L

# Diagnostics only. Use words that definitely occur in the data.
TEST_SEARCH_TERM <- "az"
TEST_DIACRITIC_TERMS <- c("kormány", "kormany")
TEST_LIMIT <- 100L

###############################################################################
# 1. INPUT
###############################################################################

toconvert <- readRDS("toconvert.rds")

posts <- toconvert$posts[, .(postId = as.character(postId), authorname = as.character(authorName), url = as.character(postUrl),
  time = round(as.numeric(as.POSIXct(toconvert$posts$time, tz = "UTC"))), text = as.character(text))][order(time, postId)]
links <- toconvert$links[, .(postId = as.character(postId), link = as.character(link), available = as.integer(available))][order(postId)]
images <- toconvert$media[media_type == "Photo" & !is.na(filename), .(postId = as.character(postId), filename = as.character(filename))][order(postId)]

rm(toconvert)

# Searched and displayed text is stored in Unicode NFC. Browsers send NFC, and a
# diacritic-sensitive index would not match a decomposed "o" + U+0308 to "ö".
# NFC is canonically equivalent, i.e. it renders identically. URLs and file
# names are kept byte-for-byte, as they must match external resources.
to_nfc <- function(x, label) {
  i <- which(!is.na(x) & !stringi::stri_trans_isnfc(x))
  cat(label, ": ", length(i), " values converted to NFC\n", sep = "")
  if (length(i)) x[i] <- stringi::stri_trans_nfc(x[i])
  x
}
posts[, text := to_nfc(text, "posts$text")]
posts[, authorname := to_nfc(stringi::stri_trim_both(authorname), "posts$authorname")]

###############################################################################
# 2. VALIDATION
###############################################################################

for (tbl in c("posts", "links", "images")) {
  if (anyNA(get(tbl)$postId)) stop(tbl, "$postId contains NA values.")
  if (any(trimws(get(tbl)$postId) == "")) stop(tbl, "$postId contains empty strings.")
}

# posts.postId is the primary key, so duplicates would abort the load anyway.
if (anyDuplicated(posts$postId)) {
  stop(uniqueN(posts$postId[duplicated(posts$postId)]), " postId values occur more than once.")
}

if (!is.numeric(posts$time)) stop("posts$time must be numeric UNIX timestamps.")
if (anyNA(posts$time)) stop("posts$time contains NA values.")

if (!all(links$available %in% c(0L, 1L))) stop("links$available must be 0 or 1.")

# The foreign keys reject child rows without a post, so they must be handled here.
orphan_links <- !links$postId %chin% posts$postId
orphan_images <- !images$postId %chin% posts$postId
if (any(orphan_links) || any(orphan_images)) {
  stop(sprintf("%d links and %d images refer to a postId that is not in posts.", sum(orphan_links), sum(orphan_images)))
}
rm(orphan_links, orphan_images)

# Reported, not fatal
n_missing <- function(x) sum(is.na(x) | !nzchar(x))
n_not_http <- function(x) sum(!is.na(x) & nzchar(x) & !grepl("^https?://", x, ignore.case = TRUE))
cat("posts$url missing: ", n_missing(posts$url), ", not http(s): ", n_not_http(posts$url), "\n", sep = "")
cat("links$link missing: ", n_missing(links$link), ", not http(s): ", n_not_http(links$link),
  ", availability unknown: ", sum(is.na(links$available)), "\n", sep = "")
cat("images$filename missing: ", n_missing(images$filename), ", containing path characters: ",
  sum(grepl("[/\\\\]|^\\.", images$filename)), "\n", sep = "")

cat("posts: ", nrow(posts), ", links: ", nrow(links), ", images: ", nrow(images), "\n", sep = "")
cat("time range (UTC):", format(as.POSIXct(range(posts$time), tz = "UTC")), "\n")

###############################################################################
# 3. AUTHORS
#
# authorId is the position of the name in Hungarian alphabetical order. The
# radix sort first puts the names in byte order, so names that collate as equal
# are numbered the same way regardless of the R locale.
###############################################################################

author_names <- sort(unique(posts$authorname), method = "radix")
author_names <- author_names[order(stringi::stri_rank(author_names, locale = "hu_HU"), seq_along(author_names))]
authors <- data.table(authorname = author_names)
authors[, authorId := .I]
rm(author_names)

posts[, authorId := match(authorname, authors$authorname)]
posts <- posts[, .(postId, authorId, url, time, text)]
authors <- merge(authors, posts[, .(post_count = .N, first_time = min(time), last_time = max(time)), .(authorId)], by = "authorId")
cat("authors: ", nrow(authors), " (including ", sum(is.na(authors$authorname)), " unknown-author row)\n", sep = "")

###############################################################################
# 4. CHILD-ROW STRIDES
#
# Links/images of the post with rowid r get rowids [r * stride, (r + 1) * stride).
###############################################################################

next_pow2 <- function(n) as.integer(2^ceiling(log2(max(2, n))))
max_per_post <- function(d) if (nrow(d) == 0) 0L else max(d[, .N, by = postId]$N)

link_stride <- next_pow2(max_per_post(links) + 1)
image_stride <- next_pow2(max_per_post(images) + 1)
cat("link stride: ", link_stride, ", image stride: ", image_stride, "\n", sep = "")

if (max(link_stride, image_stride) > 65536) stop("A post has too many links/images for the clustered layout.")
if ((nrow(posts) + 1) * max(link_stride, image_stride) > 2^53 / 4) stop("rowid space too small.")

###############################################################################
# 5. STAGING DATABASE
#
# The input is first written, unsorted, to a separate file. The final file is
# then filled with INSERT ... SELECT ... ORDER BY, so the physical order uses
# SQLite's own BINARY collation (not R's locale-dependent sorting), and no
# temporary data ever occupies pages of the final file. Staging rowids keep the
# input order of links/images within a post.
###############################################################################

work_files <- c(STAGE_FILE, BUILD_FILE, FTS_SCRATCH_FILE, COMPACT_FILE)
work_files <- c(work_files, outer(work_files, c("-journal", "-wal", "-shm"), paste0))
unlink(work_files)
# A file that is still open (e.g. from an interrupted run in the same R session)
# cannot be deleted on Windows; building on top of it would fail later.
if (any(file.exists(work_files))) stop("Old work files are still in use (restart R): ", paste(work_files[file.exists(work_files)], collapse = ", "))

stage <- dbConnect(SQLite(), STAGE_FILE)
dbGetQuery(stage, "PRAGMA journal_mode = OFF")
dbExecute(stage, "PRAGMA synchronous = OFF")
dbExecute(stage, "CREATE TABLE posts (postId TEXT, authorId INTEGER, url TEXT, time INTEGER, text TEXT)")
dbExecute(stage, "CREATE TABLE links (postId TEXT, link TEXT, available INTEGER)")
dbExecute(stage, "CREATE TABLE images (postId TEXT, filename TEXT)")
dbExecute(stage, "CREATE TABLE authors (authorId INTEGER, authorname TEXT, post_count INTEGER, first_time INTEGER, last_time INTEGER)")
dbWithTransaction(stage, {
  dbAppendTable(stage, "authors", authors)
  dbAppendTable(stage, "posts", posts)
  dbAppendTable(stage, "links", links)
  dbAppendTable(stage, "images", images)
})
dbDisconnect(stage)

###############################################################################
# 6. FINAL DATABASE: SETTINGS AND SCHEMA
###############################################################################

con <- dbConnect(SQLite(), BUILD_FILE)

scalar <- function(sql, params = NULL) dbGetQuery(con, sql, params = params)[[1]][1]
check <- function(ok, what) if (!isTRUE(ok)) stop("Verification failed: ", what) else cat("OK:", what, "\n")

# page_size only takes effect before the first table is created.
dbExecute(con, sprintf("PRAGMA page_size = %d", PAGE_SIZE))
# A throwaway build file needs no journal. This also keeps the file header in
# rollback-journal (non-WAL) mode.
dbGetQuery(con, "PRAGMA journal_mode = OFF")
dbExecute(con, "PRAGMA synchronous = OFF")
dbExecute(con, "PRAGMA temp_store = MEMORY")
dbExecute(con, "PRAGMA cache_size = -200000")
# Foreign keys are switched on in section 7, once the unique postId index they
# rely on exists (before that, SQLite rejects any write to posts or its children
# with "foreign key mismatch").
dbExecute(con, "PRAGMA foreign_keys = OFF")
# Ordered aggregates (json_group_array(... ORDER BY ...), section 7) need 3.44.0.
if (package_version(scalar("SELECT sqlite_version()")) < "3.44.0") stop("SQLite 3.44.0 or later is required: update RSQLite.")

dbExecute(con, "ATTACH DATABASE ? AS stage", params = list(STAGE_FILE))

# images and links repeat the post's rows of the images and links tables as
# compact JSON, in the same order, so that a page of posts can be hydrated from
# posts alone (one b-tree, one row per post):
#   images  ["<filename>", ...]
#   links   [["<url>", <available: 1 or 0>], ...]
# Both are NULL when the post has none. The images and links tables remain the
# normalised form.
#
# id is the rowid: 1..n in (time, postId) order. Keyset pagination, the full-text
# indexes (content_rowid) and the child rowid ranges all depend on these
# numbers, so they are an explicit INTEGER PRIMARY KEY: a plain rowid could be
# renumbered by VACUUM, a dump/reload or another tool copying the table, and
# the search would then silently return the wrong posts. postId is unique through
# idx_posts_postId, built right after the posts are loaded (section 7).
dbExecute(con, "
  CREATE TABLE posts (
      id       INTEGER PRIMARY KEY,
      postId   TEXT NOT NULL,
      authorId INTEGER NOT NULL REFERENCES authors(authorId),
      url      TEXT NOT NULL,
      time     INTEGER NOT NULL,
      text     TEXT,
      images   TEXT CHECK (images IS NULL OR (json_valid(images) AND json_type(images) = 'array' AND json_array_length(images) > 0)),
      links    TEXT CHECK (links IS NULL OR (json_valid(links) AND json_type(links) = 'array' AND json_array_length(links) > 0))
  )"
)

# Children: id (rowid) in [r * stride, (r + 1) * stride) for the post with id r,
# explicit for the same reason as posts.id.
dbExecute(con, "
  CREATE TABLE links (
      id        INTEGER PRIMARY KEY,
      postId    TEXT NOT NULL,
      link      TEXT NOT NULL,
      available INTEGER NOT NULL CHECK (available IN (0, 1)),
      FOREIGN KEY (postId) REFERENCES posts(postId)
  )"
)

dbExecute(con, "
  CREATE TABLE images (
      id       INTEGER PRIMARY KEY,
      postId   TEXT NOT NULL,
      filename TEXT NOT NULL,
      FOREIGN KEY (postId) REFERENCES posts(postId)
  )"
)

# One row per distinct author name
dbExecute(con, "
  CREATE TABLE authors (
      authorId   INTEGER NOT NULL PRIMARY KEY,
      authorname TEXT NOT NULL UNIQUE,
      post_count INTEGER NOT NULL,
      first_time INTEGER NOT NULL,
      last_time  INTEGER NOT NULL
  )"
)

dbExecute(con, "CREATE TABLE archive_meta (key TEXT NOT NULL PRIMARY KEY, value) WITHOUT ROWID")

# The page size is fixed once the first table exists. SQLite ignores an invalid
# or too-late PRAGMA page_size without an error, so confirm it before the load.
check(scalar("PRAGMA page_size") == PAGE_SIZE, sprintf("page size is %d bytes", PAGE_SIZE))

###############################################################################
# 7. LOAD ROWS IN PHYSICAL ORDER
###############################################################################

dbBegin(con)

dbExecute(con, "
  INSERT INTO authors (authorId, authorname, post_count, first_time, last_time)
  SELECT authorId, authorname, post_count, first_time, last_time
  FROM stage.authors
  ORDER BY authorId"
)

# The JSON is built from the staging tables in staging (= input) order, the
# order load_children() below also uses, and written together with the post:
# rows that grew after insertion would split pages and break the physical order.
dbExecute(con, "CREATE TEMP TABLE post_children (postId TEXT PRIMARY KEY, images TEXT, links TEXT) WITHOUT ROWID")
dbExecute(con, "
  INSERT INTO temp.post_children (postId, images, links)
  SELECT postId, max(images), max(links) FROM (
    SELECT postId, json_group_array(filename ORDER BY rowid) AS images, NULL AS links
    FROM stage.images GROUP BY postId
    UNION ALL
    SELECT postId, NULL, json_group_array(json_array(link, available) ORDER BY rowid)
    FROM stage.links GROUP BY postId)
  GROUP BY postId"
)

dbExecute(con, "
  INSERT INTO posts (id, postId, authorId, url, time, text, images, links)
  SELECT row_number() OVER (ORDER BY p.time, p.postId), p.postId, p.authorId, p.url, p.time, p.text, c.images, c.links
  FROM stage.posts AS p
  LEFT JOIN temp.post_children AS c ON c.postId = p.postId
  ORDER BY p.time, p.postId"
)

# The unique postId index is built once all posts are in place: one contiguous
# b-tree after the posts rows, instead of index pages interleaved with them
# during the load. The foreign keys of links and images need it before those
# tables are filled.
dbExecute(con, "CREATE UNIQUE INDEX idx_posts_postId ON posts(postId)")
dbCommit(con)

# From here on every child row is checked against posts (the PRAGMA has no effect
# inside a transaction). posts.authorId is covered by PRAGMA foreign_key_check in
# section 11.
dbExecute(con, "PRAGMA foreign_keys = ON")
dbBegin(con)

dbExecute(con, "CREATE TEMP TABLE post_rowid (postId TEXT PRIMARY KEY, r INTEGER NOT NULL) WITHOUT ROWID")
dbExecute(con, "INSERT INTO temp.post_rowid SELECT postId, id FROM main.posts")

load_children <- function(table, columns, stride) {
  dbExecute(con, sprintf("
    INSERT INTO main.%1$s (id, %2$s)
    SELECT m.r * %3$d + row_number() OVER (PARTITION BY s.postId ORDER BY s.rowid) - 1, %4$s
    FROM stage.%1$s AS s
    JOIN temp.post_rowid AS m ON m.postId = s.postId
    ORDER BY 1",
    table, paste(columns, collapse = ", "), stride, paste0("s.", columns, collapse = ", ")
  ))
}
load_children("links", c("postId", "link", "available"), link_stride)
load_children("images", c("postId", "filename"), image_stride)

dbCommit(con)
dbExecute(con, "DROP TABLE temp.post_rowid")
dbExecute(con, "DROP TABLE temp.post_children")

###############################################################################
# 8. INDEXES
#
# Built after loading, so each index is one contiguous b-tree. Every index also
# stores the rowid, so (time, rowid) keyset pages are answered from the index.
# As rowid order == time order, idx_posts_time also turns a date into a rowid
# bound (first rowid with time >= date), which the full-text search can use.
###############################################################################

# WHERE time >= ? AND time < ? ORDER BY time, rowid; date -> rowid bounds
dbExecute(con, "CREATE INDEX idx_posts_time ON posts(time)")
# WHERE authorId = ? [AND time ...] ORDER BY time [DESC], rowid [DESC] (author
# filter), and ORDER BY authorId, time DESC, rowid DESC (author sort, newest
# first within an author). authorId is stored DESC so that the latter is a
# plain backward index scan, without a sorting step.
dbExecute(con, "CREATE INDEX idx_posts_author_time ON posts(authorId DESC, time)")
# Child lookups by postId (generic access path and foreign-key checks). The
# unique postId index of posts (idx_posts_postId) was built in section 7.
dbExecute(con, "CREATE INDEX idx_images_postId ON images(postId)")
dbExecute(con, "CREATE INDEX idx_links_postId ON links(postId)")

###############################################################################
# 9. FULL-TEXT INDEXES (FTS5, external content)
#
# Each index covers posts.text without storing a second copy of it; its rowid
# is posts.id. Each is built and merged ('optimize') in a scratch file, and
# its shadow tables are then copied in key order. Building it in place would
# scatter the merged segment over pages freed by intermediate segments.
###############################################################################

# The same tokenizers run in the browser on the search terms, so their handling
# of Hungarian letters is checked on a known sample rather than assumed.
fts_matches <- function(tokenize, doc, query) {
  dbExecute(con, sprintf("CREATE VIRTUAL TABLE temp.fts5_test USING fts5(text, tokenize='%s')", tokenize))
  on.exit(dbExecute(con, "DROP TABLE temp.fts5_test"))
  dbExecute(con, "INSERT INTO temp.fts5_test (text) VALUES (?)", params = list(doc))
  dbGetQuery(con, "SELECT count(*) FROM temp.fts5_test WHERE fts5_test MATCH ?", params = list(query))[[1]]
}
fts5_ok <- tryCatch(fts_matches(FTS_TOKENIZERS[[1]], "x", "x") == 1, error = function(e) FALSE)
if (!fts5_ok) stop("This SQLite build has no FTS5 support.")
rm(fts5_ok)

tokenizer_cases <- data.table(
  query            = c("kőszeg", "KŐSZEG", "koszeg", "korul", "ules", "ur"),
  posts_fts        = c(1, 1, 0, 0, 0, 0),
  posts_fts_folded = c(1, 1, 1, 1, 1, 1)
)
for (fts in names(FTS_TOKENIZERS)) {
  got <- vapply(tokenizer_cases$query, function(q) fts_matches(FTS_TOKENIZERS[[fts]], "Kőszeg körül ÜLÉS űr", q), numeric(1))
  check(all(got == tokenizer_cases[[fts]]), paste(fts, "tokenizer treats diacritics as intended"))
}

dbExecute(con, "ATTACH DATABASE ? AS scratch", params = list(FTS_SCRATCH_FILE))
dbGetQuery(con, "PRAGMA scratch.journal_mode = OFF")
dbExecute(con, "PRAGMA scratch.synchronous = OFF")
# The FTS5 content table must be in the same schema as the FTS5 table.
# Same content_rowid column ('id') as main.posts, as both use fts_definition().
dbExecute(con, "CREATE TABLE scratch.posts (id INTEGER PRIMARY KEY, text TEXT)")
dbExecute(con, "INSERT INTO scratch.posts (id, text) SELECT id, text FROM main.posts ORDER BY id")

for (fts in names(FTS_TOKENIZERS)) {
  definition <- fts_definition(FTS_TOKENIZERS[[fts]])
  dbExecute(con, sprintf("CREATE VIRTUAL TABLE scratch.%s USING fts5(%s)", fts, definition))
  dbExecute(con, sprintf("INSERT INTO scratch.%1$s (%1$s) VALUES ('rebuild')", fts))
  dbExecute(con, sprintf("INSERT INTO scratch.%1$s (%1$s) VALUES ('optimize')", fts))

  dbExecute(con, sprintf("CREATE VIRTUAL TABLE main.%s USING fts5(%s)", fts, definition))

  shadow_keys <- setNames(c("k", "id", "segid, term", "id"), paste0(fts, c("_config", "_data", "_idx", "_docsize")))
  dbBegin(con)
  for (tbl in names(shadow_keys)) {
    dbExecute(con, sprintf("DELETE FROM main.%s", tbl))
    dbExecute(con, sprintf("INSERT INTO main.%1$s SELECT * FROM scratch.%1$s ORDER BY %2$s", tbl, shadow_keys[[tbl]]))
  }
  dbCommit(con)
  dbExecute(con, sprintf("DROP TABLE scratch.%s", fts))
  cat("built", fts, "\n")
}

dbExecute(con, "DETACH DATABASE scratch")
unlink(FTS_SCRATCH_FILE)

###############################################################################
# 10. ARCHIVE METADATA
#
# Information made available without the need to descend the posts b-tree for
# it (three separate range requests over HTTP): counts, time range, strides and
# the id range of posts (min_id, max_id; the ids are 1..n, so max_id equals
# post_count). archive_meta fits on its root page, which VACUUM INTO (section 14)
# places at the start of the file.
###############################################################################

dbExecute(con, "
  INSERT INTO archive_meta (key, value)
  SELECT 'built_at', ?
  UNION ALL SELECT 'link_stride', ?
  UNION ALL SELECT 'image_stride', ?
  UNION ALL SELECT 'post_count', count(*) FROM posts
  UNION ALL SELECT 'link_count', count(*) FROM links
  UNION ALL SELECT 'image_count', count(*) FROM images
  UNION ALL SELECT 'author_count', count(*) FROM authors
  UNION ALL SELECT 'min_time', min(time) FROM posts
  UNION ALL SELECT 'max_time', max(time) FROM posts
  UNION ALL SELECT 'min_id', min(id) FROM posts
  UNION ALL SELECT 'max_id', max(id) FROM posts
  UNION ALL SELECT 'schema_version', ?",
  params = list(as.integer(Sys.time()), link_stride, image_stride, SCHEMA_VERSION)
)

###############################################################################
# 11. VERIFICATION
###############################################################################

counts <- dbGetQuery(con, paste(c(
  "SELECT 'authors' AS table_name, (SELECT count(*) FROM authors) AS n",
  "SELECT 'posts', (SELECT count(*) FROM posts)",
  "SELECT 'links', (SELECT count(*) FROM links)",
  "SELECT 'images', (SELECT count(*) FROM images)",
  sprintf("SELECT '%1$s', (SELECT count(*) FROM %1$s)", names(FTS_TOKENIZERS))
), collapse = " UNION ALL "))
print(counts)
check(all(counts$n == c(nrow(authors), nrow(posts), nrow(links), nrow(images), rep(nrow(posts), length(FTS_TOKENIZERS)))),
  "row counts match the input")

# Equal counts + unique postId: an empty EXCEPT means identical content.
check(scalar("
  SELECT count(*) FROM (
    SELECT postId, authorId, url, time, text FROM stage.posts
    EXCEPT SELECT postId, authorId, url, time, text
    FROM main.posts)") == 0, "posts identical to the input")

# Including the position within the post also verifies that link/image order is kept.
for (tbl in c("links", "images")) {
  cols <- if (tbl == "links") "postId, link, available" else "postId, filename"
  check(scalar(sprintf("
    SELECT count(*) FROM (
      SELECT %1$s, row_number() OVER (PARTITION BY postId ORDER BY rowid) FROM stage.%2$s
      EXCEPT SELECT %1$s, row_number() OVER (PARTITION BY postId ORDER BY rowid) FROM main.%2$s)",
    cols, tbl)) == 0, paste(tbl, "identical to the input, order within each post kept"))
}

# posts.images / posts.links against the child tables, including the order
# within each post. (postId, position) is unique on both sides, so equal totals
# plus an empty one-way EXCEPT mean identical content.
embedded <- list(
  images = c(
    "SELECT p.postId, CAST(j.key AS INTEGER), j.value FROM posts AS p, json_each(p.images) AS j",
    "SELECT postId, row_number() OVER (PARTITION BY postId ORDER BY rowid) - 1, filename FROM images"),
  links = c(
    "SELECT p.postId, CAST(j.key AS INTEGER), json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]') FROM posts AS p, json_each(p.links) AS j",
    "SELECT postId, row_number() OVER (PARTITION BY postId ORDER BY rowid) - 1, link, available FROM links")
)
for (tbl in names(embedded)) {
  check(scalar(sprintf("SELECT coalesce(sum(json_array_length(%1$s)), 0) = (SELECT count(*) FROM %1$s) FROM posts", tbl)) == 1 &&
    scalar(sprintf("SELECT count(*) FROM (%s EXCEPT %s)", embedded[[tbl]][1], embedded[[tbl]][2])) == 0,
    sprintf("posts.%1$s identical to the %1$s table, order within each post kept", tbl))
}
check(scalar("
  SELECT (SELECT count(*) FROM posts AS p, json_each(p.images) AS j WHERE j.type <> 'text')
       + (SELECT count(*) FROM posts AS p, json_each(p.links) AS j
          WHERE j.type <> 'array' OR json_array_length(j.value) <> 2 OR json_type(j.value, '$[0]') <> 'text')") == 0,
  "posts.images / posts.links have the documented shape")

check(scalar("SELECT min(authorId) = 1 AND max(authorId) = count(*) FROM authors") == 1, "authorIds are 1..n")
check(identical(dbGetQuery(con, "SELECT authorname FROM authors ORDER BY authorId")$authorname, authors$authorname),
  "authorId order == Hungarian alphabetical order, unknown author last")
check(scalar("
  SELECT count(*) FROM authors AS a
  WHERE a.post_count IS NOT (SELECT count(*) FROM posts AS p WHERE p.authorId = a.authorId)
     OR a.first_time IS NOT (SELECT min(time) FROM posts AS p WHERE p.authorId = a.authorId)
     OR a.last_time IS NOT (SELECT max(time) FROM posts AS p WHERE p.authorId = a.authorId)") == 0,
  "author statistics match posts")

# id must be the rowid alias (the only primary key column, declared INTEGER) in
# posts, links and images, so that no copy of the file can renumber the rows.
check(scalar("
  SELECT count(*) = 3 AND sum(c.name = 'id' AND upper(c.type) = 'INTEGER') = 3
  FROM (SELECT 'posts' AS t UNION ALL SELECT 'links' UNION ALL SELECT 'images') AS x
  JOIN pragma_table_info(x.t) AS c
  WHERE c.pk > 0") == 1, "posts, links and images have an INTEGER PRIMARY KEY id (rowid alias)")
check(scalar("SELECT \"unique\" FROM pragma_index_list('posts') WHERE name = 'idx_posts_postId'") == 1,
  "postId is unique (idx_posts_postId)")
check(scalar("SELECT max(id) = count(*) AND min(id) = 1 FROM posts") == 1, "posts ids are 1..n")
check(scalar("
  SELECT count(*) FROM (
    SELECT time, postId, lag(time) OVER w AS prev_time, lag(postId) OVER w AS prev_id
    FROM posts WINDOW w AS (ORDER BY id))
  WHERE time < prev_time OR (time = prev_time AND postId <= prev_id)") == 0, "id order == (time, postId) order")

for (x in list(list("links", link_stride), list("images", image_stride))) {
  check(scalar(sprintf("
    SELECT count(*) FROM %1$s AS c JOIN posts AS p ON p.postId = c.postId
    WHERE c.id < p.id * %2$d OR c.id >= (p.id + 1) * %2$d", x[[1]], x[[2]])) == 0,
    paste(x[[1]], "clustered in their post's id range"))
}

meta <- dbGetQuery(con, "SELECT key, value FROM archive_meta")
check(all(as.numeric(meta$value[match(c("post_count", "link_count", "image_count", "author_count", "link_stride", "image_stride", "schema_version", "min_id", "max_id"), meta$key)]) ==
  c(nrow(posts), nrow(links), nrow(images), nrow(authors), link_stride, image_stride, SCHEMA_VERSION,
    scalar("SELECT min(id) FROM posts"), scalar("SELECT max(id) FROM posts"))), "archive_meta counts, schema version and id range")

for (fts in names(FTS_TOKENIZERS)) {
  check(scalar(sprintf("SELECT v FROM %s_config WHERE k = 'version'", fts)) == FTS5_REQUIRED_VERSION,
    sprintf("%s has FTS5 on-disk version %d (readable by SQLite 3.44)", fts, FTS5_REQUIRED_VERSION))
}

dbExecute(con, "DETACH DATABASE stage")
unlink(STAGE_FILE)

# Raises an error if a full-text index does not match posts.text.
for (fts in names(FTS_TOKENIZERS)) {
  dbExecute(con, sprintf("INSERT INTO %1$s (%1$s, rank) VALUES ('integrity-check', 1)", fts))
  cat("OK:", fts, "FTS5 integrity-check\n")
}

check(identical(dbGetQuery(con, "PRAGMA integrity_check")[[1]], "ok"), "PRAGMA integrity_check")
check(nrow(dbGetQuery(con, "PRAGMA foreign_key_check")) == 0, "PRAGMA foreign_key_check")

###############################################################################
# 12. STATISTICS
#
# sqlite_stat1 gives the planner row estimates. SQLite builds with STAT4 (such
# as RSQLite's) also write sqlite_stat4.
###############################################################################

dbExecute(con, "ANALYZE")

###############################################################################
# 13. DIAGNOSTICS
###############################################################################

diagnose <- function(label, sql, params = NULL) {
  cat("\n## ", label, "\n", sep = "")
  res <- dbGetQuery(con, sql, params = params)
  plan <- dbGetQuery(con, paste("EXPLAIN QUERY PLAN", sql), params = params)$detail
  cat("rows returned: ", nrow(res), "\n", sep = "")
  cat(paste0("  ", plan), sep = "\n")
  attr(res, "plan") <- plan
  invisible(res)
}
json_ids <- function(x) paste0("[", paste(x, collapse = ","), "]")
same_ids <- function(a, b) identical(as.numeric(a), as.numeric(b))

authors_top <- dbGetQuery(con, "SELECT authorId, authorname, post_count FROM authors ORDER BY post_count DESC, authorId")
cat("\nauthors: ", nrow(authors_top), "\n", sep = "")
print(head(authors_top, 10))
test_author <- authors_top$authorId[1]

first_year <- as.integer(format(as.POSIXct(min(posts$time), tz = "UTC"), "%Y"))
date_start <- as.numeric(as.POSIXct(sprintf("%d-01-01", first_year), tz = "UTC"))
date_end <- as.numeric(as.POSIXct(sprintf("%d-01-01", first_year + 1), tz = "UTC"))

page1 <- diagnose("Feed, first page", "
  SELECT rowid AS r, time AS t FROM posts INDEXED BY idx_posts_time
  ORDER BY time DESC, rowid DESC LIMIT ?", list(TEST_LIMIT))

last <- page1[nrow(page1), ]
page2 <- diagnose("Feed, second page (keyset on time, rowid)", "
  SELECT rowid AS r, time AS t FROM posts INDEXED BY idx_posts_time
  WHERE (time, rowid) < (?, ?)
  ORDER BY time DESC, rowid DESC LIMIT ?", list(last$t, last$r, TEST_LIMIT))
check(nrow(page2) == 0 || page2$t[1] < last$t || (page2$t[1] == last$t && page2$r[1] < last$r), "keyset pagination transition")

diagnose(paste("Date range", first_year), "
  SELECT rowid AS r, time AS t FROM posts INDEXED BY idx_posts_time
  WHERE time >= ? AND time < ?
  ORDER BY time DESC, rowid DESC LIMIT ?", list(date_start, date_end, TEST_LIMIT))

diagnose(paste("Author:", authors_top$authorname[1]), "
  SELECT rowid AS r, time AS t FROM posts INDEXED BY idx_posts_author_time
  WHERE authorId = ?
  ORDER BY time DESC, rowid DESC LIMIT ?", list(test_author, TEST_LIMIT))

diagnose(paste("Author + date range", first_year), "
  SELECT rowid AS r, time AS t FROM posts INDEXED BY idx_posts_author_time
  WHERE authorId = ? AND time >= ? AND time < ?
  ORDER BY time DESC, rowid DESC LIMIT ?", list(test_author, date_start, date_end, TEST_LIMIT))

# Author sort: the keyset continuation is the rest of the cursor's author,
# followed by the next authors.
author_sort <- "SELECT rowid AS r, authorId AS a, time AS t FROM posts INDEXED BY idx_posts_author_time"
as_page1 <- diagnose("Author sort (A-Z, newest first within an author), first page", paste(author_sort, "
  ORDER BY authorId, time DESC, rowid DESC LIMIT ?"), list(TEST_LIMIT))
check(!any(grepl("TEMP B-TREE", attr(as_page1, "plan"))), "author sort needs no sorting step")
last <- as_page1[nrow(as_page1), ]
as_rest <- diagnose("Author sort, second page: rest of the current author", paste(author_sort, "
  WHERE authorId = ? AND (time, rowid) < (?, ?)
  ORDER BY time DESC, rowid DESC LIMIT ?"), list(last$a, last$t, last$r, TEST_LIMIT))
as_next <- diagnose("Author sort, second page: following authors", paste(author_sort, "
  WHERE authorId > ?
  ORDER BY authorId, time DESC, rowid DESC LIMIT ?"), list(last$a, TEST_LIMIT - nrow(as_rest)))
as_ref <- dbGetQuery(con, paste(author_sort, "ORDER BY authorId, time DESC, rowid DESC LIMIT ? OFFSET ?"),
  params = list(TEST_LIMIT, TEST_LIMIT))
check(same_ids(c(as_rest$r, as_next$r), as_ref$r), "author-sort keyset page equals the OFFSET reference")

diagnose(paste0("Full-text search '", TEST_SEARCH_TERM, "', chronological via rowid"), "
  SELECT rowid AS r FROM posts_fts
  WHERE posts_fts MATCH ?
  ORDER BY rowid DESC LIMIT ?", list(TEST_SEARCH_TERM, TEST_LIMIT))

# A date range becomes a rowid range, which FTS5 applies inside the index.
r_lo <- diagnose("Date to rowid: first post at or after the start date", "
  SELECT rowid AS r FROM posts INDEXED BY idx_posts_time
  WHERE time >= ? ORDER BY time, rowid LIMIT 1", list(date_start))$r
r_hi <- scalar("
  SELECT coalesce((SELECT rowid FROM posts INDEXED BY idx_posts_time WHERE time >= ? ORDER BY time, rowid LIMIT 1),
                  (SELECT max(rowid) + 1 FROM posts))", list(date_end))
fts_dates <- diagnose("Full-text search + date range as rowid bounds", "
  SELECT rowid AS r FROM posts_fts
  WHERE posts_fts MATCH ? AND rowid >= ? AND rowid < ?
  ORDER BY rowid DESC LIMIT ?", list(TEST_SEARCH_TERM, r_lo, r_hi, TEST_LIMIT))
fts_dates_ref <- dbGetQuery(con, "
  SELECT rowid AS r FROM posts
  WHERE time >= ? AND time < ? AND rowid IN (SELECT rowid FROM posts_fts WHERE posts_fts MATCH ?)
  ORDER BY rowid DESC LIMIT ?", params = list(date_start, date_end, TEST_SEARCH_TERM, TEST_LIMIT))
check(same_ids(fts_dates$r, fts_dates_ref$r), "date range as rowid bounds equals the time filter")

diagnose("Full-text search + author + date range", "
  SELECT p.rowid AS r, p.time AS t FROM posts AS p INDEXED BY idx_posts_author_time
  WHERE p.authorId = ? AND p.time >= ? AND p.time < ?
    AND p.rowid IN (SELECT rowid FROM posts_fts WHERE posts_fts MATCH ?)
  ORDER BY p.time DESC, p.rowid DESC LIMIT ?", list(test_author, date_start, date_end, TEST_SEARCH_TERM, TEST_LIMIT))

cat("\n## Diacritics: matching posts per index\n")
print(rbindlist(lapply(names(FTS_TOKENIZERS), function(fts) data.table(
  index = fts,
  term = TEST_DIACRITIC_TERMS,
  posts = vapply(TEST_DIACRITIC_TERMS, function(term)
    scalar(sprintf("SELECT count(*) FROM %1$s WHERE %1$s MATCH ?", fts), list(sprintf('"%s"', term))), numeric(1))
))))

cat("\n## Embedded images/links\n")
print(dbGetQuery(con, "
  SELECT count(images) AS posts_with_images, count(links) AS posts_with_links,
         round(sum(length(CAST(images AS BLOB))) / 1048576.0, 1) AS images_json_MB,
         round(sum(length(CAST(links AS BLOB))) / 1048576.0, 1) AS links_json_MB
  FROM posts"))

# Schema version 2: one query hydrates a page, images and links included.
hydrated <- diagnose("Hydrate posts of the first page by rowid, with embedded images and links", "
  SELECT rowid AS r, postId, authorId, url, time, text, images, links FROM posts
  WHERE rowid IN (SELECT value FROM json_each(?))", list(json_ids(page1$r)))

# The normalised tables, read through the clustered rowid ranges.
for (x in list(list("links", "l.link, l.available", link_stride), list("images", "i.filename", image_stride))) {
  alias <- substr(x[[1]], 1, 1)
  child <- diagnose(paste("Hydrate", x[[1]], "of the first page by rowid range"), sprintf("
    SELECT j.value AS r, %2$s.postId AS postId, %3$s FROM json_each(?) AS j
    CROSS JOIN %1$s AS %2$s
    WHERE %2$s.rowid >= j.value * ? AND %2$s.rowid < (j.value + 1) * ?
    ORDER BY %2$s.rowid", x[[1]], alias, x[[2]]), list(json_ids(page1$r), x[[3]], x[[3]]))
  check(all(child$postId == hydrated$postId[match(child$r, hydrated$r)]), paste(x[[1]], "belong to the right posts"))
  check(nrow(child) == scalar(sprintf("SELECT coalesce(sum(json_array_length(%s)), 0) FROM posts WHERE rowid IN (SELECT value FROM json_each(?))", x[[1]]),
    list(json_ids(page1$r))), paste(x[[1]], "of the first page: embedded JSON and table agree"))
}

###############################################################################
# 14. FINALIZE: COMPACT COPY (VACUUM INTO)
#
# VACUUM INTO writes a fresh copy of the database: first the schema, which puts
# the root page of every table and index (including authors, archive_meta and
# sqlite_stat1, which fit on their root page) at the start of the file, then
# each table followed by its indexes, every b-tree in key order on consecutive
# pages, with no free pages. Browsers download the start of the file first, so
# opening the database and the first steps of queries need fewer separate
# requests. The ids survive the copy because they are INTEGER PRIMARY KEYs
# (section 6); the checks below confirm it. The copy, not the build file,
# becomes OUTPUT_FILE.
###############################################################################

dbGetQuery(con, "PRAGMA journal_mode = DELETE")
dbExecute(con, "VACUUM INTO ?", params = list(COMPACT_FILE))

dbExecute(con, "ATTACH DATABASE ? AS compact", params = list(COMPACT_FILE))
# Equal row counts + unique keys: an empty one-way EXCEPT means identical tables.
for (x in list(
  list("posts", "id, postId, authorId, url, time, text, images, links"),
  list("links", "id, postId, link, available"),
  list("images", "id, postId, filename"),
  list("authors", "authorId, authorname, post_count, first_time, last_time"),
  list("archive_meta", "key, value")
)) {
  check(scalar(sprintf("SELECT (SELECT count(*) FROM main.%1$s) = (SELECT count(*) FROM compact.%1$s)", x[[1]])) == 1 &&
    scalar(sprintf("SELECT count(*) FROM (SELECT %2$s FROM main.%1$s EXCEPT SELECT %2$s FROM compact.%1$s)", x[[1]], x[[2]])) == 0,
    paste("compact copy:", x[[1]], "identical, ids kept"))
}
roots <- dbGetQuery(con, "SELECT count(*) AS n, max(rootpage) AS last FROM compact.sqlite_schema WHERE rootpage > 0")
check(scalar("PRAGMA compact.freelist_count") == 0 && roots$last <= roots$n + 16,
  sprintf("compact copy: no free pages, the %d b-tree roots within the first %d pages", roots$n, roots$last))
dbExecute(con, "DETACH DATABASE compact")
dbDisconnect(con)

# The copy is what gets published, so the file-level checks run on it as well.
compact <- dbConnect(SQLite(), COMPACT_FILE)
for (fts in names(FTS_TOKENIZERS)) {
  dbExecute(compact, sprintf("INSERT INTO %1$s (%1$s, rank) VALUES ('integrity-check', 1)", fts))
  cat("OK: compact copy:", fts, "FTS5 integrity-check\n")
}
check(identical(dbGetQuery(compact, "PRAGMA integrity_check")[[1]], "ok"), "compact copy: PRAGMA integrity_check")
check(dbGetQuery(compact, "PRAGMA page_size")[[1]] == PAGE_SIZE, sprintf("compact copy: page size is %d bytes", PAGE_SIZE))
dbDisconnect(compact)
cat("\ncompact copy: ", round(file.size(COMPACT_FILE) / 1024^2, 1), " MB (build file: ",
  round(file.size(BUILD_FILE) / 1024^2, 1), " MB)\n", sep = "")

# Header bytes 19-20 are 1/1 in rollback-journal mode and 2/2 in WAL mode.
check(identical(as.integer(readBin(COMPACT_FILE, "raw", 20)[19:20]), c(1L, 1L)), "file is not in WAL mode")

unlink(c(OUTPUT_FILE, paste0(OUTPUT_FILE, c("-journal", "-wal", "-shm"))))
if (!file.rename(COMPACT_FILE, OUTPUT_FILE)) stop("Could not rename ", COMPACT_FILE, " to ", OUTPUT_FILE, ".")
unlink(work_files)

cat("Wrote ", OUTPUT_FILE, " (", round(file.size(OUTPUT_FILE) / 1024^2, 1), " MB)\n", sep = "")

###############################################################################
# 15. PARTS FOR CLOUDFLARE'S EDGE CACHE
#
# Cloudflare caches files of at most 512 MB on the Free, Pro and Business plans,
# and it checks the size of the whole object, also for range requests, so the
# complete archive can never be served from the edge cache. For the website it
# is therefore also written as consecutive byte ranges ("parts") plus a
# manifest; a client maps each database page to its part. OUTPUT_FILE itself is
# kept unchanged (for downloads and SQL tools), and concatenating the parts
# reproduces it byte for byte:
#   cat part-*.bin > archive.sqlite
#   (Windows: copy /b part-000.bin + part-001.bin archive.sqlite)
#
# Every build goes into its own folder, named after archive_meta 'built_at', so
# a new build never replaces files that browsers or the edge cache may still
# hold. The only file at a fixed URL is latest.json, next to the build folders:
# a copy of the current build's manifest plus "base", that build's folder
# relative to latest.json, so a client needs a single request to start. It reads
# latest.json once per session and takes every part from that one build, since
# pages from two builds must never be mixed. The manifest.json inside each build
# folder stays as that build's permanent record.
# Upload the build folder first and latest.json last, so the pointer never names
# an incomplete folder (single-part uploads keep R2's ETag equal to the MD5 in
# the manifest). The local CDN_PARTS_DIR (archive-parts/) maps to the database/
# prefix in the bucket; each command is "rclone <local source> <R2 destination>":
#   rclone copy -P archive-parts/<built_at> r2:<bucket>/database/<built_at> \
#     --header-upload "Cache-Control: public, max-age=31536000, immutable" \
#     --s3-upload-cutoff 1G --s3-no-check-bucket
#   rclone copyto -P archive-parts/latest.json r2:<bucket>/database/latest.json \
#     --header-upload "Cache-Control: public, max-age=60" --s3-no-check-bucket
# New sessions pick up the new build once the cached latest.json expires (about
# a minute). Keep older build folders for longer than any session can last
# (a few days), then delete them.
###############################################################################

SPLIT_FOR_CDN <- TRUE
# A multiple of 1 MiB (Cloudflare's alignment of range requests to the origin,
# and a multiple of every SQLite page size), well below the cacheable limit.
CDN_PART_BYTES <- 384 * 2^20
CDN_MAX_CACHEABLE_BYTES <- 512e6
CDN_PARTS_DIR <- file.path(dirname(OUTPUT_FILE), paste0(tools::file_path_sans_ext(basename(OUTPUT_FILE)), "-parts"))

if (SPLIT_FOR_CDN) local({
  if (!requireNamespace("jsonlite", quietly = TRUE)) stop("Package jsonlite is needed for the parts manifest.")
  stopifnot(CDN_PART_BYTES %% 2^20 == 0, CDN_PART_BYTES < CDN_MAX_CACHEABLE_BYTES)

  archive_size <- file.size(OUTPUT_FILE)
  header <- readBin(OUTPUT_FILE, "raw", 100)
  be_int <- function(b) sum(as.numeric(b) * 256^((length(b) - 1):0))
  page_size <- be_int(header[17:18])
  if (page_size == 1) page_size <- 65536
  check(rawToChar(header[1:15]) == "SQLite format 3" &&
    be_int(header[93:96]) == be_int(header[25:28]) &&
    be_int(header[29:32]) * page_size == archive_size,
    "archive header: page count x page size == file size")

  ro <- dbConnect(SQLite(), OUTPUT_FILE, flags = SQLITE_RO)
  built_at <- dbGetQuery(ro, "SELECT value FROM archive_meta WHERE key = 'built_at'")$value
  # Smallest id per month, for the website's monthly histogram (Elemzés tab). ids
  # are assigned in (time, postId) order, so these breakpoints partition the archive
  # by month exactly; shipping them saves the browser a full scan of the time index
  # on the first search (see src/lib/monthly.js). jsonlite serializes this
  # data.frame as an array of {ym, lo} records.
  month_bounds <- dbGetQuery(ro,
    "SELECT strftime('%Y-%m', time, 'unixepoch') AS ym, MIN(id) AS lo
     FROM posts GROUP BY ym ORDER BY lo")
  dbDisconnect(ro)
  version_dir <- file.path(CDN_PARTS_DIR, built_at)
  unlink(version_dir, recursive = TRUE)
  dir.create(version_dir, recursive = TRUE)

  block <- 64 * 2^20
  archive <- file(OUTPUT_FILE, "rb")
  parts <- lapply(seq_len(ceiling(archive_size / CDN_PART_BYTES)) - 1, function(i) {
    name <- sprintf("part-%03d.bin", i)
    offset <- i * CDN_PART_BYTES
    size <- min(CDN_PART_BYTES, archive_size - offset)
    out <- file(file.path(version_dir, name), "wb")
    left <- size
    while (left > 0) {
      buf <- readBin(archive, "raw", min(left, block))
      if (!length(buf)) stop("Unexpected end of ", OUTPUT_FILE)
      writeBin(buf, out)
      left <- left - length(buf)
    }
    close(out)
    list(name = name, offset = offset, size = size, md5 = unname(tools::md5sum(file.path(version_dir, name))))
  })
  close(archive)

  # Read everything back: each part must equal its byte range of the archive.
  archive <- file(OUTPUT_FILE, "rb")
  same <- vapply(parts, function(p) {
    path <- file.path(version_dir, p$name)
    part <- file(path, "rb")
    on.exit(close(part))
    ok <- file.size(path) == p$size
    left <- p$size
    while (ok && left > 0) {
      n <- min(left, block)
      ok <- identical(readBin(archive, "raw", n), readBin(part, "raw", n))
      left <- left - n
    }
    ok
  }, logical(1))
  close(archive)
  sizes <- vapply(parts, function(p) p$size, numeric(1))
  check(all(same), "parts are byte-identical to the archive")
  check(sum(sizes) == archive_size && all(sizes %% page_size == 0) && all(sizes < CDN_MAX_CACHEABLE_BYTES),
    "parts cover the archive, page-aligned, each below Cloudflare's cacheable size")

  manifest <- list(
    format = MANIFEST_FORMAT,
    schemaVersion = SCHEMA_VERSION,
    builtAt = built_at,
    file = basename(OUTPUT_FILE),
    size = archive_size,
    md5 = unname(tools::md5sum(OUTPUT_FILE)),
    pageSize = page_size,
    partSize = CDN_PART_BYTES,
    monthBounds = month_bounds,
    parts = parts
  )
  write_manifest <- function(x, path) jsonlite::write_json(x, path, auto_unbox = TRUE, pretty = TRUE, digits = NA)
  write_manifest(manifest, file.path(version_dir, "manifest.json"))

  # The pointer comes last, so it only ever names a build that passed every check.
  # The trailing slash in base lets a client resolve part names against it as a URL.
  pointer_file <- file.path(CDN_PARTS_DIR, "latest.json")
  write_manifest(c(list(base = paste0(built_at, "/")), manifest), pointer_file)
  pointer <- jsonlite::read_json(pointer_file)
  check(identical(pointer[names(pointer) != "base"],
    jsonlite::read_json(file.path(CDN_PARTS_DIR, paste0(pointer$base, "manifest.json")))),
    "latest.json embeds the manifest of the build folder it names")

  cat("Wrote ", length(parts), " parts (", paste(round(sizes / 1e6, 1), collapse = " + "), " MB) and manifest.json to ",
    version_dir, "; latest.json points to ", built_at, "; ", OUTPUT_FILE, " kept\n", sep = "")
})
