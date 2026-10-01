// Monthly post-count aggregation for the Elemzés (analysis) tab.
//
// Post ids are assigned in (time, postId) order (see SQLite-converter.R), so id
// strictly increases with time and every calendar month occupies a contiguous id
// range. Given the smallest id of each month (the "boundaries", computed once
// from a covering-index scan), a set of matching FTS rowids can be counted per
// month with a single linear merge — without reading a single posts row, which
// matters because a broad search can match hundreds of thousands of posts.

/**
 * Bucket ascending, unique rowids into per-month counts.
 *
 * @param {number[]} sortedIds matching rowids, ascending
 * @param {{ym:string, lo:number}[]} boundaries months with their smallest id,
 *   ascending by `lo` (lo[0] is the archive's min id)
 * @returns {{ym:string, n:number}[]} one entry per month (0-filled), same order
 */
export function bucketByMonth(sortedIds, boundaries) {
  if (!boundaries || boundaries.length === 0) return [];
  const counts = new Array(boundaries.length).fill(0);
  let b = 0;
  for (let k = 0; k < sortedIds.length; k++) {
    const id = sortedIds[k];
    // Advance to the last month whose starting id is <= this id. Safe because the
    // ids are ascending, so b only ever moves forward.
    while (b + 1 < boundaries.length && boundaries[b + 1].lo <= id) b++;
    counts[b]++;
  }
  return boundaries.map((m, i) => ({ ym: m.ym, n: counts[i] }));
}
