library(data.table)
library(httr2)
library(parallel)

# ---------------------------------------------------------------------------
# Parallel integrity checker for large collections of video files. Uses
# ffmpeg/ffprobe (the gold standard) and writes a resumable CSV so a long run
# can be stopped and continued.
#
# Two check modes (speed vs. completeness):
#
#   mode = "fast"  (default)  ffmpeg -c copy -f null  (demux read-through)
#        Reads every packet of every stream without decoding. Catches the
#        dominant download-corruption mode -- truncated / "partial file" -- plus
#        unreadable containers. I/O-bound: throughput tracks your disk speed
#        (roughly 150 MB/s on HDD, 500+ MB/s on SSD, GB/s on NVMe).
#
#   mode = "deep"             ffmpeg -f null  (full decode)
#        Decodes every frame of every stream. Additionally catches mid-stream
#        bitstream corruption that leaves the container intact. CPU-bound and
#        ~20x slower (~20-25 MB/s aggregate on ~10 cores here).
#
# A file is flagged "corrupt" when ffmpeg exits non-zero OR prints anything at
# log level "error". This matched a full decode with zero false positives on the
# sample set.
# ---------------------------------------------------------------------------

# Worker-side single-file check. Defined at top level so it serialises cheaply
# to PSOCK workers; reads its configuration from the exported `.CVI_CFG` list.
.cvi_check_one <- function(path, size) {
  t0 <- Sys.time()
  secs <- function() as.numeric(Sys.time() - t0, units = "secs")
  cfg <- .CVI_CFG
  
  if (is.na(size)) {
    return(data.frame(path = path, size_bytes = NA_real_, verdict = "missing",
                      exit_status = NA_integer_, n_error_lines = NA_integer_,
                      first_error = "file not found", seconds = secs(),
                      stringsAsFactors = FALSE))
  }
  if (size == 0) {
    return(data.frame(path = path, size_bytes = 0, verdict = "empty",
                      exit_status = NA_integer_, n_error_lines = 0L,
                      first_error = "zero-byte file", seconds = secs(),
                      stringsAsFactors = FALSE))
  }
  
  out <- suppressWarnings(system2(
    cfg$ffmpeg,
    c(cfg$args_pre, shQuote(path), cfg$args_post),
    stdout = TRUE, stderr = TRUE, timeout = cfg$timeout
  ))
  status <- attr(out, "status"); status <- if (is.null(status)) 0L else as.integer(status)
  errs <- out[nzchar(out)]
  
  verdict <- if (status == 124L) "timeout"
  else if (status != 0L || length(errs) > 0L) "corrupt"
  else "ok"
  
  data.frame(path = path, size_bytes = size, verdict = verdict,
             exit_status = status, n_error_lines = length(errs),
             first_error = if (length(errs)) errs[[1]] else "",
             seconds = secs(), stringsAsFactors = FALSE)
}

#' Check integrity of all video files in a directory.
#'
#' @param dir        Directory to scan.
#' @param mode       "fast" (demux read-through) or "deep" (full decode).
#' @param output     CSV results file. Appended to, enabling resume.
#' @param pattern    Filename regex (case-insensitive).
#' @param recursive  Recurse into subdirectories.
#' @param workers    Parallel ffmpeg processes. Default: cores - 1.
#' @param threads    ffmpeg threads PER process (deep mode only). Keep
#'                   workers * threads near your logical core count.
#' @param resume     Skip files already present in `output`.
#' @param chunk_size Files per checkpoint (results flushed to CSV each chunk).
#' @param timeout    Per-file wall-clock limit (seconds); exceeding it -> "timeout".
#' @param ffmpeg     ffmpeg executable (path or name on PATH).
#' @return (invisibly) a data frame of results for the files checked this run.
check_video_integrity <- function(
    dir,
    mode       = c("fast", "deep"),
    output     = file.path(dir, "integrity_results.csv"),
    pattern    = "\\.(mp4|mov|m4v|mkv|webm|avi|flv|ts|m2ts|3gp)$",
    recursive  = FALSE,
    workers    = max(1L, parallel::detectCores() - 1L),
    threads    = 1L,
    resume     = TRUE,
    chunk_size = 1000L,
    timeout    = if (match.arg(mode) == "deep") 3600 else 900,
    ffmpeg     = "ffmpeg") {
  
  mode <- match.arg(mode)
  stopifnot(dir.exists(dir))
  
  # --- Resolve the executable up front so workers don't rely on PATH lookups.
  ff <- Sys.which(ffmpeg)
  ff <- if (nzchar(ff)) unname(ff) else ffmpeg
  if (system2(ff, "-version", stdout = FALSE, stderr = FALSE) != 0L)
    stop("Could not run ffmpeg: '", ffmpeg, "'. Set `ffmpeg = <full path>`.")
  
  # --- Enumerate files.
  files <- list.files(dir, pattern = pattern, full.names = TRUE,
                      recursive = recursive, ignore.case = TRUE)
  files <- normalizePath(files, winslash = "/", mustWork = FALSE)
  if (!length(files)) { message("No matching files in ", dir); return(invisible(NULL)) }
  
  # --- Resume: drop files already recorded in the output CSV.
  if (resume && file.exists(output)) {
    done <- tryCatch(utils::read.csv(output, stringsAsFactors = FALSE)$path,
                     error = function(e) character())
    done <- normalizePath(done, winslash = "/", mustWork = FALSE)
    skip <- length(intersect(files, done))
    files <- setdiff(files, done)
    if (skip) message("Resuming: skipping ", skip, " already-checked file(s).")
  }
  if (!length(files)) { message("Nothing to do -- all files already checked."); return(invisible(NULL)) }
  
  sizes <- file.size(files)
  # Largest first: longest tasks start earliest -> better load balancing.
  ord <- order(sizes, decreasing = TRUE)
  files <- files[ord]; sizes <- sizes[ord]
  
  # --- Build the ffmpeg argument template for the chosen mode.
  #   fast: demux all streams, copy packets, discard   -> reads whole file, no decode
  #   deep: decode all streams, discard                 -> full validation
  args_pre <- c("-hide_banner", "-nostdin", "-v", "error")
  if (mode == "deep") args_pre <- c(args_pre, "-threads", threads)
  args_pre <- c(args_pre, "-i")
  args_post <- if (mode == "fast") c("-map", "0", "-c", "copy", "-f", "null", "-")
  else                c("-map", "0", "-f", "null", "-")
  
  .CVI_CFG <- list(ffmpeg = ff, args_pre = args_pre, args_post = args_post,
                   timeout = timeout)
  
  total_bytes <- sum(sizes, na.rm = TRUE)
  message(sprintf("Checking %d file(s), %.1f GB, mode='%s', %d worker(s)%s.",
                  length(files), total_bytes / 1024^3, mode, workers,
                  if (mode == "deep") sprintf(" x %d thread(s)", threads) else ""))
  
  # --- Parallel cluster.
  cl <- makeCluster(workers)
  on.exit(stopCluster(cl), add = TRUE)
  clusterExport(cl, c(".CVI_CFG", ".cvi_check_one"), envir = environment())
  
  write_header <- !file.exists(output) || file.size(output) == 0
  idx <- split(seq_along(files), ceiling(seq_along(files) / chunk_size))
  start <- Sys.time(); done_bytes <- 0; tally <- integer()
  results <- vector("list", length(idx))
  
  for (k in seq_along(idx)) {
    ii <- idx[[k]]
    res <- clusterMap(cl, .cvi_check_one, path = files[ii], size = sizes[ii],
                      SIMPLIFY = FALSE, USE.NAMES = FALSE,
                      .scheduling = "dynamic")
    df <- do.call(rbind, res)
    results[[k]] <- df
    
    utils::write.table(df, output, sep = ",", row.names = FALSE,
                       col.names = write_header, append = !write_header,
                       qmethod = "double")
    write_header <- FALSE
    
    done_bytes <- done_bytes + sum(sizes[ii], na.rm = TRUE)
    tally <- table(c(rep(names(tally), tally), df$verdict))
    el <- as.numeric(Sys.time() - start, units = "secs")
    rate <- done_bytes / el
    eta <- (total_bytes - done_bytes) / max(rate, 1)
    message(sprintf(
      "[%3.0f%%] %d/%d files | %.1f/%.1f GB | %.0f MB/s | elapsed %s | ETA %s | %s",
      100 * done_bytes / total_bytes, sum(lengths(idx[seq_len(k)])), length(files),
      done_bytes / 1024^3, total_bytes / 1024^3, rate / 1024^2,
      .cvi_fmt_dur(el), .cvi_fmt_dur(eta),
      paste(sprintf("%s=%d", names(tally), as.integer(tally)), collapse = " ")))
  }
  
  out <- do.call(rbind, results)
  message("\nDone in ", .cvi_fmt_dur(as.numeric(Sys.time() - start, "secs")),
          ". Results written to ", output)
  print(table(verdict = out$verdict))
  invisible(out)
}

.cvi_fmt_dur <- function(s) {
  s <- round(s)
  sprintf("%02d:%02d:%02d", s %/% 3600, (s %% 3600) %/% 60, s %% 60)
}

# ---------------------------------------------------------------------------
# Fast pass over everything (recommended first step):
res <- check_video_integrity("./videos", mode = "fast")

# fs::file_move(res[res$verdict!="ok",]$path, "./broken/videocorrupt1/")

# Deep pass, to re-check the files that passed "fast"
res2 <- check_video_integrity("./videos", mode = "deep")

# fs::file_move(res2[res2$verdict!="ok",]$path, "./broken/videocorrupt1/")
# ---------------------------------------------------------------------------

toconvert <- readRDS("toconvert.rds")
media <- unique(toconvert$media[media_type == "Video"][!is.na(filename), .(postId, filename)])

corrupt <- data.table(
  filename = c(basename(fread("integrity_results_files1_fast.csv")[verdict != "ok"]$path),
               basename(fread("integrity_results_files1_deep.csv")[verdict != "ok"]$path)))

todownload <- data.table(
  postUrl = toconvert$posts[postId %in% merge(corrupt, media, by = "filename")$postId]$postUrl
)

# Resolve the *current* direct .mp4 URL for a vector of Facebook video posts.
# Uses the embed endpoint (plugins/video.php), which returns the legacy
# hd_src / sd_src CDN URLs without login. HD is preferred over SD. Requests are
# chunked (each embed page is ~0.2 MB) and run in parallel with a capped number
# of active connections; missing/removed/throttled posts resolve to NA.
fetch_video_urls <- function(post_urls, concurrency = 15, chunk_size = 200,
                             timeout = 30, chunk_pause = 1) {
  ua <- "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
  
  extract_src <- function(html) {
    for (key in c("hd_src", "sd_src")) {
      m <- regmatches(html, regexpr(sprintf('"%s"\\s*:\\s*"(\\\\.|[^"\\\\])*"', key), html))
      if (!length(m)) next
      # Parse the matched "key":"value" pair as JSON so every escape (\/, \uXXXX)
      # is decoded correctly -- manual gsub misses cases like \u0025 (%).
      val <- tryCatch(jsonlite::fromJSON(paste0("{", m, "}"))[[key]],
                      error = function(e) NA_character_)
      if (length(val) && !is.na(val) && nzchar(val)) return(val)
    }
    NA_character_
  }
  resolve_one <- function(resp) {
    if (!inherits(resp, "httr2_response") || resp_status(resp) != 200) return(NA_character_)
    extract_src(resp_body_string(resp))
  }
  
  n <- length(post_urls)
  out <- rep(NA_character_, n)
  chunks <- split(seq_len(n), ceiling(seq_len(n) / chunk_size))
  for (k in seq_along(chunks)) {
    idx <- chunks[[k]]
    reqs <- lapply(post_urls[idx], function(u) {
      embed <- paste0("https://www.facebook.com/plugins/video.php?href=",
                      URLencode(u, reserved = TRUE))
      request(embed) |>
        req_user_agent(ua) |>
        req_headers("Accept-Language" = "en-US,en;q=0.9") |>
        req_timeout(timeout) |>
        req_error(is_error = function(resp) FALSE)
    })
    resps <- req_perform_parallel(reqs, on_error = "continue", max_active = concurrency)
    out[idx] <- vapply(resps, resolve_one, character(1))
    message(sprintf("chunk %d/%d: %d resolved, %d missing",
                    k, length(chunks), sum(!is.na(out[idx])), sum(is.na(out[idx]))))
    if (k < length(chunks) && chunk_pause > 0) Sys.sleep(chunk_pause)
  }
  out
}

# Add/refresh the `download_url` column in place. Resumable: only rows still NA
# are (re-)fetched, so if a long run is interrupted, call it again to continue.
add_download_url <- function(dt, url_col = "postUrl", ...) {
  if (!"download_url" %in% names(dt)) dt[, download_url := NA_character_]
  todo <- which(is.na(dt$download_url))
  if (length(todo))
    dt[todo, download_url := fetch_video_urls(dt[[url_col]][todo], ...)]
  dt[]
}

todownload <- add_download_url(todownload)

# Extract the filename from a media URL: the last path segment, with any query
# string (?...) or fragment (#...) removed. NA / slash-terminated URLs -> NA.
extract_filename <- function(url) {
  base <- sub("[?#].*$", "", url)  # drop query string and fragment
  base <- sub("^.*/", "", base)    # keep only the last path segment
  fifelse(!is.na(url) & nzchar(base), base, NA_character_)
}

todownload$dest <- paste0("./videodl/", extract_filename(todownload$download_url))

todownload <- todownload[!is.na(download_url)]
todownload <- todownload[!duplicated(dest)]

download_media(todownload)
