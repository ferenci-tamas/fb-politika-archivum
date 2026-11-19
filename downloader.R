library(data.table)

# Download media with curl::multi_download. Within a round the work is split into
# chunks of `chunk_size`, and each chunk is a separate multi_download call: this
# caps how many transfers run concurrently (multi_download has no built-in
# concurrency limit) and lets us pause between chunks to reduce throttling.
# multi_download resumes interrupted transfers via HTTP range requests
# (resume = TRUE) and marks success = FALSE unless the full Content-Length was
# received -- so truncated downloads are detected natively. Rounds retry with
# exponential backoff: successful rows drop out, genuine partials are resumed,
# and HTTP-error responses (>= 400, e.g. expired signed URLs) have their bodies
# deleted first so resume never appends a range to an error page.

download_media <- function(dt, max_tries = 4, base_delay = 5,
                           chunk_size = 100, chunk_pause = 2) {
  pending <- copy(dt)
  status <- data.table()
  for (attempt in seq_len(max_tries)) {
    if (!nrow(pending)) break
    message("Round ", attempt, "/", max_tries, ": ", nrow(pending), " file(s)")
    # Contiguous chunks keep res row order aligned with `pending`.
    chunks <- split(seq_len(nrow(pending)),
                    ceiling(seq_len(nrow(pending)) / chunk_size))
    res <- rbindlist(lapply(seq_along(chunks), function(k) {
      idx <- chunks[[k]]
      message("  chunk ", k, "/", length(chunks), " (", length(idx), " file(s))")
      out <- as.data.table(
        curl::multi_download(pending$download_url[idx], pending$dest[idx],
                             resume = TRUE, progress = TRUE)
      )
      if (k < length(chunks)) Sys.sleep(chunk_pause)
      out
    }))
    ok <- res$success & !is.na(res$success)
    # multi_download does not report a byte count, so measure the file on disk.
    succeeded <- pending[ok]
    succeeded[, `:=`(status_code = res$status_code[ok], size = file.size(dest))]
    status <- rbind(status, succeeded, fill = TRUE)
    # For HTTP errors (>= 400), discard the saved error body so a resumed retry
    # starts fresh rather than appending a range to an error page.
    http_err <- !ok & !is.na(res$status_code) & res$status_code >= 400
    unlink(res$destfile[http_err])
    pending <- pending[!ok]
    if (nrow(pending) && attempt < max_tries)
      Sys.sleep(base_delay * 2^(attempt - 1))
  }
  list(ok = status, failed = pending)
}

results <- download_media(to_download)
results