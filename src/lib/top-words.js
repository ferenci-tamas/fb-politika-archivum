// Shape one author's stored monthly top words into stacked-area series for the
// "Leggyakoribb szavak" (most frequent words) view. Pure (no DOM/ECharts), so it
// stays unit-testable in Node.
//
// The archive stores, per author and year-month, that month's top words with raw
// counts (see word_monthly in SQLite-converter.R). For one author this ranks words by
// their summed monthly share (each month's n / that month's content-word tokens) so a
// high-volume era cannot crowd out words that defined quieter periods -- while ignoring
// near-empty months, so a single-token month cannot crown a one-off word -- keeps the
// top `limit`, and returns one series per word with a 0-filled point for every active
// month. An optional `selectMonths` restricts the ranking to a zoomed-in window while
// every series still spans the full axis, so zooming re-picks the words without moving
// the time axis.

/**
 * @param {{ym:string, word:string, n:number}[]} rows one author's word_monthly rows
 * @param {Map<string,number>|null} [totalsByYm] ym -> that month's total content-word
 *   tokens (word_month_totals). Used both as the ratio-mode denominator (each point's
 *   `total`) and, when present, as the ranking weight: words are scored by their summed
 *   monthly share (n / month tokens) instead of raw count, so a high-volume era does not
 *   crowd out words that defined quieter periods. Falls back to raw count when null.
 * @param {number} [limit] how many words (series) to keep
 * @param {Iterable<string>|null} [selectMonths] when given, only these months count
 *   toward the ranking (the window the user zoomed to); every series still spans the
 *   full month axis.
 * @param {number} [minSelectTokens] months with fewer than this many content-word tokens
 *   are ignored when ranking, so a near-empty month cannot inflate a word's share (one
 *   token would otherwise be a 100% month). Only affects share-based ranking.
 * @returns {{series:{label:string,total:number,color?:string,points:{ym:string,n:number,total:number}[]}[], months:string[]}}
 */
export function shapeTopWords(rows, totalsByYm = null, limit = 10, selectMonths = null, minSelectTokens = 0) {
  if (!rows || rows.length === 0) return { series: [], months: [] };

  const months = [...new Set(rows.map((r) => r.ym))].sort();
  const monthIndex = new Map(months.map((ym, i) => [ym, i]));
  const window = selectMonths ? (selectMonths instanceof Set ? selectMonths : new Set(selectMonths)) : null;

  // Per word: total raw count (series metadata), the ranking score (summed monthly
  // share over the window), and the 0-filled monthly counts across the full axis.
  const totalCount = new Map();
  const score = new Map();
  const byWord = new Map();
  for (const r of rows) {
    const n = Number(r.n) || 0;
    totalCount.set(r.word, (totalCount.get(r.word) || 0) + n);
    let arr = byWord.get(r.word);
    if (!arr) {
      arr = new Array(months.length).fill(0);
      byWord.set(r.word, arr);
    }
    arr[monthIndex.get(r.ym)] += n;
    if (!window || window.has(r.ym)) {
      if (totalsByYm && totalsByYm.get) {
        // Share-based ranking, but skip months too sparse to be meaningful: one token
        // would otherwise count as a 100% month and crown a one-off word (e.g. a lone
        // "karácsony" in a month with almost no other content).
        const mt = totalsByYm.get(r.ym);
        if (mt && mt >= minSelectTokens) score.set(r.word, (score.get(r.word) || 0) + n / mt);
      } else {
        score.set(r.word, (score.get(r.word) || 0) + n); // no totals: rank by raw count
      }
    }
  }

  // The `limit` highest-scoring words; ties broken by word for a stable order. If the
  // window contained no rows, fall back to ranking every word by its total count.
  const byScore = (a, b) => score.get(b) - score.get(a) || (a < b ? -1 : a > b ? 1 : 0);
  const byCount = (a, b) => totalCount.get(b) - totalCount.get(a) || (a < b ? -1 : a > b ? 1 : 0);
  const ranked = score.size ? [...score.keys()].sort(byScore) : [...totalCount.keys()].sort(byCount);
  const topWords = ranked.slice(0, limit);

  // Per-month stacked total over the kept words (fallback denominator).
  const monthStackTotal = new Array(months.length).fill(0);
  for (const word of topWords) {
    const arr = byWord.get(word);
    for (let i = 0; i < months.length; i++) monthStackTotal[i] += arr[i];
  }

  // Ratio-mode denominator per month: the cell's total content-word tokens when
  // available (word_month_totals), else the displayed stack sum (absolute-only).
  const denom = months.map((ym, i) => {
    const t = totalsByYm && totalsByYm.get ? totalsByYm.get(ym) : null;
    return t && t > 0 ? t : monthStackTotal[i];
  });

  const series = topWords.map((word) => {
    const arr = byWord.get(word);
    return {
      label: word,
      total: totalCount.get(word),
      points: months.map((ym, i) => ({ ym, n: arr[i], total: denom[i] }))
    };
  });

  return { series, months };
}
